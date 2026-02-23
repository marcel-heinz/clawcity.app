import express from 'express';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
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
const CLAWCITY_API_URL = (process.env.CLAWCITY_API_URL || process.env.APP_BASE_URL || 'https://www.clawcity.app').replace(/\/+$/, '');
const INTERNAL_API_TOKEN =
  process.env.OPENCLAW_INTERNAL_API_TOKEN ||
  process.env.OPENCLAW_PROVISION_TOKEN ||
  process.env.PROVISION_AUTH_TOKEN ||
  '';

// Shared skill source directory (SKILL.md format, auto-discovered by OpenClaw)
const SKILL_SOURCE_DIR = path.join(OPENCLAW_HOME, 'workspace', 'skills', 'clawcity');

const CHAT_TIMEOUT_MS = intEnv('OPENCLAW_CHAT_TIMEOUT_MS', 240_000);
const CHAT_RETRIES = intEnv('OPENCLAW_CHAT_RETRIES', 2);
const CHAT_RETRY_DELAY_MS = intEnv('OPENCLAW_CHAT_RETRY_DELAY_MS', 1_500);
const GATEWAY_HEALTH_TIMEOUT_MS = intEnv('OPENCLAW_GATEWAY_HEALTH_TIMEOUT_MS', 2_500);
const GATEWAY_HEALTH_CACHE_MS = intEnv('OPENCLAW_GATEWAY_HEALTH_CACHE_MS', 5_000);
const INTERNAL_API_TIMEOUT_MS = intEnv('OPENCLAW_INTERNAL_API_TIMEOUT_MS', 8_000);

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
const AUTOPLAY_EXPECTED_CALLS_PER_TICK = 1.05;
const AUTOPLAY_DISTILL_EVERY_TICKS = intEnv('OPENCLAW_MEMORY_DISTILL_EVERY_TICKS', 100);
const OPENROUTER_PREFIX = 'openrouter/';
const ALLOWED_MODELS = ['z-ai/glm-5', 'minimax/minimax-m2.5'] as const;
const MEMORY_FILE = 'Memory.md';
const MEMORY_DIR = 'memory';
const MEMORY_RECENT_DIR = 'recent';
const MEMORY_STATE_FILE = 'state.json';
const MEMORY_RECENT_EVENTS_FILE = 'events.jsonl';
const MEMORY_MAX_CHARS = 4_000;
const MEMORY_CONTEXT_MAX_CHARS = 700;
const MEMORY_RECENT_MAX_LINES = 300;

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
let gatewayHealthCache: GatewayRuntimeHealth | null = null;
let gatewayHealthCheckedAtMs = 0;

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
  userKey?: string;
  injectMemory?: boolean;
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
  autoplayPacingAccumulator?: number;
  lastAutoplayAttemptAt?: string;
  updatedAt?: string;
}

interface MemoryState {
  ticks_since_distill: number;
  last_distilled_at: string | null;
  memory_version: number;
  memory_digest: string | null;
}

type MemoryOp =
  | { op: 'upsert_fact'; key: string; value: string }
  | { op: 'remove_fact'; key: string }
  | { op: 'request_distill' };

interface InternalBudgetResponse {
  success: boolean;
  config_id: string;
  tier: string;
  interval_ms: number | null;
  call_ceiling: number;
  reserve_calls: number;
  remaining_calls_total: number;
  remaining_calls_autoplay: number;
  scheduled_ticks_remaining: number;
  affordable_ticks_remaining: number;
  run_fraction: number;
  credits_cycle_end: string | null;
  expected_calls_per_autoplay_tick: number;
  llm_calls_used: number;
  autoplay_calls_used: number;
  credits_used: number;
  error?: string;
  details?: string;
}

