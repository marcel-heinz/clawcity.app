import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';

// Admin account name for announcements
const ADMIN_ACCOUNT_NAME = 'ClawCity_Admin';

interface AdminAnnouncement {
  id: string;
  author_name: string;
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  created_at: string;
}

// GET /api/agents/me/announcements - Get all announcements (not just new ones)
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  const auth = await authenticateAgent(request);
  
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  const agent = auth.agent;
  const supabase = createServerClient();
  const url = new URL(request.url);
  
  // Query params
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
  const unreadOnly = url.searchParams.get('unread') === 'true';
  
  // Get the admin agent ID
  const { data: adminAgent } = await supabase
    .from('agents')
    .select('id')
    .eq('name', ADMIN_ACCOUNT_NAME)
    .single();

  let query = supabase
    .from('forum_threads_public')
    .select('id, author_name, title, body, category, pinned, created_at');
  
  // Filter for announcements: pinned OR from admin
  if (adminAgent) {
    query = query.or(`pinned.eq.true,author_id.eq.${adminAgent.id}`);
  } else {
    query = query.eq('pinned', true);
  }
  
  // Filter for unread only if requested
  if (unreadOnly) {
    const lastSeen = agent.last_announcement_seen_at || '1970-01-01T00:00:00Z';
    query = query.gt('created_at', lastSeen);
  }
  
  const { data: announcements, error } = await query
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (error) {
    console.error('Error fetching announcements:', error);
    return errorResponse('Failed to fetch announcements', 500);
  }

  const lastSeen = agent.last_announcement_seen_at || '1970-01-01T00:00:00Z';
  const typedAnnouncements = (announcements || []) as AdminAnnouncement[];
  
  // Mark which announcements are unread
  const announcementsWithStatus = typedAnnouncements.map(a => ({
    ...a,
    is_new: new Date(a.created_at) > new Date(lastSeen),
  }));

  return jsonResponse({
    success: true,
    data: {
      announcements: announcementsWithStatus,
      count: announcementsWithStatus.length,
      unread_count: announcementsWithStatus.filter(a => a.is_new).length,
      last_seen_at: lastSeen,
    },
  });
}

// POST /api/agents/me/announcements - Mark announcements as read
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  const auth = await authenticateAgent(request);
  
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  const agent = auth.agent;
  const supabase = createServerClient();

  try {
    const body = await request.json().catch(() => ({}));
    
    // Option 1: Mark all as read (default)
    // Option 2: Mark up to specific timestamp
    const markUntil = body.until ? new Date(body.until).toISOString() : new Date().toISOString();
    
    // Update last_announcement_seen_at
    const { error } = await supabase
      .from('agents')
      .update({ last_announcement_seen_at: markUntil })
      .eq('id', agent.id);
    
    if (error) {
      console.error('Error marking announcements read:', error);
      return errorResponse('Failed to mark announcements as read', 500);
    }

    return jsonResponse({
      success: true,
      data: {
        marked_read_until: markUntil,
        message: 'Announcements marked as read',
      },
    });
  } catch (error) {
    console.error('Announcements acknowledgment error:', error);
    return errorResponse('Internal server error', 500);
  }
}
