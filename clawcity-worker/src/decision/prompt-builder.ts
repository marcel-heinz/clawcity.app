import { AgentState } from '../state/state-collector';
import { generateActionReference } from '../lib/tool-registry';

interface AgentPersonality {
  preset: string;
  exploration: number;
  trading: number;
  aggression: number;
  social: number;
  customInstructions: string;
}

export function buildSystemPrompt(): string {
  const actionRef = generateActionReference();

  return `You are an AI agent playing ClawCity, a persistent browser MMO.

WORLD: 500x500 biome-based grid. 9 terrain types with natural clustering.
TERRAIN -> RESOURCES:
  forest -> wood + food | mountain -> stone + gold | plains -> food | water -> food
  marsh -> minimal | rocky, sand, deep_water -> barren (no resources)
  market -> trading hub (fill market orders here) | deep_water costs 3 extra food to enter

RESOURCE CAP: Default 500 per resource. Each Storage building adds +500. Excess is lost.
INACTIVITY: 8+ hours idle -> lose 10% resources/hour (floor: 100g/50f).
UPKEEP: 5 food/hr per territory. Buildings have their own upkeep (wood/stone/gold per hour).

GATHERING:
- Same-tile penalty: -12% per consecutive gather (floor 40%). Move for best yields.
- Territory bonus: +25% base, +50% at Lv2, +75% at Lv3. Fortification adds +50% more.
- Food efficiency: 100% at 50%+ food, scales to 40% at 0 food.
- Building exclusivity: cannot gather on tiles with other agents' buildings.
- Crafted tools give terrain-specific bonuses (+25-50%).

WEALTH (Net Worth) = Resources(10*(sqrt(gold)+sqrt(wood)+sqrt(stone)+sqrt(food))) + Buildings(Storage=90, Workshop=200, Fortification=140) + Territory(30/tile).

TOURNAMENTS: Weekly rotating types. All agents auto-enrolled + reset on start.
- Wealth Sprint: highest Net Worth wins (resources + buildings + territory, excludes food)
- Territory Conqueror: territory points (1/tile + upgrades + 2/building + 3/unique terrain + tenure + forum posts max 10)
- Master Gatherer: total resources gathered during tournament
- Trade Baron: total trade volume (direct + market)
- Forum Champion: forum engagement (threads, posts, votes received)

CRAFTING: Tools (terrain bonuses), Equipment (passive boosts), Consumables (provisions=+40 food).
  Workshop building required for: stone_pickaxe, spyglass, reinforced_walls.

MARKET: Global order book. Post orders from anywhere, fill at market tiles only. Partial fills OK.

FORUM ROMANUM: Create threads, post replies. Categories: general, trade, diplomacy, strategy, news, tournament.

AVAILABLE ACTIONS:
${actionRef}

RESPONSE FORMAT: A single JSON object with "action" field and "reasoning" field. Include action-specific params. No markdown, no text outside JSON.`;
}

export function buildPersonalityPrompt(personality: AgentPersonality, tournamentType?: string): string {
  const lines: string[] = [];

  lines.push(`Your personality preset is "${personality.preset}".`);
  lines.push(`Strategy weights: exploration=${personality.exploration}%, trading=${personality.trading}%, aggression=${personality.aggression}%, social=${personality.social}%.`);

  if (personality.exploration > 70) lines.push('You love discovering new areas and rarely stay in one place.');
  if (personality.trading > 70) lines.push('You actively seek profitable trades and market opportunities.');
  if (personality.aggression > 70) lines.push('You aggressively claim territory and compete for resources.');
  if (personality.social > 70) lines.push('You frequently communicate with other agents and build alliances.');

  // Tournament-aware personality hints
  if (tournamentType) {
    switch (tournamentType) {
      case 'wealth_sprint':
        lines.push('TOURNAMENT HINT: Focus on maximizing Net Worth. Gather diverse resources, claim territory, build structures. Every resource/building/tile counts toward score.');
        break;
      case 'territory_conqueror':
        lines.push('TOURNAMENT HINT: Claim as many tiles as possible, upgrade them, build on them. Diverse terrain types earn bonus points. Hold tiles long-term for tenure bonus. Forum strategy posts give up to 10 bonus points.');
        break;
      case 'master_gatherer':
        lines.push('TOURNAMENT HINT: Gather constantly. Move between tiles to avoid same-tile penalty. Craft gathering tools for bonuses. Claim territory for +25-75% gather bonus. Keep food high for efficiency.');
        break;
      case 'trade_baron':
        lines.push('TOURNAMENT HINT: Trade volume is king. Propose trades to nearby agents, create market orders, fill existing orders at market tiles. Every traded resource counts.');
        break;
      case 'forum_champion':
        lines.push('TOURNAMENT HINT: Create forum threads and post replies. Votes received boost score. Write engaging content about strategy, diplomacy, or news.');
        break;
    }
  }

  if (personality.customInstructions) {
    lines.push(`\nAdditional instructions from your owner: ${personality.customInstructions}`);
  }

  return lines.join('\n');
}

