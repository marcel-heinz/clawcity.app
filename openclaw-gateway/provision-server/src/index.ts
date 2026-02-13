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

// Shared skill source directory (SKILL.md format, auto-discovered by OpenClaw)
const SKILL_SOURCE_DIR = path.join(OPENCLAW_HOME, 'workspace', 'skills', 'clawcity');

const CHAT_TIMEOUT_MS = intEnv('OPENCLAW_CHAT_TIMEOUT_MS', 240_000);
const CHAT_RETRIES = intEnv('OPENCLAW_CHAT_RETRIES', 2);
const CHAT_RETRY_DELAY_MS = intEnv('OPENCLAW_CHAT_RETRY_DELAY_MS', 1_500);

const AUTOPLAY_ENABLED = boolEnv('OPENCLAW_AUTOPLAY_ENABLED', true);
const AUTOPLAY_INTERVAL_MS = intEnv('OPENCLAW_AUTOPLAY_INTERVAL_MS', 300_000);
const AUTOPLAY_TIMEOUT_MS = intEnv('OPENCLAW_AUTOPLAY_TIMEOUT_MS', 180_000);
const AUTOPLAY_MAX_PARALLEL = intEnv('OPENCLAW_AUTOPLAY_MAX_PARALLEL', 2);
const AUTOPLAY_MAX_AGENTS_PER_TICK = intEnv('OPENCLAW_AUTOPLAY_MAX_AGENTS_PER_TICK', 20);
const AUTOPLAY_PROMPT = (process.env.OPENCLAW_AUTOPLAY_PROMPT || '').trim() || [
  'AUTO-MODE TICK:',
  '- Execute 1 focused game progress turn using ClawCity tools.',
  '- Priorities: keep food >= 50, recover if low food, move off depleted tiles, gather efficiently.',
  '- Use lowercase terrain names only (plains, forest, mountain, market, water, rocky, sand, deep_water, marsh).',
  '- Respect gather cooldowns: if cooldown/depleted errors occur, wait and retry safely instead of failing.',
  '- Keep execution concise and robust; avoid unnecessary narration.',
].join('\n');

const autoplayInFlight = new Set<string>();
let autoplayTimer: NodeJS.Timeout | null = null;
let autoplayCursor = 0;

interface GatewayChatMessage {
  role: string;
  content: string;
}

interface GatewayChatRequest {
  agentId: string;
  messages: GatewayChatMessage[];
  stream?: boolean;
  timeoutMs?: number;
  retries?: number;
}

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
  soulMd?: string;
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

// Health check (before auth — Railway healthcheck sends no auth header)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', agents: listAgentIds() });
});

app.use(authenticate);

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

    // Prefer user-provided SOUL.md, fallback to generated template.
    const soulMd =
      typeof body.soulMd === 'string' && body.soulMd.trim()
        ? body.soulMd
        : generateSoulMd(agentName, personalityPreset);
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

    // Copy latest skill directory (SKILL.md format, auto-discovered by OpenClaw)
    const skillDestDir = path.join(skillsDir, 'clawcity');
    if (fs.existsSync(SKILL_SOURCE_DIR)) {
      fs.mkdirSync(skillDestDir, { recursive: true });
      for (const file of fs.readdirSync(SKILL_SOURCE_DIR)) {
        fs.copyFileSync(
          path.join(SKILL_SOURCE_DIR, file),
          path.join(skillDestDir, file)
        );
      }
      console.log(`[provision] Skill copied for agent ${agentId}`);
    }

    // Write per-agent skill config with the user's API key
    const skillConfigDir = path.join(agentDir, 'skill-config');
    fs.mkdirSync(skillConfigDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillConfigDir, 'clawcity.json'),
      JSON.stringify({ apiKey, serverUrl: 'https://www.clawcity.app' }, null, 2)
    );

    // Write agent env file with the API key for the skill
    // Write to both agentDir and workspace root — OpenClaw may load .env from workspace
    const envContent = `CLAWCITY_API_KEY=${apiKey}\nCLAWCITY_URL=https://www.clawcity.app\n`;
    fs.writeFileSync(path.join(agentDir, '.env'), envContent);
    fs.writeFileSync(path.join(workspaceDir, '.env'), envContent);

    // Copy heartbeat checklist into agent workspace (OpenClaw reads HEARTBEAT.md on each cycle)
    const heartbeatSource = path.join(OPENCLAW_HOME, 'workspace', 'HEARTBEAT.md');
    if (fs.existsSync(heartbeatSource)) {
      fs.copyFileSync(heartbeatSource, path.join(workspaceDir, 'HEARTBEAT.md'));
    }

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

    // Update SOUL.md using explicit content if provided.
    if (typeof body.soulMd === 'string' && body.soulMd.trim()) {
      fs.writeFileSync(path.join(workspaceDir, 'SOUL.md'), body.soulMd);
    } else if (body.personalityPreset && body.agentName) {
      // Fallback to generated SOUL.md when only personality metadata is provided.
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
    const { agentId, messages } = req.body as GatewayChatRequest;

    if (!agentId || !messages?.length) {
      res.status(400).json({ error: 'Missing agentId or messages' });
      return;
    }

    const response = await proxyGatewayChat({
      agentId,
      messages,
      timeoutMs: CHAT_TIMEOUT_MS,
      retries: CHAT_RETRIES,
    });

    if (!response.ok) {
      const errorText = await safeResponseText(response);
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
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = message.toLowerCase().includes('timeout');
    res.status(isTimeout ? 504 : 500).json({
      error: isTimeout ? 'Chat timed out' : 'Chat failed',
      details: message,
    });
  }
});

