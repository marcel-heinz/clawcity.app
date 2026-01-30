import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { calculateGatheredResources } from '@/lib/game-logic';
import { TerrainType } from '@/lib/types';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  const auth = await authenticateAgent(request);
  
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  try {
    const agent = auth.agent;
    const supabase = createServerClient();

    // Get current tile
    const { data: tile } = await supabase
      .from('tiles')
      .select('terrain')
      .eq('x', agent.x)
      .eq('y', agent.y)
      .single();

    if (!tile) {
      return errorResponse('Could not find your current tile', 500);
    }

    const terrain = tile.terrain as TerrainType;

    // Markets don't produce resources
    if (terrain === 'market') {
      return jsonResponse({
        success: true,
        data: {
          message: 'Markets are for trading, not gathering. Visit forests, plains, or mountains for resources.',
          gathered: { gold: 0, wood: 0, food: 0, stone: 0 },
          terrain,
        },
      });
    }

    // Water can be gathered from but less efficiently
    if (terrain === 'water') {
      return jsonResponse({
        success: true,
        data: {
          message: 'You fish in the water and catch some food.',
          gathered: { gold: 0, wood: 0, food: Math.floor(Math.random() * 2) + 1, stone: 0 },
          terrain,
        },
      });
    }

    // Calculate resources based on terrain
    const gathered = calculateGatheredResources(terrain);

    // Update agent inventory
    const { error: updateError } = await supabase
      .from('agents')
      .update({
        gold: agent.gold + gathered.gold,
        wood: agent.wood + gathered.wood,
        food: agent.food + gathered.food,
        stone: agent.stone + gathered.stone,
      })
      .eq('id', agent.id);

    if (updateError) {
      console.error('Error updating inventory:', updateError);
      return errorResponse('Failed to gather resources', 500);
    }

    // Log gather event
    await supabase.from('events').insert({
      agent_id: agent.id,
      type: 'gather',
      data: { 
        terrain,
        resources: gathered,
      },
      location: { x: agent.x, y: agent.y },
    });

    // Format message based on what was gathered
    const gatheredItems = Object.entries(gathered)
      .filter(([, amount]) => amount > 0)
      .map(([resource, amount]) => `${amount} ${resource}`)
      .join(', ');

    const message = gatheredItems 
      ? `You gathered ${gatheredItems} from the ${terrain}.`
      : `You searched the ${terrain} but found nothing this time.`;

    return jsonResponse({
      success: true,
      data: {
        message,
        gathered,
        terrain,
        inventory: {
          gold: agent.gold + gathered.gold,
          wood: agent.wood + gathered.wood,
          food: agent.food + gathered.food,
          stone: agent.stone + gathered.stone,
        },
      },
    });
  } catch (error) {
    console.error('Gather error:', error);
    return errorResponse('Internal server error', 500);
  }
}
