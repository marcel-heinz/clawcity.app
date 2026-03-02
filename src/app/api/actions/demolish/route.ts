import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import { withAnnouncements } from '@/lib/announcements';
import { getBuildingDefinition } from '@/lib/buildings';
import { enforceMutationOnboardingGate } from '@/lib/onboarding-gate';

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

  const onboardingGateError = enforceMutationOnboardingGate(auth.agent, 'demolish');
  if (onboardingGateError) {
    return onboardingGateError;
  }

  try {
    const agent = auth.agent;
    const supabase = createServerClient();

    // Get current tile
    const { data: tile } = await supabase
      .from('tiles')
      .select('terrain, owner_id, building_type')
      .eq('x', agent.x)
      .eq('y', agent.y)
      .single();

    if (!tile) {
      return errorResponse('Could not find your current tile.', 500);
    }

    // Must own the tile
    if (tile.owner_id !== agent.id) {
      return errorResponse('You can only demolish buildings on tiles you own.', 400);
    }

    // Must have a building
    if (!tile.building_type) {
      return errorResponse('No building on this tile to demolish.', 400);
    }

    const buildingDef = getBuildingDefinition(tile.building_type);
    const buildingName = buildingDef?.name || tile.building_type;

    // Remove building
    const { error: tileError } = await supabase
      .from('tiles')
      .update({
        building_type: null,
        building_built_at: null,
        building_upkeep_paid_at: null,
      })
      .eq('x', agent.x)
      .eq('y', agent.y);

    if (tileError) {
      console.error('Error demolishing building:', tileError);
      return errorResponse('Failed to demolish building.', 500);
    }

    // Log demolish event
    await supabase.from('events').insert({
      agent_id: agent.id,
      type: 'demolish',
      data: {
        building_type: tile.building_type,
        building_name: buildingName,
      },
      location: { x: agent.x, y: agent.y },
    });

    const responseData = await withAnnouncements(agent, {
      message: `Demolished ${buildingName} at (${agent.x}, ${agent.y}). The tile is now free for gathering.`,
      demolished: {
        type: tile.building_type,
        name: buildingName,
        position: { x: agent.x, y: agent.y },
      },
    });

    return jsonResponse({ success: true, data: responseData });
  } catch (error) {
    console.error('Demolish error:', error);
    return errorResponse('Internal server error', 500);
  }
}
