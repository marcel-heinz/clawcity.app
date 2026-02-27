import { getItemDefinition } from './crafting';
import {
  CLAIM_COST_FOOD,
  CLAIM_COST_GOLD,
  CLAIM_COST_STONE,
  CLAIM_COST_WOOD,
  MAX_TERRITORIES_PER_AGENT,
  STAMINA_COST_CLAIM,
} from './types';

export const FIRST_CLAIM_DISCOUNT_PERCENT = 30;
export const DEFAULT_TERRITORY_DEED_DISCOUNT_PERCENT = 50;

export type ClaimDiscountSource = 'none' | 'first_claim' | 'territory_deed';

export type ClaimBlockReason =
  | 'market_tile'
  | 'water_tile'
  | 'already_owned'
  | 'tile_claimed'
  | 'territory_limit'
  | 'insufficient_resources';

export type ClaimResourceName = 'gold' | 'wood' | 'stone' | 'food';

export interface ClaimResourceSnapshot {
  gold: number;
  wood: number;
  stone: number;
  food: number;
}

export interface ClaimRequirement {
  need: number;
  have: number;
  missing: number;
}

export interface ClaimEffectiveCost {
  gold: number;
  wood: number;
  stone: number;
  food_claim_cost: number;
  stamina_cost: number;
  food_total: number;
}

export interface ClaimDiscountState {
  territory_deed_available: boolean;
  territory_deed_discount_percent: number;
  territory_deed_used: boolean;
  first_claim_discount_available: boolean;
  first_claim_discount_used: boolean;
  discount_percent_applied: number;
  discount_source: ClaimDiscountSource;
}

export interface ClaimQuote {
  quote_version: 'v1';
  can_execute: boolean;
  can_afford: boolean;
  reasons: ClaimBlockReason[];
  effective_cost: ClaimEffectiveCost;
  discounts: ClaimDiscountState;
  missing_resources: string[];
  requirements: Record<ClaimResourceName, ClaimRequirement>;
}

export interface ClaimQuoteInput {
  inventory: ClaimResourceSnapshot;
  terrain?: string | null;
  tileOwnerId?: string | null;
  agentId: string;
  territoryCount: number;
  maxTerritories?: number;
  territoryDeedAvailable: boolean;
  territoryDeedDiscountPercent?: number;
  firstClaimDiscountAvailable?: boolean;
  discountOverride?: Partial<
    Pick<
      ClaimDiscountState,
      'discount_percent_applied' | 'discount_source' | 'territory_deed_used' | 'first_claim_discount_used'
    >
  >;
  baseReasons?: ClaimBlockReason[];
}

function toFiniteInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function makeRequirement(need: number, have: number): ClaimRequirement {
  return {
    need,
    have,
    missing: Math.max(0, need - have),
  };
}

function appendReasonUnique(list: ClaimBlockReason[], reason: ClaimBlockReason): void {
  if (!list.includes(reason)) {
    list.push(reason);
  }
}

export function getTerritoryDeedDiscountPercent(): number {
  const deedDefinition = getItemDefinition('territory_deed');
  if (!deedDefinition) {
    return DEFAULT_TERRITORY_DEED_DISCOUNT_PERCENT;
  }

  for (const effect of deedDefinition.effects) {
    if (effect.type === 'claim_discount') {
      return toFiniteInt(effect.percent, DEFAULT_TERRITORY_DEED_DISCOUNT_PERCENT);
    }
  }

  return DEFAULT_TERRITORY_DEED_DISCOUNT_PERCENT;
}

