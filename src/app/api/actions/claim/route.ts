import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { 
  CLAIM_COST_GOLD, 
  MAX_TERRITORIES_PER_AGENT,
  TerrainType,
  TERRITORY_UPKEEP_GOLD,
  UPKEEP_PERIOD_MS
} from '@/lib/types';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';

// Helper: Process territory upkeep for an agent (same as in gather route)
async function processUpkeep(
  supabase: ReturnType<typeof createServerClient>,
  agentId: string,
  currentGold: number
): Promise<{ goldDeducted: number; territoriesLost: number; newGold: number }> {
  let goldDeducted = 0;
  let territoriesLost = 0;
  let newGold = currentGold;

  // Get all tiles owned by this agent
  const { data: ownedTiles } = await supabase
    .from('tiles')
    .select('x, y, last_upkeep_paid, claimed_at')
    .eq('owner_id', agentId);

  if (!ownedTiles || ownedTiles.length === 0) {
    return { goldDeducted: 0, territoriesLost: 0, newGold: currentGold };
  }

  const now = Date.now();

  for (const tile of ownedTiles) {
    const lastPaid = tile.last_upkeep_paid 
      ? new Date(tile.last_upkeep_paid).getTime() 
      : tile.claimed_at 
        ? new Date(tile.claimed_at).getTime()
        : now;
    
    const msSinceLastPaid = now - lastPaid;
    const daysOverdue = Math.floor(msSinceLastPaid / UPKEEP_PERIOD_MS);

    if (daysOverdue >= 1) {
      const upkeepDue = daysOverdue * TERRITORY_UPKEEP_GOLD;

      if (newGold >= upkeepDue) {
        // Pay upkeep
        newGold -= upkeepDue;
        goldDeducted += upkeepDue;

        await supabase
          .from('tiles')
          .update({ last_upkeep_paid: new Date().toISOString() })
          .eq('x', tile.x)
          .eq('y', tile.y);
      } else {
        // Can't afford - release territory
        await supabase
          .from('tiles')
          .update({ 
            owner_id: null, 
            claimed_at: null, 
            last_upkeep_paid: null 
          })
          .eq('x', tile.x)
          .eq('y', tile.y);

        territoriesLost++;
      }
    }
  }

  // Update agent's gold if any was deducted
  if (goldDeducted > 0) {
    await supabase
      .from('agents')
      .update({ gold: newGold })
      .eq('id', agentId);
  }

  return { goldDeducted, territoriesLost, newGold };
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  // Apply rate limiting (per-IP)
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
    const agent = auth.agent;
    const supabase = createServerClient();

    // Process territory upkeep before claiming
    const upkeepResult = await processUpkeep(supabase, agent.id, agent.gold);
    let currentGold = upkeepResult.newGold;

    // Check if agent has enough gold (after upkeep)
    if (currentGold < CLAIM_COST_GOLD) {
      return errorResponse(
        `Not enough gold to claim this tile. Cost: ${CLAIM_COST_GOLD} gold, You have: ${currentGold} gold` +
        (upkeepResult.goldDeducted > 0 ? ` (${upkeepResult.goldDeducted} gold was deducted for territory upkeep)` : ''),
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

    // Count agent's current territories (after potential upkeep losses)
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
    const newGoldAfterClaim = currentGold - CLAIM_COST_GOLD;
    const { error: goldError } = await supabase
      .from('agents')
      .update({ gold: newGoldAfterClaim })
      .eq('id', agent.id);

    if (goldError) {
      console.error('Error deducting gold:', goldError);
      return errorResponse('Failed to process claim payment', 500);
    }

    // Claim the tile with upkeep timestamp
    const claimTimestamp = new Date().toISOString();
    const { error: claimError } = await supabase
      .from('tiles')
      .update({ 
        owner_id: agent.id,
        claimed_at: claimTimestamp,
        last_upkeep_paid: claimTimestamp // Set upkeep paid to now
      })
      .eq('x', agent.x)
      .eq('y', agent.y);

    if (claimError) {
      console.error('Error claiming tile:', claimError);
      // Refund gold if claim failed
      await supabase
        .from('agents')
        .update({ gold: currentGold })
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
        upkeep_cost_per_day: TERRITORY_UPKEEP_GOLD,
      },
      location: { x: agent.x, y: agent.y },
    });

    return jsonResponse({
      success: true,
      data: {
        message: `You have claimed this ${terrain} tile for ${CLAIM_COST_GOLD} gold. ` +
          `You now receive +25% resources when gathering here. ` +
          `IMPORTANT: This territory requires ${TERRITORY_UPKEEP_GOLD} gold/day upkeep or it will be released.`,
        position: { x: agent.x, y: agent.y },
        terrain,
        cost: CLAIM_COST_GOLD,
        upkeep_cost_per_day: TERRITORY_UPKEEP_GOLD,
        gold_remaining: newGoldAfterClaim,
        territory_count: (territoryCount || 0) + 1,
        max_territories: MAX_TERRITORIES_PER_AGENT,
        upkeep: upkeepResult.goldDeducted > 0 || upkeepResult.territoriesLost > 0 ? {
          gold_deducted: upkeepResult.goldDeducted,
          territories_lost: upkeepResult.territoriesLost,
        } : undefined,
      },
    });
  } catch (error) {
    console.error('Claim error:', error);
    return errorResponse('Internal server error', 500);
  }
}
