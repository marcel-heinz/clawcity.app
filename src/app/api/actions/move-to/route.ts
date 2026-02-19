import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { TerrainType, WORLD_SIZE } from '@/lib/types';
import { getCooldownMs, atomicCooldownCheck } from '@/lib/game-settings';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import { withAnnouncements } from '@/lib/announcements';
import { createTerrainResolver } from '@/lib/game-logic';
import { getActiveWorldConfig } from '@/lib/world-runtime';
import { isTileHarvestable } from '@/lib/tile-state';
import {
  buildBlockedGoalSet,
  buildTerrainTileStateMap,
  findNearestFreshTerrainTile,
  tileCoordKey,
  type TerrainTileState,
} from '@/lib/move-to-targeting';

/**
 * move-to: Server-side multi-tile pathfinding + stepped movement.
 *
 * Accepts EITHER:
 *   { x, y }                     – move to specific coordinates
 *   { terrain: "forest" }        – move to nearest tile of that terrain type
 *
 * Optional:
 *   max_steps (default 60, max 300) – stop after this many tiles
 *
 * The endpoint:
 *  1. Fetches tiles in a search radius around the agent
 *  2. Runs BFS to find the shortest walkable path
 *  3. Executes each step sequentially (DB write per tile for realtime animation)
 *  4. Respects deep_water stamina costs and world boundaries
 *  5. Returns the full path taken + final state
 *
 * Each step writes to the agents table, triggering Supabase Realtime events
 * so the 3D viewer sees smooth tile-by-tile movement.
 */

const DEEP_WATER_STAMINA_COST = 3;
const MAX_STEPS_LIMIT = 300;
const DEFAULT_MAX_STEPS = 60;
// Delay between steps in ms — gives Supabase Realtime time to broadcast each position
const STEP_DELAY_MS = 120;
const FRESH_TILE_SEARCH_RADII = [8, 16, 24, 32, 48, 72, 120, 180, 240, 300];

const VALID_TERRAINS: TerrainType[] = [
  'plains', 'forest', 'mountain', 'market', 'water', 'rocky', 'sand', 'deep_water', 'marsh',
];

interface PathNode {
  x: number;
  y: number;
  parent: PathNode | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Spiral scan outward from (cx, cy) to find the Manhattan distance
 * to the nearest tile of the given terrain type.
 * Returns null if nothing found within MAX_STEPS_LIMIT.
 */
function spiralScanDistance(
  cx: number,
  cy: number,
  target: TerrainType,
  terrainAt: (x: number, y: number) => TerrainType
): number | null {
  for (let dist = 1; dist <= MAX_STEPS_LIMIT; dist++) {
    for (let dx = -dist; dx <= dist; dx++) {
      const dyAbs = dist - Math.abs(dx);
      for (const dy of dyAbs === 0 ? [0] : [-dyAbs, dyAbs]) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= WORLD_SIZE || y < 0 || y >= WORLD_SIZE) continue;
        if (terrainAt(x, y) === target) return dist;
      }
    }
  }
  return null;
}

async function fetchTerrainTileStates(
  supabase: ReturnType<typeof createServerClient>,
  centerX: number,
  centerY: number,
  radius: number,
  terrain: TerrainType,
): Promise<TerrainTileState[]> {
  const minX = Math.max(0, centerX - radius);
  const maxX = Math.min(WORLD_SIZE - 1, centerX + radius);
  const minY = Math.max(0, centerY - radius);
  const maxY = Math.min(WORLD_SIZE - 1, centerY + radius);

  const PAGE_SIZE = 1000;
  const tiles: TerrainTileState[] = [];
  let page = 0;

  while (page < 50) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('tiles')
      .select('x, y, depleted, depleted_at, regenerates_at')
      .eq('terrain', terrain)
      .gte('x', minX)
      .lte('x', maxX)
      .gte('y', minY)
      .lte('y', maxY)
      .order('x', { ascending: true })
      .order('y', { ascending: true })
      .range(from, to);

    if (error) {
      throw error;
    }
    if (!data || data.length === 0) {
      break;
    }

    tiles.push(...(data as TerrainTileState[]));
    if (data.length < PAGE_SIZE) {
      break;
    }
    page++;
  }

  return tiles;
}

/**
 * BFS pathfinding on the tile grid using deterministic noise terrain.
 * Avoids deep_water unless the agent has enough food to pay stamina costs.
 * Returns the path as an array of {x, y} from start (exclusive) to destination (inclusive).
 */
