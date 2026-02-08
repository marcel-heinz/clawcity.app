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
}

interface ProvisionResponse {
  success: boolean;
  agentId?: string;
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

    return (await res.json()) as ProvisionResponse;
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

    return (await res.json()) as ProvisionResponse;
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

    return (await res.json()) as ProvisionResponse;
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

    return (await res.json()) as ChatResponse;
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
    const data = (await res.json()) as { status: string; agents: string[] };
    return { healthy: data.status === 'ok', agents: data.agents || [] };
  } catch {
    return { healthy: false, agents: [] };
  }
}

/**
 * Check if OpenClaw integration is configured.
 */
export function isOpenClawConfigured(): boolean {
  return !!PROVISION_URL;
}
