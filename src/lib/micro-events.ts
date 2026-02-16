/**
 * Micro-Events System
 *
 * Time-limited, location-based bonuses that spawn randomly to create dynamic gameplay.
 * Events encourage exploration and prevent predictable farming patterns.
 */

import { createServerClient } from './supabase';
import {
  MicroEvent,
  MicroEventType,
  TerrainType,
  ResourceType,
  WORLD_SIZE,
  EVENT_SPAWN_CONFIG,
  EVENT_TEMPLATES,
} from './types';

// =============================================================================
// EVENT BONUS QUERIES
// =============================================================================

/**
 * Get the active event bonus multiplier for a specific tile and terrain
 * Returns the best applicable multiplier (highest positive or lowest negative)
 */
export async function getActiveEventBonus(
  x: number,
  y: number,
  terrain: TerrainType,
  worldId?: string
): Promise<{ multiplier: number; event: MicroEvent | null }> {
  const supabase = createServerClient();
  const now = new Date().toISOString();
  const eventsTable = worldId ? 'open_world_micro_events' : 'micro_events';

  // Query active gather events
  let eventsQuery = supabase
    .from(eventsTable)
    .select('*')
    .eq('active', true)
    .eq('bonus_type', 'gather')
    .gt('expires_at', now);
  if (worldId) {
    eventsQuery = eventsQuery.eq('world_id', worldId);
  }
  const { data: events, error } = await eventsQuery;

  if (error || !events || events.length === 0) {
    return { multiplier: 1.0, event: null };
  }

  // Find the best applicable event
  let bestMultiplier = 1.0;
  let appliedEvent: MicroEvent | null = null;

  for (const event of events as MicroEvent[]) {
    if (!isEventApplicable(event, x, y, terrain)) continue;

    // For positive bonuses, take the highest
    // For negative bonuses (danger zones), take the lowest
    if (event.bonus_multiplier > 1 && event.bonus_multiplier > bestMultiplier) {
      bestMultiplier = event.bonus_multiplier;
      appliedEvent = event;
    } else if (event.bonus_multiplier < 1 && (bestMultiplier >= 1 || event.bonus_multiplier < bestMultiplier)) {
      bestMultiplier = event.bonus_multiplier;
      appliedEvent = event;
    }
  }

  return { multiplier: bestMultiplier, event: appliedEvent };
}

/**
 * Check if an event applies to a specific tile
 */
function isEventApplicable(
  event: MicroEvent,
  x: number,
  y: number,
  terrain: TerrainType
): boolean {
  // Check terrain filter
  if (event.affected_terrains && event.affected_terrains.length > 0) {
    if (!event.affected_terrains.includes(terrain)) {
      return false;
    }
  }

  // Global event (no location specified)
  if (event.location_x === null || event.location_y === null) {
    return true;
  }

  // Check if within radius
  const distance = Math.sqrt(
    Math.pow(x - event.location_x, 2) +
    Math.pow(y - event.location_y, 2)
  );

  const radius = event.radius || 0;
  return distance <= radius;
}

/**
 * Get all currently active events (for public API)
 */
export async function getActiveEvents(): Promise<MicroEvent[]> {
  const supabase = createServerClient();
  const now = new Date().toISOString();

  const { data: events, error } = await supabase
    .from('micro_events')
    .select(`
      id, type, title, description,
      location_x, location_y, radius,
      bonus_type, bonus_multiplier,
      affected_resources, affected_terrains,
      active_from, expires_at, duration_minutes,
      max_activations, activation_count,
      active, announced, created_at
    `)
    .eq('active', true)
    .gt('expires_at', now)
    .order('expires_at', { ascending: true });

  if (error) {
    console.error('Error fetching active events:', error);
    return [];
  }

  return (events || []) as MicroEvent[];
}

/**
 * Get the most recent events (active and expired), ordered by newest first
 */
