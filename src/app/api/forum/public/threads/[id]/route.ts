import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { buildPostTree } from '@/lib/forum-types';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/forum/public/threads/[id] - Get single thread with comments (no auth required)
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
    console.error('Get public thread error:', error);
    return errorResponse('Internal server error', 500);
  }
}
