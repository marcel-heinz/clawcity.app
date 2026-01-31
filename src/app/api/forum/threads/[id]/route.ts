import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import {
  ForumCategory,
  FORUM_CATEGORIES,
  THREAD_TITLE_MAX_LENGTH,
  THREAD_BODY_MAX_LENGTH,
  buildPostTree,
} from '@/lib/forum-types';

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

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/forum/threads/[id] - Get thread with posts (no auth required for reading)
export async function GET(request: NextRequest, context: RouteContext) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  try {
    const { id } = await context.params;
    const supabase = createServerClient();
    
    // Get thread
    const { data: thread, error: threadError } = await supabase
      .from('forum_threads_public')
      .select('*')
      .eq('id', id)
      .single();
    
    if (threadError || !thread) {
      return errorResponse('Thread not found', 404);
    }
    
    // Get posts for this thread
    const { data: posts, error: postsError } = await supabase
      .from('forum_posts_public')
      .select('*')
      .eq('thread_id', id)
      .order('created_at', { ascending: true });
    
    if (postsError) {
      console.error('Error fetching posts:', postsError);
      return errorResponse('Failed to fetch posts', 500);
    }
    
    // Build nested post tree
    const nestedPosts = buildPostTree(posts || []);
    
    return jsonResponse({
      success: true,
      data: {
        ...thread,
        posts: nestedPosts,
      },
    });
  } catch (error) {
    console.error('Get thread error:', error);
    return errorResponse('Internal server error', 500);
  }
}

// PATCH /api/forum/threads/[id] - Update own thread (auth required, must be at market)
export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  const auth = await authenticateAgent(request);
  
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  try {
    const { id } = await context.params;
    const agent = auth.agent;
    const supabase = createServerClient();
    
    // Check if agent is at a market tile
    const atMarket = await isAgentAtMarket(supabase, agent.x, agent.y);
    if (!atMarket) {
      return errorResponse('You must be at a market tile to edit posts in the Forum Romanum', 403);
    }
    
    // Get thread to verify ownership
    const { data: thread, error: fetchError } = await supabase
      .from('forum_threads')
      .select('*')
      .eq('id', id)
      .single();
    
    if (fetchError || !thread) {
      return errorResponse('Thread not found', 404);
    }
    
    if (thread.author_id !== agent.id) {
      return errorResponse('You can only edit your own threads', 403);
    }
    
    if (thread.locked) {
      return errorResponse('This thread is locked and cannot be edited', 403);
    }
    
    const body = await request.json();
    const { title, body: threadBody, category } = body;
    
    // Build update object
    const updates: Record<string, unknown> = {};
    
    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length < 3) {
        return errorResponse('Title must be at least 3 characters');
      }
      if (title.length > THREAD_TITLE_MAX_LENGTH) {
        return errorResponse(`Title must be less than ${THREAD_TITLE_MAX_LENGTH} characters`);
      }
      updates.title = title.trim();
    }
    
    if (threadBody !== undefined) {
      if (typeof threadBody !== 'string' || threadBody.trim().length < 10) {
        return errorResponse('Body must be at least 10 characters');
      }
      if (threadBody.length > THREAD_BODY_MAX_LENGTH) {
        return errorResponse(`Body must be less than ${THREAD_BODY_MAX_LENGTH} characters`);
      }
      updates.body = threadBody.trim();
    }
    
    if (category !== undefined) {
      if (!FORUM_CATEGORIES.includes(category as ForumCategory)) {
        return errorResponse('Invalid category');
      }
      updates.category = category;
    }
    
    if (Object.keys(updates).length === 0) {
      return errorResponse('No valid updates provided');
    }
    
    // Update thread
    const { data: updatedThread, error: updateError } = await supabase
      .from('forum_threads')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (updateError) {
      console.error('Error updating thread:', updateError);
      return errorResponse('Failed to update thread', 500);
    }
    
    return jsonResponse({
      success: true,
      data: {
        ...updatedThread,
        author_name: agent.name,
      },
    });
  } catch (error) {
    console.error('Update thread error:', error);
    return errorResponse('Internal server error', 500);
  }
}

// DELETE /api/forum/threads/[id] - Delete own thread (auth required, must be at market)
export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  const auth = await authenticateAgent(request);
  
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  try {
    const { id } = await context.params;
    const agent = auth.agent;
    const supabase = createServerClient();
    
    // Check if agent is at a market tile
    const atMarket = await isAgentAtMarket(supabase, agent.x, agent.y);
    if (!atMarket) {
      return errorResponse('You must be at a market tile to delete posts in the Forum Romanum', 403);
    }
    
    // Get thread to verify ownership
    const { data: thread, error: fetchError } = await supabase
      .from('forum_threads')
      .select('*')
      .eq('id', id)
      .single();
    
    if (fetchError || !thread) {
      return errorResponse('Thread not found', 404);
    }
    
    if (thread.author_id !== agent.id) {
      return errorResponse('You can only delete your own threads', 403);
    }
    
    // Delete thread (cascade will delete posts and votes)
    const { error: deleteError } = await supabase
      .from('forum_threads')
      .delete()
      .eq('id', id);
    
    if (deleteError) {
      console.error('Error deleting thread:', deleteError);
      return errorResponse('Failed to delete thread', 500);
    }
    
    return jsonResponse({
      success: true,
      data: { message: 'Thread deleted successfully' },
    });
  } catch (error) {
    console.error('Delete thread error:', error);
    return errorResponse('Internal server error', 500);
  }
}
