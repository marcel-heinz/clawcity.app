import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { BUILDING_DEFINITIONS, calculateResourceCap } from '@/lib/buildings';
import {
  calculateWealthBreakdown,
  CLAIM_COST_FOOD,
  CLAIM_COST_GOLD,
  CLAIM_COST_STONE,
  CLAIM_COST_WOOD,
  MAX_TERRITORIES_PER_AGENT,
  MAX_UPGRADE_LEVEL,
  STAMINA_COST_CLAIM,
  UPGRADE_COSTS,
} from '@/lib/types';
import { getActiveStorageBonus } from '@/lib/claw-credits';

/**
 * GET /api/agents/me/stats
 *
 * Lightweight stats endpoint — returns only essential numbers.
 * Designed to minimize token usage when agents ask "what are my stats?"
 *
 * Response is ~150 chars vs ~2000+ chars from /api/agents/me
 */

type ResourceName = 'gold' | 'wood' | 'food' | 'stone';

interface Requirement {
  need: number;
  have: number;
  missing: number;
}

function makeRequirement(need: number, have: number): Requirement {
  return {
    need,
    have,
    missing: Math.max(0, need - have),
  };
}

function canAfford(requirements: Record<ResourceName, Requirement>): boolean {
  return Object.values(requirements).every((entry) => entry.missing === 0);
}

