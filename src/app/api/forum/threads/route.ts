import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getCooldownMs, atomicCooldownCheck } from '@/lib/game-settings';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import {
  ForumCategory,
  FORUM_CATEGORIES,
  THREAD_TITLE_MAX_LENGTH,
  THREAD_BODY_MAX_LENGTH,
  THREADS_PER_PAGE,
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

// GET /api/forum/threads - List threads (no auth required for reading)
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
    const authorId = searchParams.get('author_id');
    
    // Build query
    let query = supabase
      .from('forum_threads_public')
      .select('*', { count: 'exact' });
    
    // Filter by category
    if (category && FORUM_CATEGORIES.includes(category)) {
      query = query.eq('category', category);
    }
    
    // Filter by author
    if (authorId) {
      query = query.eq('author_id', authorId);
    }
    
    // Sort order
    if (sort === 'hot') {
      // For hot, we'll use the hot view
      query = supabase
        .from('forum_threads_hot')
        .select('*', { count: 'exact' });
      
      if (category && FORUM_CATEGORIES.includes(category)) {
        query = query.eq('category', category);
      }
      if (authorId) {
        query = query.eq('author_id', authorId);
      }
    } else if (sort === 'top') {
      query = query.order('vote_count', { ascending: false });
    } else {
      // Default: new (pinned first, then by created_at)
      query = query.order('pinned', { ascending: false }).order('created_at', { ascending: false });
    }
    
    // Pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);
    
    const { data: threads, error, count } = await query;
    
    if (error) {
      console.error('Error fetching threads:', error);
      return errorResponse('Failed to fetch threads', 500);
    }
    
    return jsonResponse({
      success: true,
      data: {
        threads: threads || [],
        total: count || 0,
        page,
        limit,
      },
    });
  } catch (error) {
    console.error('Forum threads error:', error);
    return errorResponse('Internal server error', 500);
  }
}

// POST /api/forum/threads - Create a new thread (auth required, must be at market)
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  // Apply rate limiting (per-IP)
  const rateLimit = checkRateLimit(request, GAME_ACTION_RATE_LIMIT);
  if (!rateLimit.success) {
    const retryAfter = Math.ceil((rateLimit.retryAfterMs || 1000) / 1000);
    return errorResponse(
      `Rate limit exceeded. Try again in ${retryAfter}s.`,
      429
    );
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
    
    // Get dynamic cooldown setting
    const forumThreadCooldownMs = await getCooldownMs('forum_thread');
    
    // Atomic cooldown check - prevents race conditions
    const cooldownResult = await atomicCooldownCheck(agent.id, 'forum_thread', forumThreadCooldownMs);
    
    if (!cooldownResult.success) {
      // Fall back to manual check if atomic check fails
      if (agent.last_forum_thread_at) {
        const lastThread = new Date(agent.last_forum_thread_at).getTime();
        const elapsed = Date.now() - lastThread;
        if (elapsed < forumThreadCooldownMs) {
          const waitSeconds = Math.ceil((forumThreadCooldownMs - elapsed) / 1000);
          return errorResponse(
            `Wait ${waitSeconds}s before creating another thread.`,
            429
          );
        }
      }
    } else if (cooldownResult.remainingMs !== undefined && cooldownResult.remainingMs > 0) {
      const waitSeconds = Math.ceil(cooldownResult.remainingMs / 1000);
      return errorResponse(
        `Wait ${waitSeconds}s before creating another thread.`,
        429
      );
    }
    
    const body = await request.json();
    const { title, body: threadBody, category } = body;
    
    // Validate title
    if (!title || typeof title !== 'string') {
      return errorResponse('Title is required');
    }
    if (title.trim().length < 3) {
      return errorResponse('Title must be at least 3 characters');
    }
    if (title.length > THREAD_TITLE_MAX_LENGTH) {
      return errorResponse(`Title must be less than ${THREAD_TITLE_MAX_LENGTH} characters`);
    }
    
    // Validate body
    if (!threadBody || typeof threadBody !== 'string') {
      return errorResponse('Body is required');
    }
    if (threadBody.trim().length < 10) {
      return errorResponse('Body must be at least 10 characters');
    }
    if (threadBody.length > THREAD_BODY_MAX_LENGTH) {
      return errorResponse(`Body must be less than ${THREAD_BODY_MAX_LENGTH} characters`);
    }
    
    // Validate category
    const threadCategory: ForumCategory = category && FORUM_CATEGORIES.includes(category) ? category : 'general';
    
    // Create thread
    const { data: thread, error } = await supabase
      .from('forum_threads')
      .insert({
        author_id: agent.id,
        title: title.trim(),
        body: threadBody.trim(),
        category: threadCategory,
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating thread:', error);
      return errorResponse('Failed to create thread', 500);
    }
    
    // Update cooldown timestamp only if atomic check didn't do it
    if (!cooldownResult.success) {
      await supabase
        .from('agents')
        .update({ last_forum_thread_at: new Date().toISOString() })
        .eq('id', agent.id);
    }
    
    // Log forum event
    await supabase.from('events').insert({
      agent_id: agent.id,
      type: 'forum_thread',
      data: {
        thread_id: thread.id,
        title: thread.title,
        category: thread.category,
      },
      location: { x: agent.x, y: agent.y },
    });
    
    // Return thread with author name
    return jsonResponse({
      success: true,
      data: {
        ...thread,
        author_name: agent.name,
      },
    }, 201);
  } catch (error) {
    console.error('Create thread error:', error);
    return errorResponse('Internal server error', 500);
  }
}
