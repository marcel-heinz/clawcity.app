import express from 'express';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { generateSoulMd, generateAgentsMd } from './templates';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || process.env.PROVISION_PORT || '18800', 10);
const AUTH_TOKEN = process.env.PROVISION_AUTH_TOKEN || '';
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || '/home/node/.openclaw';
const OPENCLAW_CONFIG_PATH = path.join(OPENCLAW_HOME, 'openclaw.json');
const MODEL_OVERRIDE_PATH = path.join(OPENCLAW_HOME, 'model.override.json');
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

// Shared skill source directory (SKILL.md format, auto-discovered by OpenClaw)
const SKILL_SOURCE_DIR = path.join(OPENCLAW_HOME, 'workspace', 'skills', 'clawcity');

const CHAT_TIMEOUT_MS = intEnv('OPENCLAW_CHAT_TIMEOUT_MS', 240_000);
const CHAT_RETRIES = intEnv('OPENCLAW_CHAT_RETRIES', 2);
const CHAT_RETRY_DELAY_MS = intEnv('OPENCLAW_CHAT_RETRY_DELAY_MS', 1_500);

const AUTOPLAY_ENABLED = boolEnv('OPENCLAW_AUTOPLAY_ENABLED', true);
const AUTOPLAY_INTERVAL_MS = intEnv('OPENCLAW_AUTOPLAY_INTERVAL_MS', 300_000);
const AUTOPLAY_TIMEOUT_MS = intEnv('OPENCLAW_AUTOPLAY_TIMEOUT_MS', 240_000);
const AUTOPLAY_MAX_PARALLEL = intEnv('OPENCLAW_AUTOPLAY_MAX_PARALLEL', 2);
const AUTOPLAY_MAX_AGENTS_PER_TICK = intEnv('OPENCLAW_AUTOPLAY_MAX_AGENTS_PER_TICK', 20);
const AUTOPLAY_PROMPT_OVERRIDE = (process.env.OPENCLAW_AUTOPLAY_PROMPT || '').trim();
const AUTOPLAY_SNAPSHOT_REFRESH_MS = 15 * 60 * 1000;
const AUTOPLAY_WARM_START_DELAY_MS = 15_000;

const AGENT_SETTINGS_FILE = 'agent-settings.json';
const AUTOPLAY_FEEDBACK_FILE = 'autoplay-feedback.jsonl';
const AUTOPLAY_FEEDBACK_RETENTION_MS = 24 * 60 * 60 * 1000;
const AUTOPLAY_FEEDBACK_DEFAULT_LIMIT = 50;
const OPENROUTER_PREFIX = 'openrouter/';
const ALLOWED_MODELS = ['z-ai/glm-5', 'minimax/minimax-m2.5'] as const;

type AllowedModel = (typeof ALLOWED_MODELS)[number];

const autoplayInFlight = new Set<string>();
let autoplayTimer: NodeJS.Timeout | null = null;
let autoplayWarmTimer: NodeJS.Timeout | null = null;
let autoplaySnapshotTimer: NodeJS.Timeout | null = null;
let autoplayCursor = 0;
let autoplayPassCounter = 0;
let autoplayNextTickAtMs: number | null = null;
let autoplayLastTickStartedAt: string | null = null;
let autoplayLastTickFinishedAt: string | null = null;
let autoplayLastTickResult: string | null = null;
let autoplayLastTickErrorCode: string | null = null;
let autoplayCommandSnapshot = 'Unavailable';
let autoplayPrompt = '';
let autoplayPromptUpdatedAt: string | null = null;
const autoplayDeferredUntilPass = new Map<string, number>();
const autoplayAgentState = new Map<string, {
  last_tick_started_at: string | null;
  last_tick_finished_at: string | null;
  last_tick_result: string | null;
  last_tick_error_code: string | null;
}>();

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
  autoModeEnabled?: boolean;
}

interface AgentSettings {
  autoplayEnabled?: boolean;
  updatedAt?: string;
}

type AutoplayFeedbackStatus =
  | 'success'
  | 'failed'
  | 'busy'
  | 'skipped_disabled'
  | 'uncertain_timeout_deferred';

interface AutoplayFeedbackEntry {
  id: string;
  agent_id: string;
  started_at: string;
  finished_at: string;
  status: AutoplayFeedbackStatus;
  summary: string;
  details?: string;
  error_code?: string;
}

interface RunAutoplayResult {
  success: boolean;
  status: AutoplayFeedbackStatus;
  summary: string;
  details: string;
  errorCode?: string;
}

interface RunAutoplayTickResult {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  agents: string[];
  reason_counts: Record<string, number>;
  pass: number;
}

interface RunAutoplayOptions {
  manual?: boolean;
  recordDisabledFeedback?: boolean;
}

