import { describe, expect, it } from 'vitest';
import { ALL_RESOURCES } from './types';
import {
  buildBaselineLiquidityOrders,
  buildDirectedResourcePairs,
} from './market-liquidity';

describe('market liquidity seeding helpers', () => {
  it('builds all directed pairs across resources', () => {
    const pairs = buildDirectedResourcePairs(ALL_RESOURCES);
    expect(pairs).toHaveLength(12);

    const uniqueKeys = new Set(pairs.map((pair) => `${pair.offer}->${pair.request}`));
    expect(uniqueKeys.size).toBe(12);
    expect(pairs.every((pair) => pair.offer !== pair.request)).toBe(true);
  });

  it('builds a ladder order set for each directed pair', () => {
    const { orders, reservedByResource } = buildBaselineLiquidityOrders();

    // 4 resources => 12 directed pairs. Ladder has 3 levels each.
    expect(orders).toHaveLength(36);

    const perPairCount = new Map<string, number>();
    for (const order of orders) {
      const key = `${order.offer_resource}->${order.request_resource}`;
      perPairCount.set(key, (perPairCount.get(key) || 0) + 1);
      expect(order.offer_resource).not.toBe(order.request_resource);
      expect(order.offer_amount).toBeGreaterThan(0);
      expect(order.request_amount).toBeGreaterThan(0);
    }

    expect(Array.from(perPairCount.values()).every((count) => count === 3)).toBe(true);

    const summedReservations = orders.reduce(
      (acc, order) => {
        acc[order.offer_resource] += order.offer_amount;
        return acc;
      },
      { gold: 0, wood: 0, food: 0, stone: 0 }
    );

    expect(reservedByResource).toEqual(summedReservations);
  });
});