export function resolveClaimDiscountState(input: {
  territoryDeedAvailable: boolean;
  territoryDeedDiscountPercent?: number;
  firstClaimDiscountAvailable: boolean;
  discountOverride?: Partial<
    Pick<
      ClaimDiscountState,
      'discount_percent_applied' | 'discount_source' | 'territory_deed_used' | 'first_claim_discount_used'
    >
  >;
}): ClaimDiscountState {
  const territoryDeedDiscountPercent = toFiniteInt(
    input.territoryDeedDiscountPercent,
    getTerritoryDeedDiscountPercent(),
  );

  const firstClaimDiscountPercent = FIRST_CLAIM_DISCOUNT_PERCENT;
  const deedCandidate = input.territoryDeedAvailable ? territoryDeedDiscountPercent : 0;
  const firstClaimCandidate = input.firstClaimDiscountAvailable ? firstClaimDiscountPercent : 0;

  let discountPercentApplied = Math.max(deedCandidate, firstClaimCandidate);
  let discountSource: ClaimDiscountSource = 'none';
  let territoryDeedUsed = false;
  let firstClaimDiscountUsed = false;

  if (discountPercentApplied > 0) {
    if (deedCandidate >= firstClaimCandidate && deedCandidate > 0) {
      discountSource = 'territory_deed';
      territoryDeedUsed = true;
    } else {
      discountSource = 'first_claim';
      firstClaimDiscountUsed = true;
    }
  }

  if (input.discountOverride) {
    if (input.discountOverride.discount_percent_applied !== undefined) {
      discountPercentApplied = toFiniteInt(
        input.discountOverride.discount_percent_applied,
        discountPercentApplied,
      );
    }
    if (input.discountOverride.discount_source) {
      discountSource = input.discountOverride.discount_source;
    }
    if (input.discountOverride.territory_deed_used !== undefined) {
      territoryDeedUsed = input.discountOverride.territory_deed_used;
    }
    if (input.discountOverride.first_claim_discount_used !== undefined) {
      firstClaimDiscountUsed = input.discountOverride.first_claim_discount_used;
    }
  }

  return {
    territory_deed_available: input.territoryDeedAvailable,
    territory_deed_discount_percent: territoryDeedDiscountPercent,
    territory_deed_used: territoryDeedUsed,
    first_claim_discount_available: input.firstClaimDiscountAvailable,
    first_claim_discount_used: firstClaimDiscountUsed,
    discount_percent_applied: Math.max(0, Math.min(100, discountPercentApplied)),
    discount_source: discountSource,
  };
}

export function buildClaimQuote(input: ClaimQuoteInput): ClaimQuote {
  const maxTerritories = toFiniteInt(input.maxTerritories, MAX_TERRITORIES_PER_AGENT);
  const firstClaimDiscountAvailable =
    input.firstClaimDiscountAvailable === undefined
      ? input.territoryCount === 0
      : input.firstClaimDiscountAvailable;

  const discounts = resolveClaimDiscountState({
    territoryDeedAvailable: input.territoryDeedAvailable,
    territoryDeedDiscountPercent: input.territoryDeedDiscountPercent,
    firstClaimDiscountAvailable,
    discountOverride: input.discountOverride,
  });

  const multiplier = Math.max(0, (100 - discounts.discount_percent_applied) / 100);

  const effectiveCost: ClaimEffectiveCost = {
    gold: Math.floor(CLAIM_COST_GOLD * multiplier),
    wood: Math.floor(CLAIM_COST_WOOD * multiplier),
    stone: Math.floor(CLAIM_COST_STONE * multiplier),
    food_claim_cost: Math.floor(CLAIM_COST_FOOD * multiplier),
    stamina_cost: STAMINA_COST_CLAIM,
    food_total: 0,
  };
  effectiveCost.food_total = effectiveCost.food_claim_cost + effectiveCost.stamina_cost;

  const requirements: Record<ClaimResourceName, ClaimRequirement> = {
    gold: makeRequirement(effectiveCost.gold, input.inventory.gold),
    wood: makeRequirement(effectiveCost.wood, input.inventory.wood),
    stone: makeRequirement(effectiveCost.stone, input.inventory.stone),
    food: makeRequirement(effectiveCost.food_total, input.inventory.food),
  };

  const canAfford = Object.values(requirements).every((requirement) => requirement.missing === 0);
  const missingResources = (Object.entries(requirements) as Array<[ClaimResourceName, ClaimRequirement]>)
    .filter(([, requirement]) => requirement.missing > 0)
    .map(([resource, requirement]) => `${resource} (need ${requirement.need}, have ${requirement.have})`);

  const reasons: ClaimBlockReason[] = [];
  for (const baseReason of input.baseReasons || []) {
    appendReasonUnique(reasons, baseReason);
  }

  if (input.terrain === 'market') {
    appendReasonUnique(reasons, 'market_tile');
  }
  if (input.terrain === 'water') {
    appendReasonUnique(reasons, 'water_tile');
  }
  if (input.tileOwnerId === input.agentId) {
    appendReasonUnique(reasons, 'already_owned');
  }
  if (input.tileOwnerId && input.tileOwnerId !== input.agentId) {
    appendReasonUnique(reasons, 'tile_claimed');
  }
  if (input.territoryCount >= maxTerritories) {
    appendReasonUnique(reasons, 'territory_limit');
  }
  if (!canAfford) {
    appendReasonUnique(reasons, 'insufficient_resources');
  }

  return {
    quote_version: 'v1',
    can_execute: reasons.length === 0,
    can_afford: canAfford,
    reasons,
    effective_cost: effectiveCost,
    discounts,
    missing_resources: missingResources,
    requirements,
  };
}
