import { describe, expect, it } from 'vitest';
import { resolveClaimQuote } from './claim-quote-rpc';

const baseInput = {
  inventory: { gold: 50, wood: 20, stone: 10, food: 20 },
  terrain: 'forest',
  tileOwnerId: null,
  agentId: 'agent-1',
  territoryCount: 0,
  maxTerritories: 10,
  territoryDeedAvailable: false,
  territoryDeedDiscountPercent: 50,
  firstClaimDiscountAvailable: true,
} as const;

describe('resolveClaimQuote', () => {
  it('uses RPC quote when payload is valid', async () => {
    const supabase = {
      rpc: async () => ({
        error: null,
        data: {
          ok: true,
          quote_version: 'v1',
          can_execute: true,
          can_afford: true,
          reasons: [],
          effective_cost: {
            gold: 35,
            wood: 14,
            stone: 7,
            food_claim_cost: 10,
            stamina_cost: 5,
            food_total: 15,
          },
          discounts: {
            territory_deed_available: false,
            territory_deed_discount_percent: 50,
            territory_deed_used: false,
            first_claim_discount_available: true,
            first_claim_discount_used: true,
            discount_percent_applied: 30,
            discount_source: 'first_claim',
          },
          missing_resources: [],
          requirements: {
            gold: { need: 35, have: 50, missing: 0 },
            wood: { need: 14, have: 20, missing: 0 },
            stone: { need: 7, have: 10, missing: 0 },
            food: { need: 15, have: 20, missing: 0 },
          },
        },
      }),
    };

    const result = await resolveClaimQuote(supabase, baseInput, { x: 1, y: 2 });
    expect(result.source).toBe('rpc');
    expect(result.quote.can_afford).toBe(true);
    expect(result.quote.effective_cost.wood).toBe(14);
    expect(result.quote.discounts.first_claim_discount_used).toBe(true);
  });

  it('falls back to local quote on RPC error', async () => {
    const supabase = {
      rpc: async () => ({ error: { message: 'fn missing' }, data: null }),
    };

    const result = await resolveClaimQuote(supabase, baseInput, { x: 1, y: 2 });
    expect(result.source).toBe('local_fallback');
    expect(result.quote.discounts.first_claim_discount_used).toBe(true);
    expect(result.quote.effective_cost.gold).toBe(35);
  });

  it('falls back to local quote on invalid RPC payload', async () => {
    const supabase = {
      rpc: async () => ({ error: null, data: { ok: true, quote_version: 'v1' } }),
    };

    const result = await resolveClaimQuote(supabase, baseInput, { x: 1, y: 2 });
    expect(result.source).toBe('local_fallback');
    expect(result.quote.can_execute).toBe(true);
  });
});