function findPath(
  startX: number,
  startY: number,
  isGoal: (x: number, y: number, terrain: TerrainType) => boolean,
  maxSteps: number,
  agentFood: number,
  terrainAt: (x: number, y: number) => TerrainType,
): { path: Array<{ x: number; y: number }>; deepWaterCount: number } | null {
  const visited = new Set<string>();
  const queue: PathNode[] = [{ x: startX, y: startY, parent: null }];
  visited.add(`${startX},${startY}`);

  const directions = [
    { dx: 0, dy: -1 }, // north
    { dx: 0, dy: 1 },  // south
    { dx: 1, dy: 0 },  // east
    { dx: -1, dy: 0 }, // west
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const dir of directions) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      const key = `${nx},${ny}`;

      // World boundary check
      if (nx < 0 || nx >= WORLD_SIZE || ny < 0 || ny >= WORLD_SIZE) continue;
      if (visited.has(key)) continue;
      visited.add(key);

      const terrain = terrainAt(nx, ny);
      const node: PathNode = { x: nx, y: ny, parent: current };

      // Reconstruct path to check length and deep_water cost
      const path: Array<{ x: number; y: number }> = [];
      let deepWaterCount = 0;
      let n: PathNode | null = node;
      while (n && n.parent) {
        path.unshift({ x: n.x, y: n.y });
        if (terrainAt(n.x, n.y) === 'deep_water') deepWaterCount++;
        n = n.parent;
      }

      // Skip if path is too long
      if (path.length > maxSteps) continue;

      // Skip if we can't afford the deep water cost
      const deepWaterFoodCost = deepWaterCount * DEEP_WATER_STAMINA_COST;
      if (deepWaterFoodCost > agentFood) continue;

      // Check if this is the goal
      if (isGoal(nx, ny, terrain)) {
        return { path, deepWaterCount };
      }

      queue.push(node);
    }
  }

  return null;
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  // Rate limit
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
    const body = await request.json();
    const { x: targetX, y: targetY, terrain: targetTerrain, max_steps } = body as {
      x?: number;
      y?: number;
      terrain?: string;
      max_steps?: number;
    };

    // Validate input — must provide EITHER coordinates OR terrain
    const hasCoords = targetX !== undefined && targetY !== undefined;
    const hasTerrain = targetTerrain !== undefined;

    if (!hasCoords && !hasTerrain) {
      return errorResponse('Provide either {x, y} coordinates or {terrain} type to navigate to.');
    }
    if (hasCoords && hasTerrain) {
      return errorResponse('Provide either {x, y} or {terrain}, not both.');
    }

    if (hasCoords) {
      if (typeof targetX !== 'number' || typeof targetY !== 'number') {
        return errorResponse('x and y must be numbers.');
      }
      if (targetX < 0 || targetX >= WORLD_SIZE || targetY < 0 || targetY >= WORLD_SIZE) {
        return errorResponse(`Coordinates must be within 0-${WORLD_SIZE - 1}.`);
      }
    }

    if (hasTerrain && !VALID_TERRAINS.includes(targetTerrain as TerrainType)) {
      return errorResponse(`Invalid terrain. Valid: ${VALID_TERRAINS.join(', ')}`);
    }

    const maxSteps = Math.min(max_steps ?? DEFAULT_MAX_STEPS, MAX_STEPS_LIMIT);
    const agent = auth.agent;
    const supabase = createServerClient();
    const activeWorldConfig = await getActiveWorldConfig(supabase);
    const terrainAt = createTerrainResolver(activeWorldConfig);
    const moveCooldownMs = await getCooldownMs('move');

    // Enforce move cooldown parity with /api/actions/move
    const cooldownResult = await atomicCooldownCheck(agent.id, 'move', moveCooldownMs);
    if (cooldownResult.remainingMs !== undefined && cooldownResult.remainingMs > 0) {
      const waitSeconds = Math.ceil(cooldownResult.remainingMs / 1000);
      return errorResponse(
        `Move cooldown active. Wait ${waitSeconds}s before moving again.`,
        429
      );
    }
    if (!cooldownResult.success && agent.last_move_at) {
      const lastMove = new Date(agent.last_move_at).getTime();
      const elapsed = Date.now() - lastMove;
      if (elapsed < moveCooldownMs) {
        const waitSeconds = Math.ceil((moveCooldownMs - elapsed) / 1000);
        return errorResponse(
          `Move cooldown active. Wait ${waitSeconds}s before moving again.`,
          429
        );
      }
    }

    // Already at target?
    if (hasCoords && agent.x === targetX && agent.y === targetY) {
      return jsonResponse({
        success: true,
        data: {
          message: 'Already at target position.',
          position: { x: agent.x, y: agent.y },
          steps: 0,
          path: [],
        },
      });
    }

    // Define goal function
    let goalDescription: string;
    let isGoal: (x: number, y: number, terrain: TerrainType) => boolean;
    let effectiveMaxSteps = maxSteps;
    const nowMs = Date.now();
    let blockedTerrainGoals = new Set<string>();

    if (hasCoords) {
      goalDescription = `(${targetX}, ${targetY})`;
      isGoal = (x, y) => x === targetX && y === targetY;
    } else {
      const desiredTerrain = targetTerrain as TerrainType;
      goalDescription = `nearest ${desiredTerrain} tile`;
      isGoal = (_x, _y, terrain) => terrain === desiredTerrain;
    }

    // Check if already on target terrain
    if (hasTerrain) {
      const desiredTerrain = targetTerrain as TerrainType;
      const currentTerrain = terrainAt(agent.x, agent.y);
      if (currentTerrain === desiredTerrain) {
        const { data: currentTile, error: currentTileError } = await supabase
          .from('tiles')
          .select('depleted, depleted_at, regenerates_at')
          .eq('x', agent.x)
          .eq('y', agent.y)
          .maybeSingle();

        if (currentTileError) {
          console.error('move-to: failed to read current tile depletion state:', currentTileError);
        }

        const currentTileHarvestable = currentTile
          ? isTileHarvestable(currentTile, nowMs)
          : true;

        if (currentTileHarvestable) {
          return jsonResponse({
            success: true,
            data: {
              message: `Already on ${desiredTerrain} terrain.`,
              position: { x: agent.x, y: agent.y },
              terrain: currentTerrain,
              steps: 0,
              path: [],
            },
          });
        }

        // Current tile is depleted: find nearest fresh tile of the same terrain if possible.
        const radii = [...FRESH_TILE_SEARCH_RADII.filter((radius) => radius < effectiveMaxSteps), effectiveMaxSteps]
          .filter((radius, index, all) => radius > 0 && all.indexOf(radius) === index);
        let freshTarget: { x: number; y: number; distance: number } | null = null;

        for (const radius of radii) {
          try {
            const terrainTiles = await fetchTerrainTileStates(supabase, agent.x, agent.y, radius, desiredTerrain);
            if (terrainTiles.length === 0) continue;

            blockedTerrainGoals = new Set([
              ...blockedTerrainGoals,
              ...buildBlockedGoalSet(terrainTiles, nowMs),
            ]);

            const target = findNearestFreshTerrainTile({
              startX: agent.x,
              startY: agent.y,
              targetTerrain: desiredTerrain,
              maxSteps: radius,
              terrainAt,
              tileStateMap: buildTerrainTileStateMap(terrainTiles),
              nowMs,
            });

            if (target) {
              freshTarget = target;
              break;
            }
          } catch (error) {
            console.error('move-to: failed to scan nearby terrain tiles:', error);
            break;
          }
        }

        if (freshTarget) {
          const targetPoint = freshTarget;
          goalDescription = `fresh ${desiredTerrain} tile`;
          isGoal = (x, y) => x === targetPoint.x && y === targetPoint.y;
          effectiveMaxSteps = Math.max(effectiveMaxSteps, targetPoint.distance + 6);
          effectiveMaxSteps = Math.min(effectiveMaxSteps, MAX_STEPS_LIMIT);
        } else if (blockedTerrainGoals.size > 0) {
          goalDescription = `nearest fresh ${desiredTerrain} tile`;
          isGoal = (x, y, terrain) =>
            terrain === desiredTerrain && !blockedTerrainGoals.has(tileCoordKey(x, y));
        }
      }

      // Spiral scan to find nearest matching terrain and auto-expand max_steps
      const nearestDist = spiralScanDistance(agent.x, agent.y, desiredTerrain, terrainAt);
      if (nearestDist !== null) {
        effectiveMaxSteps = Math.max(effectiveMaxSteps, nearestDist + 10);
        effectiveMaxSteps = Math.min(effectiveMaxSteps, MAX_STEPS_LIMIT);
      }
    }

    // Find path via deterministic world config resolver.
    const result = findPath(agent.x, agent.y, isGoal, effectiveMaxSteps, agent.food, terrainAt);

    if (!result) {
      return jsonResponse({
        success: false,
        error: `No path found to ${goalDescription} within ${effectiveMaxSteps} steps. Try increasing max_steps or moving to a different area first.`,
        data: {
          position: { x: agent.x, y: agent.y },
          max_steps: effectiveMaxSteps,
        },
      });
    }

    const { path, deepWaterCount } = result;
    const totalDeepWaterCost = deepWaterCount * DEEP_WATER_STAMINA_COST;

    // Execute each step with DB writes for realtime animation
    let currentFood = agent.food;
    let currentX = agent.x;
    let currentY = agent.y;
    const pathTaken: Array<{ x: number; y: number; terrain: string }> = [];

    for (let i = 0; i < path.length; i++) {
      const step = path[i];
      const stepTerrain = terrainAt(step.x, step.y);

      // Deep water stamina cost
      let foodDeduction = 0;
      if (stepTerrain === 'deep_water') {
        foodDeduction = DEEP_WATER_STAMINA_COST;
        currentFood = Math.max(0, currentFood - foodDeduction);
      }

      // Update agent position in DB (triggers Supabase Realtime for 3D view)
      const updateData: Record<string, unknown> = {
        x: step.x,
        y: step.y,
        last_move_at: new Date().toISOString(),
      };
      if (foodDeduction > 0) {
        updateData.food = currentFood;
      }

      const { error: updateError } = await supabase
        .from('agents')
        .update(updateData)
        .eq('id', agent.id);

      if (updateError) {
        console.error(`move-to: step ${i} update error:`, updateError);
        // Return partial result
        return jsonResponse({
          success: true,
          data: {
            message: `Moved ${pathTaken.length} of ${path.length} steps before error.`,
            position: { x: currentX, y: currentY },
            terrain: terrainAt(currentX, currentY),
            steps: pathTaken.length,
            path: pathTaken,
            error_at_step: i,
          },
        });
      }

      currentX = step.x;
      currentY = step.y;
      pathTaken.push({ x: step.x, y: step.y, terrain: stepTerrain });

      // Delay between steps for realtime animation (skip delay on last step)
      if (i < path.length - 1) {
        await sleep(Math.max(STEP_DELAY_MS, moveCooldownMs));
      }
    }

    // Log a single move-to event (not individual move events to avoid event spam)
    await supabase.from('events').insert({
      agent_id: agent.id,
      type: 'move',
      data: {
        action: 'move_to',
        from: { x: agent.x, y: agent.y },
        to: { x: currentX, y: currentY },
        steps: pathTaken.length,
        deep_water_tiles: deepWaterCount,
        deep_water_food_cost: totalDeepWaterCost,
      },
      location: { x: currentX, y: currentY },
    });

    // Update last_active
    await supabase
      .from('agents')
      .update({ last_active: new Date().toISOString() })
      .eq('id', agent.id);

    const finalTerrain = terrainAt(currentX, currentY);

    // Build terrain summary instead of full path array to save tokens
    const terrainCounts: Record<string, number> = {};
    for (const step of pathTaken) {
      terrainCounts[step.terrain] = (terrainCounts[step.terrain] || 0) + 1;
    }

    // Use verbose=true query param to include full path (for debugging)
    const verbose = request.nextUrl?.searchParams?.get('verbose') === 'true';

    const includeAnnouncements = request.nextUrl?.searchParams?.get('include')?.includes('announcements');
    const responseData = await withAnnouncements(agent, {
      message: `Navigated ${pathTaken.length} tiles to ${goalDescription}.`,
      position: { x: currentX, y: currentY },
      terrain: finalTerrain,
      steps: pathTaken.length,
      path_summary: {
        start: { x: agent.x, y: agent.y },
        end: { x: currentX, y: currentY },
        terrains_crossed: terrainCounts,
      },
      ...(verbose ? { path: pathTaken } : {}),
      ...(totalDeepWaterCost > 0 ? {
        deep_water_cost: {
          tiles: deepWaterCount,
          food_spent: totalDeepWaterCost,
          food_remaining: currentFood,
        },
      } : {}),
    }, includeAnnouncements);

    return jsonResponse({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error('move-to error:', error);
    return errorResponse('Internal server error', 500);
  }
}
