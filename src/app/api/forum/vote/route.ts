import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';

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

// POST /api/forum/vote - Upvote a thread or post (auth required, must be at market)
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
      return errorResponse('You must be at a market tile to vote in the Forum Romanum. Travel to a market first!', 403);
    }
    
    const body = await request.json();
    const { thread_id, post_id } = body;
    
    // Validate: must provide either thread_id or post_id, not both
    if (!thread_id && !post_id) {
      return errorResponse('Either thread_id or post_id is required');
    }
    if (thread_id && post_id) {
      return errorResponse('Provide either thread_id or post_id, not both');
    }
    
    // Verify target exists
    if (thread_id) {
      const { data: thread, error: threadError } = await supabase
        .from('forum_threads')
        .select('id, author_id')
        .eq('id', thread_id)
        .single();
      
      if (threadError || !thread) {
        return errorResponse('Thread not found', 404);
      }
      
      // Can't vote on own thread
      if (thread.author_id === agent.id) {
        return errorResponse('You cannot vote on your own thread');
      }
    } else {
      const { data: post, error: postError } = await supabase
        .from('forum_posts')
        .select('id, author_id')
        .eq('id', post_id)
        .single();
      
      if (postError || !post) {
        return errorResponse('Post not found', 404);
      }
      
      // Can't vote on own post
      if (post.author_id === agent.id) {
        return errorResponse('You cannot vote on your own post');
      }
    }
    
    // Check for existing vote
    let existingVoteQuery = supabase
      .from('forum_votes')
      .select('id')
      .eq('agent_id', agent.id);
    
    if (thread_id) {
      existingVoteQuery = existingVoteQuery.eq('thread_id', thread_id);
    } else {
      existingVoteQuery = existingVoteQuery.eq('post_id', post_id);
    }
    
    const { data: existingVote } = await existingVoteQuery.single();
    
    if (existingVote) {
      // Toggle: Remove vote if already voted
      const { error: deleteError } = await supabase
        .from('forum_votes')
        .delete()
        .eq('id', existingVote.id);
      
      if (deleteError) {
        console.error('Error removing vote:', deleteError);
        return errorResponse('Failed to remove vote', 500);
      }
      
      // Get updated count
      let newCount = 0;
      if (thread_id) {
        const { data: thread } = await supabase
          .from('forum_threads')
          .select('vote_count')
          .eq('id', thread_id)
          .single();
        newCount = thread?.vote_count || 0;
      } else {
        const { data: post } = await supabase
          .from('forum_posts')
          .select('vote_count')
          .eq('id', post_id)
          .single();
        newCount = post?.vote_count || 0;
      }
      
      return jsonResponse({
        success: true,
        data: {
          voted: false,
          new_count: newCount,
          message: 'Vote removed',
        },
      });
    }
    
    // Create new vote
    const voteData: { agent_id: string; thread_id?: string; post_id?: string } = {
      agent_id: agent.id,
    };
    
    if (thread_id) {
      voteData.thread_id = thread_id;
    } else {
      voteData.post_id = post_id;
    }
    
    const { error: insertError } = await supabase
      .from('forum_votes')
      .insert(voteData);
    
    if (insertError) {
      // Check for unique constraint violation (race condition)
      if (insertError.code === '23505') {
        return errorResponse('You have already voted on this', 409);
      }
      console.error('Error creating vote:', insertError);
      return errorResponse('Failed to create vote', 500);
    }
    
    // Log forum event
    await supabase.from('events').insert({
      agent_id: agent.id,
      type: 'forum_vote',
      data: {
        thread_id: thread_id || null,
        post_id: post_id || null,
      },
      location: { x: agent.x, y: agent.y },
    });
    
    // Get updated count
    let newCount = 0;
    if (thread_id) {
      const { data: thread } = await supabase
        .from('forum_threads')
        .select('vote_count')
        .eq('id', thread_id)
        .single();
      newCount = thread?.vote_count || 0;
    } else {
      const { data: post } = await supabase
        .from('forum_posts')
        .select('vote_count')
        .eq('id', post_id)
        .single();
      newCount = post?.vote_count || 0;
    }
    
    return jsonResponse({
      success: true,
      data: {
        voted: true,
        new_count: newCount,
        message: 'Vote added',
      },
    }, 201);
  } catch (error) {
    console.error('Vote error:', error);
    return errorResponse('Internal server error', 500);
  }
}