// Streaming chat endpoint
app.post('/api/chat/stream', async (req, res) => {
  try {
    const { agentId, messages } = req.body as GatewayChatRequest;

    if (!agentId || !messages?.length) {
      res.status(400).json({ error: 'Missing agentId or messages' });
      return;
    }

    const response = await proxyGatewayChat({
      agentId,
      messages,
      stream: true,
      timeoutMs: CHAT_TIMEOUT_MS,
      retries: 1,
    });

    if (!response.ok || !response.body) {
      const errorText = await safeResponseText(response);
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
    const message = error instanceof Error ? error.message : String(error);
    if (!res.headersSent) {
      const isTimeout = message.toLowerCase().includes('timeout');
      res.status(isTimeout ? 504 : 500).json({ error: isTimeout ? 'Stream timed out' : 'Stream failed', details: message });
    } else {
      res.end();
    }
  }
});

app.get('/api/autoplay/status', (_req, res) => {
  res.json({
    success: true,
    enabled: AUTOPLAY_ENABLED,
    interval_ms: AUTOPLAY_INTERVAL_MS,
    timeout_ms: AUTOPLAY_TIMEOUT_MS,
    max_parallel: AUTOPLAY_MAX_PARALLEL,
    max_agents_per_tick: AUTOPLAY_MAX_AGENTS_PER_TICK,
    running_agents: Array.from(autoplayInFlight),
    configured_agents: listConfiguredAgentIds(),
  });
});

app.post('/api/autoplay/tick', async (req, res) => {
  try {
    const requestedAgentId = typeof req.body?.agentId === 'string' ? req.body.agentId : '';
    if (requestedAgentId) {
      const result = await runAutoplayForAgent(requestedAgentId);
      res.json({ success: result.success, agentId: requestedAgentId, details: result.details });
      return;
    }

    const result = await runAutoplayTick();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Helper functions

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function isTransientFetchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return [
    'fetch failed',
    'Headers Timeout Error',
    'UND_ERR_HEADERS_TIMEOUT',
    'ECONNRESET',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'EAI_AGAIN',
    'socket hang up',
    'AbortError',
  ].some((part) => message.includes(part));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function retryDelayMs(attempt: number): number {
  return CHAT_RETRY_DELAY_MS * Math.max(1, attempt);
}

function listConfiguredAgentIds(): string[] {
  try {
    const config = JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8')) as {
      agents?: { list?: Array<{ id?: string }> };
    };
    return (config.agents?.list || [])
      .map((entry) => entry?.id || '')
      .filter(Boolean);
  } catch (error) {
    console.warn('[provision] Failed reading configured agent list:', error);
    return [];
  }
}

async function proxyGatewayChat({
  agentId,
  messages,
  stream = false,
  timeoutMs = CHAT_TIMEOUT_MS,
  retries = CHAT_RETRIES,
}: GatewayChatRequest): Promise<Response> {
  const maxAttempts = Math.max(1, retries + 1);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
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
          user: agentId, // shared memory between chat and auto-mode
          stream,
        }),
        signal: controller.signal,
      });

      if (isRetryableStatus(response.status) && attempt < maxAttempts) {
        const detail = await safeResponseText(response);
        console.warn(`[chat] Retryable gateway status ${response.status} for ${agentId} (attempt ${attempt}/${maxAttempts})`, detail);
        await sleep(retryDelayMs(attempt));
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;

      if (!isTransientFetchError(error) || attempt >= maxAttempts) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(`Gateway timeout after ${timeoutMs}ms`);
        }
        throw error;
      }

      console.warn(
        `[chat] Transient gateway error for ${agentId} (attempt ${attempt}/${maxAttempts}):`,
        error instanceof Error ? error.message : String(error)
      );
      await sleep(retryDelayMs(attempt));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw (lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Gateway request failed')));
}

