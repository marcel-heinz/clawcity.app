/**
 * OpenClaw Gateway client for the ClawCity Next.js app.
 * Communicates with the provisioning server running alongside the OpenClaw gateway.
 */

const PROVISION_URL = process.env.OPENCLAW_PROVISION_URL || '';
const PROVISION_TOKEN = process.env.OPENCLAW_PROVISION_TOKEN || '';

interface ProvisionRequest {
  agentId: string;
  agentName: string;
  apiKey: string;
  personalityPreset: string;
  strategyExploration: number;
  strategyTrading: number;
  strategyAggression: number;
  strategySocial: number;
  customInstructions: string;
  soulMd?: string;
  autoModeEnabled?: boolean;
}

interface ProvisionResponse {
  success: boolean;
  agentId?: string;
  autoplay_disabled?: boolean;
  removed_from_config?: boolean;
  in_flight_at_stop?: boolean;
  verified_not_configured?: boolean;
  message?: string;
  stopped?: boolean;
  error?: string;
  details?: string;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  error?: string;
  details?: string;
  status?: number;
}

export interface AutoModeFeedbackEntry {
  id: string;
  agent_id: string;
  started_at: string;
  finished_at: string;
  status: 'success' | 'failed' | 'busy' | 'skipped_disabled' | 'uncertain_timeout_deferred';
  summary: string;
  details?: string;
  error_code?: string;
}

export interface AutoModeAgentStatus {
  agent_id: string;
  enabled: boolean;
  in_flight: boolean;
  deferred_once?: boolean;
  next_tick_at: string | null;
  last_tick_started_at: string | null;
  last_tick_finished_at: string | null;
  last_tick_result: string | null;
  last_tick_error_code: string | null;
  last_tick: AutoModeFeedbackEntry | null;
  memory?: {
    last_distilled_at: string | null;
    ticks_since_distill: number;
    memory_version: number;
    memory_bytes: number;
  };
  budget?: {
    tier: string | null;
    interval_ms: number | null;
    call_ceiling: number;
    reserve_calls: number;
    remaining_calls_total: number;
    remaining_calls_autoplay: number;
    scheduled_ticks_remaining: number;
    affordable_ticks_remaining: number;
    run_fraction: number;
  };
}

export interface AutoModeProvisionStatus {
  success: boolean;
  enabled: boolean;
  interval_ms: number;
  timeout_ms: number;
  max_parallel: number;
  max_agents_per_tick: number;
  pass?: number;
  next_tick_at?: string | null;
  last_tick_started_at?: string | null;
  last_tick_finished_at?: string | null;
  last_tick_result?: string | null;
  last_tick_error_code?: string | null;
  prompt_updated_at?: string | null;
  running_agents: string[];
  configured_agents: string[];
  agents: AutoModeAgentStatus[];
  error?: string;
  details?: string;
}

export interface AgentMemoryPayload {
  success: boolean;
  agentId?: string;
  content?: string;
  state?: {
    last_distilled_at: string | null;
    ticks_since_distill: number;
    memory_version: number;
    memory_digest: string | null;
    memory_bytes: number;
  };
  error?: string;
  details?: string;
}

export type OpenRouterGatewayModel = 'z-ai/glm-5' | 'minimax/minimax-m2.5';

interface GatewayModelSettingsResponse {
  success: boolean;
  model?: OpenRouterGatewayModel;
  models?: OpenRouterGatewayModel[];
  error?: string;
  details?: string;
}

