import { randomInt } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ALL_RESOURCES,
  type MarketResource,
  WORLD_SIZE,
} from './types';

export const LIQUIDITY_AGENT_NAME = 'ClawCity_Oracle';
export const LIQUIDITY_BUFFER_PER_RESOURCE = 50000;

const ORDER_EXPIRY_DAYS = 30;
const MARKET_ANCHOR_X = 50;
const MARKET_ANCHOR_Y = 150;

const RESOURCE_VALUE: Record<MarketResource, number> = {
  gold: 1.0,
  wood: 1.05,
  food: 0.9,
  stone: 1.15,
};

const LADDER: Array<{ offerAmount: number; premium: number }> = [
  { offerAmount: 25, premium: 0.08 },
  { offerAmount: 75, premium: 0.14 },
  { offerAmount: 175, premium: 0.2 },
];

export interface LiquidityOrderSpec {
  offer_resource: MarketResource;
  offer_amount: number;
  request_resource: MarketResource;
  request_amount: number;
}

export interface LiquiditySeedResult {
  ok: boolean;
  message: string;
  agent_id?: string;
  created_orders?: number;
  cancelled_orders?: number;
}

export function buildDirectedResourcePairs(resources: readonly MarketResource[]): Array<{
  offer: MarketResource;
  request: MarketResource;
}> {
  const pairs: Array<{ offer: MarketResource; request: MarketResource }> = [];
  for (const offer of resources) {
    for (const request of resources) {
      if (offer !== request) {
        pairs.push({ offer, request });
      }
    }
  }
  return pairs;
}

export function buildBaselineLiquidityOrders(): {
  orders: LiquidityOrderSpec[];
  reservedByResource: Record<MarketResource, number>;
} {
  const orders: LiquidityOrderSpec[] = [];
  const reservedByResource: Record<MarketResource, number> = {
    gold: 0,
    wood: 0,
    food: 0,
    stone: 0,
  };

  for (const pair of buildDirectedResourcePairs(ALL_RESOURCES)) {
    const baseRate = RESOURCE_VALUE[pair.offer] / RESOURCE_VALUE[pair.request];
    for (const level of LADDER) {
      const requestAmount = Math.max(
        1,
        Math.round(level.offerAmount * baseRate * (1 + level.premium)),
      );
      orders.push({
        offer_resource: pair.offer,
        offer_amount: level.offerAmount,
        request_resource: pair.request,
        request_amount: requestAmount,
      });
      reservedByResource[pair.offer] += level.offerAmount;
    }
  }

  return { orders, reservedByResource };
}