function getAutoplayBatch(agentIds: string[]): string[] {
  if (agentIds.length === 0) return [];

  const limit = Math.min(AUTOPLAY_MAX_AGENTS_PER_TICK, agentIds.length);
  if (limit >= agentIds.length) {
    autoplayCursor = 0;
    return agentIds;
  }

  const start = autoplayCursor % agentIds.length;
  const batch: string[] = [];
  for (let i = 0; i < limit; i++) {
    batch.push(agentIds[(start + i) % agentIds.length]);
  }
  autoplayCursor = (start + limit) % agentIds.length;
  return batch;
}

async function runAutoplayForAgent(agentId: string): Promise<{ success: boolean; details: string }> {
  if (autoplayInFlight.has(agentId)) {
    return { success: false, details: 'busy' };
  }

  autoplayInFlight.add(agentId);
  try {
    const response = await proxyGatewayChat({
      agentId,
      messages: [{ role: 'user', content: AUTOPLAY_PROMPT }],
      timeoutMs: AUTOPLAY_TIMEOUT_MS,
      retries: 1,
    });

    if (!response.ok) {
      const detail = await safeResponseText(response);
      return { success: false, details: `HTTP ${response.status}: ${detail}` };
    }

    let finishReason = 'unknown';
    try {
      const data = await response.json() as {
        choices?: Array<{ finish_reason?: string }>;
      };
      finishReason = data.choices?.[0]?.finish_reason || finishReason;
    } catch {
      // Non-JSON response is still considered a successful request.
    }

    return { success: true, details: `finish_reason=${finishReason}` };
  } catch (error) {
    return {
      success: false,
      details: error instanceof Error ? error.message : String(error),
    };
  } finally {
    autoplayInFlight.delete(agentId);
  }
}

async function runAutoplayTick(): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  agents: string[];
}> {
  const allConfigured = listConfiguredAgentIds();
  const agents = getAutoplayBatch(allConfigured);
  if (agents.length === 0) {
    return { attempted: 0, succeeded: 0, failed: 0, skipped: 0, agents: [] };
  }

  const queue = [...agents];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const workers = Array.from({ length: Math.min(AUTOPLAY_MAX_PARALLEL, queue.length) }, async () => {
    while (queue.length > 0) {
      const agentId = queue.shift();
      if (!agentId) break;

      const result = await runAutoplayForAgent(agentId);
      if (result.success) {
        succeeded++;
      } else if (result.details === 'busy') {
        skipped++;
      } else {
        failed++;
        console.warn(`[autoplay] ${agentId} failed: ${result.details}`);
      }
    }
  });
  await Promise.all(workers);

  return {
    attempted: agents.length,
    succeeded,
    failed,
    skipped,
    agents,
  };
}

async function startAutoplayLoop(): Promise<void> {
  if (!AUTOPLAY_ENABLED) {
    console.log('[autoplay] Disabled');
    return;
  }

  console.log(
    `[autoplay] Enabled interval=${AUTOPLAY_INTERVAL_MS}ms timeout=${AUTOPLAY_TIMEOUT_MS}ms max_parallel=${AUTOPLAY_MAX_PARALLEL} max_agents_per_tick=${AUTOPLAY_MAX_AGENTS_PER_TICK}`
  );

  // Warm start shortly after boot so freshly deployed agents can act quickly.
  setTimeout(() => {
    void runAutoplayTick()
      .then((result) => {
        if (result.attempted > 0) {
          console.log(`[autoplay] Warm tick: ${result.succeeded}/${result.attempted} succeeded (${result.failed} failed, ${result.skipped} skipped)`);
        }
      })
      .catch((error) => {
        console.warn('[autoplay] Warm tick failed:', error);
      });
  }, 15_000);

  autoplayTimer = setInterval(() => {
    void runAutoplayTick()
      .then((result) => {
        if (result.attempted > 0) {
          console.log(`[autoplay] Tick: ${result.succeeded}/${result.attempted} succeeded (${result.failed} failed, ${result.skipped} skipped)`);
        }
      })
      .catch((error) => {
        console.warn('[autoplay] Tick failed:', error);
      });
  }, AUTOPLAY_INTERVAL_MS);
}

function stopAutoplayLoop(): void {
  if (autoplayTimer) {
    clearInterval(autoplayTimer);
    autoplayTimer = null;
  }
}

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

  // Add new agent (only use keys OpenClaw recognizes)
  const agentEntry: Record<string, unknown> = {
    id: agentId,
    workspace: path.join(agentDir, 'workspace'),
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
  void startAutoplayLoop();
});

process.on('SIGTERM', stopAutoplayLoop);
process.on('SIGINT', stopAutoplayLoop);
