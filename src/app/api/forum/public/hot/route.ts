import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';

// GET /api/forum/public/hot - Get hot/trending threads (no auth required)
// Optimized for sharing and viral content
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  try {
    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    
    const limit = Math.min(20, Math.max(1, parseInt(searchParams.get('limit') || '10')));
    
    // Get hot threads using the hot view
    const { data: threads, error } = await supabase
      .from('forum_threads_hot')
      .select('*')
      .limit(limit);
    
    if (error) {
      console.error('Error fetching hot threads:', error);
      return errorResponse('Failed to fetch hot threads', 500);
    }
    
    return jsonResponse({
      success: true,
      data: {
        threads: threads || [],
        generated_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Hot threads error:', error);
    return errorResponse('Internal server error', 500);
  }
}
