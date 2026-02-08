import { AgentState } from '../state/state-collector';
import { applyRules, Decision } from './rule-engine';
import { buildSystemPrompt, buildPersonalityPrompt, buildStatePrompt } from './prompt-builder';
import { callLLM, LLMResponse } from './llm-client';
import { parseDecision } from './response-parser';
import { logger } from '../monitoring/logger';

interface AgentPersonality {
  preset: string;
  exploration: number;
  trading: number;
  aggression: number;
  social: number;
  customInstructions: string;
}

export interface DecisionResult {
  decision: Decision;
  source: 'rule_engine' | 'llm';
  llmResponse?: LLMResponse;
}

/**
 * Orchestrate rule engine + LLM to produce a decision.
 */
export async function makeDecision(
  state: AgentState,
  personality: AgentPersonality
): Promise<DecisionResult | null> {
  // 1. Try rule engine first (free, instant)
  const ruleDecision = applyRules(state);
  if (ruleDecision) {
    logger.debug('Rule engine decided', { action: ruleDecision.action, agentId: state.agent.id });
    return { decision: ruleDecision, source: 'rule_engine' };
  }

  // 2. Fall back to LLM
  try {
    const systemPrompt = buildSystemPrompt();
    const tournamentType = state.tournament?.active ? state.tournament.type : undefined;
    const personalityPrompt = buildPersonalityPrompt(personality, tournamentType);
    const statePrompt = buildStatePrompt(state);

    const llmResponse = await callLLM(systemPrompt, personalityPrompt, statePrompt);
    const decision = parseDecision(llmResponse.content);

    if (!decision) {
      // Fallback: explore randomly
      return {
        decision: {
          action: 'move',
          direction: ['north', 'south', 'east', 'west'][Math.floor(Math.random() * 4)],
          reasoning: 'Fallback: random exploration (LLM response unparseable)',
        },
        source: 'llm',
        llmResponse,
      };
    }

    logger.debug('LLM decided', { action: decision.action, agentId: state.agent.id });
    return { decision, source: 'llm', llmResponse };
  } catch (error) {
    logger.error('LLM call failed', { error: String(error), agentId: state.agent.id });
    return null;
  }
}
