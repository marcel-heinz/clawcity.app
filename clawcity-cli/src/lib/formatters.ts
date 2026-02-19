type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asRecordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value)
    ? value.filter((entry) => entry && typeof entry === 'object') as UnknownRecord[]
    : [];
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function formatNumber(value: number | null, digits = 2): string {
  if (value === null) return '?';
  return value.toFixed(digits);
}

function formatCompactResources(resources: UnknownRecord): string {
  const gold = asNumber(resources.gold) ?? 0;
  const wood = asNumber(resources.wood) ?? 0;
  const food = asNumber(resources.food) ?? 0;
  const stone = asNumber(resources.stone) ?? 0;
  return `G:${gold} W:${wood} F:${food} S:${stone}`;
}

function formatRecipeCost(recipe: UnknownRecord): string {
  const entries = Object.entries(recipe)
    .map(([resource, amount]) => {
      const parsed = asNumber(amount);
      if (parsed === null || parsed <= 0) return null;
      return `${parsed}${resource[0]}`;
    })
    .filter((entry): entry is string => Boolean(entry));
  return entries.join('+');
}

export function formatGatherResultLine(data: UnknownRecord): string {
  const gathered = asRecord(data.gathered);
  const stamina = asRecord(data.stamina);
  const cooldown = asRecord(data.cooldown);
  const tileIntel = asRecord(data.tile_intel);
  const efficiency = asNumber(stamina?.efficiency);
  const cooldownRemainingMs = asNumber(cooldown?.cooldown_remaining_ms);
  const tileHealth = asString(tileIntel?.tile_health);
  const gathersRemainingEstimate = asNumber(tileIntel?.gathers_remaining_estimate);
  const tileStatus = asString(data.tile_status)
    || (data.tile_depleted === true ? 'depleted' : 'available');
  const parts = gathered
    ? Object.entries(gathered)
        .map(([resource, amount]) => {
          const parsed = asNumber(amount);
          if (parsed === null || parsed <= 0) return null;
          return `+${parsed} ${resource}`;
        })
        .filter((entry): entry is string => Boolean(entry))
    : [];

  const gatheredPart = parts.length > 0 ? parts.join(', ') : 'none';
  const segments = [
    `Gathered: ${gatheredPart}`,
    `Efficiency: ${efficiency ?? '?'}%`,
    `Tile: ${tileStatus}`,
  ];

  if (cooldownRemainingMs !== null) {
    segments.push(`Next: ${Math.ceil(cooldownRemainingMs / 1000)}s`);
  }
  if (tileHealth) {
    segments.push(`Health: ${tileHealth}`);
  }
  if (gathersRemainingEstimate !== null) {
    segments.push(`Est: ${gathersRemainingEstimate} gathers`);
  }

  const message = asString(data.message);
  if (message && parts.length === 0) {
    segments.push(message);
  }

  return segments.join(' | ');
}

export function extractMarketOrderId(data: UnknownRecord): string | null {
  const order = asRecord(data.order);
  return asString(order?.id)
    || asString(data.order_id)
    || asString(data.id)
    || null;
}

export function formatMarketPricesLines(data: UnknownRecord): string[] {
  const stats = asRecord(data.stats);
  const pairs = asRecordArray(data.pairs);

  const openOrders = asNumber(stats?.open_orders) ?? 0;
  const transactions24h = asNumber(stats?.transactions_24h) ?? 0;
  const activePairs = asNumber(stats?.active_trading_pairs) ?? pairs.length;

  const lines = [
    `Open orders: ${openOrders} | 24h transactions: ${transactions24h} | Active pairs: ${activePairs}`,
  ];

  if (pairs.length === 0) {
    lines.push('No active trading pairs');
    return lines;
  }

  const sortedPairs = [...pairs]
    .sort((a, b) => (asNumber(b.order_count) ?? 0) - (asNumber(a.order_count) ?? 0))
    .slice(0, 12);

  for (const pair of sortedPairs) {
    const offer = asString(pair.offer_resource) || '?';
    const request = asString(pair.request_resource) || '?';
    const orderCount = asNumber(pair.order_count) ?? 0;
    const available = asNumber(pair.total_offer_available) ?? 0;
    const bestRate = asNumber(pair.best_rate);
    const avgRate = asNumber(pair.avg_rate);
    lines.push(
      `${offer}->${request} | orders:${orderCount} | avail:${available} | best:${formatNumber(bestRate)} | avg:${formatNumber(avgRate)}`
    );
  }

  return lines;
}

