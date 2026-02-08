import { config } from '../config';
import { getSupabase } from '../db/supabase-client';
import { getAgentsDueForTick, type AgentConfig } from './agent-scheduler';
import { collectAgentState } from '../state/state-collector';
import { hashState } from '../state/state-hasher';
import { makeDecision } from '../decision/decision-engine';
import { decryptApiKey } from '../execution/api-client';
import { executeAction } from '../execution/action-executor';
import { acquireLock, releaseLock } from '../coordination/agent-lock';
import { consumeDecisionQuota } from '../coordination/quota-tracker';
import { updateLastTick } from '../monitoring/health-check';
import { logger } from '../monitoring/logger';

let tickInterval: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

export function startTickLoop() {
  tickInterval = setInterval(tick, config.tickIntervalMs);
  // Run first tick immediately
  tick();
}

export function stopTickLoop() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

async function tick() {
  if (isProcessing) return; // Skip if previous tick is still running
  isProcessing = true;

  try {
    updateLastTick();

    const supabase = getSupabase();

    // Fetch all active configs with user tier info
    const { data: rawConfigs, error } = await supabase
      .from('agent_configs')
      .select(`
        id, user_id, agent_id, agent_api_key_encrypted,
        personality_preset, strategy_exploration, strategy_trading,
        strategy_aggression, strategy_social, custom_instructions,
        last_tick_at, last_state_hash,
        users!inner(tier)
      `)
      .eq('is_active', true);

    if (error || !rawConfigs || rawConfigs.length === 0) {
      isProcessing = false;
      return;
    }

    // Flatten the join
    const configs: AgentConfig[] = rawConfigs.map((c: Record<string, unknown>) => ({
      ...c,
      tier: (c.users as { tier: string })?.tier || 'starter',
    })) as AgentConfig[];

    // Filter to those due for a tick
    const dueConfigs = getAgentsDueForTick(configs);

    if (dueConfigs.length === 0) {
      isProcessing = false;
      return;
    }

    logger.debug('Tick', { total: configs.length, due: dueConfigs.length });

    // Process up to maxConcurrentTicks in parallel
    const batch = dueConfigs.slice(0, config.maxConcurrentTicks);
    await Promise.allSettled(batch.map((c) => processAgent(c)));
  } catch (error) {
    logger.error('Tick loop error', { error: String(error) });
  } finally {
    isProcessing = false;
  }
}

async function processAgent(agentConfig: AgentConfig) {
  const { id: configId, agent_id: agentId, user_id: userId } = agentConfig;

  // 1. Acquire distributed lock
  const locked = await acquireLock(configId);
  if (!locked) return;

  try {
    // 2. Check quota
    const hasQuota = await consumeDecisionQuota(userId);
    if (!hasQuota) {
      logger.debug('Quota exhausted', { userId, configId });
      return;
    }

    // 3. Decrypt API key (needed for both state collection and execution)
    const apiKey = decryptApiKey(agentConfig.agent_api_key_encrypted);

    // 4. Collect game state (with API key for extended data: tournaments, buildings, items)
    const state = await collectAgentState(agentId, apiKey);
    if (!state) {
      logger.warn('Could not collect state', { agentId });
      return;
    }

    // 5. Hash state - skip LLM if unchanged
    const stateHash = hashState(state);
    if (stateHash === agentConfig.last_state_hash) {
      logger.debug('State unchanged, skipping', { agentId });
      // Still update last_tick_at to prevent re-processing
      await getSupabase()
        .from('agent_configs')
        .update({ last_tick_at: new Date().toISOString() })
        .eq('id', configId);
      return;
    }

    // 6. Make decision (rule engine or LLM)
    const personality = {
      preset: agentConfig.personality_preset,
      exploration: agentConfig.strategy_exploration,
      trading: agentConfig.strategy_trading,
      aggression: agentConfig.strategy_aggression,
      social: agentConfig.strategy_social,
      customInstructions: agentConfig.custom_instructions || '',
    };

    const result = await makeDecision(state, personality);
    if (!result) {
      logger.warn('No decision produced', { agentId });
      return;
    }

    // 7. Execute action
    const execution = await executeAction(result.decision, apiKey);

    // 8. Log decision
    const supabase = getSupabase();

    // Estimate cost (rough: $3/MTok input, $15/MTok output for Sonnet)
    const promptCost = (result.llmResponse?.promptTokens || 0) * 0.000003;
    const completionCost = (result.llmResponse?.completionTokens || 0) * 0.000015;

    // Capture all action-specific data for the log
    const { reasoning: _reasoning, action: _action, ...actionData } = result.decision;

    await supabase.from('decision_log').insert({
      agent_config_id: configId,
      user_id: userId,
      action: result.decision.action,
      action_data: actionData,
      reasoning: result.decision.reasoning,
      decision_source: result.source,
      model: result.llmResponse?.model || null,
      prompt_tokens: result.llmResponse?.promptTokens || 0,
      completion_tokens: result.llmResponse?.completionTokens || 0,
      estimated_cost_usd: promptCost + completionCost,
      success: execution.success,
      error_message: execution.error || null,
      agent_position: { x: state.agent.x, y: state.agent.y },
    });

    // 9. Update agent config with tick time and state hash
    const updateData: Record<string, unknown> = {
      last_tick_at: new Date().toISOString(),
      last_state_hash: stateHash,
    };

    if (execution.success) {
      updateData.consecutive_errors = 0;
      updateData.last_error = null;
    } else {
      updateData.consecutive_errors = (agentConfig as unknown as { consecutive_errors: number }).consecutive_errors + 1;
      updateData.last_error = execution.error;

      // Auto-pause after 10 consecutive errors
      if ((updateData.consecutive_errors as number) >= 10) {
        updateData.is_active = false;
        logger.warn('Agent auto-paused due to consecutive errors', { agentId, configId });
      }
    }

    await supabase
      .from('agent_configs')
      .update(updateData)
      .eq('id', configId);

    logger.info('Agent tick complete', {
      agentId,
      action: result.decision.action,
      source: result.source,
      success: execution.success,
    });
  } catch (error) {
    logger.error('Agent processing error', { configId, error: String(error) });

    // Track error
    await getSupabase()
      .from('agent_configs')
      .update({
        last_tick_at: new Date().toISOString(),
        last_error: String(error),
      })
      .eq('id', configId);
  } finally {
    await releaseLock(configId);
  }
}
