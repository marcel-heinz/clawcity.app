import express from 'express';
import fs from 'fs';
import path from 'path';
import { generateSoulMd, generateAgentsMd } from './templates';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || process.env.PROVISION_PORT || '18800', 10);
const AUTH_TOKEN = process.env.PROVISION_AUTH_TOKEN || '';
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || '/home/node/.openclaw';
const OPENCLAW_CONFIG_PATH = path.join(OPENCLAW_HOME, 'openclaw.json');
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

// Shared skill source path
const SKILL_SOURCE = path.join(OPENCLAW_HOME, 'workspace', 'skills', 'clawcity.skill.ts');

interface ProvisionRequest {
  agentId: string; // Unique ID for this user's agent (use ClawCity user_id)
  agentName: string;
  apiKey: string; // ClawCity game API key (plaintext for OpenClaw skill)
  personalityPreset: string;
  strategyExploration: number;
  strategyTrading: number;
  strategyAggression: number;
  strategySocial: number;
  customInstructions: string;
  model?: string; // Optional LLM model override
}

// Auth middleware
function authenticate(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  if (!AUTH_TOKEN) {
    next();
    return;
  }
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== AUTH_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

app.use(authenticate);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agents: listAgentIds() });
});

// List all provisioned agents
app.get('/api/provision', (_req, res) => {
  const agents = listAgentIds();
  res.json({ success: true, agents });
});

// Get agent details
app.get('/api/provision/:agentId', (req, res) => {
  const { agentId } = req.params;
  const agentDir = getAgentDir(agentId);

  if (!fs.existsSync(agentDir)) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  const soulPath = path.join(agentDir, 'workspace', 'SOUL.md');
  const agentsPath = path.join(agentDir, 'workspace', 'AGENTS.md');

  res.json({
    success: true,
    agent: {
      id: agentId,
      soul: fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf-8') : null,
      agents: fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf-8') : null,
    },
  });
});

