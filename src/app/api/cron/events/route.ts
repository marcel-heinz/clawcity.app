import { NextRequest } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { EVENT_SPAWN_CONFIG } from '@/lib/types';
import {
  expireEvents,
  countActiveEvents,
  pickWeightedEventType,
  generateMicroEvent,
  insertEvent,
  postEventAnnouncement,
  markEventAnnounced,
} from '@/lib/micro-events';

/**
 * GET /api/cron/events
 *
 * Hourly cron job to manage micro-events:
 *
 * 1. Expire events that have passed their expires_at time
 * 2. Roll to spawn a new event (75% chance per hour)
 * 3. Pick event type via weighted random selection
 * 4. Post forum announcement for the new event
 *
 * Called every hour at minute 30 via Vercel Cron: "30 * * * *"
 * (Offset from upkeep cron at minute 0)
 */
export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return errorResponse('Unauthorized', 401);
  }

  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 500);
  }

  try {
    const now = new Date();
    const results: string[] = [];

    // 1. Expire old events
    const { count: expiredCount, events: expiredEvents } = await expireEvents();
    if (expiredCount > 0) {
      results.push(`Expired ${expiredCount} events: ${expiredEvents.map(e => e.title).join(', ')}`);
    }

    // 2. Count currently active events
    const activeCount = await countActiveEvents();
    results.push(`Active events: ${activeCount}/${EVENT_SPAWN_CONFIG.max_active_events}`);

    // 3. Maybe spawn a new event
    let spawnedEvent = null;
    let spawnMessage = 'No event spawned';

    if (activeCount < EVENT_SPAWN_CONFIG.max_active_events) {
      // Roll base spawn chance (75%)
      const roll = Math.random();
      if (roll < EVENT_SPAWN_CONFIG.base_spawn_chance) {
        // Pick event type using weighted selection
        const eventType = pickWeightedEventType();
        const eventData = generateMicroEvent(eventType);
        spawnedEvent = await insertEvent(eventData);

        if (spawnedEvent) {
          spawnMessage = `Spawned: ${spawnedEvent.title} (${spawnedEvent.type})`;
          if (spawnedEvent.location_x !== null) {
            spawnMessage += ` at (${spawnedEvent.location_x}, ${spawnedEvent.location_y}) r=${spawnedEvent.radius}`;
          } else {
            spawnMessage += ' (global)';
          }
          spawnMessage += ` +${Math.round((spawnedEvent.bonus_multiplier - 1) * 100)}% for ${spawnedEvent.duration_minutes}min`;
          results.push(spawnMessage);

          // 4. Post forum announcement
          const announced = await postEventAnnouncement(spawnedEvent);
          if (announced) {
            await markEventAnnounced(spawnedEvent.id);
            results.push(`Announced event on forum`);
          } else {
            results.push(`Failed to announce event (ClawCity_Admin may not exist)`);
          }
        } else {
          results.push('Failed to insert event');
        }
      } else {
        results.push(`Spawn roll failed: ${(roll * 100).toFixed(1)}% > ${EVENT_SPAWN_CONFIG.base_spawn_chance * 100}% threshold`);
      }
    } else {
      results.push(`At max events (${EVENT_SPAWN_CONFIG.max_active_events}), skipping spawn`);
    }

    return jsonResponse({
      success: true,
      data: {
        timestamp: now.toISOString(),
        events_expired: expiredCount,
        event_spawned: spawnedEvent ? {
          id: spawnedEvent.id,
          title: spawnedEvent.title,
          type: spawnedEvent.type,
          multiplier: spawnedEvent.bonus_multiplier,
          duration_minutes: spawnedEvent.duration_minutes,
          location: spawnedEvent.location_x !== null
            ? { x: spawnedEvent.location_x, y: spawnedEvent.location_y, radius: spawnedEvent.radius }
            : 'global',
        } : null,
        active_event_count: activeCount + (spawnedEvent ? 1 : 0) - expiredCount,
        details: results,
      },
    });
  } catch (error) {
    console.error('Cron events error:', error);
    return errorResponse('Internal server error', 500);
  }
}

// Also support POST for manual triggers
export { GET as POST };
