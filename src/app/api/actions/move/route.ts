import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { calculateNewPosition } from '@/lib/game-logic';
import { Direction } from '@/lib/types';
import { getCooldownMs, atomicCooldownCheck } from '@/lib/game-settings';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';

const VALID_DIRECTIONS: Direction[] = ['north', 'south', 'east', 'west'];

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  // Apply rate limiting first (per-IP)
  const rateLimit = checkRateLimit(request, GAME_ACTION_RATE_LIMIT);
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
    const body = await request.json();
    const { direction } = body;

    if (!direction || !VALID_DIRECTIONS.includes(direction)) {
      return errorResponse('Invalid direction. Use: north, south, east, or west');
    }

    const agent = auth.agent;
    const supabase = createServerClient();

    // Get dynamic cooldown setting
    const moveCooldownMs = await getCooldownMs('move');

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

    // Update agent position (cooldown already updated by atomic check, or update now if fallback)
    const updateData: Record<string, unknown> = { 
      x: newPos.x, 
      y: newPos.y,
    };
    
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

    // Get new tile info
    const { data: tile } = await supabase
      .from('tiles')
      .select('terrain')
      .eq('x', newPos.x)
      .eq('y', newPos.y)
      .single();

    // Log move event
    await supabase.from('events').insert({
      agent_id: agent.id,
      type: 'move',
      data: { 
        direction, 
        from: { x: agent.x, y: agent.y },
        to: newPos,
        terrain: tile?.terrain,
      },
      location: newPos,
    });

    // Get nearby agents at new position
    const { data: nearbyAgents } = await supabase
      .from('agents')
      .select('id, name, x, y, reputation')
      .neq('id', agent.id)
      .gte('x', newPos.x - 3)
      .lte('x', newPos.x + 3)
      .gte('y', newPos.y - 3)
      .lte('y', newPos.y + 3);

    return jsonResponse({
      success: true,
      data: {
        message: `Moved ${direction}`,
        position: newPos,
        terrain: tile?.terrain || 'unknown',
        nearby_agents: nearbyAgents || [],
        moved: true,
      },
    });
  } catch (error) {
    console.error('Move error:', error);
    return errorResponse('Internal server error', 500);
  }
}
