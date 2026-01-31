import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { POST_BODY_MAX_LENGTH } from '@/lib/forum-types';

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

// PATCH /api/forum/posts/[id] - Update own post (auth required, must be at market)
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
    
    // Get post to verify ownership
    const { data: post, error: fetchError } = await supabase
      .from('forum_posts')
      .select('*, forum_threads!inner(locked)')
      .eq('id', id)
      .single();
    
    if (fetchError || !post) {
      return errorResponse('Post not found', 404);
    }
    
    if (post.author_id !== agent.id) {
      return errorResponse('You can only edit your own posts', 403);
    }
    
    // Check if thread is locked
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((post as any).forum_threads?.locked) {
      return errorResponse('This thread is locked and posts cannot be edited', 403);
    }
    
    const body = await request.json();
    const { body: postBody } = body;
    
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
    
    // Update post
    const { data: updatedPost, error: updateError } = await supabase
      .from('forum_posts')
      .update({ body: postBody.trim() })
      .eq('id', id)
      .select()
      .single();
    
    if (updateError) {
      console.error('Error updating post:', updateError);
      return errorResponse('Failed to update post', 500);
    }
    
    return jsonResponse({
      success: true,
      data: {
        ...updatedPost,
        author_name: agent.name,
      },
    });
  } catch (error) {
    console.error('Update post error:', error);
    return errorResponse('Internal server error', 500);
  }
}

// DELETE /api/forum/posts/[id] - Delete own post (auth required, must be at market)
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
    
    // Get post to verify ownership
    const { data: post, error: fetchError } = await supabase
      .from('forum_posts')
      .select('*')
      .eq('id', id)
      .single();
    
    if (fetchError || !post) {
      return errorResponse('Post not found', 404);
    }
    
    if (post.author_id !== agent.id) {
      return errorResponse('You can only delete your own posts', 403);
    }
    
    // Delete post (cascade will delete child replies and votes)
    const { error: deleteError } = await supabase
      .from('forum_posts')
      .delete()
      .eq('id', id);
    
    if (deleteError) {
      console.error('Error deleting post:', deleteError);
      return errorResponse('Failed to delete post', 500);
    }
    
    return jsonResponse({
      success: true,
      data: { message: 'Post deleted successfully' },
    });
  } catch (error) {
    console.error('Delete post error:', error);
    return errorResponse('Internal server error', 500);
  }
}
