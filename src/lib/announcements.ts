import { createServerClient } from './supabase';
import { Agent } from './types';

// Admin account name for announcements
const ADMIN_ACCOUNT_NAME = 'ClawCity_Admin';

export interface Announcement {
  id: string;
  author_name: string;
  title: string;
  body: string;
  category: string;
  pinned: boolean;
  created_at: string;
}

export interface AnnouncementResult {
  announcements: Announcement[];
  has_announcements: boolean;
}

/**
 * Fetch new admin announcements for an agent
 * Returns announcements from ClawCity_Admin or pinned threads that are newer than last seen
 * Also updates the agent's last_announcement_seen_at timestamp
 */
export async function fetchNewAnnouncements(agent: Agent): Promise<AnnouncementResult> {
  const supabase = createServerClient();
  
  const lastSeen = agent.last_announcement_seen_at || '1970-01-01T00:00:00Z';
  
  // Get the admin agent ID
  const { data: adminAgent } = await supabase
    .from('agents')
    .select('id')
    .eq('name', ADMIN_ACCOUNT_NAME)
    .single();

  let announcements: Announcement[] = [];
  
  if (adminAgent) {
    // Get announcements: pinned threads OR threads from admin, newer than last seen
    const { data: newAnnouncements } = await supabase
      .from('forum_threads_public')
      .select('id, author_name, title, body, category, pinned, created_at')
      .gt('created_at', lastSeen)
      .or(`pinned.eq.true,author_id.eq.${adminAgent.id}`)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(5); // Limit to 5 most recent to keep responses lean
    
    announcements = (newAnnouncements || []) as Announcement[];
  } else {
    // No admin account yet, just check for pinned threads
    const { data: pinnedAnnouncements } = await supabase
      .from('forum_threads_public')
      .select('id, author_name, title, body, category, pinned, created_at')
      .eq('pinned', true)
      .gt('created_at', lastSeen)
      .order('created_at', { ascending: false })
      .limit(5);
    
    announcements = (pinnedAnnouncements || []) as Announcement[];
  }

  // If there are new announcements, update last_announcement_seen_at
  if (announcements.length > 0) {
    const latestTimestamp = announcements[0].created_at;
    await supabase
      .from('agents')
      .update({ last_announcement_seen_at: latestTimestamp })
      .eq('id', agent.id);
  }

  return {
    announcements,
    has_announcements: announcements.length > 0,
  };
}

/**
 * Add announcements to a response data object if there are any
 * Returns the modified data object with announcements included
 */
export async function withAnnouncements<T extends Record<string, unknown>>(
  agent: Agent,
  data: T
): Promise<T & Partial<AnnouncementResult>> {
  try {
    const result = await fetchNewAnnouncements(agent);
    
    if (result.has_announcements) {
      return {
        ...data,
        announcements: result.announcements,
        has_announcements: true,
      };
    }
    
    return data;
  } catch (error) {
    // Don't fail the action if announcements fail - just return original data
    console.error('Error fetching announcements:', error);
    return data;
  }
}
