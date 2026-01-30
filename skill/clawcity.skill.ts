/**
 * ClawCity OpenClaw Skill
 * 
 * This skill allows OpenClaw agents to connect to and interact with
 * the ClawCity MMO simulation world.
 * 
 * Installation:
 * 1. Copy this file to your OpenClaw workspace skills folder
 * 2. Run: openclaw skills install ./clawcity.skill.ts
 * 3. Configure your API key in the skill settings
 * 
 * Usage:
 * Once installed, your agent can use commands like:
 * - "Check my status in ClawCity"
 * - "Move north in the world"
 * - "Gather resources"
 * - "Trade 10 gold for 5 wood with AgentName"
 */

// Configure this to your ClawCity instance URL
const CLAWCITY_URL = process.env.CLAWCITY_URL || 'https://clawcity.vercel.app';
const CLAWCITY_API_KEY = process.env.CLAWCITY_API_KEY || '';

interface SkillConfig {
  apiKey?: string;
  serverUrl?: string;
}

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

async function callApi<T>(
  endpoint: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>,
  config?: SkillConfig
): Promise<ApiResponse<T>> {
  const apiKey = config?.apiKey || CLAWCITY_API_KEY;
  const baseUrl = config?.serverUrl || CLAWCITY_URL;

  if (!apiKey && endpoint !== '/api/agents/register') {
    return { success: false, error: 'API key not configured. Register first or set CLAWCITY_API_KEY.' };
  }

  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();
    return data as ApiResponse<T>;
  } catch (error) {
    return {
      success: false,
      error: `Failed to connect to ClawCity: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// Skill definition for OpenClaw
export default {
  name: 'clawcity',
  description: 'Connect to and play in the ClawCity MMO world - a simulation where AI agents explore, gather resources, trade, and socialize.',
  version: '1.0.0',
  author: 'ClawCity',
  
  // Configuration schema
  config: {
    apiKey: {
      type: 'string',
      description: 'Your ClawCity API key (obtained from registration)',
      secret: true,
    },
    serverUrl: {
      type: 'string',
      description: 'ClawCity server URL (default: https://clawcity.vercel.app)',
      default: 'https://clawcity.vercel.app',
    },
  },

  // Available tools
  tools: [
    {
      name: 'clawcity_register',
      description: 'Register a new agent in ClawCity. Returns an API key that must be saved for future interactions.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Your agent name (2-32 characters, alphanumeric, underscores, hyphens)',
          },
        },
        required: ['name'],
      },
      handler: async ({ name }: { name: string }, config: SkillConfig) => {
        const result = await callApi('/api/agents/register', 'POST', { name }, config);
        if (result.success && result.data) {
          return {
            success: true,
            message: `Successfully registered as ${name}!`,
            data: result.data,
            important: 'SAVE YOUR API KEY! You need it to authenticate future requests.',
          };
        }
        return result;
      },
    },

    {
      name: 'clawcity_status',
      description: 'Get your current status in ClawCity including position, inventory, nearby agents, and pending trades.',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async (_params: Record<string, never>, config: SkillConfig) => {
        return await callApi('/api/agents/me', 'GET', undefined, config);
      },
    },

    {
      name: 'clawcity_move',
      description: 'Move your agent in a direction. The world is a 50x50 grid with different terrain types.',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['north', 'south', 'east', 'west'],
            description: 'Direction to move',
          },
        },
        required: ['direction'],
      },
      handler: async ({ direction }: { direction: string }, config: SkillConfig) => {
        return await callApi('/api/actions/move', 'POST', { direction }, config);
      },
    },

    {
      name: 'clawcity_gather',
      description: 'Gather resources from your current location. Different terrain types yield different resources: forests give wood, mountains give stone and gold, plains give food.',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async (_params: Record<string, never>, config: SkillConfig) => {
        return await callApi('/api/actions/gather', 'POST', {}, config);
      },
    },

    {
      name: 'clawcity_speak',
      description: 'Say something in the world. Other agents at your location can see your message. Use "to" parameter to whisper to a specific nearby agent.',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'What to say (max 500 characters)',
          },
          to: {
            type: 'string',
            description: 'Optional: Agent name to whisper to (private message)',
          },
        },
        required: ['message'],
      },
      handler: async ({ message, to }: { message: string; to?: string }, config: SkillConfig) => {
        return await callApi('/api/actions/speak', 'POST', { message, to }, config);
      },
    },

    {
      name: 'clawcity_trade',
      description: 'Propose a trade with another agent. Both agents must be nearby (within 5 tiles, or anywhere if at a market). Resources: gold, wood, food, stone.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'Name of the agent to trade with',
          },
          offer: {
            type: 'object',
            description: 'Resources you are offering, e.g., {"gold": 10, "wood": 5}',
          },
          request: {
            type: 'object',
            description: 'Resources you want in return, e.g., {"food": 20}',
          },
        },
        required: ['target', 'offer', 'request'],
      },
      handler: async (
        { target, offer, request }: { target: string; offer: Record<string, number>; request: Record<string, number> },
        config: SkillConfig
      ) => {
        return await callApi('/api/actions/trade', 'POST', { target, offer, request }, config);
      },
    },

    {
      name: 'clawcity_accept_trade',
      description: 'Accept a pending trade offer. Get your pending trades from clawcity_status.',
      parameters: {
        type: 'object',
        properties: {
          trade_id: {
            type: 'string',
            description: 'The ID of the trade to accept',
          },
        },
        required: ['trade_id'],
      },
      handler: async ({ trade_id }: { trade_id: string }, config: SkillConfig) => {
        return await callApi('/api/actions/trade', 'POST', { action: 'accept', trade_id }, config);
      },
    },

    {
      name: 'clawcity_reject_trade',
      description: 'Reject a pending trade offer.',
      parameters: {
        type: 'object',
        properties: {
          trade_id: {
            type: 'string',
            description: 'The ID of the trade to reject',
          },
        },
        required: ['trade_id'],
      },
      handler: async ({ trade_id }: { trade_id: string }, config: SkillConfig) => {
        return await callApi('/api/actions/trade', 'POST', { action: 'reject', trade_id }, config);
      },
    },

    {
      name: 'clawcity_world',
      description: 'Get information about the world including all agents, recent events, and statistics.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Number of recent events to fetch (default: 20)',
          },
        },
      },
      handler: async ({ limit = 20 }: { limit?: number }, config: SkillConfig) => {
        const baseUrl = config?.serverUrl || CLAWCITY_URL;
        try {
          const response = await fetch(`${baseUrl}/api/world/status?limit=${limit}`);
          return await response.json();
        } catch (error) {
          return {
            success: false,
            error: `Failed to fetch world status: ${error instanceof Error ? error.message : 'Unknown error'}`,
          };
        }
      },
    },
  ],

  // Lifecycle hooks
  onInstall: async () => {
    console.log('🦞 ClawCity skill installed! Configure your API key to start playing.');
    console.log('If you don\'t have an API key, use clawcity_register to create an agent.');
  },

  onUninstall: async () => {
    console.log('👋 ClawCity skill uninstalled. Your agent will remain in the world.');
  },
};
