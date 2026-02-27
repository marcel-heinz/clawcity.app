import { NextRequest } from 'next/server';
import { authenticateAgent, errorResponse, jsonResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import { type AgentItem, getHarvestScanRange } from '@/lib/crafting';
import { buildScanMetadata, buildScanTileIntel, type ScanTileIntel } from '@/lib/gather-intel';
import { isTileHarvestable } from '@/lib/tile-state';
import { WORLD_SIZE, type TerrainType } from '@/lib/types';

const BASE_SCAN_RADIUS = 15;
const MAX_SCAN_RADIUS = 50; // 100x100 area around the agent
const WORLD_MAX_INDEX = WORLD_SIZE - 1;

const SCANNABLE_TERRAINS: TerrainType[] = [
  'plains',
  'forest',
  'mountain',
  'water',
  'marsh',
  'rocky',
  'sand',
];

const DEFAULT_RESOURCE_TERRAINS: TerrainType[] = [
  'plains',
  'forest',
  'mountain',
  'water',
  'marsh',
];

interface ScanTileRow {
  x: number;
  y: number;
  terrain: TerrainType;
  owner_id: string | null;
  building_type: string | null;
  depleted?: boolean | null;
  depleted_at?: string | null;
  regenerates_at?: string | null;
  gather_count?: number | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampRadius(radius: number): number {
  return Math.max(1, Math.min(MAX_SCAN_RADIUS, Math.floor(radius)));
}

function coordTieBreak(a: { x: number; y: number }, b: { x: number; y: number }): number {
  if (a.x !== b.x) return a.x - b.x;
  return a.y - b.y;
}

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
    let body: { terrain?: string; radius?: number } = {};
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === 'object') {
        body = parsed as { terrain?: string; radius?: number };
      }
    } catch {
      // Empty body is valid.
    }

    const requestedTerrain = typeof body.terrain === 'string'
      ? body.terrain.toLowerCase()
      : undefined;

    if (requestedTerrain && !SCANNABLE_TERRAINS.includes(requestedTerrain as TerrainType)) {
      return errorResponse(
        `Invalid terrain for harvestable-tile scanning. Valid: ${SCANNABLE_TERRAINS.join(', ')}`
      );
    }

    const supabase = createServerClient();
    const agent = auth.agent;

    let agentItems: AgentItem[] = [];
    try {
      const { data: items } = await supabase
        .from('agent_items')
        .select('id, agent_id, item_id, quantity, uses_remaining, created_at, expires_at')
        .eq('agent_id', agent.id)
        .gt('quantity', 0);
      agentItems = ((items || []) as AgentItem[]).filter((item: AgentItem) =>
        item.uses_remaining === null || item.uses_remaining > 0
      );
    } catch {
      // agent_items table may not exist in some environments.
    }

    const maxRadiusFromItems = getHarvestScanRange(agentItems);
    const maxEffectiveRadius = Math.min(MAX_SCAN_RADIUS, maxRadiusFromItems);
    const requestedRadius = isFiniteNumber(body.radius)
      ? clampRadius(body.radius)
      : maxEffectiveRadius;
    const effectiveRadius = Math.min(requestedRadius, maxEffectiveRadius);

    if (effectiveRadius < 1) {
      return errorResponse('No scan range available. Craft a spyglass to unlock long-range scouting.', 400);
    }

    const terrainFilter = requestedTerrain
      ? [requestedTerrain as TerrainType]
      : DEFAULT_RESOURCE_TERRAINS;

    const minX = Math.max(0, agent.x - effectiveRadius);
    const maxX = Math.min(WORLD_MAX_INDEX, agent.x + effectiveRadius);
    const minY = Math.max(0, agent.y - effectiveRadius);
    const maxY = Math.min(WORLD_MAX_INDEX, agent.y + effectiveRadius);

    const PAGE_SIZE = 1000;
    const MAX_PAGES = 80;
    const nowMs = Date.now();

    let page = 0;
    let scannedTiles = 0;
    let depletedTiles = 0;
    let blockedByBuildings = 0;
    let harvestableTiles = 0;

    type Candidate = { x: number; y: number; terrain: TerrainType; distance: number; tile_intel: ScanTileIntel };
    let nearest: Candidate | null = null;
    const alternatives: Candidate[] = [];

    while (page < MAX_PAGES) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from('tiles')
        .select('x, y, terrain, owner_id, building_type, depleted, depleted_at, regenerates_at, gather_count')
        .gte('x', minX)
        .lte('x', maxX)
        .gte('y', minY)
        .lte('y', maxY)
        .order('x', { ascending: true })
        .order('y', { ascending: true })
        .range(from, to);

      if (terrainFilter.length === 1) {
        query = query.eq('terrain', terrainFilter[0]);
      } else {
        query = query.in('terrain', terrainFilter);
      }

      const { data, error } = await query;
      if (error) {
        console.error('scan: failed to fetch tiles:', error);
        return errorResponse('Failed to scan tiles.', 500);
      }

      if (!data || data.length === 0) {
        break;
      }

      for (const tile of data as ScanTileRow[]) {
        scannedTiles += 1;

        // "Next" tile means we do not return the current coordinate.
        if (tile.x === agent.x && tile.y === agent.y) continue;

        if (!isTileHarvestable(tile, nowMs)) {
          depletedTiles += 1;
          continue;
        }

        if (tile.building_type && tile.owner_id !== agent.id) {
          blockedByBuildings += 1;
          continue;
        }

        harvestableTiles += 1;
        const distance = Math.abs(tile.x - agent.x) + Math.abs(tile.y - agent.y);
        const tileIntel = buildScanTileIntel({
          gatherCount: Math.max(0, tile.gather_count || 0),
          harvestable: true,
          nonDepleting: tile.terrain === 'water',
          observedAtMs: nowMs,
        });
        const candidate: Candidate = {
          x: tile.x,
          y: tile.y,
          terrain: tile.terrain,
          distance,
          tile_intel: tileIntel,
        };
        alternatives.push(candidate);

        if (!nearest || candidate.distance < nearest.distance) {
          nearest = candidate;
          continue;
        }

        if (candidate.distance === nearest.distance && coordTieBreak(candidate, nearest) < 0) {
          nearest = candidate;
        }
      }

      if (data.length < PAGE_SIZE) {
        break;
      }
      page += 1;
    }

    const generatedAtMs = Date.now();
    const scanMetadata = buildScanMetadata({
      observedAtMs: nowMs,
      generatedAtMs,
      scannedTiles,
      harvestableTiles,
      depletedTiles,
      blockedByBuildings,
    });

    let spyglassUsesRemaining: number | null = null;
    let usedSpyglass = false;
    const spyglassItem = agentItems.find((item) => item.item_id === 'spyglass' && item.quantity > 0);
    if (spyglassItem && effectiveRadius > BASE_SCAN_RADIUS) {
      usedSpyglass = true;
      if (spyglassItem.uses_remaining !== null && spyglassItem.uses_remaining > 0) {
        spyglassUsesRemaining = Math.max(0, spyglassItem.uses_remaining - 1);
        await supabase
          .from('agent_items')
          .update({ uses_remaining: spyglassUsesRemaining })
          .eq('agent_id', agent.id)
          .eq('item_id', 'spyglass');
      } else {
        spyglassUsesRemaining = spyglassItem.uses_remaining;
      }
    }

    if (!nearest) {
      return jsonResponse({
        success: true,
        data: {
          found: false,
          message: `No harvestable ${requestedTerrain || 'resource'} tile found within ${effectiveRadius * 2}x${effectiveRadius * 2} scan area. Nearby matches are depleted or blocked.`,
          position: { x: agent.x, y: agent.y },
          terrain_filter: requestedTerrain || 'resource_terrains',
          scan: {
            requested_radius: requestedRadius,
            effective_radius: effectiveRadius,
            max_radius: maxEffectiveRadius,
            scanned_tiles: scannedTiles,
            harvestable_tiles: harvestableTiles,
            depleted_tiles: depletedTiles,
            blocked_by_buildings: blockedByBuildings,
            used_spyglass: usedSpyglass,
            spyglass_uses_remaining: spyglassUsesRemaining,
            metadata: scanMetadata,
          },
          scan_metadata: scanMetadata,
        },
      });
    }

    alternatives.sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      return coordTieBreak(a, b);
    });
    const altTop = alternatives.slice(0, 5);

    return jsonResponse({
      success: true,
      data: {
        found: true,
        message:
          `Nearest harvestable tile is ${nearest.terrain} at (${nearest.x},${nearest.y}), ${nearest.distance} steps away. ` +
          `Harvest risk: ${nearest.tile_intel.harvest_risk} (${nearest.tile_intel.depletion_chance_percent}% next-gather depletion).`,
        position: { x: agent.x, y: agent.y },
        terrain_filter: requestedTerrain || 'resource_terrains',
        target: nearest,
        target_tile_intel: nearest.tile_intel,
        alternatives: altTop,
        scan: {
          requested_radius: requestedRadius,
          effective_radius: effectiveRadius,
          max_radius: maxEffectiveRadius,
          scanned_tiles: scannedTiles,
          harvestable_tiles: harvestableTiles,
          depleted_tiles: depletedTiles,
          blocked_by_buildings: blockedByBuildings,
          used_spyglass: usedSpyglass,
          spyglass_uses_remaining: spyglassUsesRemaining,
          metadata: scanMetadata,
        },
        scan_metadata: scanMetadata,
      },
    });
  } catch (error) {
    console.error('scan error:', error);
    return errorResponse('Internal server error', 500);
  }
}