async function ensureLiquidityAgent(supabase: SupabaseClient): Promise<{
  id: string;
  gold: number;
  wood: number;
  food: number;
  stone: number;
}> {
  const { data: existing, error: existingError } = await supabase
    .from('agents')
    .select('id, gold, wood, food, stone, is_system')
    .eq('name', LIQUIDITY_AGENT_NAME)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to lookup liquidity agent: ${existingError.message}`);
  }

  if (existing) {
    if (!existing.is_system) {
      await supabase
        .from('agents')
        .update({ is_system: true })
        .eq('id', existing.id);
    }
    return {
      id: existing.id,
      gold: existing.gold || 0,
      wood: existing.wood || 0,
      food: existing.food || 0,
      stone: existing.stone || 0,
    };
  }

  const spawnX = Math.min(Math.max(MARKET_ANCHOR_X, 0), WORLD_SIZE - 1);
  const spawnY = Math.min(Math.max(MARKET_ANCHOR_Y, 0), WORLD_SIZE - 1);
  const apiKeySuffix = randomInt(100000000, 999999999);

  const { data: created, error: createError } = await supabase
    .from('agents')
    .insert({
      name: LIQUIDITY_AGENT_NAME,
      api_key: `system_${apiKeySuffix}`,
      claim_token: '',
      claimed: true,
      claimed_by_twitter: '@oracle',
      is_system: true,
      x: spawnX,
      y: spawnY,
      gold: LIQUIDITY_BUFFER_PER_RESOURCE,
      wood: LIQUIDITY_BUFFER_PER_RESOURCE,
      food: LIQUIDITY_BUFFER_PER_RESOURCE,
      stone: LIQUIDITY_BUFFER_PER_RESOURCE,
      reputation: 0,
    })
    .select('id, gold, wood, food, stone')
    .single();

  if (createError || !created) {
    throw new Error(`Failed to create liquidity agent: ${createError?.message || 'unknown error'}`);
  }

  return {
    id: created.id,
    gold: created.gold || 0,
    wood: created.wood || 0,
    food: created.food || 0,
    stone: created.stone || 0,
  };
}

export async function ensureBaselineMarketLiquidity(supabase: SupabaseClient): Promise<LiquiditySeedResult> {
  try {
    const liquidityAgent = await ensureLiquidityAgent(supabase);
    const { orders, reservedByResource } = buildBaselineLiquidityOrders();

    const { data: openOrders, error: openOrdersError } = await supabase
      .from('market_orders')
      .select('id')
      .eq('agent_id', liquidityAgent.id)
      .eq('status', 'open');

    if (openOrdersError) {
      throw new Error(`Failed to fetch existing liquidity orders: ${openOrdersError.message}`);
    }

    let cancelledOrders = 0;
    if ((openOrders || []).length > 0) {
      const { error: cancelError } = await supabase
        .from('market_orders')
        .update({ status: 'cancelled' })
        .eq('agent_id', liquidityAgent.id)
        .eq('status', 'open');

      if (cancelError) {
        throw new Error(`Failed to cancel existing liquidity orders: ${cancelError.message}`);
      }
      cancelledOrders = openOrders!.length;
    }

    const topUpInventory = {
      gold: LIQUIDITY_BUFFER_PER_RESOURCE + reservedByResource.gold,
      wood: LIQUIDITY_BUFFER_PER_RESOURCE + reservedByResource.wood,
      food: LIQUIDITY_BUFFER_PER_RESOURCE + reservedByResource.food,
      stone: LIQUIDITY_BUFFER_PER_RESOURCE + reservedByResource.stone,
    };

    const { error: topUpError } = await supabase
      .from('agents')
      .update(topUpInventory)
      .eq('id', liquidityAgent.id);

    if (topUpError) {
      throw new Error(`Failed to top up liquidity inventory: ${topUpError.message}`);
    }

    const expiresAt = new Date(Date.now() + ORDER_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const payload = orders.map((order) => ({
      agent_id: liquidityAgent.id,
      offer_resource: order.offer_resource,
      offer_amount: order.offer_amount,
      request_resource: order.request_resource,
      request_amount: order.request_amount,
      filled_amount: 0,
      status: 'open',
      expires_at: expiresAt,
    }));

    const { error: insertError } = await supabase
      .from('market_orders')
      .insert(payload);

    if (insertError) {
      throw new Error(`Failed to insert liquidity orders: ${insertError.message}`);
    }

    const { error: reserveError } = await supabase
      .from('agents')
      .update({
        gold: LIQUIDITY_BUFFER_PER_RESOURCE,
        wood: LIQUIDITY_BUFFER_PER_RESOURCE,
        food: LIQUIDITY_BUFFER_PER_RESOURCE,
        stone: LIQUIDITY_BUFFER_PER_RESOURCE,
      })
      .eq('id', liquidityAgent.id);

    if (reserveError) {
      throw new Error(`Failed to normalize liquidity reserves: ${reserveError.message}`);
    }

    return {
      ok: true,
      message: `Seeded ${orders.length} baseline market orders across all directed resource pairs.`,
      agent_id: liquidityAgent.id,
      created_orders: orders.length,
      cancelled_orders: cancelledOrders,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown market liquidity error';
    return {
      ok: false,
      message,
    };
  }
}