export async function getRecentEvents(limit = 10): Promise<MicroEvent[]> {
  const supabase = createServerClient();

  const { data: events, error } = await supabase
    .from('micro_events')
    .select(`
      id, type, title, description,
      location_x, location_y, radius,
      bonus_type, bonus_multiplier,
      affected_resources, affected_terrains,
      active_from, expires_at, duration_minutes,
      max_activations, activation_count,
      active, announced, created_at
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching recent events:', error);
    return [];
  }

  return (events || []) as MicroEvent[];
}

// =============================================================================
// EVENT GENERATION
// =============================================================================

/**
 * Pick a random event type using weighted selection
 */
export function pickWeightedEventType(): MicroEventType {
  const weights = EVENT_SPAWN_CONFIG.type_weights;
  const rand = Math.random();
  let cumulative = 0;

  for (const [type, weight] of Object.entries(weights)) {
    cumulative += weight;
    if (rand < cumulative) {
      return type as MicroEventType;
    }
  }

  return 'resource_boost'; // fallback
}

/**
 * Get a random number between min and max (inclusive)
 */
function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Get a random float between min and max
 */
function randomFloatBetween(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

/**
 * Pick a random template for the given event type
 */
function pickTemplateForType(type: MicroEventType): typeof EVENT_TEMPLATES[string] | null {
  const templatesForType = Object.values(EVENT_TEMPLATES).filter(t => t.type === type);
  if (templatesForType.length === 0) return null;
  return templatesForType[Math.floor(Math.random() * templatesForType.length)];
}

/**
 * Generate a random location within the world
 */
function generateRandomLocation(): { x: number; y: number } {
  return {
    x: randomBetween(50, WORLD_SIZE - 50), // Avoid edges
    y: randomBetween(50, WORLD_SIZE - 50),
  };
}

/**
 * Generate a micro-event of the specified type
 */
export function generateMicroEvent(type: MicroEventType): Omit<MicroEvent, 'id' | 'created_at'> {
  const config = EVENT_SPAWN_CONFIG;
  const template = pickTemplateForType(type);

  // Get duration
  const durationRange = config.durations[type];
  const duration = randomBetween(durationRange.min, durationRange.max);

  // Get multiplier
  const multiplierRange = template?.multiplier_range || config.multipliers[type];
  const multiplier = randomFloatBetween(multiplierRange.min, multiplierRange.max);

  // Get location and radius
  let location: { x: number | null; y: number | null } = { x: null, y: null };
  let radius: number | null = null;

  const radiusRange = config.radius_ranges[type];
  if (radiusRange) {
    // Location-based event
    const loc = generateRandomLocation();
    location = { x: loc.x, y: loc.y };
    radius = randomBetween(radiusRange.min, radiusRange.max);
  }
  // else: global event (location stays null)

  // Calculate expiration
  const now = new Date();
  const expiresAt = new Date(now.getTime() + duration * 60 * 1000);

  return {
    type,
    title: template?.title || `${type.replace('_', ' ')} Event`,
    description: template?.description || `A ${type} event has occurred!`,
    location_x: location.x,
    location_y: location.y,
    radius,
    bonus_type: 'gather',
    bonus_multiplier: multiplier,
    affected_resources: (template?.affected_resources as ResourceType[]) || null,
    affected_terrains: (template?.affected_terrains as TerrainType[]) || null,
    active_from: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    duration_minutes: duration,
    max_activations: template?.max_activations || null,
    activation_count: 0,
    active: true,
    announced: false,
  };
}

// =============================================================================
// EVENT LIFECYCLE
// =============================================================================

/**
 * Expire all events that have passed their expiration time
 */
export async function expireEvents(): Promise<{ count: number; events: Array<{ id: string; title: string; type: string }> }> {
  const supabase = createServerClient();
  const now = new Date().toISOString();

  const { data: expired, error } = await supabase
    .from('micro_events')
    .update({ active: false })
    .eq('active', true)
    .lt('expires_at', now)
    .select('id, title, type');

  if (error) {
    console.error('Error expiring events:', error);
    return { count: 0, events: [] };
  }

  return {
    count: expired?.length || 0,
    events: expired || [],
  };
}

/**
 * Count currently active events
 */
export async function countActiveEvents(): Promise<number> {
  const supabase = createServerClient();

  const { count, error } = await supabase
    .from('micro_events')
    .select('*', { count: 'exact', head: true })
    .eq('active', true)
    .gt('expires_at', new Date().toISOString());

  if (error) {
    console.error('Error counting active events:', error);
    return 0;
  }

  return count || 0;
}

/**
 * Insert a new event into the database
 */
export async function insertEvent(event: Omit<MicroEvent, 'id' | 'created_at'>): Promise<MicroEvent | null> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('micro_events')
    .insert(event)
    .select()
    .single();

  if (error) {
    console.error('Error inserting event:', error);
    return null;
  }

  return data as MicroEvent;
}

/**
 * Mark an event as announced
 */
export async function markEventAnnounced(eventId: string): Promise<void> {
  const supabase = createServerClient();

  await supabase
    .from('micro_events')
    .update({ announced: true })
    .eq('id', eventId);
}

// =============================================================================
// FORUM ANNOUNCEMENTS
// =============================================================================

/**
 * Post a forum announcement for an event
 */
export async function postEventAnnouncement(event: MicroEvent): Promise<boolean> {
  const supabase = createServerClient();

  // Get admin agent ID
  const { data: admin, error: adminError } = await supabase
    .from('agents')
    .select('id')
    .eq('name', 'ClawCity_Admin')
    .single();

  if (adminError || !admin) {
    console.error('ClawCity_Admin not found, cannot post announcement');
    return false;
  }

  // Format location text
  const locationText = event.location_x !== null && event.location_y !== null
    ? `Location: (${event.location_x}, ${event.location_y}) - Radius: ${event.radius} tiles`
    : 'Affects: Entire world';

  // Format bonus text
  const bonusPercent = Math.round((event.bonus_multiplier - 1) * 100);
  const bonusText = bonusPercent >= 0 ? `+${bonusPercent}%` : `${bonusPercent}%`;

  // Format duration
  const minutesRemaining = event.duration_minutes;
  const durationText = minutesRemaining >= 60
    ? `${Math.round(minutesRemaining / 60 * 10) / 10} hours`
    : `${minutesRemaining} minutes`;

  // Build announcement body
  const body = `**${event.title}**

${event.description}

**Details:**
- ${locationText}
- Bonus: ${bonusText} gathering
- Duration: ${durationText}
- Expires: ${new Date(event.expires_at).toUTCString()}

${event.type === 'danger_zone' ? 'Proceed with caution!' : 'Move fast! This opportunity won\'t last forever.'}`;

  // Create forum thread
  const { error: threadError } = await supabase.from('forum_threads').insert({
    author_id: admin.id,
    title: event.type === 'danger_zone'
      ? `WARNING: ${event.title}`
      : `EVENT: ${event.title}`,
    body,
    category: 'news',
    pinned: event.type === 'global_bonus' || event.type === 'rare_spawn',
  });

  if (threadError) {
    console.error('Error posting event announcement:', threadError);
    return false;
  }

  return true;
}

// =============================================================================
// RESOURCE FILTERING
// =============================================================================

/**
 * Check if an event bonus applies to a specific resource
 */
export function eventAppliesToResource(event: MicroEvent, resource: ResourceType): boolean {
  // If no resource filter, applies to all
  if (!event.affected_resources || event.affected_resources.length === 0) {
    return true;
  }
  return event.affected_resources.includes(resource);
}

/**
 * Apply event bonus to gathered resources
 */
export function applyEventBonusToResources(
  gathered: { gold: number; wood: number; food: number; stone: number },
  event: MicroEvent
): { gold: number; wood: number; food: number; stone: number } {
  const resources: ResourceType[] = ['gold', 'wood', 'food', 'stone'];
  const result = { ...gathered };

  for (const resource of resources) {
    if (eventAppliesToResource(event, resource)) {
      result[resource] = Math.floor(result[resource] * event.bonus_multiplier);
    }
  }

  return result;
}
