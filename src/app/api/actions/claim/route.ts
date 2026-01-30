import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { 
  CLAIM_COST_GOLD, 
  MAX_TERRITORIES_PER_AGENT,
  TerrainType 
} from '@/lib/types';

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

    // Check if agent has enough gold
    if (agent.gold < CLAIM_COST_GOLD) {
      return errorResponse(
        `Not enough gold to claim this tile. Cost: ${CLAIM_COST_GOLD} gold, You have: ${agent.gold} gold`,
        400
      );
    }

    // Get current tile
    const { data: tile, error: tileError } = await supabase
      .from('tiles')
      .select('terrain, owner_id')
      .eq('x', agent.x)
      .eq('y', agent.y)
      .single();

    if (tileError || !tile) {
      return errorResponse('Could not find your current tile', 500);
    }

    const terrain = tile.terrain as TerrainType;

    // Cannot claim markets or water
    if (terrain === 'market') {
      return errorResponse('Markets cannot be claimed - they belong to everyone.', 400);
    }

    if (terrain === 'water') {
      return errorResponse('Water tiles cannot be claimed.', 400);
    }

    // Check if tile is already owned
    if (tile.owner_id) {
      if (tile.owner_id === agent.id) {
        return errorResponse('You already own this tile!', 400);
      }
      
      // Get owner name for better error message
      const { data: owner } = await supabase
        .from('agents')
        .select('name')
        .eq('id', tile.owner_id)
        .single();
      
      return errorResponse(
        `This tile is already claimed by ${owner?.name || 'another agent'}. Trade with them to acquire it.`,
        400
      );
    }

    // Count agent's current territories
    const { count: territoryCount } = await supabase
      .from('tiles')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', agent.id);

    if ((territoryCount || 0) >= MAX_TERRITORIES_PER_AGENT) {
      return errorResponse(
        `You have reached the maximum of ${MAX_TERRITORIES_PER_AGENT} territories. Trade or release tiles to claim more.`,
        400
      );
    }

    // Deduct gold from agent
    const { error: goldError } = await supabase
      .from('agents')
      .update({ gold: agent.gold - CLAIM_COST_GOLD })
      .eq('id', agent.id);

    if (goldError) {
      console.error('Error deducting gold:', goldError);
      return errorResponse('Failed to process claim payment', 500);
    }

    // Claim the tile
    const { error: claimError } = await supabase
      .from('tiles')
      .update({ 
        owner_id: agent.id,
        claimed_at: new Date().toISOString()
      })
      .eq('x', agent.x)
      .eq('y', agent.y);

    if (claimError) {
      console.error('Error claiming tile:', claimError);
      // Refund gold if claim failed
      await supabase
        .from('agents')
        .update({ gold: agent.gold })
        .eq('id', agent.id);
      return errorResponse('Failed to claim tile', 500);
    }

    // Log claim event
    await supabase.from('events').insert({
      agent_id: agent.id,
      type: 'claim',
      data: { 
        terrain,
        cost: CLAIM_COST_GOLD,
        territory_count: (territoryCount || 0) + 1,
      },
      location: { x: agent.x, y: agent.y },
    });

    return jsonResponse({
      success: true,
      data: {
        message: `You have claimed this ${terrain} tile for ${CLAIM_COST_GOLD} gold. You now receive +25% resources when gathering here.`,
        position: { x: agent.x, y: agent.y },
        terrain,
        cost: CLAIM_COST_GOLD,
        gold_remaining: agent.gold - CLAIM_COST_GOLD,
        territory_count: (territoryCount || 0) + 1,
        max_territories: MAX_TERRITORIES_PER_AGENT,
      },
    });
  } catch (error) {
    console.error('Claim error:', error);
    return errorResponse('Internal server error', 500);
  }
}
