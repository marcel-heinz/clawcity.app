import {
  buildClaimQuote,
  type ClaimBlockReason,
  type ClaimDiscountSource,
  type ClaimQuote,
  type ClaimQuoteInput,
} from './claim-quote';
import {
  CLAIM_COST_FOOD,
  CLAIM_COST_GOLD,
  CLAIM_COST_STONE,
  CLAIM_COST_WOOD,
  MAX_TERRITORIES_PER_AGENT,
  STAMINA_COST_CLAIM,
} from './types';

type RpcClient = {
  rpc: (
    fn: string,
    params: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown | null }> | { data: unknown; error: unknown | null };
};

export type ClaimQuoteSource = 'rpc' | 'local_fallback';

export interface ClaimQuoteResolution {
  quote: ClaimQuote;
  source: ClaimQuoteSource;
}

const ALLOWED_REASONS: ClaimBlockReason[] = [
  'market_tile',
  'water_tile',
  'already_owned',
  'tile_claimed',
  'territory_limit',
  'insufficient_resources',
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function parseReasons(value: unknown): ClaimBlockReason[] | null {
  if (!Array.isArray(value)) return null;
  const reasons = value
    .filter((reason): reason is ClaimBlockReason => typeof reason === 'string' && ALLOWED_REASONS.includes(reason as ClaimBlockReason));
  return reasons.length === value.length ? reasons : null;
}

function parseDiscountSource(value: unknown): ClaimDiscountSource | null {
  if (value === 'none' || value === 'first_claim' || value === 'territory_deed') {
    return value;
  }
  return null;
}

function parseClaimQuote(data: unknown): ClaimQuote | null {
  const root = asRecord(data);
  if (!root) return null;
  if (asBoolean(root.ok) === false) return null;

  const quoteVersion = root.quote_version;
  if (quoteVersion !== 'v1') return null;

  const effectiveCostRaw = asRecord(root.effective_cost);
  const discountsRaw = asRecord(root.discounts);
  const requirementsRaw = asRecord(root.requirements);
  const reasons = parseReasons(root.reasons);

  if (!effectiveCostRaw || !discountsRaw || !requirementsRaw || !reasons) return null;

  const discountSource = parseDiscountSource(discountsRaw.discount_source);
  if (!discountSource) return null;

  const parseRequirement = (resource: string): { need: number; have: number; missing: number } | null => {
    const req = asRecord(requirementsRaw[resource]);
    if (!req) return null;
    return {
      need: asNumber(req.need, 0),
      have: asNumber(req.have, 0),
      missing: asNumber(req.missing, 0),
    };
  };

  const goldReq = parseRequirement('gold');
  const woodReq = parseRequirement('wood');
  const stoneReq = parseRequirement('stone');
  const foodReq = parseRequirement('food');
  if (!goldReq || !woodReq || !stoneReq || !foodReq) return null;

  const missingResources = Array.isArray(root.missing_resources)
    ? root.missing_resources.filter((value): value is string => typeof value === 'string')
    : [];

  return {
    quote_version: 'v1',
    can_execute: asBoolean(root.can_execute),
    can_afford: asBoolean(root.can_afford),
    reasons,
    effective_cost: {
      gold: asNumber(effectiveCostRaw.gold, CLAIM_COST_GOLD),
      wood: asNumber(effectiveCostRaw.wood, CLAIM_COST_WOOD),
      stone: asNumber(effectiveCostRaw.stone, CLAIM_COST_STONE),
      food_claim_cost: asNumber(effectiveCostRaw.food_claim_cost, CLAIM_COST_FOOD),
      stamina_cost: asNumber(effectiveCostRaw.stamina_cost, STAMINA_COST_CLAIM),
      food_total: asNumber(effectiveCostRaw.food_total, CLAIM_COST_FOOD + STAMINA_COST_CLAIM),
    },
    discounts: {
      territory_deed_available: asBoolean(discountsRaw.territory_deed_available),
      territory_deed_discount_percent: asNumber(discountsRaw.territory_deed_discount_percent, 0),
      territory_deed_used: asBoolean(discountsRaw.territory_deed_used),
      first_claim_discount_available: asBoolean(discountsRaw.first_claim_discount_available),
      first_claim_discount_used: asBoolean(discountsRaw.first_claim_discount_used),
      discount_percent_applied: asNumber(discountsRaw.discount_percent_applied, 0),
      discount_source: discountSource,
    },
    missing_resources: missingResources,
    requirements: {
      gold: goldReq,
      wood: woodReq,
      stone: stoneReq,
      food: foodReq,
    },
  };
}

export async function resolveClaimQuote(
  supabase: RpcClient,
  input: ClaimQuoteInput,
  position: { x: number; y: number },
): Promise<ClaimQuoteResolution> {
  const localQuote = buildClaimQuote(input);

  const { data, error } = await Promise.resolve(supabase.rpc('quote_claim_tile', {
    p_agent_id: input.agentId,
    p_x: position.x,
    p_y: position.y,
    p_base_gold_cost: CLAIM_COST_GOLD,
    p_base_wood_cost: CLAIM_COST_WOOD,
    p_base_stone_cost: CLAIM_COST_STONE,
    p_base_food_claim_cost: CLAIM_COST_FOOD,
    p_food_stamina_cost: STAMINA_COST_CLAIM,
    p_max_territories: input.maxTerritories ?? MAX_TERRITORIES_PER_AGENT,
    p_deed_discount_percent: input.territoryDeedDiscountPercent,
  }));

  if (error) {
    return {
      quote: localQuote,
      source: 'local_fallback',
    };
  }

  const rpcQuote = parseClaimQuote(data);
  if (!rpcQuote) {
    return {
      quote: localQuote,
      source: 'local_fallback',
    };
  }

  return {
    quote: rpcQuote,
    source: 'rpc',
  };
}