async function provisionFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  if (!PROVISION_URL) {
    throw new Error('OPENCLAW_PROVISION_URL not configured');
  }

  const url = `${PROVISION_URL.replace(/\/+$/, '')}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(PROVISION_TOKEN ? { Authorization: `Bearer ${PROVISION_TOKEN}` } : {}),
    ...((options.headers as Record<string, string>) || {}),
  };

  return fetch(url, { ...options, headers });
}

async function parseJsonSafe<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Provision a new OpenClaw agent for a user.
 */
export async function provisionAgent(
  config: ProvisionRequest
): Promise<ProvisionResponse> {
  try {
    const res = await provisionFetch('/api/provision', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    const data = await parseJsonSafe<ProvisionResponse>(res);
    if (data) return data;
    return {
      success: false,
      error: `Provisioning request failed (${res.status})`,
    };
  } catch (error) {
    return {
      success: false,
      error: 'Failed to connect to OpenClaw gateway',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Update an existing agent's personality/strategy.
 */
export async function updateAgent(
  agentId: string,
  config: Partial<ProvisionRequest>
): Promise<ProvisionResponse> {
  try {
    const res = await provisionFetch(`/api/provision/${agentId}`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });

    const data = await parseJsonSafe<ProvisionResponse>(res);
    if (data) return data;
    return {
      success: false,
      error: `Agent update failed (${res.status})`,
    };
  } catch (error) {
    return {
      success: false,
      error: 'Failed to update agent',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Deprovision (stop) an agent.
 */
export async function deprovisionAgent(
  agentId: string
): Promise<ProvisionResponse> {
  try {
    const res = await provisionFetch(`/api/provision/${agentId}`, {
      method: 'DELETE',
    });

    const data = await parseJsonSafe<ProvisionResponse>(res);
    if (data) return data;
    return {
      success: false,
      error: `Agent deprovision failed (${res.status})`,
    };
  } catch (error) {
    return {
      success: false,
      error: 'Failed to deprovision agent',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Send a chat message to an agent and get a response.
 */
export async function chatWithAgent(
  agentId: string,
  messages: ChatMessage[]
): Promise<ChatResponse> {
  try {
    const res = await provisionFetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ agentId, messages }),
    });
    const data = await parseJsonSafe<ChatResponse & { error?: string; details?: string }>(res);
    if (!data) {
      return {
        id: '',
        choices: [],
        error: `Gateway returned invalid JSON (${res.status})`,
        status: res.status,
      };
    }

    if (!res.ok) {
      return {
        id: '',
        choices: [],
        error: data.error || `Gateway request failed (${res.status})`,
        details: data.details,
        status: res.status,
      };
    }

    return data;
  } catch (error) {
    return {
      id: '',
      choices: [],
      error: error instanceof Error ? error.message : 'Chat failed',
    };
  }
}

/**
 * Check if the OpenClaw gateway is healthy.
 */
export async function checkGatewayHealth(): Promise<{
  healthy: boolean;
  agents: string[];
}> {
  try {
    const res = await provisionFetch('/health');
    const data = await parseJsonSafe<{ status: string; agents: string[] }>(res);
    if (!data) {
      return { healthy: false, agents: [] };
    }
    return { healthy: data.status === 'ok', agents: data.agents || [] };
  } catch {
    return { healthy: false, agents: [] };
  }
}

export async function setAgentAutoplay(
  agentId: string,
  enabled: boolean
): Promise<ProvisionResponse> {
  try {
    const res = await provisionFetch(`/api/provision/${agentId}/autoplay`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
    const data = await parseJsonSafe<ProvisionResponse>(res);
    if (data) return data;
    return {
      success: false,
      error: `Autoplay update failed (${res.status})`,
    };
  } catch (error) {
    return {
      success: false,
      error: 'Failed to update autoplay setting',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getAgentAutoplayFeedback(
  agentId: string,
  limit = 50
): Promise<{ success: boolean; entries: AutoModeFeedbackEntry[]; error?: string; details?: string }> {
  try {
    const query = new URLSearchParams({ limit: String(limit) });
    const res = await provisionFetch(`/api/autoplay/feedback/${agentId}?${query.toString()}`);
    const data = await parseJsonSafe<{
      success: boolean;
      entries?: AutoModeFeedbackEntry[];
      error?: string;
      details?: string;
    }>(res);
    if (!data) {
      return {
        success: false,
        entries: [],
        error: `Feedback request failed (${res.status})`,
      };
    }
    return {
      success: !!data.success,
      entries: data.entries || [],
      error: data.error,
      details: data.details,
    };
  } catch (error) {
    return {
      success: false,
      entries: [],
      error: 'Failed to fetch autoplay feedback',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getAutoplayStatus(): Promise<{
  success: boolean;
  status?: AutoModeProvisionStatus;
  error?: string;
  details?: string;
}> {
  try {
    const res = await provisionFetch('/api/autoplay/status');
    const data = await parseJsonSafe<AutoModeProvisionStatus>(res);
    if (!data) {
      return {
        success: false,
        error: `Status request failed (${res.status})`,
      };
    }
    if (!res.ok || !data.success) {
      return {
        success: false,
        error: data.error || `Status request failed (${res.status})`,
        details: data.details,
      };
    }
    return {
      success: true,
      status: data,
    };
  } catch (error) {
    return {
      success: false,
      error: 'Failed to fetch autoplay status',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getGatewayModelSettings(): Promise<{
  success: boolean;
  model?: OpenRouterGatewayModel;
  models?: OpenRouterGatewayModel[];
  error?: string;
  details?: string;
  status?: number;
}> {
  try {
    const res = await provisionFetch('/api/settings/model');
    const data = await parseJsonSafe<GatewayModelSettingsResponse>(res);
    if (!data) {
      return {
        success: false,
        error: `Model settings request failed (${res.status})`,
        status: res.status,
      };
    }

    if (!res.ok || !data.success) {
      return {
        success: false,
        error: data.error || `Model settings request failed (${res.status})`,
        details: data.details,
        status: res.status,
      };
    }

    return {
      success: true,
      model: data.model,
      models: data.models,
      status: res.status,
    };
  } catch (error) {
    return {
      success: false,
      error: 'Failed to fetch gateway model settings',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function updateGatewayModelSettings(
  model: OpenRouterGatewayModel
): Promise<{
  success: boolean;
  model?: OpenRouterGatewayModel;
  models?: OpenRouterGatewayModel[];
  error?: string;
  details?: string;
  status?: number;
}> {
  try {
    const res = await provisionFetch('/api/settings/model', {
      method: 'PUT',
      body: JSON.stringify({ model }),
    });
    const data = await parseJsonSafe<GatewayModelSettingsResponse>(res);
    if (!data) {
      return {
        success: false,
        error: `Model settings update failed (${res.status})`,
        status: res.status,
      };
    }

    if (!res.ok || !data.success) {
      return {
        success: false,
        error: data.error || `Model settings update failed (${res.status})`,
        details: data.details,
        status: res.status,
      };
    }

    return {
      success: true,
      model: data.model,
      models: data.models,
      status: res.status,
    };
  } catch (error) {
    return {
      success: false,
      error: 'Failed to update gateway model settings',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getAgentMemory(
  agentId: string
): Promise<AgentMemoryPayload> {
  try {
    const res = await provisionFetch(`/api/provision/${agentId}/memory`);
    const data = await parseJsonSafe<AgentMemoryPayload>(res);
    if (!data) {
      return {
        success: false,
        error: `Memory request failed (${res.status})`,
      };
    }
    return data;
  } catch (error) {
    return {
      success: false,
      error: 'Failed to fetch agent memory',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function updateAgentMemory(
  agentId: string,
  content: string
): Promise<AgentMemoryPayload> {
  try {
    const res = await provisionFetch(`/api/provision/${agentId}/memory`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
    const data = await parseJsonSafe<AgentMemoryPayload>(res);
    if (!data) {
      return {
        success: false,
        error: `Memory update failed (${res.status})`,
      };
    }
    return data;
  } catch (error) {
    return {
      success: false,
      error: 'Failed to update agent memory',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function distillAgentMemory(
  agentId: string
): Promise<AgentMemoryPayload> {
  try {
    const res = await provisionFetch(`/api/provision/${agentId}/memory/distill`, {
      method: 'POST',
    });
    const data = await parseJsonSafe<AgentMemoryPayload>(res);
    if (!data) {
      return {
        success: false,
        error: `Memory distill failed (${res.status})`,
      };
    }
    return data;
  } catch (error) {
    return {
      success: false,
      error: 'Failed to distill agent memory',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function resetAgentMemory(
  agentId: string,
  mode: 'soft' | 'hard' = 'soft'
): Promise<AgentMemoryPayload> {
  try {
    const res = await provisionFetch(`/api/provision/${agentId}/memory/reset`, {
      method: 'POST',
      body: JSON.stringify({ mode }),
    });
    const data = await parseJsonSafe<AgentMemoryPayload>(res);
    if (!data) {
      return {
        success: false,
        error: `Memory reset failed (${res.status})`,
      };
    }
    return data;
  } catch (error) {
    return {
      success: false,
      error: 'Failed to reset agent memory',
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if OpenClaw integration is configured.
 */
export function isOpenClawConfigured(): boolean {
  return !!PROVISION_URL;
}
