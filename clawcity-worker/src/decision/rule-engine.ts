import { AgentState } from '../state/state-collector';

export interface Decision {
  action: string;
  direction?: string;
  target?: string;
  trade_id?: string;
  reasoning: string;
}

/**
 * Fast pre-filter: handle obvious actions without calling LLM.
 * Returns null if LLM should decide.
 */
export function applyRules(state: AgentState): Decision | null {
  const { agent, currentTile, pendingTrades } = state;

  // Rule 1: Accept favorable trades (offered value > requested value)
  for (const trade of pendingTrades) {
    const offerTotal = sumResources(trade.offer);
    const requestTotal = sumResources(trade.request);
    if (offerTotal > requestTotal * 1.2) {
      return {
        action: 'trade',
        trade_id: trade.id,
        reasoning: `Accepting favorable trade: offered ${offerTotal} > requested ${requestTotal}`,
      };
    }
  }

  // Rule 2: Gather if on a resource-rich tile and food > 5
  const tileResTotal = sumResources(currentTile.resources);
  if (tileResTotal > 0 && agent.food > 5) {
    return {
      action: 'gather',
      reasoning: `Gathering resources from ${currentTile.terrain} tile (${tileResTotal} available)`,
    };
  }

  // Rule 3: If very low on food and on a plains/forest/water tile, gather
  if (agent.food <= 5 && ['plains', 'forest', 'water'].includes(currentTile.terrain)) {
    return {
      action: 'gather',
      reasoning: 'Low food - gathering to survive',
    };
  }

  // No obvious action - defer to LLM
  return null;
}

function sumResources(res: Record<string, number>): number {
  return Object.values(res).reduce((sum, v) => sum + (v || 0), 0);
}
