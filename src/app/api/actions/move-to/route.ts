import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { TerrainType, WORLD_SIZE } from '@/lib/types';
import { getCooldownMs } from '@/lib/game-settings';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import { withAnnouncements } from '@/lib/announcements';

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
// Search radius for pathfinding (tiles to fetch from DB)
const SEARCH_RADIUS = 150;

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
 * BFS pathfinding on the tile grid.
 * Avoids deep_water unless the agent has enough food to pay stamina costs.
 * Returns the path as an array of {x, y} from start (exclusive) to destination (inclusive).
 */
function findPath(
  startX: number,
  startY: number,
  tiles: Map<string, TerrainType>,
  isGoal: (x: number, y: number, terrain: TerrainType | undefined) => boolean,
  maxSteps: number,
  agentFood: number,
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

      const terrain = tiles.get(key);

      // Count deep_water tiles in the path to check affordability
      const node: PathNode = { x: nx, y: ny, parent: current };

      // Reconstruct path to check length and deep_water cost
      const path: Array<{ x: number; y: number }> = [];
      let deepWaterCount = 0;
      let n: PathNode | null = node;
      while (n && n.parent) {
        path.unshift({ x: n.x, y: n.y });
        const t = tiles.get(`${n.x},${n.y}`);
        if (t === 'deep_water') deepWaterCount++;
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

    // Fetch tiles in search area for pathfinding
    const searchRadius = Math.min(SEARCH_RADIUS, maxSteps + 10);
    const { data: tileRows, error: tilesError } = await supabase
      .from('tiles')
      .select('x, y, terrain')
      .gte('x', agent.x - searchRadius)
      .lte('x', agent.x + searchRadius)
      .gte('y', agent.y - searchRadius)
      .lte('y', agent.y + searchRadius)
      .limit(100000);

    if (tilesError) {
      console.error('move-to: tiles fetch error:', tilesError);
      return errorResponse('Failed to fetch map data.', 500);
    }

    // Build tile map for pathfinding
    const tileMap = new Map<string, TerrainType>();
    for (const t of tileRows || []) {
      tileMap.set(`${t.x},${t.y}`, t.terrain as TerrainType);
    }

    // Define goal function
    let goalDescription: string;
    let isGoal: (x: number, y: number, terrain: TerrainType | undefined) => boolean;

    if (hasCoords) {
      goalDescription = `(${targetX}, ${targetY})`;
      isGoal = (x, y) => x === targetX && y === targetY;
    } else {
      goalDescription = `nearest ${targetTerrain} tile`;
      isGoal = (_x, _y, terrain) => terrain === targetTerrain;
    }

    // Check if already on target terrain
    if (hasTerrain) {
      const currentTerrain = tileMap.get(`${agent.x},${agent.y}`);
      if (currentTerrain === targetTerrain) {
        return jsonResponse({
          success: true,
          data: {
            message: `Already on ${targetTerrain} terrain.`,
            position: { x: agent.x, y: agent.y },
            terrain: currentTerrain,
            steps: 0,
            path: [],
          },
        });
      }
    }

    // Find path via BFS
    const result = findPath(agent.x, agent.y, tileMap, isGoal, maxSteps, agent.food);

    if (!result) {
      return jsonResponse({
        success: false,
        error: `No path found to ${goalDescription} within ${maxSteps} steps. Try increasing max_steps or moving to a different area first.`,
        data: {
          position: { x: agent.x, y: agent.y },
          searched_radius: searchRadius,
          max_steps: maxSteps,
        },
      });
    }

    const { path, deepWaterCount } = result;
    const totalDeepWaterCost = deepWaterCount * DEEP_WATER_STAMINA_COST;

    // Get move cooldown for inter-step delays
    const moveCooldownMs = await getCooldownMs('move');

    // Execute each step with DB writes for realtime animation
    let currentFood = agent.food;
    let currentX = agent.x;
    let currentY = agent.y;
    const pathTaken: Array<{ x: number; y: number; terrain: string }> = [];

    for (let i = 0; i < path.length; i++) {
      const step = path[i];
      const stepTerrain = tileMap.get(`${step.x},${step.y}`) || 'unknown';

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
            terrain: tileMap.get(`${currentX},${currentY}`) || 'unknown',
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

    const finalTerrain = tileMap.get(`${currentX},${currentY}`) || 'unknown';

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
