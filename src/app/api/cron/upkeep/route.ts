import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { TERRITORY_UPKEEP_FOOD } from '@/lib/types';

/**
 * GET /api/cron/upkeep
 * 
 * Hourly cron job to process territory food upkeep:
 * 1. For each agent with territories, deduct TERRITORY_UPKEEP_FOOD * territory_count
 * 2. If food < upkeep: set food_depleted_at (triggers accelerated 12hr decay)
 * 3. If food_depleted_at > 12 hours: release oldest territory
 * 
 * Called every hour at minute 0 via Vercel Cron: "0 * * * *"
 */
export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return errorResponse('Unauthorized', 401);
  }

  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 500);
  }

  try {
    const supabase = createServerClient();
    const results: string[] = [];
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);

    // Get all agents with their territory counts
    const { data: agentsWithTerritories, error: agentsError } = await supabase
      .from('agents')
      .select('id, name, food, food_depleted_at')
      .gt('food', -1); // All agents

    if (agentsError) {
      console.error('Error fetching agents:', agentsError);
      return errorResponse('Failed to fetch agents', 500);
    }

    // Get territory counts for all agents in one query
    const { data: territoryCounts, error: countError } = await supabase
      .from('tiles')
      .select('owner_id')
      .not('owner_id', 'is', null);

    if (countError) {
      console.error('Error fetching territory counts:', countError);
      return errorResponse('Failed to fetch territory counts', 500);
    }

    // Build territory count map
    const territoryCountMap = new Map<string, number>();
    for (const tile of territoryCounts || []) {
      const count = territoryCountMap.get(tile.owner_id) || 0;
      territoryCountMap.set(tile.owner_id, count + 1);
    }

    let totalFoodDeducted = 0;
    let agentsProcessed = 0;
    let agentsDepleted = 0;
    let territoriesReleased = 0;

    for (const agent of agentsWithTerritories || []) {
      const territoryCount = territoryCountMap.get(agent.id) || 0;
      
      // Skip agents with no territories
      if (territoryCount === 0) {
        // Clear depleted state if they have no territories
        if (agent.food_depleted_at) {
          await supabase
            .from('agents')
            .update({ 
              food_depleted_at: null,
              last_food_upkeep_at: now.toISOString()
            })
            .eq('id', agent.id);
        }
        continue;
      }

      agentsProcessed++;
      const upkeepCost = territoryCount * TERRITORY_UPKEEP_FOOD;

      if (agent.food >= upkeepCost) {
        // Can afford upkeep - deduct food and clear depleted state
        const newFood = agent.food - upkeepCost;
        await supabase
          .from('agents')
          .update({ 
            food: newFood,
            food_depleted_at: null,
            last_food_upkeep_at: now.toISOString()
          })
          .eq('id', agent.id);
        
        totalFoodDeducted += upkeepCost;
        results.push(`${agent.name}: -${upkeepCost} food (${territoryCount} territories)`);
      } else {
        // Cannot afford full upkeep
        const foodDeducted = agent.food; // Deduct whatever they have
        agentsDepleted++;
        
        // Check if they've been depleted for 12+ hours
        const wasAlreadyDepleted = agent.food_depleted_at 
          ? new Date(agent.food_depleted_at) < twelveHoursAgo 
          : false;

        if (wasAlreadyDepleted) {
          // Release oldest territory
          const { data: oldestTile } = await supabase
            .from('tiles')
            .select('x, y')
            .eq('owner_id', agent.id)
            .order('claimed_at', { ascending: true })
            .limit(1)
            .single();

          if (oldestTile) {
            await supabase
              .from('tiles')
              .update({ 
                owner_id: null, 
                claimed_at: null,
                upgrade_level: 1 // Reset upgrade on release
              })
              .eq('x', oldestTile.x)
              .eq('y', oldestTile.y);
            
            territoriesReleased++;
            results.push(`${agent.name}: Territory at (${oldestTile.x},${oldestTile.y}) RELEASED (12hr food depletion)`);

            // Log territory loss event
            await supabase.from('events').insert({
              agent_id: agent.id,
              type: 'upkeep',
              data: { 
                action: 'territory_released',
                reason: 'food_depletion',
                position: { x: oldestTile.x, y: oldestTile.y }
              },
              location: { x: oldestTile.x, y: oldestTile.y },
            });
          }
        }

        // Update agent - set depleted state if not already set
        await supabase
          .from('agents')
          .update({ 
            food: 0,
            food_depleted_at: agent.food_depleted_at || now.toISOString(),
            last_food_upkeep_at: now.toISOString()
          })
          .eq('id', agent.id);

        totalFoodDeducted += foodDeducted;
        results.push(`${agent.name}: DEPLETED - had ${agent.food}, needed ${upkeepCost} food (${territoryCount} territories)`);

        // Log upkeep event
        await supabase.from('events').insert({
          agent_id: agent.id,
          type: 'upkeep',
          data: { 
            action: 'food_depleted',
            food_had: agent.food,
            food_needed: upkeepCost,
            territory_count: territoryCount,
            accelerated_decay_active: true
          },
          location: { x: 0, y: 0 }, // No specific location for upkeep
        });
      }
    }

    return jsonResponse({
      success: true,
      data: {
        timestamp: now.toISOString(),
        summary: {
          agents_processed: agentsProcessed,
          agents_depleted: agentsDepleted,
          total_food_deducted: totalFoodDeducted,
          territories_released: territoriesReleased,
          upkeep_rate: `${TERRITORY_UPKEEP_FOOD} food/territory/hour`
        },
        details: results,
      },
    });
  } catch (error) {
    console.error('Cron upkeep error:', error);
    return errorResponse('Internal server error', 500);
  }
}

// Also support POST for manual triggers
export { GET as POST };