interface ParsedGatewayChoice {
  finish_reason?: string;
  message?: {
    content?: unknown;
  };
}

interface GatewayConfig {
  agents?: {
    defaults?: {
      model?: {
        primary?: string;
        fallbacks?: string[];
      };
      heartbeat?: {
        model?: string;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    };
    list?: Array<{
      id?: string;
      workspace?: string;
      model?: {
        primary?: string;
      };
      [key: string]: unknown;
    }>;
  };
  [key: string]: unknown;
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

app.get('/api/settings/model', (_req, res) => {
  try {
    const config = readGatewayConfig();
    const model = resolveModelFromConfig(config);
    res.json({
      success: true,
      model,
      models: ALLOWED_MODELS,
    });
  } catch (error) {
    console.error('[settings] Failed reading model setting:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to read model setting',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

app.put('/api/settings/model', async (req, res) => {
  const requestedModel = typeof req.body?.model === 'string' ? req.body.model : '';
  const model = normalizeAllowedModel(requestedModel);

  if (!model) {
    res.status(400).json({
      success: false,
      error: 'Invalid model. Allowed values: z-ai/glm-5, minimax/minimax-m2.5',
    });
    return;
  }

  try {
    await applyGlobalModelSetting(model, { persist: true });
    res.json({
      success: true,
      model,
      models: ALLOWED_MODELS,
    });
  } catch (error) {
    console.error('[settings] Failed updating model setting:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update model setting',
      details: error instanceof Error ? error.message : String(error),
    });
  }
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
      auto_mode_enabled: getAgentAutoplaySetting(agentId),
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

    setAgentAutoplaySetting(agentId, body.autoModeEnabled !== false);

    // Update gateway config to include this agent
    await addAgentToConfig(agentId, agentDir, body.model);

    console.log(`[provision] Agent ${agentId} (${agentName}) provisioned successfully`);
    res.json({ success: true, agentId, auto_mode_enabled: getAgentAutoplaySetting(agentId) });
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

    if (typeof body.autoModeEnabled === 'boolean') {
      setAgentAutoplaySetting(agentId, body.autoModeEnabled);
    }

    console.log(`[provision] Agent ${agentId} updated`);
    res.json({ success: true, auto_mode_enabled: getAgentAutoplaySetting(agentId) });
  } catch (error) {
    console.error('[provision] Update error:', error);
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

// Update per-agent autoplay setting
app.put('/api/provision/:agentId/autoplay', (req, res) => {
  try {
    const { agentId } = req.params;
    const enabled = req.body?.enabled;

    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'Missing enabled boolean' });
      return;
    }

    const agentDir = getAgentDir(agentId);
    if (!fs.existsSync(agentDir)) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    setAgentAutoplaySetting(agentId, enabled);
    res.json({ success: true, agentId, enabled });
  } catch (error) {
    console.error('[provision] Autoplay update error:', error);
    res.status(500).json({ error: 'Failed to update autoplay setting' });
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
  const configuredAgents = listConfiguredAgentIds();
  const agentStatus = configuredAgents.map((agentId) => {
    const lastTick = readAutoplayFeedback(agentId, 1)[0] || null;
    const runtime = getAutoplayAgentState(agentId);
    const deferUntilPass = autoplayDeferredUntilPass.get(agentId);
    const deferredOnce = Number.isFinite(deferUntilPass) && (deferUntilPass as number) > autoplayPassCounter;
    return {
      agent_id: agentId,
      enabled: getAgentAutoplaySetting(agentId),
      in_flight: autoplayInFlight.has(agentId),
      deferred_once: deferredOnce,
      next_tick_at: computeNextTickAtIso(agentId),
      last_tick: lastTick,
      last_tick_started_at: runtime.last_tick_started_at || lastTick?.started_at || null,
      last_tick_finished_at: runtime.last_tick_finished_at || lastTick?.finished_at || null,
      last_tick_result: runtime.last_tick_result || lastTick?.status || null,
      last_tick_error_code: runtime.last_tick_error_code || lastTick?.error_code || null,
    };
  });

  res.json({
    success: true,
    enabled: AUTOPLAY_ENABLED,
    interval_ms: AUTOPLAY_INTERVAL_MS,
    timeout_ms: AUTOPLAY_TIMEOUT_MS,
    max_parallel: AUTOPLAY_MAX_PARALLEL,
    max_agents_per_tick: AUTOPLAY_MAX_AGENTS_PER_TICK,
    running_agents: Array.from(autoplayInFlight),
    configured_agents: configuredAgents,
    pass: autoplayPassCounter,
    next_tick_at: autoplayNextTickAtMs ? new Date(autoplayNextTickAtMs).toISOString() : null,
    last_tick_started_at: autoplayLastTickStartedAt,
    last_tick_finished_at: autoplayLastTickFinishedAt,
    last_tick_result: autoplayLastTickResult,
    last_tick_error_code: autoplayLastTickErrorCode,
    prompt_updated_at: autoplayPromptUpdatedAt,
    agents: agentStatus,
  });
});

app.get('/api/autoplay/feedback/:agentId', (req, res) => {
  try {
    const { agentId } = req.params;
    const rawLimit = parseInt(String(req.query.limit || AUTOPLAY_FEEDBACK_DEFAULT_LIMIT), 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : AUTOPLAY_FEEDBACK_DEFAULT_LIMIT;

    if (!fs.existsSync(getAgentDir(agentId))) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const entries = readAutoplayFeedback(agentId, limit);
    res.json({
      success: true,
      agentId,
      entries,
      count: entries.length,
      retention_ms: AUTOPLAY_FEEDBACK_RETENTION_MS,
    });
  } catch (error) {
    console.error('[autoplay] feedback read failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post('/api/autoplay/tick', async (req, res) => {
  try {
    const requestedAgentId = typeof req.body?.agentId === 'string' ? req.body.agentId : '';
    if (requestedAgentId) {
      const result = await runAutoplayForAgent(requestedAgentId, {
        manual: true,
        recordDisabledFeedback: true,
      });
      res.json({
        success: result.success,
        agentId: requestedAgentId,
        status: result.status,
        summary: result.summary,
        details: result.details,
      });
      return;
    }

    const result = await runAutoplayTick('manual');
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

function truncate(value: string, max = 220): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

function isGatewayTimeoutMessage(message: string): boolean {
  const lowered = message.toLowerCase();
  return lowered.includes('timeout') || lowered.includes('und_err_headers_timeout');
}

function normalizeAutoplayErrorCode(details: string, statusCode?: number): string {
  const lowered = details.toLowerCase();
  if (isGatewayTimeoutMessage(details) || statusCode === 408 || statusCode === 504) {
    return 'gateway_timeout';
  }
  if (lowered.includes("unknown command '") || lowered.includes('unknown command "')) {
    return 'unknown_command';
  }
  if (
    lowered.includes('usage: clawcity') ||
    lowered.includes('display help for command') ||
    lowered.includes('missing required argument') ||
    lowered.includes('unknown option')
  ) {
    return 'invalid_usage';
  }
  if (statusCode && statusCode >= 500) {
    return 'gateway_error';
  }
  return 'execution_error';
}

function getAutoplayAgentState(agentId: string): {
  last_tick_started_at: string | null;
  last_tick_finished_at: string | null;
  last_tick_result: string | null;
  last_tick_error_code: string | null;
} {
  const existing = autoplayAgentState.get(agentId);
  if (existing) return existing;
  const initial = {
    last_tick_started_at: null,
    last_tick_finished_at: null,
    last_tick_result: null,
    last_tick_error_code: null,
  };
  autoplayAgentState.set(agentId, initial);
  return initial;
}

function setAutoplayAgentState(
  agentId: string,
  patch: Partial<{
    last_tick_started_at: string | null;
    last_tick_finished_at: string | null;
    last_tick_result: string | null;
    last_tick_error_code: string | null;
  }>
): void {
  autoplayAgentState.set(agentId, {
    ...getAutoplayAgentState(agentId),
    ...patch,
  });
}

function computeNextTickAtIso(agentId: string): string | null {
  if (!AUTOPLAY_ENABLED || !getAgentAutoplaySetting(agentId) || !autoplayNextTickAtMs) return null;
  const deferUntil = autoplayDeferredUntilPass.get(agentId);
  const deferred = Number.isFinite(deferUntil) && (deferUntil as number) > autoplayPassCounter;
  const nextTickMs = autoplayNextTickAtMs + (deferred ? AUTOPLAY_INTERVAL_MS : 0);
  return new Date(nextTickMs).toISOString();
}

function addReasonCount(reasonCounts: Record<string, number>, reason: string): void {
  reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
}

function captureCliHelp(command: string, args: string[], timeoutMs = 12_000): string {
  const result = spawnSync(command, args, {
    encoding: 'utf-8',
    timeout: timeoutMs,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  if (!output) return '(no output)';
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .slice(0, 60)
    .join('\n');
}

function buildAutoplayCommandSnapshot(): string {
  const sections = [
    { title: 'clawcity --help', args: ['--help'] },
    { title: 'clawcity move --help', args: ['move', '--help'] },
    { title: 'clawcity move-to --help', args: ['move-to', '--help'] },
    { title: 'clawcity step --help', args: ['step', '--help'] },
    { title: 'clawcity stats --help', args: ['stats', '--help'] },
    { title: 'clawcity look --help', args: ['look', '--help'] },
    { title: 'clawcity status --help', args: ['status', '--help'] },
    { title: 'clawcity gather --help', args: ['gather', '--help'] },
    { title: 'clawcity trade --help', args: ['trade', '--help'] },
  ];

  return sections
    .map(({ title, args }) => `## ${title}\n${captureCliHelp('clawcity', args)}`)
    .join('\n\n');
}

function buildAutoplayPrompt(snapshot: string): string {
  const base = [
    'AUTO-MODE TICK (CLI-ONLY):',
    '- Execute exactly one concise progress turn with a hard budget of 3-4 CLI commands.',
    '- Priorities: keep food >= 50, recover low food, move off depleted tiles, gather efficiently.',
    '- Use only valid CLI command forms from snapshot.',
    '- Allowed movement commands: `clawcity move <terrain|x,y>`, `clawcity move-to <terrain|x,y>`, `clawcity step <north|south|east|west>`.',
    '- Allowed stats commands: `clawcity stats`, `clawcity look`, `clawcity status`, `clawcity summary`.',
    '- Allowed trade commands: `clawcity trade create ...`, `clawcity trade accept ...`, `clawcity trade reject ...`.',
    '- Terrain values must be lowercase: plains, forest, mountain, market, water, rocky, sand, deep_water, marsh.',
    '- One retry branch max for cooldown/depleted outcomes; do not loop indefinitely.',
    '- Keep response concise with actions + outcome.',
    '',
    'FORBIDDEN COMMAND EXAMPLES:',
    '- `clawcity trade` with no subcommand (unproductive; use create/accept/reject).',
    '',
    'CLI SNAPSHOT (authoritative):',
    snapshot,
  ];

  if (AUTOPLAY_PROMPT_OVERRIDE) {
    base.push('', 'OPERATOR OVERRIDE:', AUTOPLAY_PROMPT_OVERRIDE);
  }

  return base.join('\n');
}

function refreshAutoplayPrompt(reason: string): void {
  try {
    autoplayCommandSnapshot = buildAutoplayCommandSnapshot();
    autoplayPrompt = buildAutoplayPrompt(autoplayCommandSnapshot);
    autoplayPromptUpdatedAt = new Date().toISOString();
    console.log(`[autoplay] Command snapshot refreshed (${reason})`);
  } catch (error) {
    console.warn('[autoplay] Failed to refresh command snapshot:', error);
    if (!autoplayPrompt) {
      autoplayPrompt = buildAutoplayPrompt('Snapshot unavailable due to CLI help error.');
      autoplayPromptUpdatedAt = new Date().toISOString();
    }
  }
}

function getAgentSettingsPath(agentId: string): string {
  return path.join(getAgentDir(agentId), AGENT_SETTINGS_FILE);
}

function getAutoplayFeedbackPath(agentId: string): string {
  return path.join(getAgentDir(agentId), AUTOPLAY_FEEDBACK_FILE);
}

function parseAgentSettings(agentId: string): AgentSettings {
  const settingsPath = getAgentSettingsPath(agentId);
  if (!fs.existsSync(settingsPath)) return {};

  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as AgentSettings;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn(`[autoplay] Failed to parse settings for ${agentId}:`, error);
    return {};
  }
}

function getAgentAutoplaySetting(agentId: string): boolean {
  const settings = parseAgentSettings(agentId);
  return settings.autoplayEnabled !== false;
}

function setAgentAutoplaySetting(agentId: string, enabled: boolean): void {
  const agentDir = getAgentDir(agentId);
  fs.mkdirSync(agentDir, { recursive: true });
  const settingsPath = getAgentSettingsPath(agentId);
  const payload: AgentSettings = {
    autoplayEnabled: enabled,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(settingsPath, JSON.stringify(payload, null, 2));
}

function makeFeedbackEntry(input: {
  agentId: string;
  startedAt: Date;
  finishedAt: Date;
  status: AutoplayFeedbackStatus;
  summary: string;
  details?: string;
  errorCode?: string;
}): AutoplayFeedbackEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    agent_id: input.agentId,
    started_at: input.startedAt.toISOString(),
    finished_at: input.finishedAt.toISOString(),
    status: input.status,
    summary: truncate(input.summary, 240),
    details: input.details ? truncate(input.details, 400) : undefined,
    error_code: input.errorCode ? truncate(input.errorCode, 80) : undefined,
  };
}

function parseFeedbackLine(line: string): AutoplayFeedbackEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as AutoplayFeedbackEntry;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.agent_id || !parsed.started_at || !parsed.finished_at || !parsed.status || !parsed.summary) {
      return null;
    }

    const startedAtMs = Date.parse(parsed.started_at);
    const finishedAtMs = Date.parse(parsed.finished_at);
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function compactAutoplayFeedback(agentId: string, retentionMs = AUTOPLAY_FEEDBACK_RETENTION_MS): void {
  const feedbackPath = getAutoplayFeedbackPath(agentId);
  if (!fs.existsSync(feedbackPath)) return;

  const raw = fs.readFileSync(feedbackPath, 'utf-8');
  const minTs = Date.now() - retentionMs;
  const keptEntries: AutoplayFeedbackEntry[] = [];

  for (const line of raw.split('\n')) {
    const parsed = parseFeedbackLine(line);
    if (!parsed) continue;

    const finishedAt = Date.parse(parsed.finished_at);
    if (finishedAt >= minTs) {
      keptEntries.push(parsed);
    }
  }

  if (keptEntries.length === 0) {
    fs.rmSync(feedbackPath, { force: true });
    return;
  }

  keptEntries.sort((a, b) => Date.parse(a.finished_at) - Date.parse(b.finished_at));
  const content = keptEntries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  fs.writeFileSync(feedbackPath, content);
}

function appendAutoplayFeedback(agentId: string, entry: AutoplayFeedbackEntry): void {
  const agentDir = getAgentDir(agentId);
  fs.mkdirSync(agentDir, { recursive: true });
  const feedbackPath = getAutoplayFeedbackPath(agentId);
  fs.appendFileSync(feedbackPath, `${JSON.stringify(entry)}\n`);
  compactAutoplayFeedback(agentId, AUTOPLAY_FEEDBACK_RETENTION_MS);
}

function readAutoplayFeedback(agentId: string, limit = AUTOPLAY_FEEDBACK_DEFAULT_LIMIT): AutoplayFeedbackEntry[] {
  const feedbackPath = getAutoplayFeedbackPath(agentId);
  if (!fs.existsSync(feedbackPath)) return [];

  const minTs = Date.now() - AUTOPLAY_FEEDBACK_RETENTION_MS;
  const entries: AutoplayFeedbackEntry[] = [];
  const raw = fs.readFileSync(feedbackPath, 'utf-8');

  for (const line of raw.split('\n')) {
    const parsed = parseFeedbackLine(line);
    if (!parsed) continue;

    const finishedAt = Date.parse(parsed.finished_at);
    if (finishedAt >= minTs) {
      entries.push(parsed);
    }
  }

  entries.sort((a, b) => Date.parse(b.finished_at) - Date.parse(a.finished_at));
  return entries.slice(0, Math.max(1, Math.min(limit, 100)));
}

function extractAssistantText(content: unknown): string {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    const chunks = content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in (part as Record<string, unknown>)) {
          const text = (part as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }
        return '';
      })
      .filter(Boolean);

    return chunks.join(' ');
  }

  return '';
}

function summarizeAssistantOutput(raw: string): string {
  const firstLine = raw
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) return 'Auto-mode tick completed.';
  return truncate(firstLine, 220);
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

function normalizeAllowedModel(raw: string): AllowedModel | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  const normalized = value.startsWith(OPENROUTER_PREFIX)
    ? value.slice(OPENROUTER_PREFIX.length)
    : value;
  return ALLOWED_MODELS.includes(normalized as AllowedModel)
    ? (normalized as AllowedModel)
    : null;
}

function toOpenRouterModel(model: AllowedModel): string {
  return `${OPENROUTER_PREFIX}${model}`;
}

function readGatewayConfig(): GatewayConfig {
  return JSON.parse(fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8')) as GatewayConfig;
}

function writeGatewayConfig(config: GatewayConfig): void {
  fs.writeFileSync(OPENCLAW_CONFIG_PATH, JSON.stringify(config, null, 2));
}

function resolveModelFromConfig(config: GatewayConfig): AllowedModel {
  const defaultsPrimary = config.agents?.defaults?.model?.primary;
  const resolved = normalizeAllowedModel(defaultsPrimary || '');
  return resolved || ALLOWED_MODELS[0];
}

function applyModelToConfig(config: GatewayConfig, model: AllowedModel): void {
  if (!config.agents) config.agents = {};
  if (!config.agents.defaults) config.agents.defaults = {};
  if (!config.agents.defaults.model) config.agents.defaults.model = {};
  if (!config.agents.defaults.heartbeat) config.agents.defaults.heartbeat = {};
  if (!config.agents.list) config.agents.list = [];

  const openRouterModel = toOpenRouterModel(model);
  config.agents.defaults.model.primary = openRouterModel;
  config.agents.defaults.model.fallbacks = [];
  config.agents.defaults.heartbeat.model = openRouterModel;
  config.agents.list = config.agents.list.map((entry) => ({
    ...entry,
    model: { primary: openRouterModel },
  }));
}

function readPersistedModelOverride(): AllowedModel | null {
  if (!fs.existsSync(MODEL_OVERRIDE_PATH)) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(MODEL_OVERRIDE_PATH, 'utf-8')) as {
      model?: string;
    };
    return normalizeAllowedModel(payload.model || '');
  } catch (error) {
    console.warn('[settings] Failed reading model override:', error);
    return null;
  }
}

function writePersistedModelOverride(model: AllowedModel): void {
  const payload = {
    model,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(MODEL_OVERRIDE_PATH, JSON.stringify(payload, null, 2));
}

async function applyGlobalModelSetting(
  model: AllowedModel,
  options?: { persist?: boolean }
): Promise<void> {
  const persist = options?.persist !== false;
  const config = readGatewayConfig();
  applyModelToConfig(config, model);
  writeGatewayConfig(config);
  if (persist) {
    writePersistedModelOverride(model);
  }
  await signalConfigReload();
}

async function restorePersistedModelSetting(): Promise<AllowedModel | null> {
  const persistedModel = readPersistedModelOverride();
  if (!persistedModel) return null;
  await applyGlobalModelSetting(persistedModel, { persist: false });
  return persistedModel;
}

function listConfiguredAgentIds(): string[] {
  try {
    const config = readGatewayConfig();
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

function recordAutoplayFeedback(params: {
  agentId: string;
  startedAt: Date;
  status: AutoplayFeedbackStatus;
  summary: string;
  details?: string;
  errorCode?: string;
}): void {
  const finishedAt = new Date();
  const entry = makeFeedbackEntry({
    agentId: params.agentId,
    startedAt: params.startedAt,
    finishedAt,
    status: params.status,
    summary: params.summary,
    details: params.details,
    errorCode: params.errorCode,
  });
  appendAutoplayFeedback(params.agentId, entry);
  setAutoplayAgentState(params.agentId, {
    last_tick_started_at: params.startedAt.toISOString(),
    last_tick_finished_at: finishedAt.toISOString(),
    last_tick_result: params.status,
    last_tick_error_code: params.errorCode || null,
  });
}

async function runAutoplayForAgent(agentId: string, options: RunAutoplayOptions = {}): Promise<RunAutoplayResult> {
  const startedAt = new Date();
  if (!autoplayPrompt) {
    refreshAutoplayPrompt('lazy-init');
  }
  setAutoplayAgentState(agentId, {
    last_tick_started_at: startedAt.toISOString(),
  });

  if (!getAgentAutoplaySetting(agentId)) {
    const result: RunAutoplayResult = {
      success: false,
      status: 'skipped_disabled',
      summary: 'Auto-mode is disabled for this agent.',
      details: 'disabled',
      errorCode: 'disabled',
    };

    if (options.recordDisabledFeedback || options.manual) {
      recordAutoplayFeedback({
        agentId,
        startedAt,
        status: result.status,
        summary: result.summary,
        details: result.details,
        errorCode: result.errorCode,
      });
    }

    return result;
  }

  if (autoplayInFlight.has(agentId)) {
    const result: RunAutoplayResult = {
      success: false,
      status: 'busy',
      summary: 'Tick skipped because the agent is already processing another tick.',
      details: 'busy',
      errorCode: 'busy',
    };

    if (options.manual) {
      recordAutoplayFeedback({
        agentId,
        startedAt,
        status: result.status,
        summary: result.summary,
        details: result.details,
        errorCode: result.errorCode,
      });
    }

    return result;
  }

  autoplayInFlight.add(agentId);
  try {
    const response = await proxyGatewayChat({
      agentId,
      messages: [{ role: 'user', content: autoplayPrompt }],
      timeoutMs: AUTOPLAY_TIMEOUT_MS,
      retries: 1,
    });

    if (!response.ok) {
      const detail = await safeResponseText(response);
      const errorCode = normalizeAutoplayErrorCode(detail, response.status);
      const summary = errorCode === 'gateway_timeout'
        ? 'Auto-mode tick failed due to gateway timeout.'
        : `Gateway error (HTTP ${response.status}).`;
      const details = detail ? `HTTP ${response.status}: ${detail}` : `HTTP ${response.status}`;
      recordAutoplayFeedback({
        agentId,
        startedAt,
        status: 'failed',
        summary,
        details,
        errorCode,
      });
      return { success: false, status: 'failed', summary, details, errorCode };
    }

    const rawText = await safeResponseText(response);
    let finishReason = 'unknown';
    let assistantText = '';

    if (rawText) {
      try {
        const parsed = JSON.parse(rawText) as { choices?: ParsedGatewayChoice[] };
        const firstChoice = parsed.choices?.[0];
        finishReason = firstChoice?.finish_reason || finishReason;
        assistantText = extractAssistantText(firstChoice?.message?.content);
      } catch {
        assistantText = rawText;
      }
    }

    const summary = assistantText
      ? summarizeAssistantOutput(assistantText)
      : `Auto-mode tick completed (finish_reason=${finishReason}).`;
    const details = `finish_reason=${finishReason}`;

    recordAutoplayFeedback({
      agentId,
      startedAt,
      status: 'success',
      summary,
      details,
    });

    return { success: true, status: 'success', summary, details };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    if (isGatewayTimeoutMessage(details)) {
      const summary = 'Auto-mode tick timed out; outcome is uncertain. Deferring one interval.';
      const errorCode = 'uncertain_timeout_deferred';
      autoplayDeferredUntilPass.set(agentId, autoplayPassCounter + 1);
      recordAutoplayFeedback({
        agentId,
        startedAt,
        status: 'uncertain_timeout_deferred',
        summary,
        details,
        errorCode,
      });

      return {
        success: false,
        status: 'uncertain_timeout_deferred',
        summary,
        details,
        errorCode,
      };
    }

    const errorCode = normalizeAutoplayErrorCode(details);
    const summary = 'Auto-mode tick failed.';
    recordAutoplayFeedback({
      agentId,
      startedAt,
      status: 'failed',
      summary,
      details,
      errorCode,
    });

    return {
      success: false,
      status: 'failed',
      summary,
      details,
      errorCode,
    };
  } finally {
    autoplayInFlight.delete(agentId);
  }
}

async function runAutoplayTick(trigger: 'warm' | 'interval' | 'manual' = 'interval'): Promise<RunAutoplayTickResult> {
  const pass = ++autoplayPassCounter;
  autoplayLastTickStartedAt = new Date().toISOString();
  autoplayLastTickResult = null;
  autoplayLastTickErrorCode = null;

  const allConfigured = listConfiguredAgentIds();
  const reasonCounts: Record<string, number> = {};
  const failureReasonCounts: Record<string, number> = {};

  if (allConfigured.length === 0) {
    addReasonCount(reasonCounts, 'no_configured_agents');
    autoplayLastTickFinishedAt = new Date().toISOString();
    autoplayLastTickResult = 'idle';
    console.log(`[autoplay] Tick(${trigger}) pass=${pass} attempted=0 succeeded=0 failed=0 skipped=0 reasons=no_configured_agents:1`);
    return { attempted: 0, succeeded: 0, failed: 0, skipped: 0, agents: [], reason_counts: reasonCounts, pass };
  }

  const enabledConfigured = allConfigured.filter((agentId) => getAgentAutoplaySetting(agentId));
  if (enabledConfigured.length === 0) {
    addReasonCount(reasonCounts, 'all_agents_disabled');
    autoplayLastTickFinishedAt = new Date().toISOString();
    autoplayLastTickResult = 'idle';
    console.log(`[autoplay] Tick(${trigger}) pass=${pass} attempted=0 succeeded=0 failed=0 skipped=0 reasons=all_agents_disabled:1`);
    return { attempted: 0, succeeded: 0, failed: 0, skipped: 0, agents: [], reason_counts: reasonCounts, pass };
  }

  const agents = getAutoplayBatch(enabledConfigured);

  if (agents.length === 0) {
    addReasonCount(reasonCounts, 'empty_batch');
    autoplayLastTickFinishedAt = new Date().toISOString();
    autoplayLastTickResult = 'idle';
    console.log(`[autoplay] Tick(${trigger}) pass=${pass} attempted=0 succeeded=0 failed=0 skipped=0 reasons=empty_batch:1`);
    return { attempted: 0, succeeded: 0, failed: 0, skipped: 0, agents: [], reason_counts: reasonCounts, pass };
  }

  const queue = [...agents];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  const workers = Array.from({ length: Math.min(AUTOPLAY_MAX_PARALLEL, queue.length) }, async () => {
    while (queue.length > 0) {
      const agentId = queue.shift();
      if (!agentId) break;

      const deferredPass = autoplayDeferredUntilPass.get(agentId);
      if (Number.isFinite(deferredPass)) {
        if ((deferredPass as number) < pass) {
          autoplayDeferredUntilPass.delete(agentId);
        } else if ((deferredPass as number) === pass) {
          autoplayDeferredUntilPass.delete(agentId);
          skipped++;
          addReasonCount(reasonCounts, 'deferred_once');
          continue;
        }
      }

      const result = await runAutoplayForAgent(agentId);
      if (result.status === 'success') {
        succeeded++;
      } else if (result.status === 'busy' || result.status === 'skipped_disabled') {
        skipped++;
        addReasonCount(reasonCounts, result.errorCode || result.status);
      } else if (result.status === 'uncertain_timeout_deferred') {
        failed++;
        const reason = result.errorCode || result.status;
        addReasonCount(reasonCounts, reason);
        addReasonCount(failureReasonCounts, reason);
        console.warn(`[autoplay] ${agentId} uncertain timeout: ${result.details}`);
      } else {
        failed++;
        const errorCode = result.errorCode || 'failed';
        addReasonCount(reasonCounts, errorCode);
        addReasonCount(failureReasonCounts, errorCode);
        console.warn(`[autoplay] ${agentId} failed (${errorCode}): ${result.details}`);
      }
    }
  });

  await Promise.all(workers);

  autoplayLastTickFinishedAt = new Date().toISOString();
  autoplayLastTickResult = failed > 0 ? 'failed' : succeeded > 0 ? 'success' : 'skipped';
  autoplayLastTickErrorCode = failed > 0
    ? (Object.entries(failureReasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'failed')
    : null;

  const result: RunAutoplayTickResult = {
    attempted: agents.length,
    succeeded,
    failed,
    skipped,
    agents,
    reason_counts: reasonCounts,
    pass,
  };

  const reasons = Object.entries(reasonCounts)
    .map(([reason, count]) => `${reason}:${count}`)
    .join(', ') || 'none';
  console.log(
    `[autoplay] Tick(${trigger}) pass=${pass} attempted=${result.attempted} succeeded=${result.succeeded} failed=${result.failed} skipped=${result.skipped} reasons=${reasons}`
  );
  return result;
}

async function startAutoplayLoop(): Promise<void> {
  if (!AUTOPLAY_ENABLED) {
    console.log('[autoplay] Disabled');
    return;
  }

  refreshAutoplayPrompt('startup');
  autoplaySnapshotTimer = setInterval(() => {
    refreshAutoplayPrompt('scheduled');
  }, AUTOPLAY_SNAPSHOT_REFRESH_MS);

  console.log(
    `[autoplay] Enabled interval=${AUTOPLAY_INTERVAL_MS}ms timeout=${AUTOPLAY_TIMEOUT_MS}ms max_parallel=${AUTOPLAY_MAX_PARALLEL} max_agents_per_tick=${AUTOPLAY_MAX_AGENTS_PER_TICK}`
  );

  // Warm start shortly after boot so freshly deployed agents can act quickly.
  autoplayNextTickAtMs = Date.now() + AUTOPLAY_WARM_START_DELAY_MS;
  autoplayWarmTimer = setTimeout(() => {
    autoplayNextTickAtMs = Date.now() + AUTOPLAY_INTERVAL_MS;
    void runAutoplayTick('warm').catch((error) => {
      console.warn('[autoplay] Warm tick failed:', error);
    });
  }, AUTOPLAY_WARM_START_DELAY_MS);

  autoplayTimer = setInterval(() => {
    autoplayNextTickAtMs = Date.now() + AUTOPLAY_INTERVAL_MS;
    void runAutoplayTick('interval').catch((error) => {
        console.warn('[autoplay] Tick failed:', error);
      });
  }, AUTOPLAY_INTERVAL_MS);
}

function stopAutoplayLoop(): void {
  if (autoplayWarmTimer) {
    clearTimeout(autoplayWarmTimer);
    autoplayWarmTimer = null;
  }
  if (autoplayTimer) {
    clearInterval(autoplayTimer);
    autoplayTimer = null;
  }
  if (autoplaySnapshotTimer) {
    clearInterval(autoplaySnapshotTimer);
    autoplaySnapshotTimer = null;
  }
  autoplayNextTickAtMs = null;
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
  const config = readGatewayConfig();

  if (!config.agents) config.agents = {};
  if (!config.agents.list) config.agents.list = [];

  // Remove existing entry if present
  config.agents.list = config.agents.list.filter((a) => a.id !== agentId);

  // Add new agent (only use keys OpenClaw recognizes)
  const agentEntry: Record<string, unknown> = {
    id: agentId,
    workspace: path.join(agentDir, 'workspace'),
  };

  if (model) {
    agentEntry.model = { primary: model };
  }

  config.agents.list.push(agentEntry);

  writeGatewayConfig(config);

  // Signal gateway to reload config
  await signalConfigReload();
}

async function removeAgentFromConfig(agentId: string): Promise<void> {
  const config = readGatewayConfig();

  if (config.agents?.list) {
    config.agents.list = config.agents.list.filter((a) => a.id !== agentId);
  }

  writeGatewayConfig(config);
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
  void restorePersistedModelSetting()
    .then((restoredModel) => {
      if (restoredModel) {
        console.log(`[settings] Restored persisted model override: ${restoredModel}`);
      }
    })
    .catch((error) => {
      console.warn('[settings] Failed restoring persisted model override:', error);
    })
    .finally(() => {
      void startAutoplayLoop();
    });
});

process.on('SIGTERM', stopAutoplayLoop);
process.on('SIGINT', stopAutoplayLoop);
