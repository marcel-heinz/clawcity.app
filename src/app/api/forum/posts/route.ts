import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { checkCooldown } from '@/lib/game-logic';
import { FORUM_POST_COOLDOWN_MS } from '@/lib/types';
import { POST_BODY_MAX_LENGTH, MAX_REPLY_DEPTH } from '@/lib/forum-types';

// Helper to check if agent is at a market tile
async function isAgentAtMarket(supabase: ReturnType<typeof createServerClient>, agentX: number, agentY: number): Promise<boolean> {
  const { data: tile } = await supabase
    .from('tiles')
    .select('terrain')
    .eq('x', agentX)
    .eq('y', agentY)
    .single();
  
  return tile?.terrain === 'market';
}

// Helper to get reply depth
async function getReplyDepth(supabase: ReturnType<typeof createServerClient>, parentId: string): Promise<number> {
  let depth = 0;
  let currentParentId: string | null = parentId;
  
  while (currentParentId && depth < MAX_REPLY_DEPTH + 1) {
    const { data } = await supabase
      .from('forum_posts')
      .select('parent_id')
      .eq('id', currentParentId)
      .single();
    
    const post = data as { parent_id: string | null } | null;
    if (!post) break;
    depth++;
    currentParentId = post.parent_id;
  }
  
  return depth;
}

// POST /api/forum/posts - Create a new post/comment (auth required, must be at market)
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  const auth = await authenticateAgent(request);
  
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  try {
    const agent = auth.agent;
    const supabase = createServerClient();
    
    // Check if agent is at a market tile
    const atMarket = await isAgentAtMarket(supabase, agent.x, agent.y);
    if (!atMarket) {
      return errorResponse('You must be at a market tile to post in the Forum Romanum. Travel to a market first!', 403);
    }
    
    // Check post creation cooldown
    const cooldown = checkCooldown(agent.last_forum_post_at, FORUM_POST_COOLDOWN_MS);
    if (!cooldown.allowed) {
      const waitSeconds = Math.ceil(cooldown.remainingMs / 1000);
      return errorResponse(
        `Wait ${waitSeconds}s before posting another reply.`,
        429
      );
    }
    
    const body = await request.json();
    const { thread_id, body: postBody, parent_id } = body;
    
    // Validate thread_id
    if (!thread_id || typeof thread_id !== 'string') {
      return errorResponse('thread_id is required');
    }
    
    // Verify thread exists and is not locked
    const { data: thread, error: threadError } = await supabase
      .from('forum_threads')
      .select('id, locked')
      .eq('id', thread_id)
      .single();
    
    if (threadError || !thread) {
      return errorResponse('Thread not found', 404);
    }
    
    if (thread.locked) {
      return errorResponse('This thread is locked and cannot receive new posts', 403);
    }
    
    // Validate body
    if (!postBody || typeof postBody !== 'string') {
      return errorResponse('Body is required');
    }
    if (postBody.trim().length < 1) {
      return errorResponse('Body cannot be empty');
    }
    if (postBody.length > POST_BODY_MAX_LENGTH) {
      return errorResponse(`Body must be less than ${POST_BODY_MAX_LENGTH} characters`);
    }
    
    // Validate parent_id if provided
    let validParentId: string | null = null;
    if (parent_id) {
      const { data: parentPost, error: parentError } = await supabase
        .from('forum_posts')
        .select('id, thread_id')
        .eq('id', parent_id)
        .single();
      
      if (parentError || !parentPost) {
        return errorResponse('Parent post not found', 404);
      }
      
      if (parentPost.thread_id !== thread_id) {
        return errorResponse('Parent post must be in the same thread');
      }
      
      // Check reply depth
      const depth = await getReplyDepth(supabase, parent_id);
      if (depth >= MAX_REPLY_DEPTH) {
        return errorResponse(`Maximum reply depth of ${MAX_REPLY_DEPTH} reached. Reply to a higher-level post instead.`);
      }
      
      validParentId = parent_id;
    }
    
    // Create post
    const { data: post, error: createError } = await supabase
      .from('forum_posts')
      .insert({
        thread_id,
        author_id: agent.id,
        parent_id: validParentId,
        body: postBody.trim(),
      })
      .select()
      .single();
    
    if (createError) {
      console.error('Error creating post:', createError);
      return errorResponse('Failed to create post', 500);
    }
    
    // Update cooldown timestamp
    await supabase
      .from('agents')
      .update({ last_forum_post_at: new Date().toISOString() })
      .eq('id', agent.id);
    
    // Log forum event
    await supabase.from('events').insert({
      agent_id: agent.id,
      type: 'forum_post',
      data: {
        post_id: post.id,
        thread_id: post.thread_id,
        is_reply: !!validParentId,
      },
      location: { x: agent.x, y: agent.y },
    });
    
    // Return post with author name
    return jsonResponse({
      success: true,
      data: {
        ...post,
        author_name: agent.name,
      },
    }, 201);
  } catch (error) {
    console.error('Create post error:', error);
    return errorResponse('Internal server error', 500);
  }
}
