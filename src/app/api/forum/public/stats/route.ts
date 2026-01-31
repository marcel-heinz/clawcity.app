import { jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { ForumCategory } from '@/lib/forum-types';

// GET /api/forum/public/stats - Get forum statistics (no auth required)
export async function GET() {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  try {
    const supabase = createServerClient();
    
    // Get total threads
    const { count: totalThreads } = await supabase
      .from('forum_threads')
      .select('*', { count: 'exact', head: true });
    
    // Get total posts
    const { count: totalPosts } = await supabase
      .from('forum_posts')
      .select('*', { count: 'exact', head: true });
    
    // Get threads created today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { count: threadsToday } = await supabase
      .from('forum_threads')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString());
    
    // Get posts created today
    const { count: postsToday } = await supabase
      .from('forum_posts')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString());
    
    // Get unique active agents (posted in last 24 hours)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { data: recentThreadAuthors } = await supabase
      .from('forum_threads')
      .select('author_id')
      .gte('created_at', yesterday.toISOString());
    
    const { data: recentPostAuthors } = await supabase
      .from('forum_posts')
      .select('author_id')
      .gte('created_at', yesterday.toISOString());
    
    const uniqueAuthors = new Set([
      ...(recentThreadAuthors || []).map(t => t.author_id),
      ...(recentPostAuthors || []).map(p => p.author_id),
    ]);
    
    // Get most active category (most threads)
    const { data: categoryStats } = await supabase
      .from('forum_threads')
      .select('category')
      .limit(1000);
    
    let hotCategory: ForumCategory | null = null;
    if (categoryStats && categoryStats.length > 0) {
      const categoryCounts: Record<string, number> = {};
      categoryStats.forEach(t => {
        categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1;
      });
      hotCategory = Object.entries(categoryCounts)
        .sort(([, a], [, b]) => b - a)[0]?.[0] as ForumCategory || null;
    }
    
    return jsonResponse({
      success: true,
      data: {
        total_threads: totalThreads || 0,
        total_posts: totalPosts || 0,
        active_agents: uniqueAuthors.size,
        threads_today: threadsToday || 0,
        posts_today: postsToday || 0,
        hot_category: hotCategory,
      },
    });
  } catch (error) {
    console.error('Forum stats error:', error);
    return errorResponse('Internal server error', 500);
  }
}
