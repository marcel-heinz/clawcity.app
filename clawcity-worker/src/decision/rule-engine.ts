import { AgentState } from '../state/state-collector';

export interface Decision {
  action: string;
  reasoning: string;
  // movement
  direction?: string;
  // trading
  target?: string;
  trade_id?: string;
  offer?: Record<string, number>;
  request?: Record<string, number>;
  // building
  building_type?: string;
  // crafting / shop
  item_id?: string;
  quantity?: number;
  // market
  offer_resource?: string;
  offer_amount?: number;
  request_resource?: string;
  request_amount?: number;
  order_id?: string;
  amount?: number;
  // speak
  message?: string;
  to?: string;
  // forum
  thread_id?: string;
  body?: string;
  title?: string;
  category?: string;
}

/**
 * Fast pre-filter: handle obvious actions without calling LLM.
 * Returns null if LLM should decide.
 */
export function applyRules(state: AgentState): Decision | null {
  const { agent, currentTile, pendingTrades, tournament } = state;

  // Rule 1: Accept favorable trades (offered value > requested value)
  for (const trade of pendingTrades) {
    const offerTotal = sumResources(trade.offer);
    const requestTotal = sumResources(trade.request);
    // During Trade Baron tournament, accept more trades (lower threshold)
    const threshold = tournament?.active && tournament.type === 'trade_baron' ? 0.9 : 1.2;
    if (offerTotal > requestTotal * threshold) {
      return {
        action: 'trade_accept',
        trade_id: trade.id,
        reasoning: `Accepting favorable trade: offered ${offerTotal} vs requested ${requestTotal}`,
      };
    }
  }

  // Rule 2: Very low food emergency - buy rations if we have gold
  if (agent.food <= 3 && agent.gold >= 20) {
    return {
      action: 'buy',
      item_id: 'rations',
      reasoning: 'Emergency: critically low food, buying rations',
    };
  }

  // Rule 3: Low food - gather on food-producing tiles
  if (agent.food <= 5 && ['plains', 'forest', 'water'].includes(currentTile.terrain)) {
    return {
      action: 'gather',
      reasoning: 'Low food - gathering to survive',
    };
  }

  // Rule 4: Gather if on a resource-rich tile and food > 5
  const tileResTotal = sumResources(currentTile.resources);
  if (tileResTotal > 0 && agent.food > 5) {
    // Skip gathering if near cap on all relevant resources
    const nearCap = (r: number) => r >= agent.resource_cap * 0.95;
    const allCapped =
      (currentTile.terrain === 'forest' && nearCap(agent.wood) && nearCap(agent.food)) ||
      (currentTile.terrain === 'mountain' && nearCap(agent.stone) && nearCap(agent.gold)) ||
      (currentTile.terrain === 'plains' && nearCap(agent.food));

    if (!allCapped) {
      return {
        action: 'gather',
        reasoning: `Gathering resources from ${currentTile.terrain} tile (${tileResTotal} available)`,
      };
    }
  }

  // Rule 5: Territory Conqueror tournament - claim unclaimed tile if affordable
  if (
    tournament?.active &&
    tournament.type === 'territory_conqueror' &&
    !currentTile.owner_id &&
    agent.gold >= 50 &&
    agent.wood >= 20 &&
    agent.stone >= 10 &&
    agent.food >= 15 &&
    state.territories.length < 10
  ) {
    return {
      action: 'claim',
      reasoning: 'Tournament: claiming tile for Territory Conqueror points',
    };
  }

  // No obvious action - defer to LLM
  return null;
}

function sumResources(res: Record<string, number>): number {
  return Object.values(res).reduce((sum, v) => sum + (v || 0), 0);
}
