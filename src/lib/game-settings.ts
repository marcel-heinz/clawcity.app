import { createServerClient, isSupabaseConfigured } from './supabase';

// Default cooldown values (in milliseconds)
export const DEFAULT_COOLDOWNS = {
  move: 500,            // 0.5 seconds (fast movement for realtime feel)
  gather: 5000,         // 5 seconds
  trade: 5000,          // 5 seconds
  forum_thread: 60000,  // 60 seconds
  forum_post: 30000,    // 30 seconds
} as const;

export type CooldownType = keyof typeof DEFAULT_COOLDOWNS;

// Cache for settings to avoid DB calls on every request
let settingsCache: Map<string, { value: number; fetchedAt: number }> = new Map();
const CACHE_TTL_MS = 60000; // Cache settings for 1 minute

/**
 * Get a cooldown setting from the database with caching
 * Falls back to default if not found or on error
 */
export async function getCooldownMs(type: CooldownType): Promise<number> {
  const settingKey = `cooldown_${type}_ms`;
  const defaultValue = DEFAULT_COOLDOWNS[type];
  
  // Check cache first
  const cached = settingsCache.get(settingKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.value;
  }

  if (!isSupabaseConfigured) {
    return defaultValue;
  }

  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('game_settings')
      .select('value')
      .eq('key', settingKey)
      .single();

    if (error || !data) {
      return defaultValue;
    }

    const value = parseInt(data.value as string, 10);
    if (isNaN(value) || value < 0) {
      return defaultValue;
    }

    // Update cache
    settingsCache.set(settingKey, { value, fetchedAt: Date.now() });
    return value;
  } catch {
    return defaultValue;
  }
}

/**
 * Get all cooldown settings at once (more efficient for admin dashboard)
 */
export async function getAllCooldowns(): Promise<Record<CooldownType, number>> {
  const result = { ...DEFAULT_COOLDOWNS };
  
  if (!isSupabaseConfigured) {
    return result;
  }

  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('game_settings')
      .select('key, value')
      .like('key', 'cooldown_%');

    if (error || !data) {
      return result;
    }

    for (const row of data) {
      const match = (row.key as string).match(/^cooldown_(\w+)_ms$/);
      if (match) {
        const typeKey = match[1];
        if (typeKey in DEFAULT_COOLDOWNS) {
          const value = parseInt(row.value as string, 10);
          if (!isNaN(value) && value >= 0) {
            (result as Record<string, number>)[typeKey] = value;
            // Update cache
            settingsCache.set(row.key as string, { value, fetchedAt: Date.now() });
          }
        }
      }
    }

    return result;
  } catch {
    return result;
  }
}

/**
 * Update a cooldown setting in the database
 * Returns true on success, false on failure
 */
export async function updateCooldownSetting(type: CooldownType, valueMs: number): Promise<boolean> {
  if (!isSupabaseConfigured) {
    return false;
  }

  const settingKey = `cooldown_${type}_ms`;

  try {
    const supabase = createServerClient();
    const { error } = await supabase
      .from('game_settings')
      .upsert(
        { key: settingKey, value: valueMs.toString() },
        { onConflict: 'key' }
      );

    if (error) {
      console.error('Error updating cooldown setting:', error);
      return false;
    }

    // Invalidate cache
    settingsCache.delete(settingKey);
    return true;
  } catch (error) {
    console.error('Error updating cooldown setting:', error);
    return false;
  }
}

/**
 * Clear the settings cache (useful for testing or forced refresh)
 */
export function clearSettingsCache(): void {
  settingsCache.clear();
}

/**
 * Perform an atomic cooldown check and update using the database function
 * Returns the updated agent if cooldown passed, null if on cooldown
 */
export async function atomicCooldownCheck(
  agentId: string,
  cooldownType: CooldownType,
  cooldownMs: number
): Promise<{ success: boolean; agent?: Record<string, unknown>; remainingMs?: number }> {
  if (!isSupabaseConfigured) {
    return { success: false };
  }

  const columnMap: Record<CooldownType, string> = {
    move: 'last_move_at',
    gather: 'last_gather_at',
    trade: 'last_trade_at',
    forum_thread: 'last_forum_thread_at',
    forum_post: 'last_forum_post_at',
  };

  const column = columnMap[cooldownType];

  try {
    const supabase = createServerClient();
    
    // Use the atomic database function
    const { data, error } = await supabase
      .rpc('check_and_update_cooldown', {
        p_agent_id: agentId,
        p_cooldown_column: column,
        p_cooldown_ms: cooldownMs,
      });

    if (error) {
      console.error('Atomic cooldown check error:', error);
      // Fall back to regular check
      return { success: false };
    }

    if (data && data.length > 0) {
      return { success: true, agent: data[0] };
    }

    // Cooldown active - calculate remaining time
    const { data: agentData } = await supabase
      .from('agents')
      .select(column)
      .eq('id', agentId)
      .single();

    if (agentData && typeof agentData === 'object') {
      const agentRecord = agentData as unknown as Record<string, unknown>;
      if (agentRecord[column]) {
        const lastAction = new Date(agentRecord[column] as string).getTime();
        const elapsed = Date.now() - lastAction;
        const remaining = Math.max(0, cooldownMs - elapsed);
        return { success: false, remainingMs: remaining };
      }
    }

    return { success: false, remainingMs: cooldownMs };
  } catch (error) {
    console.error('Atomic cooldown check error:', error);
    return { success: false };
  }
}
