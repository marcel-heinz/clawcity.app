import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import { getCooldownMs } from '@/lib/game-settings';
import { buildGatherCooldownMeta, buildGatherTileIntel } from '@/lib/gather-intel';
import { isTileHarvestable } from '@/lib/tile-state';
import type { TerrainType } from '@/lib/types';

const GATHER_SESSION_ENABLED = process.env.GATHER_SESSION_ENDPOINT_ENABLED !== 'false';

interface GatherTileSnapshot {
  terrain: TerrainType;
  depleted?: boolean | null;
  depleted_at?: string | null;
  regenerates_at?: string | null;
  gather_count?: number | null;
}

async function buildGatherSessionResponse(request: NextRequest) {
  if (!GATHER_SESSION_ENABLED) {
    return errorResponse('Gather session endpoint is disabled.', 404, {
      code: 'gather_session_disabled',
    });
  }

  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured.', 503, {
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

  const agent = auth.agent;
  const supabase = createServerClient();

  const gatherCooldownMs = await getCooldownMs('gather');
  const nowMs = Date.now();
  let cooldownRemainingMs = 0;
  if (agent.last_gather_at) {
    const elapsed = nowMs - new Date(agent.last_gather_at).getTime();
    cooldownRemainingMs = Math.max(0, gatherCooldownMs - elapsed);
  }

  const { data: tile, error: tileError } = await supabase
    .from('tiles')
    .select('terrain, depleted, depleted_at, regenerates_at, gather_count')
    .eq('x', agent.x)
    .eq('y', agent.y)
    .maybeSingle();

  if (tileError || !tile) {
    if (tileError) {
      console.error('gather-session: failed to fetch current tile:', tileError);
    }
    return errorResponse('Could not load current tile for gather session.', 500, {
      code: 'gather_session_tile_lookup_failed',
    });
  }

  const tileSnapshot = tile as GatherTileSnapshot;
  const nonDepleting = tileSnapshot.terrain === 'water' || tileSnapshot.terrain === 'market';
  const harvestable = isTileHarvestable(tileSnapshot);
  const tileIntel = buildGatherTileIntel(Math.max(0, tileSnapshot.gather_count || 0), {
    nonDepleting,
    depleted: !nonDepleting && !harvestable,
  });

  const recommendation =
    cooldownRemainingMs > 0
      ? {
          primary_action: 'wait_or_move',
          reason: 'Gather cooldown is active.',
          suggested_commands: ['clawcity move forest', 'clawcity scan'],
        }
      : !harvestable
        ? {
            primary_action: 'move',
            reason: 'Current tile is not harvestable.',
            suggested_commands: ['clawcity scan', 'clawcity move forest'],
          }
        : {
            primary_action: 'gather',
            reason: 'Gather is available on this tile.',
            suggested_commands: ['clawcity gather'],
          };

  return jsonResponse({
    success: true,
    data: {
      session: {
        mode: 'gather_session_v1',
        generated_at: new Date(nowMs).toISOString(),
        position: { x: agent.x, y: agent.y },
        terrain: tileSnapshot.terrain,
        inventory: {
          gold: agent.gold,
          wood: agent.wood,
          stone: agent.stone,
          food: agent.food,
        },
        cooldown: buildGatherCooldownMeta(gatherCooldownMs, cooldownRemainingMs, nowMs),
        tile_intel: tileIntel,
        recommendation,
      },
      compatibility_note: 'Experimental endpoint. Additive and subject to extension.',
    },
  });
}

export async function GET(request: NextRequest) {
  return buildGatherSessionResponse(request);
}

export async function POST(request: NextRequest) {
  return buildGatherSessionResponse(request);
}