interface ConsumeCallResponse {
  success: boolean;
  allowed: boolean;
  consumed: boolean;
  reason: string;
  remaining_calls_total: number;
  remaining_calls_autoplay: number;
  call_ceiling: number;
  reserve_calls: number;
  llm_calls_used: number;
  autoplay_calls_used: number;
  credits_used: number;
  credits_remaining: number;
  credits_cycle_end: string | null;
  error?: string;
  details?: string;
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

interface GatewayRuntimeHealth {
  ok: boolean;
  statusCode: number | null;
  checkedAt: string;
  error?: string;
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
app.get('/health', async (_req, res) => {
  const gateway = await checkGatewayHealth(true);
  const configured = listConfiguredAgentIds();
  const payload = {
    status: gateway.ok ? 'ok' : 'degraded',
    agents: listAgentIds(),
    configured_agents: configured,
    gateway: {
      ready: gateway.ok,
      status_code: gateway.statusCode,
      checked_at: gateway.checkedAt,
      error: gateway.error || null,
    },
    autoplay: {
      enabled: AUTOPLAY_ENABLED,
      interval_ms: AUTOPLAY_INTERVAL_MS,
      next_tick_at: autoplayNextTickAtMs ? new Date(autoplayNextTickAtMs).toISOString() : null,
    },
  };
  res.status(gateway.ok ? 200 : 503).json(payload);
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
    ensureMemoryScaffold(agentId);

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
    ensureMemoryScaffold(agentId);

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

app.get('/api/provision/:agentId/memory', (req, res) => {
  try {
    const { agentId } = req.params;
    if (!fs.existsSync(getAgentDir(agentId))) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    ensureMemoryScaffold(agentId);
    const content = readMemoryFile(agentId);
    const state = readMemoryState(agentId);
    res.json({
      success: true,
      agentId,
      content,
      state: withMemoryStateMetadata(agentId, state),
    });
  } catch (error) {
    console.error('[memory] Read error:', error);
    res.status(500).json({ error: 'Failed to read memory' });
  }
});

app.put('/api/provision/:agentId/memory', (req, res) => {
  try {
    const { agentId } = req.params;
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    if (!fs.existsSync(getAgentDir(agentId))) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    if (content.length > MEMORY_MAX_CHARS * 3) {
      res.status(400).json({ error: `Memory content too large (max ${MEMORY_MAX_CHARS * 3} chars)` });
      return;
    }

    ensureMemoryScaffold(agentId);
    const normalized = sanitizeMemoryMarkdown(content);
    const state = writeMemoryFile(agentId, normalized, { bumpVersion: true });
    void syncMemoryTelemetry(agentId, state);

    res.json({
      success: true,
      agentId,
      content: normalized,
      state: withMemoryStateMetadata(agentId, state),
    });
  } catch (error) {
    console.error('[memory] Update error:', error);
    res.status(500).json({ error: 'Failed to update memory' });
  }
});

app.post('/api/provision/:agentId/memory/distill', async (req, res) => {
  try {
    const { agentId } = req.params;
    if (!fs.existsSync(getAgentDir(agentId))) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const distilled = await distillMemoryForAgent(agentId, 'manual');
    if (!distilled.success) {
      res.status(distilled.statusCode || 500).json({
        success: false,
        error: distilled.error || 'Failed to distill memory',
        details: distilled.details || null,
      });
      return;
    }

    res.json({
      success: true,
      agentId,
      content: distilled.content,
      state: withMemoryStateMetadata(agentId, distilled.state || readMemoryState(agentId)),
    });
  } catch (error) {
    console.error('[memory] Distill error:', error);
    res.status(500).json({ error: 'Failed to distill memory' });
  }
});

app.post('/api/provision/:agentId/memory/op', async (req, res) => {
  try {
    const { agentId } = req.params;
    if (!fs.existsSync(getAgentDir(agentId))) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const validatedOp = validateMemoryOpPayload(req.body);
    if (!validatedOp.valid) {
      res.status(400).json({
        success: false,
        error: 'Invalid memory op payload',
        details: validatedOp.error,
      });
      return;
    }

    const applied = await applyMemoryOp(agentId, validatedOp.op);
    if (!applied.success) {
      res.status(applied.statusCode || 400).json({
        success: false,
        error: applied.error || 'Failed to apply memory op',
        details: applied.details || null,
      });
      return;
    }

    res.json({
      success: true,
      agentId,
      content: applied.content,
      state: withMemoryStateMetadata(agentId, applied.state || readMemoryState(agentId)),
      operation: applied.operation,
    });
  } catch (error) {
    console.error('[memory] Op error:', error);
    res.status(500).json({ error: 'Failed to apply memory op' });
  }
});

app.post('/api/provision/:agentId/memory/reset', (req, res) => {
  try {
    const { agentId } = req.params;
    const mode = req.body?.mode === 'hard' ? 'hard' : 'soft';
    if (!fs.existsSync(getAgentDir(agentId))) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    resetAgentMemory(agentId, mode);
    const content = readMemoryFile(agentId);
    const state = readMemoryState(agentId);
    res.json({
      success: true,
      agentId,
      mode,
      content,
      state: withMemoryStateMetadata(agentId, state),
    });
  } catch (error) {
    console.error('[memory] Reset error:', error);
    res.status(500).json({ error: 'Failed to reset memory' });
  }
});

// Deprovision an agent (stop but keep data)
app.delete('/api/provision/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    const inFlightAtStop = autoplayInFlight.has(agentId);

    // Stop future ticks immediately; in-flight work is allowed to complete.
    setAgentAutoplaySetting(agentId, false);
    clearAutoplayTransientState(agentId);

    const removedFromConfig = await removeAgentFromConfig(agentId);
    const verifiedNotConfigured = !listConfiguredAgentIds().includes(agentId);

    if (!verifiedNotConfigured) {
      const message = inFlightAtStop
        ? 'Stop requested; in-flight tick will finish, but runtime removal verification failed.'
        : 'Stop requested, but runtime removal verification failed.';
      console.error(`[provision] Deprovision verification failed for ${agentId}`);
      res.status(500).json({
        success: false,
        agentId,
        autoplay_disabled: true,
        removed_from_config: removedFromConfig,
        in_flight_at_stop: inFlightAtStop,
        verified_not_configured: false,
        message,
      });
      return;
    }

    const message = inFlightAtStop
      ? 'Stop accepted. Current in-flight tick will finish; no future ticks will run.'
      : (removedFromConfig ? 'Agent stopped and removed from runtime config.' : 'Agent already stopped.');
    console.log(`[provision] Agent ${agentId} deprovisioned (removed=${removedFromConfig}, in_flight=${inFlightAtStop})`);
    res.json({
      success: true,
      agentId,
      autoplay_disabled: true,
      removed_from_config: removedFromConfig,
      in_flight_at_stop: inFlightAtStop,
      verified_not_configured: true,
      message,
    });
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

    const gateway = await checkGatewayHealth();
    if (!gateway.ok) {
      res.status(503).json({
        error: 'OpenClaw gateway unavailable',
        details: gateway.error || 'gateway_unreachable',
        gateway_status: gateway.statusCode,
      });
      return;
    }

    let callBudget: ConsumeCallResponse;
    try {
      callBudget = await consumeCallBudget(
        agentId,
        'manual',
        `manual-chat:${agentId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
      );
    } catch (error) {
      res.status(502).json({
        error: 'Billing service unavailable',
        details: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (!callBudget.allowed) {
      res.status(402).json({
        error: 'Call budget exhausted',
        details: callBudget.reason,
      });
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
      if (response.status === 401 || response.status === 403) {
        res.status(502).json({
          error: 'Gateway authentication failed',
          details: 'Check OPENCLAW_GATEWAY_TOKEN wiring on Railway.',
        });
        return;
      }
      res.status(response.status).json({
        error: 'Gateway error',
        details: errorText,
      });
      return;
    }

    const data = await response.json() as { choices?: ParsedGatewayChoice[] };
    const assistantText = extractAssistantText(data?.choices?.[0]?.message?.content);
    if (assistantText) {
      appendRecentMemoryEvent(agentId, {
        source: 'chat',
        summary: summarizeAssistantOutput(assistantText),
      });

      const memoryOps = extractMemoryOpsFromText(assistantText);
      for (const op of memoryOps) {
        await applyMemoryOp(agentId, op);
      }
    }
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

    const gateway = await checkGatewayHealth();
    if (!gateway.ok) {
      res.status(503).json({
        error: 'OpenClaw gateway unavailable',
        details: gateway.error || 'gateway_unreachable',
        gateway_status: gateway.statusCode,
      });
      return;
    }

    let callBudget: ConsumeCallResponse;
    try {
      callBudget = await consumeCallBudget(
        agentId,
        'manual',
        `manual-stream:${agentId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
      );
    } catch (error) {
      res.status(502).json({
        error: 'Billing service unavailable',
        details: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (!callBudget.allowed) {
      res.status(402).json({
        error: 'Call budget exhausted',
        details: callBudget.reason,
      });
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
      if (response.status === 401 || response.status === 403) {
        res.status(502).json({
          error: 'Gateway authentication failed',
          details: 'Check OPENCLAW_GATEWAY_TOKEN wiring on Railway.',
        });
        return;
      }
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

app.get('/api/autoplay/status', async (_req, res) => {
  try {
    const gateway = await checkGatewayHealth();
    const configuredAgents = listConfiguredAgentIds();
    const agentStatus = await Promise.all(configuredAgents.map(async (agentId) => {
      const lastTick = readAutoplayFeedback(agentId, 1)[0] || null;
      const runtime = getAutoplayAgentState(agentId);
      const deferUntilPass = autoplayDeferredUntilPass.get(agentId);
      const deferredOnce = Number.isFinite(deferUntilPass) && (deferUntilPass as number) > autoplayPassCounter;
      const memoryState = withMemoryStateMetadata(agentId, readMemoryState(agentId));
      const budget = await getAutoplayBudget(agentId);

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
        memory: {
          last_distilled_at: memoryState.last_distilled_at,
          ticks_since_distill: memoryState.ticks_since_distill,
          memory_version: memoryState.memory_version,
          memory_bytes: memoryState.memory_bytes,
        },
        budget: budget
          ? {
              tier: budget.tier || null,
              interval_ms: budget.interval_ms,
              call_ceiling: budget.call_ceiling,
              reserve_calls: budget.reserve_calls,
              remaining_calls_total: budget.remaining_calls_total,
              remaining_calls_autoplay: budget.remaining_calls_autoplay,
              scheduled_ticks_remaining: budget.scheduled_ticks_remaining,
              affordable_ticks_remaining: budget.affordable_ticks_remaining,
              run_fraction: budget.run_fraction,
            }
          : null,
      };
    }));

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
      gateway: {
        ready: gateway.ok,
        status_code: gateway.statusCode,
        checked_at: gateway.checkedAt,
        error: gateway.error || null,
      },
      agents: agentStatus,
    });
  } catch (error) {
    console.error('[autoplay] status error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch autoplay status' });
  }
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
  if (lowered.includes('gateway_unavailable') || lowered.includes('gateway unavailable')) {
    return 'gateway_unavailable';
  }
  if (isGatewayTimeoutMessage(details) || statusCode === 408 || statusCode === 504) {
    return 'gateway_timeout';
  }
  if (statusCode === 401 || statusCode === 403) {
    return 'gateway_auth';
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

function extractMemoryOpsFromText(text: string): MemoryOp[] {
  if (!text) return [];
  const ops: MemoryOp[] = [];
  const regex = /\[\[MEMORY_OP:(\{[\s\S]*?\})\]\]/g;
  let match: RegExpExecArray | null = regex.exec(text);
  while (match) {
    const raw = match[1];
    try {
      const parsed = JSON.parse(raw) as unknown;
      const validated = validateMemoryOpPayload(parsed);
      if (validated.valid) {
        ops.push(validated.op);
      }
    } catch {
      // ignore malformed op payloads
    }
    match = regex.exec(text);
  }
  return ops;
}

function validateMemoryOpPayload(input: unknown): { valid: true; op: MemoryOp } | { valid: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, error: 'Memory op payload must be an object' };
  }

  const payload = input as Record<string, unknown>;
  const op = typeof payload.op === 'string' ? payload.op : '';
  const keys = Object.keys(payload);

  if (op === 'request_distill') {
    if (keys.some((key) => key !== 'op')) {
      return { valid: false, error: 'request_distill accepts only { op }' };
    }
    return { valid: true, op: { op: 'request_distill' } };
  }

  if (op === 'remove_fact') {
    if (keys.some((key) => key !== 'op' && key !== 'key')) {
      return { valid: false, error: 'remove_fact accepts only { op, key }' };
    }
    if (typeof payload.key !== 'string' || !payload.key.trim()) {
      return { valid: false, error: 'remove_fact requires a non-empty string key' };
    }
    return { valid: true, op: { op: 'remove_fact', key: payload.key } };
  }

  if (op === 'upsert_fact') {
    if (keys.some((key) => key !== 'op' && key !== 'key' && key !== 'value')) {
      return { valid: false, error: 'upsert_fact accepts only { op, key, value }' };
    }
    if (typeof payload.key !== 'string' || !payload.key.trim()) {
      return { valid: false, error: 'upsert_fact requires a non-empty string key' };
    }
    if (typeof payload.value !== 'string' || !payload.value.trim()) {
      return { valid: false, error: 'upsert_fact requires a non-empty string value' };
    }
    return {
      valid: true,
      op: {
        op: 'upsert_fact',
        key: payload.key,
        value: payload.value,
      },
    };
  }

  return { valid: false, error: 'Unsupported memory op' };
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
    { title: 'clawcity oracle --help', args: ['oracle', '--help'] },
    { title: 'clawcity move --help', args: ['move', '--help'] },
    { title: 'clawcity move-to --help', args: ['move-to', '--help'] },
    { title: 'clawcity step --help', args: ['step', '--help'] },
    { title: 'clawcity stats --help', args: ['stats', '--help'] },
    { title: 'clawcity look --help', args: ['look', '--help'] },
    { title: 'clawcity status --help', args: ['status', '--help'] },
    { title: 'clawcity gather --help', args: ['gather', '--help'] },
    { title: 'clawcity buy --help', args: ['buy', '--help'] },
    { title: 'clawcity craft --help', args: ['craft', '--help'] },
    { title: 'clawcity market --help', args: ['market', '--help'] },
    { title: 'clawcity market fill --help', args: ['market', 'fill', '--help'] },
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
    '- If intent is unclear, run `clawcity oracle` and follow the highest-priority pending outcome.',
    '- Use only valid CLI command forms from snapshot.',
    '- Allowed movement commands: `clawcity move <terrain|x,y>`, `clawcity move-to <terrain|x,y>`, `clawcity step <north|south|east|west>`.',
    '- Allowed stats commands: `clawcity stats`, `clawcity look`, `clawcity status`, `clawcity summary`.',
    '- Allowed economy commands: `clawcity buy rations -q <N>`, `clawcity craft <item>`, `clawcity market list`, `clawcity market fill ... --preview`.',
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

function getWorkspaceDir(agentId: string): string {
  return path.join(getAgentDir(agentId), 'workspace');
}

function getMemoryDir(agentId: string): string {
  return path.join(getWorkspaceDir(agentId), MEMORY_DIR);
}

function getMemoryRecentDir(agentId: string): string {
  return path.join(getMemoryDir(agentId), MEMORY_RECENT_DIR);
}

function getMemoryStatePath(agentId: string): string {
  return path.join(getMemoryDir(agentId), MEMORY_STATE_FILE);
}

function getMemoryRecentEventsPath(agentId: string): string {
  return path.join(getMemoryRecentDir(agentId), MEMORY_RECENT_EVENTS_FILE);
}

function getLegacyMemoryRecentEventsPath(agentId: string): string {
  return path.join(getMemoryDir(agentId), MEMORY_RECENT_EVENTS_FILE);
}

function getMemoryPath(agentId: string): string {
  return path.join(getWorkspaceDir(agentId), MEMORY_FILE);
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

function writeAgentSettings(agentId: string, patch: Partial<AgentSettings>): AgentSettings {
  const agentDir = getAgentDir(agentId);
  fs.mkdirSync(agentDir, { recursive: true });
  const settingsPath = getAgentSettingsPath(agentId);
  const current = parseAgentSettings(agentId);
  const payload: AgentSettings = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(settingsPath, JSON.stringify(payload, null, 2));
  return payload;
}

function setAgentAutoplaySetting(agentId: string, enabled: boolean): void {
  writeAgentSettings(agentId, {
    autoplayEnabled: enabled,
  });
}

function clearAutoplayTransientState(agentId: string): void {
  autoplayDeferredUntilPass.delete(agentId);
  autoplayAgentState.delete(agentId);
}

function defaultMemoryMarkdown(agentId: string): string {
  return [
    '# Memory',
    '',
    '## Active Context',
    '- Keep food >= 50 when possible.',
    '- Prefer concise, high-signal actions.',
    '',
    '## Durable Facts',
    '- home_terrain: unknown',
    '',
    '## Recent Signals',
    '- none',
    '',
    '## Constraints',
    '- Maximize progress without risky loops.',
    `- Agent ID: ${agentId}`,
    '',
  ].join('\n');
}

function defaultMemoryState(): MemoryState {
  return {
    ticks_since_distill: 0,
    last_distilled_at: null,
    memory_version: 1,
    memory_digest: null,
  };
}

function sanitizeMemoryMarkdown(content: string): string {
  const trimmed = content.replace(/\r\n/g, '\n').trim();
  if (!trimmed) {
    return [
      '# Memory',
      '',
      '## Active Context',
      '- none',
      '',
      '## Durable Facts',
      '- none',
      '',
      '## Recent Signals',
      '- none',
      '',
      '## Constraints',
      '- none',
      '',
    ].join('\n');
  }
  if (trimmed.length <= MEMORY_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, MEMORY_MAX_CHARS - 1)}…`;
}

function computeMemoryDigest(content: string): string {
  return createHash('sha1').update(content, 'utf-8').digest('hex');
}

function readMemoryState(agentId: string): MemoryState {
  const statePath = getMemoryStatePath(agentId);
  if (!fs.existsSync(statePath)) return defaultMemoryState();
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as Partial<MemoryState>;
    return {
      ticks_since_distill: Number.isFinite(parsed.ticks_since_distill) ? Math.max(0, Math.floor(parsed.ticks_since_distill || 0)) : 0,
      last_distilled_at: parsed.last_distilled_at || null,
      memory_version: Number.isFinite(parsed.memory_version) ? Math.max(1, Math.floor(parsed.memory_version || 1)) : 1,
      memory_digest: parsed.memory_digest || null,
    };
  } catch {
    return defaultMemoryState();
  }
}

function writeMemoryState(agentId: string, patch: Partial<MemoryState>): MemoryState {
  const memoryDir = getMemoryDir(agentId);
  fs.mkdirSync(memoryDir, { recursive: true });
  const next: MemoryState = {
    ...readMemoryState(agentId),
    ...patch,
  };
  fs.writeFileSync(getMemoryStatePath(agentId), JSON.stringify(next, null, 2));
  return next;
}

function readMemoryFile(agentId: string): string {
  const memoryPath = getMemoryPath(agentId);
  if (!fs.existsSync(memoryPath)) return defaultMemoryMarkdown(agentId);
  return fs.readFileSync(memoryPath, 'utf-8');
}

function writeMemoryFile(
  agentId: string,
  content: string,
  options?: { bumpVersion?: boolean; resetTicks?: boolean; lastDistilledAt?: string | null }
): MemoryState {
  const workspaceDir = getWorkspaceDir(agentId);
  fs.mkdirSync(workspaceDir, { recursive: true });
  const normalized = sanitizeMemoryMarkdown(content);
  fs.writeFileSync(getMemoryPath(agentId), `${normalized}\n`);
  const current = readMemoryState(agentId);
  const digest = computeMemoryDigest(normalized);
  return writeMemoryState(agentId, {
    memory_digest: digest,
    memory_version: options?.bumpVersion ? current.memory_version + 1 : current.memory_version,
    ticks_since_distill: options?.resetTicks ? 0 : current.ticks_since_distill,
    last_distilled_at: options?.lastDistilledAt !== undefined ? options.lastDistilledAt : current.last_distilled_at,
  });
}

function withMemoryStateMetadata(agentId: string, state: MemoryState): MemoryState & { memory_bytes: number } {
  const memoryPath = getMemoryPath(agentId);
  const bytes = fs.existsSync(memoryPath) ? fs.statSync(memoryPath).size : 0;
  return {
    ...state,
    memory_bytes: bytes,
  };
}

function ensureMemoryScaffold(agentId: string): void {
  const workspaceDir = getWorkspaceDir(agentId);
  const memoryDir = getMemoryDir(agentId);
  const memoryRecentDir = getMemoryRecentDir(agentId);
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.mkdirSync(memoryRecentDir, { recursive: true });

  if (!fs.existsSync(getMemoryPath(agentId))) {
    const base = defaultMemoryMarkdown(agentId);
    fs.writeFileSync(getMemoryPath(agentId), `${base}\n`);
    const digest = computeMemoryDigest(base);
    writeMemoryState(agentId, {
      ticks_since_distill: 0,
      last_distilled_at: null,
      memory_version: 1,
      memory_digest: digest,
    });
  } else if (!fs.existsSync(getMemoryStatePath(agentId))) {
    writeMemoryState(agentId, defaultMemoryState());
  }

  const recentPath = getMemoryRecentEventsPath(agentId);
  const legacyRecentPath = getLegacyMemoryRecentEventsPath(agentId);
  if (!fs.existsSync(recentPath) && fs.existsSync(legacyRecentPath)) {
    fs.renameSync(legacyRecentPath, recentPath);
  }

  if (!fs.existsSync(getMemoryRecentEventsPath(agentId))) {
    fs.writeFileSync(getMemoryRecentEventsPath(agentId), '');
  }
}

function memoryContextSnippet(agentId: string): string {
  ensureMemoryScaffold(agentId);
  const content = readMemoryFile(agentId);
  const compact = content
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join('\n');
  if (!compact) return '';
  if (compact.length <= MEMORY_CONTEXT_MAX_CHARS) return compact;
  return `${compact.slice(0, MEMORY_CONTEXT_MAX_CHARS - 1)}…`;
}

function appendRecentMemoryEvent(agentId: string, event: {
  source: 'autoplay' | 'chat' | 'memory';
  summary: string;
  details?: string;
}): void {
  ensureMemoryScaffold(agentId);
  const payload = {
    at: new Date().toISOString(),
    source: event.source,
    summary: truncate(event.summary, 220),
    details: event.details ? truncate(event.details, 300) : undefined,
  };
  const eventsPath = getMemoryRecentEventsPath(agentId);
  fs.appendFileSync(eventsPath, `${JSON.stringify(payload)}\n`);

  const raw = fs.readFileSync(eventsPath, 'utf-8');
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > MEMORY_RECENT_MAX_LINES) {
    const kept = lines.slice(lines.length - MEMORY_RECENT_MAX_LINES).join('\n');
    fs.writeFileSync(eventsPath, `${kept}\n`);
  }
}

function readRecentMemoryEvents(agentId: string, limit = 60): Array<{ at: string; source: string; summary: string; details?: string }> {
  ensureMemoryScaffold(agentId);
  const eventsPath = getMemoryRecentEventsPath(agentId);
  const raw = fs.readFileSync(eventsPath, 'utf-8');
  const parsed: Array<{ at: string; source: string; summary: string; details?: string }> = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const item = JSON.parse(trimmed) as { at?: string; source?: string; summary?: string; details?: string };
      if (!item || typeof item.summary !== 'string' || typeof item.source !== 'string') continue;
      parsed.push({
        at: item.at || new Date().toISOString(),
        source: item.source,
        summary: item.summary,
        details: item.details,
      });
    } catch {
      // ignore invalid lines
    }
  }
  return parsed.slice(Math.max(0, parsed.length - Math.max(1, limit)));
}

function parseDurableFacts(memory: string): Map<string, string> {
  const lines = memory.split('\n');
  const facts = new Map<string, string>();
  let inFacts = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^##\s+/i.test(trimmed)) {
      inFacts = /^##\s+Durable Facts$/i.test(trimmed);
      continue;
    }
    if (!inFacts) continue;
    const match = trimmed.match(/^-\s*([^:]+):\s*(.+)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    if (key && value) facts.set(key, value);
  }
  return facts;
}

function setDurableFacts(memory: string, nextFacts: Map<string, string>): string {
  const lines = memory.split('\n');
  const out: string[] = [];
  let i = 0;
  let sectionWritten = false;

  while (i < lines.length) {
    const line = lines[i];
    if (/^##\s+Durable Facts$/i.test(line.trim())) {
      out.push('## Durable Facts');
      if (nextFacts.size === 0) {
        out.push('- none');
      } else {
        Array.from(nextFacts.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .forEach(([key, value]) => out.push(`- ${key}: ${value}`));
      }
      sectionWritten = true;
      i += 1;
      while (i < lines.length && !/^##\s+/i.test(lines[i].trim())) {
        i += 1;
      }
      continue;
    }
    out.push(line);
    i += 1;
  }

  if (!sectionWritten) {
    if (out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
    out.push('## Durable Facts');
    if (nextFacts.size === 0) {
      out.push('- none');
    } else {
      Array.from(nextFacts.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([key, value]) => out.push(`- ${key}: ${value}`));
    }
  }

  return out.join('\n').trim();
}

async function applyMemoryOp(agentId: string, op: MemoryOp): Promise<{
  success: boolean;
  statusCode?: number;
  error?: string;
  details?: string;
  content?: string;
  state?: MemoryState;
  operation?: string;
}> {
  ensureMemoryScaffold(agentId);
  const operation = op.op;
  if (operation === 'request_distill') {
    const distilled = await distillMemoryForAgent(agentId, 'requested');
    if (!distilled.success) {
      return {
        success: false,
        statusCode: distilled.statusCode || 500,
        error: distilled.error,
        details: distilled.details,
      };
    }
    return {
      success: true,
      content: distilled.content,
      state: distilled.state,
      operation,
    };
  }

  if (operation === 'upsert_fact') {
    const key = typeof op.key === 'string' ? truncate(op.key, 80) : '';
    const value = typeof op.value === 'string' ? truncate(op.value, 180) : '';
    if (!key || !value) {
      return { success: false, statusCode: 400, error: 'upsert_fact requires non-empty key and value' };
    }
    const current = readMemoryFile(agentId);
    const facts = parseDurableFacts(current);
    facts.set(key, value);
    const next = setDurableFacts(current, facts);
    const state = writeMemoryFile(agentId, next, { bumpVersion: true });
    await syncMemoryTelemetry(agentId, state);
    appendRecentMemoryEvent(agentId, {
      source: 'memory',
      summary: `upsert_fact: ${key}`,
      details: value,
    });
    return { success: true, content: next, state, operation };
  }

  if (operation === 'remove_fact') {
    const key = typeof op.key === 'string' ? truncate(op.key, 80) : '';
    if (!key) {
      return { success: false, statusCode: 400, error: 'remove_fact requires a key' };
    }
    const current = readMemoryFile(agentId);
    const facts = parseDurableFacts(current);
    facts.delete(key);
    const next = setDurableFacts(current, facts);
    const state = writeMemoryFile(agentId, next, { bumpVersion: true });
    await syncMemoryTelemetry(agentId, state);
    appendRecentMemoryEvent(agentId, {
      source: 'memory',
      summary: `remove_fact: ${key}`,
    });
    return { success: true, content: next, state, operation };
  }

  return { success: false, statusCode: 400, error: `Unsupported memory operation: ${operation}` };
}

function resetAgentMemory(agentId: string, mode: 'soft' | 'hard'): void {
  ensureMemoryScaffold(agentId);
  const sessionsDir = path.join(getAgentDir(agentId), 'sessions');
  fs.rmSync(sessionsDir, { recursive: true, force: true });
  fs.mkdirSync(sessionsDir, { recursive: true });

  if (mode === 'hard') {
    const base = defaultMemoryMarkdown(agentId);
    fs.writeFileSync(getMemoryPath(agentId), `${base}\n`);
    writeMemoryState(agentId, {
      ticks_since_distill: 0,
      last_distilled_at: null,
      memory_version: 1,
      memory_digest: computeMemoryDigest(base),
    });
    void syncMemoryTelemetry(agentId, readMemoryState(agentId));
    fs.writeFileSync(getMemoryRecentEventsPath(agentId), '');
    const legacyRecentPath = getLegacyMemoryRecentEventsPath(agentId);
    if (legacyRecentPath !== getMemoryRecentEventsPath(agentId)) {
      fs.rmSync(legacyRecentPath, { force: true });
    }
    return;
  }

  appendRecentMemoryEvent(agentId, {
    source: 'memory',
    summary: 'soft_reset performed',
  });
  void syncMemoryTelemetry(agentId, readMemoryState(agentId));
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

function gatewayAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  return GATEWAY_TOKEN
    ? { Authorization: `Bearer ${GATEWAY_TOKEN}`, ...extraHeaders }
    : { ...extraHeaders };
}

async function checkGatewayHealth(force = false): Promise<GatewayRuntimeHealth> {
  const now = Date.now();
  if (!force && gatewayHealthCache && now - gatewayHealthCheckedAtMs < GATEWAY_HEALTH_CACHE_MS) {
    return gatewayHealthCache;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GATEWAY_HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(`${GATEWAY_URL}/v1/models`, {
      method: 'GET',
      headers: gatewayAuthHeaders(),
      signal: controller.signal,
    });

    // Any non-5xx means the gateway process is reachable (200/401/403/404 all acceptable for health).
    const ok = response.status < 500;
    const next: GatewayRuntimeHealth = {
      ok,
      statusCode: response.status,
      checkedAt: new Date().toISOString(),
      error: ok ? undefined : `gateway_http_${response.status}`,
    };
    gatewayHealthCache = next;
    gatewayHealthCheckedAtMs = now;
    return next;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const next: GatewayRuntimeHealth = {
      ok: false,
      statusCode: null,
      checkedAt: new Date().toISOString(),
      error: isGatewayTimeoutMessage(message) ? 'gateway_health_timeout' : message,
    };
    gatewayHealthCache = next;
    gatewayHealthCheckedAtMs = now;
    return next;
  } finally {
    clearTimeout(timeout);
  }
}

async function internalApiFetch(pathname: string, options: RequestInit = {}): Promise<Response> {
  if (!INTERNAL_API_TOKEN) {
    throw new Error('OPENCLAW_INTERNAL_API_TOKEN is not configured');
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${INTERNAL_API_TOKEN}`,
    ...((options.headers as Record<string, string>) || {}),
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INTERNAL_API_TIMEOUT_MS);
  try {
    return await fetch(`${CLAWCITY_API_URL}${pathname}`, {
      ...options,
      headers,
      signal: options.signal || controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function syncMemoryTelemetry(agentId: string, state: MemoryState): Promise<void> {
  if (!INTERNAL_API_TOKEN) return;
  try {
    await internalApiFetch('/api/internal/autoplay/memory-telemetry', {
      method: 'POST',
      body: JSON.stringify({
        config_id: agentId,
        last_distilled_at: state.last_distilled_at,
        memory_version: state.memory_version,
        memory_digest: state.memory_digest,
      }),
    });
  } catch (error) {
    console.warn('[memory] telemetry sync failed:', error instanceof Error ? error.message : String(error));
  }
}

async function getAutoplayBudget(agentId: string): Promise<InternalBudgetResponse | null> {
  if (!INTERNAL_API_TOKEN) return null;
  try {
    const query = new URLSearchParams({ config_id: agentId });
    const response = await internalApiFetch(`/api/internal/autoplay/budget?${query.toString()}`, {
      method: 'GET',
    });
    const data = JSON.parse(await response.text()) as InternalBudgetResponse;
    if (!response.ok || !data.success) return null;
    return data;
  } catch (error) {
    console.warn('[autoplay] budget fetch failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function consumeCallBudget(
  agentId: string,
  mode: 'manual' | 'autoplay' | 'memory_distill',
  idempotencyKey: string
): Promise<ConsumeCallResponse> {
  if (!INTERNAL_API_TOKEN) {
    return {
      success: true,
      allowed: true,
      consumed: false,
      reason: 'internal_token_missing',
      remaining_calls_total: Number.MAX_SAFE_INTEGER,
      remaining_calls_autoplay: Number.MAX_SAFE_INTEGER,
      call_ceiling: Number.MAX_SAFE_INTEGER,
      reserve_calls: 0,
      llm_calls_used: 0,
      autoplay_calls_used: 0,
      credits_used: 0,
      credits_remaining: 0,
      credits_cycle_end: null,
    };
  }

  const response = await internalApiFetch('/api/internal/billing/consume-call', {
    method: 'POST',
    body: JSON.stringify({
      config_id: agentId,
      mode,
      idempotency_key: idempotencyKey,
    }),
  });
  const text = await response.text();
  let data: ConsumeCallResponse;
  try {
    data = JSON.parse(text) as ConsumeCallResponse;
  } catch {
    throw new Error(`Invalid consume-call payload: ${text || '(empty)'}`);
  }
  if (!data.success) {
    throw new Error(data.error || `consume-call failed (${response.status})`);
  }
  return data;
}

async function distillMemoryForAgent(
  agentId: string,
  trigger: 'manual' | 'scheduled' | 'requested'
): Promise<{
  success: boolean;
  statusCode?: number;
  error?: string;
  details?: string;
  content?: string;
  state?: MemoryState;
}> {
  ensureMemoryScaffold(agentId);
  const current = readMemoryFile(agentId);
  const recent = readRecentMemoryEvents(agentId, 80);
  const budgetId = `memory-distill:${agentId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  const gateway = await checkGatewayHealth();
  if (!gateway.ok) {
    return {
      success: false,
      statusCode: 503,
      error: 'OpenClaw gateway unavailable for memory distillation',
      details: gateway.error || 'gateway_unreachable',
    };
  }

  let budget: ConsumeCallResponse;
  try {
    budget = await consumeCallBudget(agentId, 'memory_distill', budgetId);
  } catch (error) {
    return {
      success: false,
      statusCode: 502,
      error: 'Failed to consume distill budget',
      details: error instanceof Error ? error.message : String(error),
    };
  }

  if (!budget.allowed) {
    return {
      success: false,
      statusCode: 402,
      error: 'Memory distillation blocked by call budget',
      details: budget.reason,
    };
  }

  const recentText = recent.length
    ? recent.map((item) => `- [${item.source}] ${item.summary}${item.details ? ` (${item.details})` : ''}`).join('\n')
    : '- none';
  const distillPrompt = [
    'Rewrite the agent memory into compact markdown.',
    'Output only markdown with these headings exactly:',
    '# Memory',
    '## Active Context',
    '## Durable Facts',
    '## Recent Signals',
    '## Constraints',
    '',
    `Hard limit: ${MEMORY_MAX_CHARS} characters.`,
    'Keep concise and action-relevant.',
    '',
    'CURRENT MEMORY:',
    current,
    '',
    'RECENT EVENTS:',
    recentText,
    '',
    `TRIGGER: ${trigger}`,
  ].join('\n');

  const response = await proxyGatewayChat({
    agentId,
    userKey: `${agentId}:memory-distill`,
    injectMemory: false,
    timeoutMs: AUTOPLAY_TIMEOUT_MS,
    retries: 1,
    messages: [
      { role: 'system', content: 'You are a strict memory compactor. Return markdown only.' },
      { role: 'user', content: distillPrompt },
    ],
  });

  if (!response.ok) {
    const detail = await safeResponseText(response);
    return {
      success: false,
      statusCode: response.status,
      error: 'Gateway error during memory distillation',
      details: detail || `HTTP ${response.status}`,
    };
  }

  const text = await safeResponseText(response);
  let distilled = text;
  try {
    const parsed = JSON.parse(text) as { choices?: ParsedGatewayChoice[] };
    distilled = extractAssistantText(parsed.choices?.[0]?.message?.content) || distilled;
  } catch {
    // noop - raw text fallback
  }

  if (!distilled.trim()) {
    distilled = current;
  }

  const nowIso = new Date().toISOString();
  const normalized = sanitizeMemoryMarkdown(distilled);
  const state = writeMemoryFile(agentId, normalized, {
    bumpVersion: true,
    resetTicks: true,
    lastDistilledAt: nowIso,
  });
  await syncMemoryTelemetry(agentId, state);
  appendRecentMemoryEvent(agentId, {
    source: 'memory',
    summary: `memory_distilled (${trigger})`,
    details: `chars=${normalized.length}`,
  });

  return {
    success: true,
    content: normalized,
    state,
  };
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
  userKey,
  injectMemory = true,
}: GatewayChatRequest): Promise<Response> {
  const maxAttempts = Math.max(1, retries + 1);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const memoryPrelude = injectMemory ? memoryContextSnippet(agentId) : '';
      const outboundMessages = memoryPrelude
        ? [{ role: 'system', content: `Long-term memory (compact):\n${memoryPrelude}` }, ...messages]
        : messages;
      const headers = gatewayAuthHeaders({
        'Content-Type': 'application/json',
        'x-openclaw-agent-id': agentId,
      });
      const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: `openclaw:${agentId}`,
          messages: outboundMessages,
          user: userKey || agentId, // shared memory between chat and auto-mode
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
  let attemptedModelCall = false;
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
    const gateway = await checkGatewayHealth();
    if (!gateway.ok) {
      const summary = 'Auto-mode skipped because gateway is unavailable.';
      const details = gateway.statusCode
        ? `gateway_unavailable:http_${gateway.statusCode}`
        : `gateway_unavailable:${gateway.error || 'unreachable'}`;
      recordAutoplayFeedback({
        agentId,
        startedAt,
        status: 'failed',
        summary,
        details,
        errorCode: 'gateway_unavailable',
      });
      return { success: false, status: 'failed', summary, details, errorCode: 'gateway_unavailable' };
    }

    let budget: ConsumeCallResponse;
    try {
      budget = await consumeCallBudget(
        agentId,
        'autoplay',
        `autoplay:${agentId}:${startedAt.getTime()}:${Math.random().toString(36).slice(2, 8)}`
      );
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      const summary = 'Auto-mode skipped because billing service is unavailable.';
      recordAutoplayFeedback({
        agentId,
        startedAt,
        status: 'failed',
        summary,
        details,
        errorCode: 'billing_unavailable',
      });
      return { success: false, status: 'failed', summary, details, errorCode: 'billing_unavailable' };
    }
    if (!budget.allowed) {
      const summary = budget.reason === 'manual_reserve'
        ? 'Auto-mode skipped to preserve manual reserve.'
        : 'Auto-mode blocked by call budget.';
      const details = `budget_denied:${budget.reason}`;
      recordAutoplayFeedback({
        agentId,
        startedAt,
        status: 'failed',
        summary,
        details,
        errorCode: budget.reason || 'budget_denied',
      });
      return { success: false, status: 'failed', summary, details, errorCode: budget.reason || 'budget_denied' };
    }
    attemptedModelCall = true;

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

    if (assistantText) {
      appendRecentMemoryEvent(agentId, {
        source: 'autoplay',
        summary,
        details,
      });
      const memoryOps = extractMemoryOpsFromText(assistantText);
      for (const op of memoryOps) {
        await applyMemoryOp(agentId, op);
      }
    }

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
    if (attemptedModelCall) {
      const state = writeMemoryState(agentId, {
        ticks_since_distill: readMemoryState(agentId).ticks_since_distill + 1,
      });
      if (state.ticks_since_distill >= AUTOPLAY_DISTILL_EVERY_TICKS) {
        const distilled = await distillMemoryForAgent(agentId, 'scheduled');
        if (!distilled.success) {
          console.warn(`[memory] Scheduled distill failed for ${agentId}: ${distilled.error} ${distilled.details || ''}`.trim());
        } else {
          console.log(`[memory] Scheduled distill applied for ${agentId} (version=${distilled.state?.memory_version || 'n/a'})`);
        }
      }
    }
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

      const budget = await getAutoplayBudget(agentId);
      if (budget) {
        if (budget.remaining_calls_total <= 0) {
          skipped++;
          addReasonCount(reasonCounts, 'cap_exhausted');
          continue;
        }
        if (budget.remaining_calls_autoplay <= 0) {
          skipped++;
          addReasonCount(reasonCounts, 'manual_reserve');
          continue;
        }
      }

      const settings = parseAgentSettings(agentId);
      const intervalMs = budget?.interval_ms && budget.interval_ms > 0
        ? budget.interval_ms
        : AUTOPLAY_INTERVAL_MS;
      const lastAttemptMs = settings.lastAutoplayAttemptAt ? Date.parse(settings.lastAutoplayAttemptAt) : NaN;
      if (Number.isFinite(lastAttemptMs) && Date.now() - lastAttemptMs < intervalMs) {
        skipped++;
        addReasonCount(reasonCounts, 'tier_cadence');
        continue;
      }

      const runFraction = budget
        ? Math.max(0, Math.min(1, Number(budget.run_fraction || 0)))
        : 1;
      const nextAccumulator = Math.max(0, (settings.autoplayPacingAccumulator || 0) + runFraction);
      if (nextAccumulator < 1) {
        writeAgentSettings(agentId, {
          autoplayPacingAccumulator: nextAccumulator,
        });
        skipped++;
        addReasonCount(reasonCounts, 'pacing_skip');
        continue;
      }

      writeAgentSettings(agentId, {
        autoplayPacingAccumulator: nextAccumulator - 1,
        lastAutoplayAttemptAt: new Date().toISOString(),
      });

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

async function removeAgentFromConfig(agentId: string): Promise<boolean> {
  const config = readGatewayConfig();
  const beforeCount = (config.agents?.list || []).length;

  if (config.agents?.list) {
    config.agents.list = config.agents.list.filter((a) => a.id !== agentId);
  } else {
    config.agents = { ...(config.agents || {}), list: [] };
  }
  const afterCount = (config.agents?.list || []).length;

  writeGatewayConfig(config);
  await signalConfigReload();
  return afterCount < beforeCount;
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
  console.log(`[provision] Gateway auth token: ${GATEWAY_TOKEN ? 'configured' : 'not configured'}`);
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
