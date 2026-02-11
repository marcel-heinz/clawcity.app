import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';
import {
  TERRITORY_UPKEEP_FOOD,
  INACTIVITY_THRESHOLD_HOURS,
  INACTIVITY_DRAIN_PERCENT,
  STARTING_GOLD,
  STARTING_FOOD
} from '@/lib/types';
import {
  BUILDING_DEFINITIONS,
  BUILDING_DECAY_HOURS,
  type BuildingType,
} from '@/lib/buildings';
import { getUpkeepReduction, type AgentItem } from '@/lib/crafting';

/**
 * GET /api/cron/upkeep
 * 
 * Hourly cron job to process:
 * 
 * 1. TERRITORY UPKEEP (for agents with territories):
 *    - Deduct TERRITORY_UPKEEP_FOOD * territory_count
 *    - If food < upkeep: set food_depleted_at (triggers accelerated 12hr decay)
 *    - If food_depleted_at > 12 hours: release oldest territory
 * 
 * 2. INACTIVITY DRAIN (for ALL agents inactive 8+ hours):
 *    - Drain 10% of each resource per hour
 *    - Floor at starting stats: 100 gold, 50 food, 0 wood, 0 stone
 * 
 * Called every hour at minute 0 via Vercel Cron: "0 * * * *"
 */
