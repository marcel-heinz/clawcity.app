import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { calculateNewPosition, checkCooldown } from '@/lib/game-logic';
import { Direction, MOVE_COOLDOWN_MS } from '@/lib/types';

const VALID_DIRECTIONS: Direction[] = ['north', 'south', 'east', 'west'];

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
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

    // Check move cooldown
    const cooldown = checkCooldown(agent.last_move_at, MOVE_COOLDOWN_MS);
    if (!cooldown.allowed) {
      const waitSeconds = Math.ceil(cooldown.remainingMs / 1000);
      return errorResponse(
        `Move cooldown active. Wait ${waitSeconds}s before moving again.`,
        429
      );
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

    // Update agent position and cooldown timestamp
    const { error: updateError } = await supabase
      .from('agents')
      .update({ 
        x: newPos.x, 
        y: newPos.y,
        last_move_at: new Date().toISOString()
      })
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
