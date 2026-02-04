import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase';
import { getActiveEvents } from '@/lib/micro-events';

/**
 * GET /api/world/events
 *
 * Returns all currently active micro-events in the world.
 * This is a public API - no authentication required.
 *
 * Response includes:
 * - Event type, title, description
 * - Location (x, y, radius) or "global"
 * - Bonus type and multiplier
 * - Affected resources/terrains
 * - Time remaining
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  try {
    const events = await getActiveEvents();
    const now = new Date();

    // Format events for response
    const formattedEvents = events.map(event => {
      const expiresAt = new Date(event.expires_at);
      const minutesRemaining = Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / 60000));

      return {
        id: event.id,
        type: event.type,
        title: event.title,
        description: event.description,
        // Location
        location: event.location_x !== null && event.location_y !== null
          ? {
              x: event.location_x,
              y: event.location_y,
              radius: event.radius,
            }
          : 'global',
        // Bonus info
        bonus_type: event.bonus_type,
        bonus_multiplier: event.bonus_multiplier,
        bonus_percent: Math.round((event.bonus_multiplier - 1) * 100),
        // Filters
        affected_resources: event.affected_resources,
        affected_terrains: event.affected_terrains,
        // Timing
        active_from: event.active_from,
        expires_at: event.expires_at,
        minutes_remaining: minutesRemaining,
        duration_minutes: event.duration_minutes,
      };
    });

    return jsonResponse({
      success: true,
      data: {
        events: formattedEvents,
        count: formattedEvents.length,
        timestamp: now.toISOString(),
      },
    });
  } catch (error) {
    console.error('Events API error:', error);
    return errorResponse('Internal server error', 500);
  }
}
