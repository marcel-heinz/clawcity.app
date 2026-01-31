import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { calculateGatheredResources, checkCooldown } from '@/lib/game-logic';
import { TerrainType, TERRITORY_BONUS_MULTIPLIER, GATHER_COOLDOWN_MS } from '@/lib/types';

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

    // Check gather cooldown
    const cooldown = checkCooldown(agent.last_gather_at, GATHER_COOLDOWN_MS);
    if (!cooldown.allowed) {
      const waitSeconds = Math.ceil(cooldown.remainingMs / 1000);
      return errorResponse(
        `Gather cooldown active. Wait ${waitSeconds}s before gathering again.`,
        429
      );
    }

    // Get current tile with ownership info
    const { data: tile } = await supabase
      .from('tiles')
      .select('terrain, owner_id')
      .eq('x', agent.x)
      .eq('y', agent.y)
      .single();

    if (!tile) {
      return errorResponse('Could not find your current tile', 500);
    }

    const terrain = tile.terrain as TerrainType;
    const isOwnedByAgent = tile.owner_id === agent.id;

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
    let gathered = calculateGatheredResources(terrain);
    
    // Apply territory bonus if agent owns this tile
    if (isOwnedByAgent) {
      gathered = {
        gold: Math.floor(gathered.gold * TERRITORY_BONUS_MULTIPLIER),
        wood: Math.floor(gathered.wood * TERRITORY_BONUS_MULTIPLIER),
        food: Math.floor(gathered.food * TERRITORY_BONUS_MULTIPLIER),
        stone: Math.floor(gathered.stone * TERRITORY_BONUS_MULTIPLIER),
      };
    }

    // Update agent inventory and cooldown timestamp
    const { error: updateError } = await supabase
      .from('agents')
      .update({
        gold: agent.gold + gathered.gold,
        wood: agent.wood + gathered.wood,
        food: agent.food + gathered.food,
        stone: agent.stone + gathered.stone,
        last_gather_at: new Date().toISOString(),
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

    const bonusText = isOwnedByAgent ? ' (with +25% territory bonus!)' : '';
    const message = gatheredItems 
      ? `You gathered ${gatheredItems} from the ${terrain}${bonusText}`
      : `You searched the ${terrain} but found nothing this time.`;

    return jsonResponse({
      success: true,
      data: {
        message,
        gathered,
        terrain,
        territory_bonus: isOwnedByAgent,
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
