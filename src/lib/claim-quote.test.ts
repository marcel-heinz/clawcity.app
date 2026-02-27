import { describe, expect, it } from 'vitest';
import {
  buildClaimQuote,
  FIRST_CLAIM_DISCOUNT_PERCENT,
  resolveClaimDiscountState,
} from './claim-quote';

describe('claim quote helpers', () => {
  it('applies first-claim discount when no deed is available', () => {
    const quote = buildClaimQuote({
      inventory: { gold: 40, wood: 14, stone: 7, food: 10 },
      terrain: 'plains',
      tileOwnerId: null,
      agentId: 'agent-1',
      territoryCount: 0,
      territoryDeedAvailable: false,
    });

    expect(quote.discounts.discount_percent_applied).toBe(FIRST_CLAIM_DISCOUNT_PERCENT);
    expect(quote.discounts.first_claim_discount_used).toBe(true);
    expect(quote.discounts.territory_deed_used).toBe(false);
    expect(quote.effective_cost.gold).toBe(35);
    expect(quote.effective_cost.food_total).toBe(12);
  });

  it('prefers deed discount when better than first-claim discount', () => {
    const quote = buildClaimQuote({
      inventory: { gold: 100, wood: 100, stone: 100, food: 100 },
      terrain: 'plains',
      tileOwnerId: null,
      agentId: 'agent-1',
      territoryCount: 0,
      territoryDeedAvailable: true,
      territoryDeedDiscountPercent: 60,
    });

    expect(quote.discounts.discount_percent_applied).toBe(60);
    expect(quote.discounts.discount_source).toBe('territory_deed');
    expect(quote.discounts.territory_deed_used).toBe(true);
    expect(quote.discounts.first_claim_discount_used).toBe(false);
    expect(quote.effective_cost.gold).toBe(20);
  });

  it('adds terrain, ownership, limit, and affordability reasons', () => {
    const quote = buildClaimQuote({
      inventory: { gold: 0, wood: 0, stone: 0, food: 0 },
      terrain: 'market',
      tileOwnerId: 'other-agent',
      agentId: 'agent-1',
      territoryCount: 10,
      maxTerritories: 10,
      territoryDeedAvailable: false,
      firstClaimDiscountAvailable: false,
    });

    expect(quote.reasons).toEqual([
      'market_tile',
      'tile_claimed',
      'territory_limit',
      'insufficient_resources',
    ]);
    expect(quote.can_execute).toBe(false);
    expect(quote.can_afford).toBe(false);
  });

  it('honors discount overrides from atomic claim RPC output', () => {
    const discounts = resolveClaimDiscountState({
      territoryDeedAvailable: true,
      territoryDeedDiscountPercent: 50,
      firstClaimDiscountAvailable: true,
      discountOverride: {
        discount_percent_applied: 30,
        discount_source: 'first_claim',
        territory_deed_used: false,
        first_claim_discount_used: true,
      },
    });

    expect(discounts.discount_percent_applied).toBe(30);
    expect(discounts.discount_source).toBe('first_claim');
    expect(discounts.first_claim_discount_used).toBe(true);
    expect(discounts.territory_deed_used).toBe(false);
  });
});
