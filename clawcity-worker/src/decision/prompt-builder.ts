import { AgentState } from '../state/state-collector';

interface AgentPersonality {
  preset: string;
  exploration: number;
  trading: number;
  aggression: number;
  social: number;
  customInstructions: string;
}

const SYSTEM_PROMPT = `You are an AI agent playing ClawCity, a persistent browser MMO.

GAME RULES:
- 500x500 grid world with terrain types: plains, forest, mountain, market, water, rocky, sand, deep_water, marsh
- Resources: gold, wood, food, stone. Food is consumed by actions (stamina system).
- Actions: move (north/south/east/west), gather (collect resources from current tile), speak (message another agent), trade (propose/accept trades)
- Gathering yields depend on terrain: forest=wood+food, mountain=stone+gold, plains=food, water=food
- You can claim territory on tiles you occupy (costs resources)
- Wealth = resources + territory + buildings
- Goal: maximize wealth and reputation through smart exploration, trading, and territory control

AVAILABLE ACTIONS (respond with exactly one):
- {"action":"move","direction":"north|south|east|west","reasoning":"..."}
- {"action":"gather","reasoning":"..."}
- {"action":"speak","target":"AgentName","message":"...","reasoning":"..."}
- {"action":"trade","target":"AgentName","offer":{"gold":N},"request":{"wood":N},"reasoning":"..."}

RESPONSE FORMAT: JSON object with "action" and "reasoning" fields. No markdown, no explanation outside JSON.`;

export function buildSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function buildPersonalityPrompt(personality: AgentPersonality): string {
  const lines: string[] = [];

  lines.push(`Your personality preset is "${personality.preset}".`);
  lines.push(`Strategy weights: exploration=${personality.exploration}%, trading=${personality.trading}%, aggression=${personality.aggression}%, social=${personality.social}%.`);

  if (personality.exploration > 70) lines.push('You love discovering new areas and rarely stay in one place.');
  if (personality.trading > 70) lines.push('You actively seek profitable trades and market opportunities.');
  if (personality.aggression > 70) lines.push('You aggressively claim territory and compete for resources.');
  if (personality.social > 70) lines.push('You frequently communicate with other agents and build alliances.');

  if (personality.customInstructions) {
    lines.push(`\nAdditional instructions from your owner: ${personality.customInstructions}`);
  }

  return lines.join('\n');
}

export function buildStatePrompt(state: AgentState): string {
  const { agent, currentTile, nearbyAgents, nearbyTiles, pendingTrades } = state;

  const lines: string[] = [
    `CURRENT STATE:`,
    `Position: (${agent.x}, ${agent.y})`,
    `Resources: gold=${agent.gold}, wood=${agent.wood}, food=${agent.food}, stone=${agent.stone}`,
    `Reputation: ${agent.reputation}`,
    `Current tile: ${currentTile.terrain}${currentTile.owner_id ? ' (owned)' : ''}`,
    `Tile resources: ${JSON.stringify(currentTile.resources)}`,
  ];

  if (nearbyAgents.length > 0) {
    lines.push(`\nNearby agents: ${nearbyAgents.map((a) => `${a.name} at (${a.x},${a.y})`).join(', ')}`);
  }

  // Summarize nearby tiles by terrain
  const terrainCounts: Record<string, number> = {};
  for (const t of nearbyTiles) {
    terrainCounts[t.terrain] = (terrainCounts[t.terrain] || 0) + 1;
  }
  lines.push(`\nNearby terrain: ${Object.entries(terrainCounts).map(([t, c]) => `${t}(${c})`).join(', ')}`);

  if (pendingTrades.length > 0) {
    lines.push(`\nPending trades: ${pendingTrades.length} incoming`);
    for (const t of pendingTrades) {
      lines.push(`  - Offer: ${JSON.stringify(t.offer)} for ${JSON.stringify(t.request)}`);
    }
  }

  lines.push('\nChoose your next action wisely. Respond with a single JSON object.');

  return lines.join('\n');
}
