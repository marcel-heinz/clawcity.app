import crypto from 'crypto';
import { AgentState } from './state-collector';

/**
 * Generate a SHA-256 hash of the meaningful parts of the agent state.
 * Used to skip LLM calls when nothing has changed.
 */
export function hashState(state: AgentState): string {
  const meaningful = {
    pos: [state.agent.x, state.agent.y],
    res: [state.agent.gold, state.agent.wood, state.agent.food, state.agent.stone],
    terrain: state.currentTile.terrain,
    tileRes: state.currentTile.resources,
    nearby: state.nearbyAgents.map((a) => a.id).sort(),
    trades: state.pendingTrades.length,
  };
  return crypto.createHash('sha256').update(JSON.stringify(meaningful)).digest('hex');
}
