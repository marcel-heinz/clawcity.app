import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { 
  UPGRADE_COSTS,
  UPGRADE_BONUSES,
  MAX_UPGRADE_LEVEL,
  TerrainType
} from '@/lib/types';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import { withAnnouncements } from '@/lib/announcements';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  // Apply rate limiting (per-IP)
  const rateLimit = await checkRateLimit(request, GAME_ACTION_RATE_LIMIT);
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
    const toNumber = (value: unknown, fallback: number): number =>
      typeof value === 'number' && Number.isFinite(value) ? value : fallback;

    // Get current tile with ownership and upgrade info
    const { data: tile, error: tileError } = await supabase
      .from('tiles')
      .select('terrain, owner_id, upgrade_level')
      .eq('x', agent.x)
      .eq('y', agent.y)
      .single();

    if (tileError || !tile) {
      return errorResponse('Could not find your current tile', 500);
    }

    const currentLevel = toNumber(tile.upgrade_level, 1);
    const nextLevel = currentLevel + 1;
    const upgradeCost = UPGRADE_COSTS[nextLevel];
    const expectedNewBonus = UPGRADE_BONUSES[nextLevel]
      ? Math.round((UPGRADE_BONUSES[nextLevel] - 1) * 100)
      : 0;

    if (!upgradeCost) {
      return errorResponse(
        `This territory is already at maximum upgrade level (${MAX_UPGRADE_LEVEL}). ` +
        `Current bonus: +${Math.round((UPGRADE_BONUSES[MAX_UPGRADE_LEVEL] - 1) * 100)}%`,
        400
      );
    }

    const { data: rawResult, error: upgradeError } = await supabase.rpc('upgrade_tile_atomic', {
      p_agent_id: agent.id,
      p_x: agent.x,
      p_y: agent.y,
      p_expected_level: currentLevel,
      p_wood_cost: upgradeCost.wood,
      p_stone_cost: upgradeCost.stone,
      p_max_upgrade_level: MAX_UPGRADE_LEVEL,
      p_new_bonus_percent: expectedNewBonus,
    });

    if (upgradeError) {
      console.error('Atomic upgrade RPC error:', upgradeError);
      return errorResponse('Failed to upgrade tile', 500);
    }

    const result = (rawResult || {}) as Record<string, unknown>;
    const code = typeof result.code === 'string' ? result.code : 'unknown';
    if (result.ok !== true) {
      if (code === 'not_owned') {
        return errorResponse(
          'You can only upgrade territories you own. Claim this tile first.',
          400
        );
      }
      if (code === 'max_level') {
        return errorResponse(
          `This territory is already at maximum upgrade level (${MAX_UPGRADE_LEVEL}). ` +
          `Current bonus: +${Math.round((UPGRADE_BONUSES[MAX_UPGRADE_LEVEL] - 1) * 100)}%`,
          400
        );
      }
      if (code === 'insufficient_resources') {
        const missingResources = Array.isArray(result.missing_resources)
          ? result.missing_resources.filter((v): v is string => typeof v === 'string')
          : [];
        return errorResponse(
          `Not enough resources to upgrade. Missing: ${missingResources.join(', ')}. ` +
          `Level ${nextLevel} upgrade costs: ${upgradeCost.wood} wood, ${upgradeCost.stone} stone.`,
          400
        );
      }
      if (code === 'stale_level') {
        return errorResponse('Tile state changed during upgrade. Refresh and try again.', 409);
      }
      if (code === 'tile_not_found') {
        return errorResponse('Could not find your current tile', 500);
      }
      return errorResponse('Failed to upgrade tile', 500);
    }

    const terrain = typeof result.terrain === 'string'
      ? result.terrain as TerrainType
      : (tile.terrain as TerrainType);
    const fromLevel = toNumber(result.from_level, currentLevel);
    const toLevel = toNumber(result.to_level, nextLevel);
    const inventory = (result.inventory && typeof result.inventory === 'object')
      ? result.inventory as Record<string, unknown>
      : {};

    const newWood = toNumber(inventory.wood, agent.wood - upgradeCost.wood);
    const newStone = toNumber(inventory.stone, agent.stone - upgradeCost.stone);
    const oldBonus = Math.round((UPGRADE_BONUSES[fromLevel] - 1) * 100);
    const newBonus = Math.round((UPGRADE_BONUSES[toLevel] - 1) * 100);

    // Include any new announcements in the response
    const responseData = await withAnnouncements(agent, {
      message: `Territory upgraded from level ${fromLevel} to level ${toLevel}! ` +
        `Gathering bonus increased from +${oldBonus}% to +${newBonus}%. ` +
        `Cost: ${upgradeCost.wood} wood, ${upgradeCost.stone} stone.`,
      position: { x: agent.x, y: agent.y },
      terrain,
      upgrade: {
        from_level: fromLevel,
        to_level: toLevel,
        cost: upgradeCost,
        bonus: {
          old_percent: oldBonus,
          new_percent: newBonus,
          multiplier: UPGRADE_BONUSES[toLevel]
        }
      },
      inventory: {
        gold: agent.gold,
        wood: newWood,
        food: agent.food,
        stone: newStone
      },
      next_upgrade: toLevel < MAX_UPGRADE_LEVEL ? {
        level: toLevel + 1,
        cost: UPGRADE_COSTS[toLevel + 1],
        bonus_percent: Math.round((UPGRADE_BONUSES[toLevel + 1] - 1) * 100)
      } : null
    });

    return jsonResponse({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error('Upgrade error:', error);
    return errorResponse('Internal server error', 500);
  }
}
