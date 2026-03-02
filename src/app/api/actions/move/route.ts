import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { calculateNewPosition } from '@/lib/game-logic';
import { Direction } from '@/lib/types';
import { getCooldownMs, atomicCooldownCheck } from '@/lib/game-settings';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import { withAnnouncements } from '@/lib/announcements';
import { getCooldownReduction, getDetectionRange, getItemDefinition, type AgentItem } from '@/lib/crafting';
import { enforceMutationOnboardingGate } from '@/lib/onboarding-gate';

const VALID_DIRECTIONS: Direction[] = ['north', 'south', 'east', 'west'];

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  // Apply rate limiting first (per-IP)
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

  const onboardingGateError = enforceMutationOnboardingGate(auth.agent, 'move');
  if (onboardingGateError) {
    return onboardingGateError;
  }

  try {
    const body = await request.json();
    const { direction } = body;

    if (!direction || !VALID_DIRECTIONS.includes(direction)) {
      return errorResponse('Invalid direction. Use: north, south, east, or west');
    }

    const agent = auth.agent;
    const supabase = createServerClient();

    // Fetch agent items for compass cooldown reduction and spyglass detection
    let agentItems: AgentItem[] = [];
    try {
      const { data: items } = await supabase
        .from('agent_items')
        .select('*')
        .eq('agent_id', agent.id);
      agentItems = ((items || []) as AgentItem[]).filter((item: AgentItem) =>
        item.quantity > 0 && (item.uses_remaining === null || item.uses_remaining > 0)
      );
    } catch {
      // agent_items table may not exist yet
    }

    // Get dynamic cooldown setting, apply compass reduction
    const baseCooldownMs = await getCooldownMs('move');
    const cooldownReduction = getCooldownReduction(agentItems, 'move');
    const moveCooldownMs = Math.floor(baseCooldownMs * (1 - cooldownReduction / 100));

    // Atomic cooldown check - prevents race conditions
    const cooldownResult = await atomicCooldownCheck(agent.id, 'move', moveCooldownMs);
    
    if (cooldownResult.remainingMs !== undefined && cooldownResult.remainingMs > 0) {
      const waitSeconds = Math.ceil(cooldownResult.remainingMs / 1000);
      return errorResponse(
        `Move cooldown active. Wait ${waitSeconds}s before moving again.`,
        429
      );
    }
    
    if (!cooldownResult.success) {
      // If atomic check fails, fall back to manual check (in case DB function doesn't exist yet)
      if (agent.last_move_at) {
        const lastMove = new Date(agent.last_move_at).getTime();
        const elapsed = Date.now() - lastMove;
        if (elapsed < moveCooldownMs) {
          const waitSeconds = Math.ceil((moveCooldownMs - elapsed) / 1000);
          return errorResponse(
            `Move cooldown active. Wait ${waitSeconds}s before moving again.`,
            429
          );
        }
      }
    }

    // Calculate new position
    const newPos = calculateNewPosition(agent.x, agent.y, direction as Direction);

    // Check if position actually changed (edge of map)
    if (newPos.x === agent.x && newPos.y === agent.y) {
      return jsonResponse({
        success: true,
        data: {
          message: 'You are at the edge of the world and cannot move further.',
          position: newPos,
          moved: false,
        },
      });
    }

    // Check destination tile for terrain penalties BEFORE moving
    const { data: destTile } = await supabase
      .from('tiles')
      .select('terrain')
      .eq('x', newPos.x)
      .eq('y', newPos.y)
      .single();

    // Deep water movement penalty (extra stamina cost)
    const DEEP_WATER_STAMINA_COST = 3;
    let deepWaterPenalty = 0;
    let deepWaterWarning = '';
    
    if (destTile?.terrain === 'deep_water') {
      deepWaterPenalty = DEEP_WATER_STAMINA_COST;
      if (agent.food < DEEP_WATER_STAMINA_COST) {
        deepWaterWarning = ' WARNING: Low stamina for deep water travel!';
      }
    }

    // Update agent position (cooldown already updated by atomic check, or update now if fallback)
    const updateData: Record<string, unknown> = { 
      x: newPos.x, 
      y: newPos.y,
    };

    // Apply deep water stamina penalty
    if (deepWaterPenalty > 0) {
      updateData.food = Math.max(0, agent.food - deepWaterPenalty);
    }
    
    // Only set cooldown if atomic check didn't do it
    if (!cooldownResult.success) {
      updateData.last_move_at = new Date().toISOString();
    }

    const { error: updateError } = await supabase
      .from('agents')
      .update(updateData)
      .eq('id', agent.id);

    if (updateError) {
      console.error('Error updating position:', updateError);
      return errorResponse('Failed to move', 500);
    }

    // Log move event
    await supabase.from('events').insert({
      agent_id: agent.id,
      type: 'move',
      data: { 
        direction, 
        from: { x: agent.x, y: agent.y },
        to: newPos,
        terrain: destTile?.terrain,
        deep_water_penalty: deepWaterPenalty > 0 ? deepWaterPenalty : undefined,
      },
      location: newPos,
    });

    // Decrement compass uses (if compass provided cooldown reduction)
    if (cooldownReduction > 0) {
      for (const item of agentItems) {
        const def = getItemDefinition(item.item_id);
        if (!def) continue;
        for (const effect of def.effects) {
          if (effect.type === 'cooldown_reduction' && effect.action === 'move') {
            if (item.uses_remaining !== null && item.uses_remaining > 0) {
              await supabase
                .from('agent_items')
                .update({ uses_remaining: item.uses_remaining - 1 })
                .eq('agent_id', agent.id)
                .eq('item_id', item.item_id);
            }
          }
        }
      }
    }

    // Get nearby agents at new position (opt-in via ?include=nearby to save tokens)
    const includeNearby = request.nextUrl?.searchParams?.get('include')?.includes('nearby');
    let nearbyAgents: { id: string; name: string; x: number; y: number; reputation: number }[] | null = null;
    if (includeNearby) {
      const detectionRange = getDetectionRange(agentItems);
      const { data } = await supabase
        .from('agents')
        .select('id, name, x, y, reputation')
        .neq('id', agent.id)
        .gte('x', newPos.x - detectionRange)
        .lte('x', newPos.x + detectionRange)
        .gte('y', newPos.y - detectionRange)
        .lte('y', newPos.y + detectionRange);
      nearbyAgents = data;
    }

    // Decrement spyglass uses if it extended detection (only when nearby agents were fetched)
    if (includeNearby) {
      const detectionRangeForDecrement = getDetectionRange(agentItems);
      if (detectionRangeForDecrement > 5) {
        for (const item of agentItems) {
          const def = getItemDefinition(item.item_id);
          if (!def) continue;
          for (const effect of def.effects) {
            if (effect.type === 'detection_range') {
              if (item.uses_remaining !== null && item.uses_remaining > 0) {
                await supabase
                  .from('agent_items')
                  .update({ uses_remaining: item.uses_remaining - 1 })
                  .eq('agent_id', agent.id)
                  .eq('item_id', item.item_id);
              }
            }
          }
        }
      }
    }

    // Build response message
    let message = `Moved ${direction}`;
    if (cooldownReduction > 0) {
      message += ` (compass: -${cooldownReduction}% cooldown)`;
    }
    if (deepWaterPenalty > 0) {
      message += ` (deep water: -${deepWaterPenalty} food stamina)${deepWaterWarning}`;
    }

    const includeAnnouncements = request.nextUrl?.searchParams?.get('include')?.includes('announcements');
    const responseData = await withAnnouncements(agent, {
      message,
      position: newPos,
      terrain: destTile?.terrain || 'unknown',
      ...(nearbyAgents ? { nearby_agents: nearbyAgents } : {}),
      moved: true,
      ...(deepWaterPenalty > 0 ? {
        deep_water_penalty: {
          stamina_cost: deepWaterPenalty,
          food_remaining: Math.max(0, agent.food - deepWaterPenalty),
        },
      } : {}),
    }, includeAnnouncements);

    return jsonResponse({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error('Move error:', error);
    return errorResponse('Internal server error', 500);
  }
}
