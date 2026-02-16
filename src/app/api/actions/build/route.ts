import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import { withAnnouncements } from '@/lib/announcements';
import {
  ALL_BUILDING_TYPES,
  BUILD_COOLDOWN_MS,
  BUILDING_DEFINITIONS,
  hasResourcesForBuilding,
  formatBuildingCost,
  type BuildingType,
} from '@/lib/buildings';
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

  const rateLimit = await checkRateLimit(request, GAME_ACTION_RATE_LIMIT);
  if (!rateLimit.success) {
    const retryAfter = Math.ceil((rateLimit.retryAfterMs || 1000) / 1000);
    return errorResponse(`Rate limit exceeded. Try again in ${retryAfter}s.`, 429);
  }

  const auth = await authenticateAgent(request);
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  try {
    const supabase = createServerClient();
    const body = await request.json();
    const buildingType = body.building_type as string;
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

    // Validate building type
    if (!buildingType || !ALL_BUILDING_TYPES.includes(buildingType as BuildingType)) {
      return errorResponse(
        `Invalid building_type. Options: ${ALL_BUILDING_TYPES.join(', ')}`,
        400
      );
    }

    const buildingDef = BUILDING_DEFINITIONS[buildingType as BuildingType];

    // Check build cooldown
    if (agent.last_build_at) {
      const lastBuild = new Date(agent.last_build_at as string).getTime();
      const elapsed = Date.now() - lastBuild;
      if (elapsed < BUILD_COOLDOWN_MS) {
        const waitSeconds = Math.ceil((BUILD_COOLDOWN_MS - elapsed) / 1000);
        return errorResponse(
          `Build cooldown active. Wait ${waitSeconds}s before building again.`,
          429
        );
      }
    }

    // Get current tile
    let tileQuery = supabase
      .from(tilesTable)
      .select('terrain, owner_id, building_type');
    tileQuery = scopeTileQuery(tileQuery, context, agent.x, agent.y);
    const { data: tile } = await tileQuery.single();

    if (!tile) {
      return errorResponse('Could not find your current tile.', 500);
    }

    // Must own the tile
    if (tile.owner_id !== agent.id) {
      return errorResponse(
        'You must own this tile (territory) to build here. Claim it first with /api/actions/claim.',
        400
      );
    }

    // Check no existing building
    if (tile.building_type) {
      return errorResponse(
        `This tile already has a ${tile.building_type}. Demolish it first to build something else.`,
        400
      );
    }

    // Check resources
    const { hasEnough, missing } = hasResourcesForBuilding(agent, buildingType as BuildingType);
    if (!hasEnough) {
      return errorResponse(
        `Not enough resources to build ${buildingDef.name}. Missing: ${missing.join(', ')}. ` +
        `Cost: ${formatBuildingCost(buildingDef.build_cost)}.`,
        400
      );
    }

    // Deduct resources
    const newGold = agent.gold - (buildingDef.build_cost.gold || 0);
    const newWood = agent.wood - (buildingDef.build_cost.wood || 0);
    const newFood = agent.food - (buildingDef.build_cost.food || 0);
    const newStone = agent.stone - (buildingDef.build_cost.stone || 0);

    let resourceUpdateQuery = supabase
      .from(agentsTable)
      .update({
        gold: newGold,
        wood: newWood,
        food: newFood,
        stone: newStone,
        last_build_at: new Date().toISOString(),
      });
    resourceUpdateQuery = scopeAgentMutation(resourceUpdateQuery, context, agent.id);
    const { error: resourceError } = await resourceUpdateQuery;

    if (resourceError) {
      console.error('Error deducting resources for build:', resourceError);
      return errorResponse('Failed to process building payment.', 500);
    }

    // Place building on tile
    const now = new Date().toISOString();
    let placeBuildingQuery = supabase
      .from(tilesTable)
      .update({
        building_type: buildingType,
        building_built_at: now,
        building_upkeep_paid_at: now,
      });
    placeBuildingQuery = scopeTileQuery(placeBuildingQuery, context, agent.x, agent.y);
    const { error: tileError } = await placeBuildingQuery;

    if (tileError) {
      // Refund resources
      let refundQuery = supabase.from(agentsTable).update({
        gold: agent.gold, wood: agent.wood, food: agent.food, stone: agent.stone,
      });
      refundQuery = scopeAgentMutation(refundQuery, context, agent.id);
      await refundQuery;
      console.error('Error placing building:', tileError);
      return errorResponse('Failed to place building.', 500);
    }

    // Log build event
    await supabase.from(eventsTable).insert(
      addWorld({
        agent_id: agent.id,
        type: 'build',
        data: {
          building_type: buildingType,
          building_name: buildingDef.name,
          cost: buildingDef.build_cost,
          effect: buildingDef.effect_description,
        },
        location: { x: agent.x, y: agent.y },
      })
    );

    const responseData = await withAnnouncements(agent, {
      message: `Built ${buildingDef.name} at (${agent.x}, ${agent.y})! Cost: ${formatBuildingCost(buildingDef.build_cost)}. Effect: ${buildingDef.effect_description}. Hourly upkeep: ${formatBuildingCost(buildingDef.hourly_upkeep)}.`,
      building: {
        type: buildingType,
        name: buildingDef.name,
        effect: buildingDef.effect_description,
        hourly_upkeep: buildingDef.hourly_upkeep,
        position: { x: agent.x, y: agent.y },
      },
      inventory: {
        gold: newGold,
        wood: newWood,
        food: newFood,
        stone: newStone,
      },
      context,
    });

    return jsonResponse({ success: true, data: responseData });
  } catch (error) {
    console.error('Build error:', error);
    return errorResponse('Internal server error', 500);
  }
}