export function formatRecipesLines(data: UnknownRecord): string[] {
  const craftable = asRecordArray(data.craftable);
  const shop = asRecordArray(data.shop);
  const lines: string[] = [];

  lines.push('Craftable items:');
  if (craftable.length === 0) {
    lines.push('  (none)');
  } else {
    for (const item of craftable) {
      const id = asString(item.id) || 'unknown';
      const recipe = asRecord(item.recipe);
      const cost = recipe ? formatRecipeCost(recipe) : '?';
      const effects = Array.isArray(item.effects)
        ? item.effects.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
        : [];
      const workshop = item.requires_workshop === true ? ' | workshop' : '';
      const effect = effects.length > 0 ? ` | ${effects[0]}` : '';
      lines.push(`  - ${id}: ${cost}${workshop}${effect}`);
    }
  }

  lines.push('Shop items:');
  if (shop.length === 0) {
    lines.push('  (none)');
  } else {
    for (const item of shop) {
      const id = asString(item.id) || 'unknown';
      const price = asNumber(item.price);
      const effects = Array.isArray(item.effects)
        ? item.effects.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
        : [];
      const effect = effects.length > 0 ? ` | ${effects[0]}` : '';
      lines.push(`  - ${id}: ${price ?? '?'} gold${effect}`);
    }
  }

  return lines;
}

export function formatProfileLines(data: UnknownRecord): string[] {
  const agent = asRecord(data.agent);
  if (!agent) {
    return ['Profile payload missing agent object'];
  }

  const name = asString(agent.name) || 'Unknown';
  const x = asNumber(agent.x) ?? '?';
  const y = asNumber(agent.y) ?? '?';
  const wealth = asNumber(agent.wealth) ?? 0;
  const reputation = asNumber(agent.reputation) ?? 0;
  const resources = formatCompactResources(agent);
  const territoryCount = asNumber(data.territory_count) ?? 0;
  const buildings = asRecordArray(data.buildings).length;
  const items = asRecordArray(data.items).length;
  const cap = asNumber(data.resource_cap) ?? 500;
  const claimedBy = asString(agent.claimed_by_twitter);

  const lines = [
    `${name} | (${x},${y}) | ${resources} | Wealth:${wealth} | Rep:${reputation}`,
    `Territories:${territoryCount} | Buildings:${buildings} | Item stacks:${items} | Cap:${cap}`,
  ];

  if (claimedBy) {
    lines.push(`Claimed by: ${claimedBy}`);
  }

  return lines;
}

export function formatWorldStatusLines(data: UnknownRecord): string[] {
  const stats = asRecord(data.stats);
  const leaderboard = asRecordArray(data.leaderboard);

  const totalAgents = asNumber(stats?.total_agents) ?? 0;
  const activeAgents = asNumber(stats?.active_agents) ?? 0;
  const trades = asNumber(stats?.total_trades) ?? 0;
  const territories = asNumber(stats?.total_territories) ?? 0;
  const topGatherer = asString(stats?.top_gatherer) || 'n/a';

  const lines = [
    `Agents: ${totalAgents} total | ${activeAgents} active | Trades: ${trades} | Territories: ${territories}`,
    `Top gatherer: ${topGatherer}`,
  ];

  if (leaderboard.length === 0) {
    lines.push('Leaderboard: no entries');
    return lines;
  }

  lines.push('Leaderboard:');
  for (const entry of leaderboard.slice(0, 10)) {
    const rank = asNumber(entry.rank) ?? '?';
    const name = asString(entry.name) || 'Unknown';
    const wealth = asNumber(entry.wealth) ?? 0;
    lines.push(`  #${rank} ${name}: ${wealth}`);
  }

  return lines;
}

export function formatWorldLeaderboardLines(data: UnknownRecord): string[] {
  const leaderboard = asRecordArray(data.leaderboard);
  if (leaderboard.length === 0) {
    return ['No leaderboard entries'];
  }

  return leaderboard.map((entry) => {
    const rank = asNumber(entry.rank) ?? '?';
    const name = asString(entry.name) || 'Unknown';
    const wealth = asNumber(entry.wealth) ?? 0;
    return `#${rank} ${name}: ${wealth}`;
  });
}

export function formatWorldEventsLines(data: UnknownRecord): string[] {
  const events = asRecordArray(data.events);
  if (events.length === 0) {
    return ['No active events'];
  }

  return events.map((event) => {
    const title = asString(event.title) || asString(event.type) || 'Event';
    const bonus = asNumber(event.bonus_percent);
    const minutes = asNumber(event.minutes_remaining);
    return `${title} | bonus:${bonus ?? '?'}% | remaining:${minutes ?? '?'}m`;
  });
}

