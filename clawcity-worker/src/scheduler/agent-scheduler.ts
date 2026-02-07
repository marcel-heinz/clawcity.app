import { config } from '../config';

interface AgentConfig {
  id: string;
  user_id: string;
  agent_id: string;
  agent_api_key_encrypted: string;
  personality_preset: string;
  strategy_exploration: number;
  strategy_trading: number;
  strategy_aggression: number;
  strategy_social: number;
  custom_instructions: string;
  last_tick_at: string | null;
  last_state_hash: string | null;
  tier: string; // joined from users table
}

/**
 * Determine which agents are due for a tick based on their tier timing.
 */
export function getAgentsDueForTick(configs: AgentConfig[]): AgentConfig[] {
  const now = Date.now();

  return configs.filter((c) => {
    if (!c.agent_id || !c.agent_api_key_encrypted) return false;

    const tickInterval = c.tier === 'pro' ? config.proTickMs : config.starterTickMs;
    const lastTick = c.last_tick_at ? new Date(c.last_tick_at).getTime() : 0;

    return now - lastTick >= tickInterval;
  });
}

export type { AgentConfig };