function missingResources(requirements: Record<ResourceName, Requirement>): string[] {
  return (Object.entries(requirements) as Array<[ResourceName, Requirement]>)
    .filter(([, entry]) => entry.missing > 0)
    .map(([resource, entry]) => `${resource} (need ${entry.need}, have ${entry.have})`);
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured.', 503, {
      code: 'database_not_configured',
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

  // Get current tile state
  const { data: tile } = await supabase
    .from('tiles')
    .select('terrain, owner_id, upgrade_level, building_type')
    .eq('x', agent.x)
    .eq('y', agent.y)
    .single();

  // Count buildings and storage for resource cap
  let storageCount = 0;
  let buildingCount = 0;
  let workshopCount = 0;
  let fortificationCount = 0;
  try {
    const { data: buildings } = await supabase
      .from('tiles')
      .select('building_type')
      .eq('owner_id', agent.id)
      .not('building_type', 'is', null);
    const buildingList = buildings || [];
    buildingCount = buildingList.length;
    storageCount = buildingList.filter((b: { building_type: string }) => b.building_type === 'storage').length;
    workshopCount = buildingList.filter((b: { building_type: string }) => b.building_type === 'workshop').length;
    fortificationCount = buildingList.filter((b: { building_type: string }) => b.building_type === 'fortification').length;
  } catch {
    // building columns may not exist yet
  }

  // Count territories
  let territoryCount = 0;
  try {
    const { count } = await supabase
      .from('tiles')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', agent.id);
    territoryCount = count || 0;
  } catch {
    // tiles table may not have owner_id yet
  }

  // Count pending trades
  let pendingTradeCount = 0;
  try {
    const { count } = await supabase
      .from('trades')
      .select('*', { count: 'exact', head: true })
      .eq('to_agent_id', agent.id)
      .eq('status', 'pending');
    pendingTradeCount = count || 0;
  } catch {
    // trades table may not exist
  }

  // Check if a territory deed discount is currently available
  let territoryDeedAvailable = false;
  try {
    const { data: deed } = await supabase
      .from('agent_items')
      .select('quantity, uses_remaining')
      .eq('agent_id', agent.id)
      .eq('item_id', 'territory_deed')
      .gt('quantity', 0)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (deed) {
      territoryDeedAvailable =
        (deed.quantity || 0) > 0 && (deed.uses_remaining === null || deed.uses_remaining > 0);
    }
  } catch {
    // agent_items table may not exist yet
  }

  const firstClaimDiscountAvailable = territoryCount === 0;
  const claimDiscountPercent = territoryDeedAvailable
    ? 50
    : firstClaimDiscountAvailable
      ? 30
      : 0;
  const claimDiscountMultiplier = (100 - claimDiscountPercent) / 100;

  const claimCostHere = {
    gold: Math.floor(CLAIM_COST_GOLD * claimDiscountMultiplier),
    wood: Math.floor(CLAIM_COST_WOOD * claimDiscountMultiplier),
    stone: Math.floor(CLAIM_COST_STONE * claimDiscountMultiplier),
    food_claim_cost: Math.floor(CLAIM_COST_FOOD * claimDiscountMultiplier),
    stamina_cost: STAMINA_COST_CLAIM,
  };
  const claimFoodTotal = claimCostHere.food_claim_cost + STAMINA_COST_CLAIM;
  const claimRequirements: Record<ResourceName, Requirement> = {
    gold: makeRequirement(claimCostHere.gold, agent.gold),
    wood: makeRequirement(claimCostHere.wood, agent.wood),
    stone: makeRequirement(claimCostHere.stone, agent.stone),
    food: makeRequirement(claimFoodTotal, agent.food),
  };
  const canAffordClaim = canAfford(claimRequirements);

  const currentTile = {
    x: agent.x,
    y: agent.y,
    terrain: tile?.terrain || 'unknown',
    owner_id: tile?.owner_id || null,
    is_owned_by_you: tile?.owner_id === agent.id,
    is_claimed: Boolean(tile?.owner_id),
    upgrade_level: Math.max(1, Number(tile?.upgrade_level || 1)),
    building_type: tile?.building_type || null,
  };

  const claimReasons: string[] = [];
  if (currentTile.terrain === 'market') claimReasons.push('market_tile');
  if (currentTile.terrain === 'water') claimReasons.push('water_tile');
  if (currentTile.owner_id === agent.id) claimReasons.push('already_owned');
  if (currentTile.owner_id && currentTile.owner_id !== agent.id) claimReasons.push('tile_claimed');
  if (territoryCount >= MAX_TERRITORIES_PER_AGENT) claimReasons.push('territory_limit');
  if (!canAffordClaim) claimReasons.push('insufficient_resources');
  const canClaimHere = claimReasons.length === 0;

  const currentLevel = currentTile.upgrade_level;
  const nextUpgradeLevel = currentLevel + 1;
  const nextUpgradeCost = UPGRADE_COSTS[nextUpgradeLevel] || null;
  const upgradeRequirements: Record<ResourceName, Requirement> = {
    gold: makeRequirement(0, agent.gold),
    wood: makeRequirement(nextUpgradeCost?.wood || 0, agent.wood),
    stone: makeRequirement(nextUpgradeCost?.stone || 0, agent.stone),
    food: makeRequirement(0, agent.food),
  };
  const canAffordUpgrade = canAfford(upgradeRequirements);
  const upgradeReasons: string[] = [];
  if (!currentTile.is_owned_by_you) upgradeReasons.push('not_owned');
  if (currentLevel >= MAX_UPGRADE_LEVEL || !nextUpgradeCost) upgradeReasons.push('max_level');
  if (nextUpgradeCost && !canAffordUpgrade) upgradeReasons.push('insufficient_resources');
  const canUpgradeHere = upgradeReasons.length === 0;

  const buildOptions = Object.entries(BUILDING_DEFINITIONS).reduce((acc, [buildingType, definition]) => {
    const requirements: Record<ResourceName, Requirement> = {
      gold: makeRequirement(definition.build_cost.gold || 0, agent.gold),
      wood: makeRequirement(definition.build_cost.wood || 0, agent.wood),
      food: makeRequirement(definition.build_cost.food || 0, agent.food),
      stone: makeRequirement(definition.build_cost.stone || 0, agent.stone),
    };
    acc[buildingType] = {
      cost: definition.build_cost,
      can_afford: canAfford(requirements),
      missing_resources: missingResources(requirements),
      requirements,
    };
    return acc;
  }, {} as Record<string, {
    cost: { gold?: number; wood?: number; food?: number; stone?: number };
    can_afford: boolean;
    missing_resources: string[];
    requirements: Record<ResourceName, Requirement>;
  }>);

  const buildReasons: string[] = [];
  if (!currentTile.is_owned_by_you) buildReasons.push('not_owned');
  if (currentTile.building_type) buildReasons.push('building_exists');
  const canBuildHere = buildReasons.length === 0;

  const storageBonusCap = await getActiveStorageBonus(supabase, agent.id);
  const resourceCap = calculateResourceCap(storageCount) + storageBonusCap;
  const wealthBreakdown = calculateWealthBreakdown({
    gold: agent.gold,
    wood: agent.wood,
    food: agent.food,
    stone: agent.stone,
    buildings: { storage: storageCount, workshop: workshopCount, fortification: fortificationCount },
    territory_count: territoryCount,
  });

  return jsonResponse({
    success: true,
    data: {
      name: agent.name,
      position: { x: agent.x, y: agent.y },
      terrain: currentTile.terrain,
      gold: agent.gold,
      wood: agent.wood,
      food: agent.food,
      stone: agent.stone,
      wealth: wealthBreakdown.total,
      reputation: agent.reputation,
      resource_cap: resourceCap,
      resource_cap_bonus_from_claw_credits: storageBonusCap,
      territories: territoryCount,
      buildings: buildingCount,
      pending_trades: pendingTradeCount,
      current_tile: currentTile,
      action_eligibility: {
        claim: {
          can_execute: canClaimHere,
          can_afford: canAffordClaim,
          reasons: claimReasons,
          effective_cost: {
            ...claimCostHere,
            food_total: claimFoodTotal,
          },
          discounts: {
            territory_deed_available: territoryDeedAvailable,
            first_claim_discount_available: firstClaimDiscountAvailable,
            discount_percent_applied: claimDiscountPercent,
          },
          missing_resources: missingResources(claimRequirements),
          requirements: claimRequirements,
        },
        upgrade: {
          can_execute: canUpgradeHere,
          can_afford: canAffordUpgrade,
          reasons: upgradeReasons,
          current_level: currentLevel,
          next_level: nextUpgradeCost ? nextUpgradeLevel : null,
          cost: nextUpgradeCost,
          missing_resources: nextUpgradeCost ? missingResources(upgradeRequirements) : [],
          requirements: upgradeRequirements,
        },
        build: {
          can_execute: canBuildHere,
          reasons: buildReasons,
          options: buildOptions,
        },
      },
      last_active: agent.last_active,
    },
  });
}