// Provision a new agent
app.post('/api/provision', async (req, res) => {
  try {
    const body = req.body as ProvisionRequest;
    const { agentId, agentName, apiKey, personalityPreset, customInstructions } = body;

    if (!agentId || !agentName || !apiKey) {
      res.status(400).json({ error: 'Missing required fields: agentId, agentName, apiKey' });
      return;
    }

    const agentDir = getAgentDir(agentId);
    const workspaceDir = path.join(agentDir, 'workspace');
    const skillsDir = path.join(workspaceDir, 'skills');
    const sessionsDir = path.join(agentDir, 'sessions');

    // Create directory structure
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.mkdirSync(sessionsDir, { recursive: true });

    // Generate SOUL.md from personality
    const soulMd = generateSoulMd(agentName, personalityPreset);
    fs.writeFileSync(path.join(workspaceDir, 'SOUL.md'), soulMd);

    // Generate AGENTS.md from strategy + instructions
    const agentsMd = generateAgentsMd({
      agentName,
      personalityPreset,
      exploration: body.strategyExploration ?? 50,
      trading: body.strategyTrading ?? 50,
      aggression: body.strategyAggression ?? 50,
      social: body.strategySocial ?? 50,
      customInstructions: customInstructions || '',
    });
    fs.writeFileSync(path.join(workspaceDir, 'AGENTS.md'), agentsMd);

    // Symlink or copy the ClawCity skill
    const skillDest = path.join(skillsDir, 'clawcity.skill.ts');
    if (!fs.existsSync(skillDest)) {
      if (fs.existsSync(SKILL_SOURCE)) {
        fs.copyFileSync(SKILL_SOURCE, skillDest);
      }
    }

    // Write per-agent skill config with the user's API key
    const skillConfigDir = path.join(agentDir, 'skill-config');
    fs.mkdirSync(skillConfigDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillConfigDir, 'clawcity.json'),
      JSON.stringify({ apiKey, serverUrl: 'https://www.clawcity.app' }, null, 2)
    );

    // Write agent env file with the API key for the skill
    fs.writeFileSync(
      path.join(agentDir, '.env'),
      `CLAWCITY_API_KEY=${apiKey}\nCLAWCITY_URL=https://www.clawcity.app\n`
    );

    // Update gateway config to include this agent
    await addAgentToConfig(agentId, agentDir, body.model);

    console.log(`[provision] Agent ${agentId} (${agentName}) provisioned successfully`);
    res.json({ success: true, agentId });
  } catch (error) {
    console.error('[provision] Error:', error);
    res.status(500).json({
      error: 'Failed to provision agent',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// Update agent personality/strategy (without re-creating)
app.put('/api/provision/:agentId', (req, res) => {
  try {
    const { agentId } = req.params;
    const body = req.body as Partial<ProvisionRequest>;
    const agentDir = getAgentDir(agentId);

    if (!fs.existsSync(agentDir)) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const workspaceDir = path.join(agentDir, 'workspace');

    // Update SOUL.md if personality changed
    if (body.personalityPreset && body.agentName) {
      const soulMd = generateSoulMd(body.agentName, body.personalityPreset);
      fs.writeFileSync(path.join(workspaceDir, 'SOUL.md'), soulMd);
    }

    // Update AGENTS.md if strategy changed
    if (body.agentName) {
      const agentsMd = generateAgentsMd({
        agentName: body.agentName,
        personalityPreset: body.personalityPreset || 'explorer',
        exploration: body.strategyExploration ?? 50,
        trading: body.strategyTrading ?? 50,
        aggression: body.strategyAggression ?? 50,
        social: body.strategySocial ?? 50,
        customInstructions: body.customInstructions || '',
      });
      fs.writeFileSync(path.join(workspaceDir, 'AGENTS.md'), agentsMd);
    }

    // Update API key if changed
    if (body.apiKey) {
      const skillConfigDir = path.join(agentDir, 'skill-config');
      fs.mkdirSync(skillConfigDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillConfigDir, 'clawcity.json'),
        JSON.stringify({ apiKey: body.apiKey, serverUrl: 'https://www.clawcity.app' }, null, 2)
      );
      fs.writeFileSync(
        path.join(agentDir, '.env'),
        `CLAWCITY_API_KEY=${body.apiKey}\nCLAWCITY_URL=https://www.clawcity.app\n`
      );
    }

    console.log(`[provision] Agent ${agentId} updated`);
    res.json({ success: true });
  } catch (error) {
    console.error('[provision] Update error:', error);
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

// Deprovision an agent (stop but keep data)
app.delete('/api/provision/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    const agentDir = getAgentDir(agentId);

    if (!fs.existsSync(agentDir)) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    // Remove from gateway config (don't delete files — keep for potential reactivation)
    await removeAgentFromConfig(agentId);

    console.log(`[provision] Agent ${agentId} deprovisioned`);
    res.json({ success: true });
  } catch (error) {
    console.error('[provision] Delete error:', error);
    res.status(500).json({ error: 'Failed to deprovision agent' });
  }
});

// Proxy chat to gateway's OpenAI-compatible HTTP API
app.post('/api/chat', async (req, res) => {
  try {
    const { agentId, messages } = req.body as {
      agentId: string;
      messages: Array<{ role: string; content: string }>;
    };

    if (!agentId || !messages?.length) {
      res.status(400).json({ error: 'Missing agentId or messages' });
      return;
    }

    const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
        'x-openclaw-agent-id': agentId,
      },
      body: JSON.stringify({
        model: `openclaw:${agentId}`,
        messages,
        user: agentId, // Persistent session per agent
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      res.status(response.status).json({
        error: 'Gateway error',
        details: errorText,
      });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('[chat] Error:', error);
    res.status(500).json({
      error: 'Chat failed',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// Streaming chat endpoint
app.post('/api/chat/stream', async (req, res) => {
  try {
    const { agentId, messages } = req.body as {
      agentId: string;
      messages: Array<{ role: string; content: string }>;
    };

    if (!agentId || !messages?.length) {
      res.status(400).json({ error: 'Missing agentId or messages' });
      return;
    }

    const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
        'x-openclaw-agent-id': agentId,
      },
      body: JSON.stringify({
        model: `openclaw:${agentId}`,
        messages,
        user: agentId,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      res.status(response.status).json({ error: 'Gateway error', details: errorText });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }

    res.end();
  } catch (error) {
    console.error('[chat/stream] Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Stream failed' });
    } else {
      res.end();
    }
  }
});

// Helper functions

function getAgentDir(agentId: string): string {
  return path.join(OPENCLAW_HOME, 'agents', agentId);
}

function listAgentIds(): string[] {
  const agentsDir = path.join(OPENCLAW_HOME, 'agents');
  if (!fs.existsSync(agentsDir)) return [];
  return fs.readdirSync(agentsDir).filter((f) => {
    const stat = fs.statSync(path.join(agentsDir, f));
    return stat.isDirectory();
  });
}

async function addAgentToConfig(agentId: string, agentDir: string, model?: string): Promise<void> {
  const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8'));

  if (!config.agents) config.agents = {};
  if (!config.agents.list) config.agents.list = [];

  // Remove existing entry if present
  config.agents.list = config.agents.list.filter(
    (a: { id: string }) => a.id !== agentId
  );

  // Add new agent
  const agentEntry: Record<string, unknown> = {
    id: agentId,
    workspace: path.join(agentDir, 'workspace'),
    stateDir: agentDir,
  };

  if (model) {
    agentEntry.model = { primary: model };
  }

  config.agents.list.push(agentEntry);

  fs.writeFileSync(OPENCLAW_CONFIG_PATH, JSON.stringify(config, null, 2));

  // Signal gateway to reload config
  await signalConfigReload();
}

async function removeAgentFromConfig(agentId: string): Promise<void> {
  const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8'));

  if (config.agents?.list) {
    config.agents.list = config.agents.list.filter(
      (a: { id: string }) => a.id !== agentId
    );
  }

  fs.writeFileSync(OPENCLAW_CONFIG_PATH, JSON.stringify(config, null, 2));
  await signalConfigReload();
}

async function signalConfigReload(): Promise<void> {
  // The gateway watches its config file for changes.
  // Touching the file triggers a reload. As a fallback, we also try the
  // WebSocket config.patch if available.
  try {
    const stat = fs.statSync(OPENCLAW_CONFIG_PATH);
    fs.utimesSync(OPENCLAW_CONFIG_PATH, stat.atime, new Date());
  } catch (e) {
    console.warn('[provision] Failed to touch config file:', e);
  }
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[provision] Provisioning server running on :${PORT}`);
  console.log(`[provision] Gateway URL: ${GATEWAY_URL}`);
  console.log(`[provision] OpenClaw home: ${OPENCLAW_HOME}`);
  console.log(`[provision] Existing agents: ${listAgentIds().join(', ') || 'none'}`);
});