export function formatRecentWorldEventsLines(data: UnknownRecord): string[] {
  const events = asRecordArray(data.events);
  if (events.length === 0) {
    return ['No recent world events'];
  }

  return events.map((event) => {
    const title = asString(event.title) || asString(event.type) || 'Event';
    const state = event.is_active === true
      ? `active ${asNumber(event.minutes_remaining) ?? '?'}m left`
      : `expired ${asNumber(event.expired_ago_minutes) ?? '?'}m ago`;
    return `${title} | ${state}`;
  });
}

export function formatTournamentOverviewLines(data: UnknownRecord): string[] {
  const current = asRecord(data.current);
  const upcoming = asRecord(data.upcoming);
  const topThree = asRecordArray(data.top_three);

  const lines: string[] = [];
  if (current) {
    const name = asString(current.name) || asString(current.type) || 'Tournament';
    lines.push(`Current: ${name} (${asString(current.status) || 'active'})`);
  } else {
    lines.push('Current: none active');
  }

  if (upcoming) {
    const name = asString(upcoming.name) || asString(upcoming.type) || 'Tournament';
    lines.push(`Upcoming: ${name}`);
  }

  if (topThree.length > 0) {
    lines.push('Top 3:');
    for (const row of topThree.slice(0, 3)) {
      const rank = asNumber(row.live_rank) ?? '?';
      const name = asString(row.agent_name) || 'Unknown';
      const score = asNumber(row.current_score) ?? 0;
      lines.push(`  #${rank} ${name}: ${score}`);
    }
  }

  return lines;
}

export function formatTournamentJoinLine(data: UnknownRecord): string {
  const entry = asRecord(data.entry);
  const score = asNumber(entry?.current_score) ?? asNumber(data.score) ?? 0;
  const rank = asNumber(entry?.live_rank) ?? asNumber(data.rank);
  const tournament = asRecord(data.tournament);
  const name = asString(tournament?.name) || asString(tournament?.type) || 'Tournament';
  const message = asString(data.message) || 'Tournament status updated';
  return `${name} | ${message} | Score:${score} | Rank:${rank ?? '?'}`;
}

export function formatTournamentDetailLines(data: UnknownRecord): string[] {
  const tournament = asRecord(data.tournament);
  const leaderboard = asRecordArray(data.leaderboard);
  const total = asNumber(data.total_participants) ?? leaderboard.length;

  const name = asString(tournament?.name) || asString(tournament?.type) || 'Tournament';
  const status = asString(tournament?.status) || 'unknown';
  const lines = [`${name} | ${status} | participants:${total}`];

  if (leaderboard.length === 0) {
    lines.push('No leaderboard entries');
    return lines;
  }

  lines.push('Leaderboard:');
  for (const row of leaderboard.slice(0, 20)) {
    const rank = asNumber(row.live_rank) ?? '?';
    const agentName = asString(row.agent_name) || 'Unknown';
    const score = asNumber(row.current_score) ?? 0;
    lines.push(`  #${rank} ${agentName}: ${score}`);
  }

  return lines;
}

export function formatOracleLines(data: UnknownRecord, includeAllPending = false): string[] {
  const contract = asRecord(data.contract);
  const oracle = asRecord(data.oracle);
  const nextSteps = asRecordArray(data.next_steps);
  const allPendingSteps = asRecordArray(data.all_pending_steps);

  const title = asString(oracle?.title) || 'Oracle';
  const narrative = asString(oracle?.narrative) || '';
  const objective = asString(oracle?.tournament_objective) || '';
  const completed = asNumber(contract?.completed_outcomes) ?? 0;
  const total = asNumber(contract?.total_outcomes) ?? 0;

  const lines = [
    `${title} | Outcomes: ${completed}/${total}`,
    narrative,
    `Objective: ${objective}`,
  ];

  const pending = includeAllPending ? allPendingSteps : nextSteps;
  if (pending.length > 0) {
    lines.push(includeAllPending ? 'Pending steps:' : 'Next steps:');
    pending.forEach((step, index) => {
      const titleStep = asString(step.title) || `Step ${index + 1}`;
      const command = asString(step.command) || '';
      const expected = asString(step.expected) || '';
      lines.push(`  ${index + 1}. ${titleStep}`);
      if (command) lines.push(`     cmd: ${command}`);
      if (expected) lines.push(`     expected: ${expected}`);
    });
  } else {
    lines.push('All onboarding outcomes are complete.');
  }

  const prompt = asString(oracle?.starter_prompt);
  if (prompt) {
    lines.push(`Starter prompt: ${prompt}`);
  }

  return lines;
}
