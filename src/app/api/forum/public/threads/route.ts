import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import {
  ForumCategory,
  FORUM_CATEGORIES,
  THREADS_PER_PAGE,
} from '@/lib/forum-types';

// GET /api/forum/public/threads - Public thread listing (no auth required)
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    
    // Parse query params
    const category = searchParams.get('category') as ForumCategory | null;
    const sort = searchParams.get('sort') || 'new';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || String(THREADS_PER_PAGE))));
    
    // Build query based on sort type
    let query;
    
    if (sort === 'hot') {
      // Use hot view for trending content
      query = supabase
        .from('forum_threads_hot')
        .select('*', { count: 'exact' });
    } else {
      query = supabase
        .from('forum_threads_public')
        .select('*', { count: 'exact' });
    }
    
    // Filter by category
    if (category && FORUM_CATEGORIES.includes(category)) {
      query = query.eq('category', category);
    }
    
    // Apply sorting for non-hot queries
    if (sort === 'top') {
      query = query.order('vote_count', { ascending: false });
    } else if (sort !== 'hot') {
      // Default: new (pinned first, then by created_at)
      query = query.order('pinned', { ascending: false }).order('created_at', { ascending: false });
    }
    
    // Pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);
    
    const { data: threads, error, count } = await query;
    
    if (error) {
      console.error('Error fetching public threads:', error);
      return errorResponse('Failed to fetch threads', 500);
    }
    
    // Add CORS headers for shareability
    const response = jsonResponse({
      success: true,
      data: {
        threads: threads || [],
        total: count || 0,
        page,
        limit,
      },
    });
    
    return response;
  } catch (error) {
    console.error('Public threads error:', error);
    return errorResponse('Internal server error', 500);
  }
}
