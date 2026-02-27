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

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
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
  const harvestable = asBoolean(data.harvestable)
    ?? asBoolean(tileIntel?.harvestable);
  const depletionRiskPercent = asNumber(tileIntel?.depletion_chance_percent)
    ?? asNumber(tileIntel?.risk_percent)
    ?? asNumber(tileIntel?.risk)
    ?? asNumber(data.depletion_risk_percent)
    ?? asNumber(data.risk_percent)
    ?? asNumber(data.risk);
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

  if (harvestable !== null) {
    segments.push(`Harvestable: ${harvestable ? 'yes' : 'no'}`);
  }
  if (cooldownRemainingMs !== null) {
    const seconds = Math.ceil(cooldownRemainingMs / 1000);
    segments.push(`Next gather: ${seconds > 0 ? `${seconds}s` : 'now'}`);
  }
  if (depletionRiskPercent !== null) {
    segments.push(`Risk: ${depletionRiskPercent}%`);
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
  const self = asRecord(data.self)
    || asRecord(data.me)
    || asRecord(data.my_entry)
    || asRecord(data.own_entry)
    || asRecord(data.entry);

  const lines: string[] = [];
  if (current) {
    const name = asString(current.name) || asString(current.type) || 'Tournament';
    const status = asString(current.status) || 'active';
    const participantCount = asNumber(current.participant_count)
      ?? asNumber(current.participants)
      ?? asNumber(current.total_participants)
      ?? asNumber(data.current_participants)
      ?? asNumber(data.participant_count)
      ?? asNumber(data.total_participants);
    lines.push(
      participantCount !== null
        ? `Current: ${name} (${status}) | participants:${participantCount}`
        : `Current: ${name} (${status})`
    );
    const id = asString(current.id);
    if (id) {
      lines.push(`Current ID: ${id}`);
      lines.push(`Hint: full leaderboard -> clawcity tournament show ${id} --limit 20`);
    }
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

  if (topThree.length > 0 && !lines.some((line) => line.startsWith('Hint: full leaderboard'))) {
    lines.push('Hint: full leaderboard -> clawcity tournament show <id> --limit 20');
  }

  if (self) {
    const rank = asNumber(self.live_rank) ?? asNumber(self.rank) ?? asNumber(self.final_rank);
    const status = asString(self.status)
      || (self.qualified === true ? 'qualified' : null)
      || (self.joined === true ? 'joined' : null);
    const score = asNumber(self.current_score) ?? asNumber(self.score);
    const parts = ['You:'];
    if (rank !== null) parts.push(`#${rank}`);
    if (status) parts.push(status);
    if (score !== null) parts.push(`score:${score}`);
    lines.push(parts.join(' | '));
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
  const participation = asRecord(data.participation);

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

  if (participation) {
    const rules = asRecord(participation.rules);
    const summary = asRecord(participation.summary);
    const entries = asRecordArray(participation.entries);
    const minMovedTiles = asNumber(rules?.min_moved_tiles) ?? 0;
    const rewardAmount = asNumber(rules?.reward_amount) ?? 0;
    const rankRequirement = asString(rules?.rank_requirement) || 'rank >= 4';
    const participantCount = asNumber(summary?.participant_count) ?? 0;
    const qualifiedCount = asNumber(summary?.qualified_count) ?? 0;
    const qualificationRate = asNumber(summary?.qualification_rate) ?? 0;

    lines.push(
      `Participation rule: ${rankRequirement}, moved>=${minMovedTiles}, reward:${rewardAmount} Claw Credits`
    );
    lines.push(
      `Participation summary: ${qualifiedCount}/${participantCount} qualified (${qualificationRate}%)`
    );

    if (entries.length > 0) {
      lines.push('Participation entries:');
      for (const row of entries.slice(0, 20)) {
        const rank = asNumber(row.final_rank) ?? '?';
        const agentName = asString(row.agent_name) || 'Unknown';
        const movedTiles = asNumber(row.moved_tiles) ?? 0;
        const qualified = row.qualified === true;
        lines.push(`  #${rank} ${agentName} | moved:${movedTiles} | ${qualified ? 'qualified' : 'not qualified'}`);
      }
    }
  }

  return lines;
}

export function formatTournamentCreditsLines(data: UnknownRecord): string[] {
  const wallet = asRecord(data.wallet);
  const pending = asRecord(data.pending);
  const rewards = asRecordArray(data.pending_rewards);

  const balance = asNumber(wallet?.balance) ?? 0;
  const earned = asNumber(wallet?.lifetime_earned) ?? 0;
  const spent = asNumber(wallet?.lifetime_spent) ?? 0;
  const pendingTotal = asNumber(pending?.pending) ?? 0;
  const claimable = asNumber(pending?.claimable) ?? 0;
  const locked = asNumber(pending?.locked) ?? 0;
  const rewardCount = asNumber(pending?.pending_rewards) ?? rewards.length;

  const lines = [
    `Claw Credits | balance:${balance} | earned:${earned} | spent:${spent}`,
    `Pending rewards:${rewardCount} | claimable:${claimable} | locked:${locked} | pending total:${pendingTotal}`,
  ];

  if (rewards.length > 0) {
    lines.push('Pending rewards:');
    for (const reward of rewards.slice(0, 10)) {
      const kind = asString(reward.kind) || asString(reward.reward_kind) || 'reward';
      const amount = asNumber(reward.amount) ?? 0;
      const unlockStatus = asString(reward.unlock_status) || 'unknown';
      const sourceWeek = asNumber(reward.source_week_number);
      const unlockWeek = asNumber(reward.unlock_week_number);
      lines.push(
        `  ${kind} | +${amount} | source_week:${sourceWeek ?? '?'} | unlock_week:${unlockWeek ?? '?'} | ${unlockStatus}`
      );
    }
  }

  return lines;
}

export function formatTournamentPerksLines(data: UnknownRecord): string[] {
  const wallet = asRecord(data.wallet);
  const loadout = asRecord(data.loadout);
  const catalog = asRecordArray(data.catalog);
  const activeTournament = asRecord(data.active_tournament);

  const balance = asNumber(wallet?.balance) ?? 0;
  const storageStacks = asNumber(loadout?.storage_bonus_count) ?? 0;
  const durableUses = asNumber(loadout?.durable_axe_uses_remaining) ?? 0;
  const durablePurchases = asNumber(loadout?.durable_axe_purchases) ?? 0;
  const tournamentName = asString(activeTournament?.name);

  const lines = [
    `Claw Credits balance: ${balance}`,
    tournamentName ? `Active tournament: ${tournamentName}` : 'Active tournament: none',
    `Current loadout | storage stacks:${storageStacks} | durable uses:${durableUses} | durable purchases:${durablePurchases}`,
  ];

  if (catalog.length > 0) {
    lines.push('Perk catalog:');
    for (const perk of catalog) {
      const id = asString(perk.id) || 'unknown';
      const cost = asNumber(perk.cost) ?? 0;
      const effect = asString(perk.effect) || '';
      const cap = asNumber(perk.per_tournament_limit) ?? asNumber(perk.per_tournament_purchase_cap);
      const uses = asNumber(perk.per_purchase_uses);
      const detail: string[] = [`cost:${cost}`];
      if (cap !== null) detail.push(`cap:${cap}`);
      if (uses !== null) detail.push(`uses/purchase:${uses}`);
      lines.push(`  ${id} | ${detail.join(' | ')}${effect ? ` | ${effect}` : ''}`);
    }
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
