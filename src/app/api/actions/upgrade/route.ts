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
import {
  gameplayTableName,
  resolveAgentForContext,
  resolveGameplayContext,
  scopeAgentMutation,
  scopeTileQuery,
} from '@/lib/game-context';

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
    const supabase = createServerClient();
    const context = await resolveGameplayContext(auth.agent.id);
    const agent = await resolveAgentForContext(auth.agent, context);
    const agentsTable = gameplayTableName('agents', context);
    const tilesTable = gameplayTableName('tiles', context);
    const eventsTable = gameplayTableName('events', context);

    const addWorld = <T extends Record<string, unknown>>(payload: T): T | (T & { world_id: string }) => {
      if (context.mode === 'open_world' && context.world_id) {
        return { world_id: context.world_id, ...payload };
      }
      return payload;
    };

    // Get current tile with ownership and upgrade info
    let tileQuery = supabase
      .from(tilesTable)
      .select('terrain, owner_id, upgrade_level');
    tileQuery = scopeTileQuery(tileQuery, context, agent.x, agent.y);
    const { data: tile, error: tileError } = await tileQuery.single();

    if (tileError || !tile) {
      return errorResponse('Could not find your current tile', 500);
    }

    const terrain = tile.terrain as TerrainType;
    const currentLevel = tile.upgrade_level || 1;

    // Check if agent owns this tile
    if (tile.owner_id !== agent.id) {
      return errorResponse(
        'You can only upgrade territories you own. Claim this tile first.',
        400
      );
    }

    // Check if already at max level
    if (currentLevel >= MAX_UPGRADE_LEVEL) {
      return errorResponse(
        `This territory is already at maximum upgrade level (${MAX_UPGRADE_LEVEL}). ` +
        `Current bonus: +${Math.round((UPGRADE_BONUSES[MAX_UPGRADE_LEVEL] - 1) * 100)}%`,
        400
      );
    }

    // Get cost for next upgrade level
    const nextLevel = currentLevel + 1;
    const upgradeCost = UPGRADE_COSTS[nextLevel];

    if (!upgradeCost) {
      return errorResponse('Invalid upgrade level', 500);
    }

    // Check if agent has enough resources
    const missingResources: string[] = [];
    
    if (agent.wood < upgradeCost.wood) {
      missingResources.push(`wood (need ${upgradeCost.wood}, have ${agent.wood})`);
    }
    if (agent.stone < upgradeCost.stone) {
      missingResources.push(`stone (need ${upgradeCost.stone}, have ${agent.stone})`);
    }

    if (missingResources.length > 0) {
      return errorResponse(
        `Not enough resources to upgrade. Missing: ${missingResources.join(', ')}. ` +
        `Level ${nextLevel} upgrade costs: ${upgradeCost.wood} wood, ${upgradeCost.stone} stone.`,
        400
      );
    }

    // Deduct resources from agent
    const newWood = agent.wood - upgradeCost.wood;
    const newStone = agent.stone - upgradeCost.stone;

    let resourceUpdateQuery = supabase
      .from(agentsTable)
      .update({
        wood: newWood,
        stone: newStone
      });
    resourceUpdateQuery = scopeAgentMutation(resourceUpdateQuery, context, agent.id);
    const { error: resourceError } = await resourceUpdateQuery;

    if (resourceError) {
      console.error('Error deducting resources:', resourceError);
      return errorResponse('Failed to process upgrade payment', 500);
    }

    // Upgrade the tile
    let upgradeTileQuery = supabase
      .from(tilesTable)
      .update({ upgrade_level: nextLevel });
    upgradeTileQuery = scopeTileQuery(upgradeTileQuery, context, agent.x, agent.y);
    const { error: upgradeError } = await upgradeTileQuery;

    if (upgradeError) {
      console.error('Error upgrading tile:', upgradeError);
      // Refund resources if upgrade failed
      let refundQuery = supabase
        .from(agentsTable)
        .update({
          wood: agent.wood,
          stone: agent.stone
        });
      refundQuery = scopeAgentMutation(refundQuery, context, agent.id);
      await refundQuery;
      return errorResponse('Failed to upgrade tile', 500);
    }

    // Log upgrade event
    await supabase.from(eventsTable).insert(
      addWorld({
        agent_id: agent.id,
        type: 'upgrade',
        data: {
          terrain,
          from_level: currentLevel,
          to_level: nextLevel,
          cost: upgradeCost,
          new_bonus_percent: Math.round((UPGRADE_BONUSES[nextLevel] - 1) * 100)
        },
        location: { x: agent.x, y: agent.y },
      })
    );

    const oldBonus = Math.round((UPGRADE_BONUSES[currentLevel] - 1) * 100);
    const newBonus = Math.round((UPGRADE_BONUSES[nextLevel] - 1) * 100);

    // Include any new announcements in the response
    const responseData = await withAnnouncements(agent, {
      message: `Territory upgraded from level ${currentLevel} to level ${nextLevel}! ` +
        `Gathering bonus increased from +${oldBonus}% to +${newBonus}%. ` +
        `Cost: ${upgradeCost.wood} wood, ${upgradeCost.stone} stone.`,
      position: { x: agent.x, y: agent.y },
      terrain,
      upgrade: {
        from_level: currentLevel,
        to_level: nextLevel,
        cost: upgradeCost,
        bonus: {
          old_percent: oldBonus,
          new_percent: newBonus,
          multiplier: UPGRADE_BONUSES[nextLevel]
        }
      },
      inventory: {
        gold: agent.gold,
        wood: newWood,
        food: agent.food,
        stone: newStone
      },
      next_upgrade: nextLevel < MAX_UPGRADE_LEVEL ? {
        level: nextLevel + 1,
        cost: UPGRADE_COSTS[nextLevel + 1],
        bonus_percent: Math.round((UPGRADE_BONUSES[nextLevel + 1] - 1) * 100)
      } : null,
      context,
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