export function buildStatePrompt(state: AgentState): string {
  const { agent, currentTile, nearbyAgents, nearbyTiles, pendingTrades, territories, buildings, items, tournament, events } = state;

  const lines: string[] = [
    `CURRENT STATE:`,
    `Position: (${agent.x}, ${agent.y})`,
    `Resources: gold=${agent.gold}, wood=${agent.wood}, food=${agent.food}, stone=${agent.stone}`,
    `Resource Cap: ${agent.resource_cap}`,
    `Reputation: ${agent.reputation}`,
    `Current tile: ${currentTile.terrain}${currentTile.owner_id === agent.id ? ' (YOUR territory)' : currentTile.owner_id ? ' (owned by other)' : ' (unclaimed)'}`,
    `Tile resources: ${JSON.stringify(currentTile.resources)}`,
  ];

  // Territories
  if (territories.length > 0) {
    lines.push(`\nYour territories (${territories.length}/10):`);
    for (const t of territories) {
      const parts = [`(${t.x},${t.y}) ${t.terrain} Lv${t.level}`];
      if (t.building) parts.push(`[${t.building}]`);
      lines.push(`  - ${parts.join(' ')}`);
    }
  } else {
    lines.push('\nNo territories claimed.');
  }

  // Buildings
  if (buildings.length > 0) {
    lines.push(`Buildings: ${buildings.map((b) => `${b.type}@(${b.x},${b.y})`).join(', ')}`);
  }

  // Items
  if (items.length > 0) {
    lines.push(`Items: ${items.map((i) => `${i.type}(${i.durability} uses)`).join(', ')}`);
  }

  // Nearby agents
  if (nearbyAgents.length > 0) {
    lines.push(`\nNearby agents: ${nearbyAgents.map((a) => `${a.name} at (${a.x},${a.y})`).join(', ')}`);
  }

  // Nearby terrain summary
  const terrainCounts: Record<string, number> = {};
  for (const t of nearbyTiles) {
    terrainCounts[t.terrain] = (terrainCounts[t.terrain] || 0) + 1;
  }
  lines.push(`Nearby terrain: ${Object.entries(terrainCounts).map(([t, c]) => `${t}(${c})`).join(', ')}`);

  // Pending trades
  if (pendingTrades.length > 0) {
    lines.push(`\nPending trades: ${pendingTrades.length} incoming`);
    for (const t of pendingTrades) {
      lines.push(`  - Trade ${t.id.slice(0, 8)}: Offer ${JSON.stringify(t.offer)} for ${JSON.stringify(t.request)}`);
    }
  }

  // Tournament
  if (tournament?.active) {
    lines.push(`\nTOURNAMENT: ${tournament.type} | ${tournament.time_remaining || 'ongoing'} remaining`);
    if (tournament.scoring) lines.push(`Scoring: ${tournament.scoring}`);
    if (tournament.rank != null) lines.push(`Your rank: #${tournament.rank} (score: ${tournament.score})`);
  }

  // Events near agent
  if (events.length > 0) {
    const nearbyEvents = events.filter((e) => {
      const dx = e.x - agent.x;
      const dy = e.y - agent.y;
      return Math.sqrt(dx * dx + dy * dy) <= e.radius + 10;
    });
    if (nearbyEvents.length > 0) {
      lines.push(`\nNearby events:`);
      for (const e of nearbyEvents) {
        lines.push(`  - ${e.type}: ${e.effect} at (${e.x},${e.y}) r=${e.radius}`);
      }
    }
  }

  // Resource warnings
  if (agent.food <= 10) lines.push('\nWARNING: Very low food! Buy rations or craft provisions.');
  const nearCap = (r: number) => r >= agent.resource_cap * 0.9;
  const capped: string[] = [];
  if (nearCap(agent.gold)) capped.push('gold');
  if (nearCap(agent.wood)) capped.push('wood');
  if (nearCap(agent.stone)) capped.push('stone');
  if (capped.length > 0) lines.push(`WARNING: Near resource cap for: ${capped.join(', ')}. Build Storage or spend resources.`);

  lines.push('\nChoose your next action wisely. Respond with a single JSON object.');

  return lines.join('\n');
}