export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  
  if (authHeader !== `Bearer ${cronSecret}`) {
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

    // Get all agents with resources and activity data
    const { data: allAgents, error: agentsError } = await supabase
      .from('agents')
      .select('id, name, gold, wood, food, stone, food_depleted_at, last_active')
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

    // Fetch all agent items for upkeep reduction (Reinforced Walls)
    const agentItemsMap = new Map<string, AgentItem[]>();
    try {
      const { data: allItems } = await supabase
        .from('agent_items')
        .select('*');
      for (const item of (allItems || []) as AgentItem[]) {
        if (item.quantity > 0 && (item.uses_remaining === null || item.uses_remaining > 0)) {
          const list = agentItemsMap.get(item.agent_id) || [];
          list.push(item);
          agentItemsMap.set(item.agent_id, list);
        }
      }
    } catch {
      // agent_items table may not exist yet
    }

    let totalFoodDeducted = 0;
    let agentsProcessed = 0;
    let agentsDepleted = 0;
    let territoriesReleased = 0;

    for (const agent of allAgents || []) {
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
      // Apply Reinforced Walls upkeep reduction
      const items = agentItemsMap.get(agent.id) || [];
      const upkeepReduction = getUpkeepReduction(items);
      const baseUpkeepCost = territoryCount * TERRITORY_UPKEEP_FOOD;
      const upkeepCost = Math.max(1, Math.floor(baseUpkeepCost * (1 - upkeepReduction / 100)));

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

        // Decrement Reinforced Walls uses if reduction was applied
        if (upkeepReduction > 0) {
          for (const item of items) {
            if (item.item_id === 'reinforced_walls' && item.uses_remaining !== null && item.uses_remaining > 0) {
              await supabase
                .from('agent_items')
                .update({ uses_remaining: item.uses_remaining - 1 })
                .eq('agent_id', agent.id)
                .eq('item_id', item.item_id);
            }
          }
        }

        const reductionNote = upkeepReduction > 0 ? ` [Reinforced Walls -${upkeepReduction}%]` : '';
        results.push(`${agent.name}: -${upkeepCost} food (${territoryCount} territories)${reductionNote}`);
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

    // ============================================
    // BUILDING UPKEEP - Deduct wood/stone/gold for buildings
    // ============================================
    const buildingResults: string[] = [];
    let buildingsProcessed = 0;
    let buildingsDestroyed = 0;
    const buildingDecayThreshold = new Date(now.getTime() - BUILDING_DECAY_HOURS * 60 * 60 * 1000);

    // Get all tiles with buildings
    let buildingTiles: { x: number; y: number; owner_id: string; building_type: string; building_upkeep_paid_at: string | null }[] = [];
    try {
      const { data: bTiles } = await supabase
        .from('tiles')
        .select('x, y, owner_id, building_type, building_upkeep_paid_at')
        .not('building_type', 'is', null);
      buildingTiles = (bTiles || []) as typeof buildingTiles;
    } catch {
      // building columns may not exist yet
    }

    if (buildingTiles.length > 0) {
      // Group buildings by owner
      const ownerBuildings = new Map<string, typeof buildingTiles>();
      for (const bt of buildingTiles) {
        if (!bt.owner_id) continue;
        const list = ownerBuildings.get(bt.owner_id) || [];
        list.push(bt);
        ownerBuildings.set(bt.owner_id, list);
      }

      for (const [ownerId, buildings] of ownerBuildings) {
        // Calculate total upkeep for this owner
        let totalGold = 0, totalWood = 0, totalStone = 0;
        for (const b of buildings) {
          const def = BUILDING_DEFINITIONS[b.building_type as BuildingType];
          if (!def) continue;
          totalGold += def.hourly_upkeep.gold || 0;
          totalWood += def.hourly_upkeep.wood || 0;
          totalStone += def.hourly_upkeep.stone || 0;
        }

        // Find the agent
        const ownerAgent = (allAgents || []).find((a: { id: string; name: string; gold: number; wood: number; food: number; stone: number; food_depleted_at: string | null; last_active: string }) => a.id === ownerId);
        if (!ownerAgent) continue;

        buildingsProcessed += buildings.length;
        const canAfford = ownerAgent.gold >= totalGold &&
          ownerAgent.wood >= totalWood &&
          ownerAgent.stone >= totalStone;

        if (canAfford) {
          // Deduct building upkeep
          await supabase
            .from('agents')
            .update({
              gold: ownerAgent.gold - totalGold,
              wood: ownerAgent.wood - totalWood,
              stone: ownerAgent.stone - totalStone,
            })
            .eq('id', ownerId);

          // Update upkeep timestamps
          for (const b of buildings) {
            await supabase
              .from('tiles')
              .update({ building_upkeep_paid_at: now.toISOString() })
              .eq('x', b.x)
              .eq('y', b.y);
          }

          // Update local agent data for subsequent inactivity drain calculations
          ownerAgent.gold -= totalGold;
          ownerAgent.wood -= totalWood;
          ownerAgent.stone -= totalStone;

          buildingResults.push(
            `${ownerAgent.name}: -${totalGold}g -${totalWood}w -${totalStone}s (${buildings.length} buildings)`
          );
        } else {
          // Can't afford - check if any buildings should be destroyed
          for (const b of buildings) {
            const lastPaid = b.building_upkeep_paid_at ? new Date(b.building_upkeep_paid_at) : null;
            const shouldDestroy = !lastPaid || lastPaid < buildingDecayThreshold;

            if (shouldDestroy) {
              // Destroy building
              await supabase
                .from('tiles')
                .update({
                  building_type: null,
                  building_built_at: null,
                  building_upkeep_paid_at: null,
                })
                .eq('x', b.x)
                .eq('y', b.y);

              buildingsDestroyed++;
              buildingResults.push(
                `${ownerAgent.name}: ${b.building_type} at (${b.x},${b.y}) DESTROYED (upkeep unpaid ${BUILDING_DECAY_HOURS}h)`
              );

              await supabase.from('events').insert({
                agent_id: ownerId,
                type: 'demolish',
                data: {
                  action: 'upkeep_decay',
                  building_type: b.building_type,
                  reason: 'upkeep_unpaid',
                },
                location: { x: b.x, y: b.y },
              });
            }
          }

          buildingResults.push(
            `${ownerAgent.name}: CANNOT AFFORD building upkeep (need ${totalGold}g ${totalWood}w ${totalStone}s)`
          );
        }
      }
    }

    // ============================================
    // INACTIVITY DRAIN - 10% per hour for ALL agents inactive 8+ hours
    // Floor at starting stats: 100 gold, 50 food, 0 wood, 0 stone
    // ============================================
    const inactivityThreshold = new Date(now.getTime() - INACTIVITY_THRESHOLD_HOURS * 60 * 60 * 1000);
    const inactivityResults: string[] = [];
    let agentsDrained = 0;
    const drainMultiplier = 1 - INACTIVITY_DRAIN_PERCENT; // 0.9 for 10% drain

    for (const agent of allAgents || []) {
      const lastActive = new Date(agent.last_active);
      
      // Skip if agent has been active within threshold
      if (lastActive >= inactivityThreshold) {
        continue;
      }

      // Calculate new values with 10% drain, floored at starting stats
      const newGold = Math.max(STARTING_GOLD, Math.floor(agent.gold * drainMultiplier));
      const newFood = Math.max(STARTING_FOOD, Math.floor(agent.food * drainMultiplier));
      const newWood = Math.max(0, Math.floor(agent.wood * drainMultiplier));
      const newStone = Math.max(0, Math.floor(agent.stone * drainMultiplier));

      // Only update if something actually changed (not already at floor)
      if (newGold !== agent.gold || newFood !== agent.food || 
          newWood !== agent.wood || newStone !== agent.stone) {
        
        await supabase
          .from('agents')
          .update({ 
            gold: newGold, 
            food: newFood, 
            wood: newWood, 
            stone: newStone 
          })
          .eq('id', agent.id);

        agentsDrained++;
        
        // Calculate what was drained for logging
        const goldDrained = agent.gold - newGold;
        const foodDrained = agent.food - newFood;
        const woodDrained = agent.wood - newWood;
        const stoneDrained = agent.stone - newStone;
        
        inactivityResults.push(
          `${agent.name}: -${goldDrained}g -${foodDrained}f -${woodDrained}w -${stoneDrained}s (inactive ${Math.round((now.getTime() - lastActive.getTime()) / 3600000)}h)`
        );
      }
    }

    return jsonResponse({
      success: true,
      data: {
        timestamp: now.toISOString(),
        territory_upkeep: {
          agents_processed: agentsProcessed,
          agents_depleted: agentsDepleted,
          total_food_deducted: totalFoodDeducted,
          territories_released: territoriesReleased,
          upkeep_rate: `${TERRITORY_UPKEEP_FOOD} food/territory/hour`,
          details: results,
        },
        building_upkeep: {
          buildings_processed: buildingsProcessed,
          buildings_destroyed: buildingsDestroyed,
          decay_hours: BUILDING_DECAY_HOURS,
          details: buildingResults,
        },
        inactivity_drain: {
          agents_drained: agentsDrained,
          threshold_hours: INACTIVITY_THRESHOLD_HOURS,
          drain_percent: `${INACTIVITY_DRAIN_PERCENT * 100}%`,
          floor: `${STARTING_GOLD}g/${STARTING_FOOD}f/0w/0s`,
          details: inactivityResults,
        },
      },
    });
  } catch (error) {
    console.error('Cron upkeep error:', error);
    return errorResponse('Internal server error', 500);
  }
}

// Also support POST for manual triggers
export { GET as POST };
