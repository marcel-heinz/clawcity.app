import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMarketOrderId,
  formatGatherResultLine,
  formatMarketPricesLines,
  formatOracleLines,
  formatRecipesLines,
  formatTournamentCreditsLines,
  formatTournamentOverviewLines,
  formatTournamentPerksLines,
} from '../dist/lib/formatters.js';

test('formatGatherResultLine handles zero-resource gathers cleanly', () => {
  const line = formatGatherResultLine({
    gathered: { gold: 0, wood: 0, food: 0, stone: 0 },
    stamina: { efficiency: 100 },
    tile_status: 'market',
  });

  assert.equal(line, 'Gathered: none | Efficiency: 100% | Tile: market');
});

test('formatGatherResultLine includes cooldown and tile planning metadata when present', () => {
  const line = formatGatherResultLine({
    gathered: { gold: 0, wood: 3, food: 0, stone: 1 },
    stamina: { efficiency: 88 },
    tile_status: 'available',
    harvestable: true,
    cooldown: { cooldown_remaining_ms: 4200 },
    tile_intel: { tile_health: 'fragile', gathers_remaining_estimate: 2, depletion_chance_percent: 33 },
  });

  assert.equal(
    line,
    'Gathered: +3 wood, +1 stone | Efficiency: 88% | Tile: available | Harvestable: yes | Next gather: 5s | Risk: 33% | Health: fragile | Est: 2 gathers',
  );
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

test('formatTournamentCreditsLines summarizes wallet and reward unlock states', () => {
  const lines = formatTournamentCreditsLines({
    wallet: {
      balance: 1200,
      lifetime_earned: 5100,
      lifetime_spent: 3900,
    },
    pending: {
      pending: 700,
      claimable: 500,
      locked: 200,
      pending_rewards: 2,
    },
    pending_rewards: [
      {
        kind: 'podium_gold',
        amount: 500,
        source_week_number: 10,
        unlock_week_number: 11,
        unlock_status: 'claimable',
      },
    ],
  });

  assert.equal(lines[0], 'Claw Credits | balance:1200 | earned:5100 | spent:3900');
  assert.match(lines[1], /claimable:500/);
  assert.match(lines[2], /Pending rewards:/);
  assert.match(lines[3], /podium_gold/);
});

test('formatTournamentPerksLines renders loadout and catalog rows', () => {
  const lines = formatTournamentPerksLines({
    wallet: { balance: 900 },
    active_tournament: { name: 'Wealth Sprint #8' },
    loadout: {
      storage_bonus_count: 1,
      durable_axe_uses_remaining: 27,
      durable_axe_purchases: 1,
    },
    catalog: [
      {
        id: 'durable_axe',
        cost: 500,
        per_purchase_uses: 30,
        per_tournament_purchase_cap: 10,
        effect: '+30% forest gather while uses remain',
      },
    ],
  });

  assert.equal(lines[0], 'Claw Credits balance: 900');
  assert.match(lines[2], /durable uses:27/);
  assert.match(lines[4], /durable_axe/);
  assert.match(lines[4], /uses\/purchase:30/);
});

test('formatTournamentOverviewLines includes participants, self status, and leaderboard hint', () => {
  const lines = formatTournamentOverviewLines({
    current: {
      id: 'tourn-123',
      name: 'Wealth Sprint #12',
      status: 'active',
      participant_count: 42,
    },
    top_three: [
      { live_rank: 1, agent_name: 'Alpha', current_score: 2100 },
    ],
    self: {
      live_rank: 7,
      status: 'active',
      current_score: 987,
    },
  });

  assert.equal(lines[0], 'Current: Wealth Sprint #12 (active) | participants:42');
  assert.equal(lines[1], 'Current ID: tourn-123');
  assert.match(lines[2], /Hint: full leaderboard/);
  assert.equal(lines[3], 'Top 3:');
  assert.equal(lines[4], '  #1 Alpha: 2100');
  assert.equal(lines[5], 'You: | #7 | active | score:987');
});
