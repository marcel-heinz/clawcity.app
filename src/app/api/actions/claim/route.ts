import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { buildClaimQuote, getTerritoryDeedDiscountPercent, type ClaimBlockReason } from '@/lib/claim-quote';
import {
  CLAIM_COST_GOLD,
  CLAIM_COST_WOOD,
  CLAIM_COST_STONE,
  CLAIM_COST_FOOD,
  STAMINA_COST_CLAIM,
  MAX_TERRITORIES_PER_AGENT,
  TERRITORY_UPKEEP_FOOD
} from '@/lib/types';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import { withAnnouncements } from '@/lib/announcements';
import { enforceMutationOnboardingGate } from '@/lib/onboarding-gate';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503, {
      code: 'database_not_configured',
    });
  }

  // Apply rate limiting (per-IP)
  const rateLimit = await checkRateLimit(request, GAME_ACTION_RATE_LIMIT);
  if (!rateLimit.success) {
    const retryAfter = Math.ceil((rateLimit.retryAfterMs || 1000) / 1000);
    return errorResponse(
      `Rate limit exceeded. Try again in ${retryAfter}s.`,
      429,
      {
        code: 'rate_limited',
        retry_after_seconds: retryAfter,
      }
    );
  }

  const auth = await authenticateAgent(request);
  
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401, {
      code: 'unauthorized',
    });
  }

  const onboardingGateError = enforceMutationOnboardingGate(auth.agent, 'claim');
  if (onboardingGateError) {
    return onboardingGateError;
  }

  try {
    const agent = auth.agent;
    const supabase = createServerClient();
    const deedDiscountPercent = getTerritoryDeedDiscountPercent();

    const [tileResult, territoryCountResult, deedResult] = await Promise.all([
      supabase
        .from('tiles')
        .select('terrain, owner_id')
        .eq('x', agent.x)
        .eq('y', agent.y)
        .maybeSingle(),
      supabase
        .from('tiles')
        .select('*', { count: 'exact', head: true })
        .eq('owner_id', agent.id),
      supabase
        .from('agent_items')
        .select('quantity, uses_remaining')
        .eq('agent_id', agent.id)
        .eq('item_id', 'territory_deed')
        .gt('quantity', 0)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (territoryCountResult.error) {
      console.error('claim: failed to fetch territory count', territoryCountResult.error);
    }

    if (tileResult.error) {
      console.error('claim: failed to fetch current tile snapshot', tileResult.error);
    }

    let territoryDeedAvailable = false;
    if (deedResult.error) {
      console.error('claim: failed to fetch territory deed availability', deedResult.error);
    } else if (deedResult.data) {
      territoryDeedAvailable =
        (deedResult.data.quantity || 0) > 0 &&
        (deedResult.data.uses_remaining === null || deedResult.data.uses_remaining > 0);
    }

    const territoryCount = territoryCountResult.count || 0;
    const preClaimQuote = buildClaimQuote({
      inventory: {
        gold: agent.gold,
        wood: agent.wood,
        stone: agent.stone,
        food: agent.food,
      },
      terrain: tileResult.data?.terrain || null,
      tileOwnerId: tileResult.data?.owner_id || null,
      agentId: agent.id,
      territoryCount,
      maxTerritories: MAX_TERRITORIES_PER_AGENT,
      territoryDeedAvailable,
      territoryDeedDiscountPercent: deedDiscountPercent,
      firstClaimDiscountAvailable: territoryCount === 0,
    });

    const { data: rawResult, error: claimError } = await supabase.rpc('claim_tile_atomic', {
      p_agent_id: agent.id,
      p_x: agent.x,
      p_y: agent.y,
      p_base_gold_cost: CLAIM_COST_GOLD,
      p_base_wood_cost: CLAIM_COST_WOOD,
      p_base_stone_cost: CLAIM_COST_STONE,
      p_base_food_claim_cost: CLAIM_COST_FOOD,
      p_food_stamina_cost: STAMINA_COST_CLAIM,
      p_max_territories: MAX_TERRITORIES_PER_AGENT,
      p_territory_upkeep_food: TERRITORY_UPKEEP_FOOD,
      p_deed_discount_percent: deedDiscountPercent,
    });

    if (claimError) {
      console.error('Atomic claim RPC error:', claimError);
      return errorResponse('Failed to claim tile', 500, {
        code: 'claim_rpc_failed',
      });
    }

    const result = (rawResult || {}) as Record<string, unknown>;
    const code = typeof result.code === 'string' ? result.code : 'unknown';
    const toNumber = (value: unknown, fallback: number): number =>
      typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    const claimQuoteFor = (
      baseReasons: ClaimBlockReason[] = [],
      discountOverride: {
        discount_percent_applied?: number;
        discount_source?: 'none' | 'first_claim' | 'territory_deed';
        territory_deed_used?: boolean;
        first_claim_discount_used?: boolean;
      } = {},
    ) =>
      buildClaimQuote({
        inventory: {
          gold: agent.gold,
          wood: agent.wood,
          stone: agent.stone,
          food: agent.food,
        },
        terrain: tileResult.data?.terrain || null,
        tileOwnerId: tileResult.data?.owner_id || null,
        agentId: agent.id,
        territoryCount,
        maxTerritories: MAX_TERRITORIES_PER_AGENT,
        territoryDeedAvailable,
        territoryDeedDiscountPercent: deedDiscountPercent,
        firstClaimDiscountAvailable: territoryCount === 0,
        baseReasons,
        discountOverride,
      });

    if (result.ok !== true) {
      if (code === 'market_tile') {
        return errorResponse('Markets cannot be claimed - they belong to everyone.', 400, {
          code,
          details: {
            claim_quote: claimQuoteFor(['market_tile']),
          },
        });
      }
      if (code === 'water_tile') {
        return errorResponse('Water tiles cannot be claimed.', 400, {
          code,
          details: {
            claim_quote: claimQuoteFor(['water_tile']),
          },
        });
      }
      if (code === 'already_owned') {
        return errorResponse('You already own this tile!', 400, {
          code,
          details: {
            claim_quote: claimQuoteFor(['already_owned']),
          },
        });
      }
      if (code === 'tile_claimed') {
        const ownerId = typeof result.owner_id === 'string' ? result.owner_id : null;
        let ownerName = 'another agent';
        if (ownerId) {
          const { data: owner } = await supabase
            .from('agents')
            .select('name')
            .eq('id', ownerId)
            .single();
          if (owner?.name) ownerName = owner.name;
        }
        return errorResponse(
          `This tile is already claimed by ${ownerName}. Trade with them to acquire it.`,
          400,
          {
            code,
            details: {
              owner_id: ownerId,
              owner_name: ownerName,
              claim_quote: claimQuoteFor(['tile_claimed']),
            },
          }
        );
      }
      if (code === 'territory_limit') {
        return errorResponse(
          `You have reached the maximum of ${MAX_TERRITORIES_PER_AGENT} territories. Trade or release tiles to claim more.`,
          400,
          {
            code,
            details: {
              max_territories: MAX_TERRITORIES_PER_AGENT,
              claim_quote: claimQuoteFor(['territory_limit']),
            },
          }
        );
      }
      if (code === 'insufficient_resources') {
        const cost = (result.cost && typeof result.cost === 'object')
          ? result.cost as Record<string, unknown>
          : {};
        const missingResources = Array.isArray(result.missing_resources)
          ? result.missing_resources.filter((v): v is string => typeof v === 'string')
          : [];
        const effectiveGoldCost = toNumber(cost.gold, CLAIM_COST_GOLD);
        const effectiveWoodCost = toNumber(cost.wood, CLAIM_COST_WOOD);
        const effectiveStoneCost = toNumber(cost.stone, CLAIM_COST_STONE);
        const totalFoodCost = toNumber(cost.food, CLAIM_COST_FOOD + STAMINA_COST_CLAIM);
        const territoryDeedUsed = result.territory_deed_used === true;
        const firstClaimDiscountUsed = result.first_claim_discount_used === true;
        const discountPercentApplied = toNumber(
          result.discount_percent_applied,
          preClaimQuote.discounts.discount_percent_applied,
        );
        const discountSourceRaw = result.discount_source;
        const discountSource =
          discountSourceRaw === 'territory_deed' || discountSourceRaw === 'first_claim' || discountSourceRaw === 'none'
            ? discountSourceRaw
            : territoryDeedUsed
              ? 'territory_deed'
              : firstClaimDiscountUsed
                ? 'first_claim'
                : 'none';
        const claimQuote = claimQuoteFor(['insufficient_resources'], {
          discount_percent_applied: discountPercentApplied,
          discount_source: discountSource,
          territory_deed_used: territoryDeedUsed,
          first_claim_discount_used: firstClaimDiscountUsed,
        });
        const discountNote = territoryDeedUsed
          ? ` (with Territory Deed -${discountPercentApplied}% discount)`
          : firstClaimDiscountUsed
            ? ` (with First Claim Boon -${discountPercentApplied}% discount)`
            : '';
        const recoveryOptions = 'Recovery options: rotate forest/mountain gathers, convert via market on market tiles, or direct-trade with another agent.';
        const requirements = {
          gold: {
            need: effectiveGoldCost,
            have: agent.gold,
            missing: Math.max(0, effectiveGoldCost - agent.gold),
          },
          wood: {
            need: effectiveWoodCost,
            have: agent.wood,
            missing: Math.max(0, effectiveWoodCost - agent.wood),
          },
          stone: {
            need: effectiveStoneCost,
            have: agent.stone,
            missing: Math.max(0, effectiveStoneCost - agent.stone),
          },
          food: {
            need: totalFoodCost,
            have: agent.food,
            missing: Math.max(0, totalFoodCost - agent.food),
          },
        };
        return errorResponse(
          `Not enough resources to claim territory. Missing: ${missingResources.join(', ')}. ` +
          `Full cost: ${effectiveGoldCost} gold, ${effectiveWoodCost} wood, ${effectiveStoneCost} stone, ${totalFoodCost} food${discountNote}. ` +
          recoveryOptions,
          400,
          {
            code,
            details: {
              missing_resources: missingResources,
              requirements,
              cost: {
                gold: effectiveGoldCost,
                wood: effectiveWoodCost,
                stone: effectiveStoneCost,
                food: totalFoodCost,
                food_claim_cost: toNumber(cost.food_claim_cost, CLAIM_COST_FOOD),
                stamina_cost: STAMINA_COST_CLAIM,
              },
              discounts: {
                territory_deed_used: territoryDeedUsed,
                first_claim_discount_used: firstClaimDiscountUsed,
                discount_percent_applied: discountPercentApplied,
                discount_source: discountSource,
              },
              claim_quote: claimQuote,
            },
            hint: recoveryOptions,
          }
        );
      }
      if (code === 'tile_not_found') {
        return errorResponse('Could not find your current tile', 500, {
          code,
          details: {
            claim_quote: preClaimQuote,
          },
        });
      }
      return errorResponse('Failed to claim tile', 500, {
        code: code === 'unknown' ? 'claim_failed' : code,
        details: {
          claim_quote: preClaimQuote,
        },
      });
    }

    const terrain = typeof result.terrain === 'string' ? result.terrain : 'unknown';
    const newTerritoryCount = toNumber(result.territory_count, 0);
    const cost = (result.cost && typeof result.cost === 'object')
      ? result.cost as Record<string, unknown>
      : {};
    const inventory = (result.inventory && typeof result.inventory === 'object')
      ? result.inventory as Record<string, unknown>
      : {};

    const effectiveGoldCost = toNumber(cost.gold, CLAIM_COST_GOLD);
    const effectiveWoodCost = toNumber(cost.wood, CLAIM_COST_WOOD);
    const effectiveStoneCost = toNumber(cost.stone, CLAIM_COST_STONE);
    const effectiveFoodClaimCost = toNumber(cost.food_claim_cost, CLAIM_COST_FOOD);
    const totalFoodCost = toNumber(cost.food, effectiveFoodClaimCost + STAMINA_COST_CLAIM);

    const newGold = toNumber(inventory.gold, agent.gold - effectiveGoldCost);
    const newWood = toNumber(inventory.wood, agent.wood - effectiveWoodCost);
    const newStone = toNumber(inventory.stone, agent.stone - effectiveStoneCost);
    const newFood = toNumber(inventory.food, agent.food - totalFoodCost);

    const territoryDeedUsed = result.territory_deed_used === true;
    const firstClaimDiscountUsed = result.first_claim_discount_used === true;
    const discountPercentApplied = toNumber(
      result.discount_percent_applied,
      preClaimQuote.discounts.discount_percent_applied,
    );
    const discountSourceRaw = result.discount_source;
    const discountSource =
      discountSourceRaw === 'territory_deed' || discountSourceRaw === 'first_claim' || discountSourceRaw === 'none'
        ? discountSourceRaw
        : territoryDeedUsed
          ? 'territory_deed'
          : firstClaimDiscountUsed
            ? 'first_claim'
            : 'none';
    const claimQuote = claimQuoteFor([], {
      discount_percent_applied: discountPercentApplied,
      discount_source: discountSource,
      territory_deed_used: territoryDeedUsed,
      first_claim_discount_used: firstClaimDiscountUsed,
    });
    const discountMessage = territoryDeedUsed
      ? ` (Territory Deed applied: -${discountPercentApplied}% cost!)`
      : firstClaimDiscountUsed
        ? ` (First Claim Boon applied: -${discountPercentApplied}% cost!)`
        : '';

    const responseData = await withAnnouncements(agent, {
      message: `You have claimed this ${terrain} tile!${discountMessage} ` +
        `Cost: ${effectiveGoldCost} gold, ${effectiveWoodCost} wood, ${effectiveStoneCost} stone, ${totalFoodCost} food. ` +
        `You now receive +25% resources when gathering here (upgradeable to +75%). ` +
        `IMPORTANT: Territory upkeep is ${TERRITORY_UPKEEP_FOOD} food/territory/hour (${newTerritoryCount * TERRITORY_UPKEEP_FOOD} food/hour total for your ${newTerritoryCount} territories).`,
      position: { x: agent.x, y: agent.y },
      terrain,
      cost: {
        gold: effectiveGoldCost,
        wood: effectiveWoodCost,
        stone: effectiveStoneCost,
        food: totalFoodCost,
        discount_percent_applied: discountPercentApplied,
        discount_source: discountSource,
        first_claim_discount_used: firstClaimDiscountUsed,
        territory_deed_used: territoryDeedUsed,
        food_breakdown: {
          claim_cost: effectiveFoodClaimCost,
          stamina_cost: STAMINA_COST_CLAIM
        }
      },
      upkeep: {
        food_per_territory_per_hour: TERRITORY_UPKEEP_FOOD,
        total_food_per_hour: newTerritoryCount * TERRITORY_UPKEEP_FOOD
      },
      inventory: {
        gold: newGold,
        wood: newWood,
        stone: newStone,
        food: newFood
      },
      territory_count: newTerritoryCount,
      max_territories: MAX_TERRITORIES_PER_AGENT,
      claim_quote: claimQuote,
    });

    return jsonResponse({ success: true, data: responseData });
  } catch (error) {
    console.error('Claim error:', error);
    return errorResponse('Internal server error', 500, {
      code: 'internal_error',
    });
  }
}
