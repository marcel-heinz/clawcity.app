import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMarketOrderId,
  formatGatherResultLine,
  formatMarketPricesLines,
  formatOracleLines,
  formatRecipesLines,
} from '../dist/lib/formatters.js';

test('formatGatherResultLine handles zero-resource gathers cleanly', () => {
  const line = formatGatherResultLine({
    gathered: { gold: 0, wood: 0, food: 0, stone: 0 },
    stamina: { efficiency: 100 },
    tile_status: 'market',
  });

  assert.equal(line, 'Gathered: none | Efficiency: 100% | Tile: market');
});

test('extractMarketOrderId supports nested response shape', () => {
  const id = extractMarketOrderId({
    order: { id: 'abc-123' },
    message: 'created',
  });
  assert.equal(id, 'abc-123');
});

test('formatMarketPricesLines parses stats and pair rates', () => {
  const lines = formatMarketPricesLines({
    stats: {
      open_orders: 4,
      transactions_24h: 9,
      active_trading_pairs: 2,
    },
    pairs: [
      {
        offer_resource: 'wood',
        request_resource: 'stone',
        order_count: 2,
        total_offer_available: 100,
        best_rate: 1.25,
        avg_rate: 1.4,
      },
    ],
  });

  assert.equal(lines[0], 'Open orders: 4 | 24h transactions: 9 | Active pairs: 2');
  assert.match(lines[1], /wood->stone/);
  assert.match(lines[1], /best:1\.25/);
  assert.match(lines[1], /avg:1\.40/);
});

test('formatRecipesLines supports craftable + shop payload', () => {
  const lines = formatRecipesLines({
    craftable: [
      {
        id: 'wooden_pickaxe',
        recipe: { wood: 40, stone: 10 },
        effects: ['+25% gathering on mountain'],
      },
    ],
    shop: [
      {
        id: 'rations',
        price: 20,
        effects: ['+25 food'],
      },
    ],
  });

  assert.equal(lines[0], 'Craftable items:');
  assert.match(lines[1], /wooden_pickaxe: 40w\+10s/);
  assert.equal(lines[2], 'Shop items:');
  assert.match(lines[3], /rations: 20 gold/);
});

test('formatOracleLines shows outcome progress and step list', () => {
  const lines = formatOracleLines({
    contract: {
      completed_outcomes: 2,
      total_outcomes: 6,
    },
    oracle: {
      title: 'The Oracle of ClawCity',
      narrative: 'A short story.',
      tournament_objective: 'Master Gatherer: total gathered.',
      starter_prompt: 'You are an autonomous competitor.',
    },
    next_steps: [
      {
        title: 'Leave Spawn',
        command: 'clawcity move forest',
        expected: 'Reach forest terrain.',
      },
    ],
  });

  assert.equal(lines[0], 'The Oracle of ClawCity | Outcomes: 2/6');
  assert.equal(lines[1], 'A short story.');
  assert.match(lines[3], /Next steps:/);
  assert.match(lines[4], /1\. Leave Spawn/);
});
