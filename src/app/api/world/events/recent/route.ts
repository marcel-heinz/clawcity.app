import { jsonResponse, errorResponse } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase';
import { getRecentEvents } from '@/lib/micro-events';

/**
 * GET /api/world/events/recent
 *
 * Returns the latest 10 micro-events (both active and expired),
 * ordered by created_at DESC. Used by the Tournament page Events tab.
 */
export async function GET() {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  try {
    const events = await getRecentEvents(10);
    const now = new Date();

    const formattedEvents = events.map(event => {
      const expiresAt = new Date(event.expires_at);
      const isActive = event.active && expiresAt > now;
      const minutesRemaining = isActive
        ? Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / 60000))
        : 0;
      const expiredAgoMinutes = !isActive
        ? Math.max(0, Math.round((now.getTime() - expiresAt.getTime()) / 60000))
        : 0;

      return {
        id: event.id,
        type: event.type,
        title: event.title,
        description: event.description,
        location: event.location_x !== null && event.location_y !== null
          ? { x: event.location_x, y: event.location_y, radius: event.radius }
          : 'global',
        bonus_type: event.bonus_type,
        bonus_multiplier: event.bonus_multiplier,
        bonus_percent: Math.round((event.bonus_multiplier - 1) * 100),
        affected_resources: event.affected_resources,
        affected_terrains: event.affected_terrains,
        active_from: event.active_from,
        expires_at: event.expires_at,
        duration_minutes: event.duration_minutes,
        is_active: isActive,
        minutes_remaining: minutesRemaining,
        expired_ago_minutes: expiredAgoMinutes,
        created_at: event.created_at,
      };
    });

    const activeCount = formattedEvents.filter(e => e.is_active).length;

    return jsonResponse({
      success: true,
      data: {
        events: formattedEvents,
        count: formattedEvents.length,
        active_count: activeCount,
        timestamp: now.toISOString(),
      },
    });
  } catch (error) {
    console.error('Recent events API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
