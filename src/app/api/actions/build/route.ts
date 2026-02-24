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

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503, {
      code: 'database_not_configured',
    });
  }

  const rateLimit = await checkRateLimit(request, GAME_ACTION_RATE_LIMIT);
  if (!rateLimit.success) {
    const retryAfter = Math.ceil((rateLimit.retryAfterMs || 1000) / 1000);
    return errorResponse(`Rate limit exceeded. Try again in ${retryAfter}s.`, 429, {
      code: 'rate_limited',
      retry_after_seconds: retryAfter,
    });
  }

  const auth = await authenticateAgent(request);
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401, {
      code: 'unauthorized',
    });
  }

  try {
    const agent = auth.agent;
    const supabase = createServerClient();
    const body = await request.json();
    const buildingType = body.building_type as string;

    // Validate building type
    if (!buildingType || !ALL_BUILDING_TYPES.includes(buildingType as BuildingType)) {
      return errorResponse(
        `Invalid building_type. Options: ${ALL_BUILDING_TYPES.join(', ')}`,
        400,
        {
          code: 'invalid_building_type',
          details: {
            options: ALL_BUILDING_TYPES,
          },
        }
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
          429,
          {
            code: 'build_cooldown',
            retry_after_seconds: waitSeconds,
          }
        );
      }
    }

    // Get current tile
    const { data: tile } = await supabase
      .from('tiles')
      .select('terrain, owner_id, building_type')
      .eq('x', agent.x)
      .eq('y', agent.y)
      .single();

    if (!tile) {
      return errorResponse('Could not find your current tile.', 500, {
        code: 'tile_not_found',
      });
    }

    // Must own the tile
    if (tile.owner_id !== agent.id) {
      return errorResponse(
        'You must own this tile (territory) to build here. Claim it first with /api/actions/claim.',
        400,
        {
          code: 'not_owned',
        }
      );
    }

    // Check no existing building
    if (tile.building_type) {
      return errorResponse(
        `This tile already has a ${tile.building_type}. Demolish it first to build something else.`,
        400,
        {
          code: 'building_exists',
          details: {
            building_type: tile.building_type,
          },
        }
      );
    }

    // Check resources
    const { hasEnough, missing } = hasResourcesForBuilding(agent, buildingType as BuildingType);
    if (!hasEnough) {
      const cost = buildingDef.build_cost;
      const requirements = {
        gold: {
          need: cost.gold || 0,
          have: agent.gold,
          missing: Math.max(0, (cost.gold || 0) - agent.gold),
        },
        wood: {
          need: cost.wood || 0,
          have: agent.wood,
          missing: Math.max(0, (cost.wood || 0) - agent.wood),
        },
        food: {
          need: cost.food || 0,
          have: agent.food,
          missing: Math.max(0, (cost.food || 0) - agent.food),
        },
        stone: {
          need: cost.stone || 0,
          have: agent.stone,
          missing: Math.max(0, (cost.stone || 0) - agent.stone),
        },
      };
      return errorResponse(
        `Not enough resources to build ${buildingDef.name}. Missing: ${missing.join(', ')}. ` +
        `Cost: ${formatBuildingCost(buildingDef.build_cost)}.`,
        400,
        {
          code: 'insufficient_resources',
          details: {
            building_type: buildingType,
            building_name: buildingDef.name,
            missing_resources: missing,
            cost: buildingDef.build_cost,
            requirements,
          },
        }
      );
    }

    // Deduct resources
    const newGold = agent.gold - (buildingDef.build_cost.gold || 0);
    const newWood = agent.wood - (buildingDef.build_cost.wood || 0);
    const newFood = agent.food - (buildingDef.build_cost.food || 0);
    const newStone = agent.stone - (buildingDef.build_cost.stone || 0);

    const { error: resourceError } = await supabase
      .from('agents')
      .update({
        gold: newGold,
        wood: newWood,
        food: newFood,
        stone: newStone,
        last_build_at: new Date().toISOString(),
      })
      .eq('id', agent.id);

    if (resourceError) {
      console.error('Error deducting resources for build:', resourceError);
      return errorResponse('Failed to process building payment.', 500, {
        code: 'build_payment_failed',
      });
    }

    // Place building on tile
    const now = new Date().toISOString();
    const { error: tileError } = await supabase
      .from('tiles')
      .update({
        building_type: buildingType,
        building_built_at: now,
        building_upkeep_paid_at: now,
      })
      .eq('x', agent.x)
      .eq('y', agent.y);

    if (tileError) {
      // Refund resources
      await supabase.from('agents').update({
        gold: agent.gold, wood: agent.wood, food: agent.food, stone: agent.stone,
      }).eq('id', agent.id);
      console.error('Error placing building:', tileError);
      return errorResponse('Failed to place building.', 500, {
        code: 'build_place_failed',
      });
    }

    // Log build event
    await supabase.from('events').insert({
      agent_id: agent.id,
      type: 'build',
      data: {
        building_type: buildingType,
        building_name: buildingDef.name,
        cost: buildingDef.build_cost,
        effect: buildingDef.effect_description,
      },
      location: { x: agent.x, y: agent.y },
    });

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
    });

    return jsonResponse({ success: true, data: responseData });
  } catch (error) {
    console.error('Build error:', error);
    return errorResponse('Internal server error', 500, {
      code: 'internal_error',
    });
  }
}
