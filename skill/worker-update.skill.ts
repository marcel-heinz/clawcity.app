/**
 * ClawCity Worker Update Skill
 *
 * This skill helps keep the hosted-agent worker in sync with the game.
 * When game mechanics change (new actions, new endpoints, balance tweaks),
 * use these tools to inspect drift between the game skill (source of truth)
 * and the worker, then update worker files accordingly.
 *
 * Installation:
 * 1. Copy to your OpenClaw workspace skills folder
 * 2. Run: openclaw skills install ./worker-update.skill.ts
 * 3. Set CLAWCITY_REPO_PATH to your local checkout
 *
 * Usage:
 * - "Check if the worker is in sync with the game skill"
 * - "Show me the current tool registry"
 * - "Update the worker prompt builder"
 * - "Run TypeScript check on the worker"
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

interface SkillConfig {
  repoPath?: string;
}

const DEFAULT_REPO_PATH = process.env.CLAWCITY_REPO_PATH || '.';

function getRepoPath(config?: SkillConfig): string {
  return config?.repoPath || DEFAULT_REPO_PATH;
}

function workerSrc(config?: SkillConfig): string {
  return path.join(getRepoPath(config), 'clawcity-worker', 'src');
}

function skillDir(config?: SkillConfig): string {
  return path.join(getRepoPath(config), 'skill');
}

// Worker source file layout
const WORKER_FILES: Record<string, string> = {
  'tool-registry': 'lib/tool-registry.ts',
  'prompt-builder': 'decision/prompt-builder.ts',
  'response-parser': 'decision/response-parser.ts',
  'rule-engine': 'decision/rule-engine.ts',
  'action-executor': 'execution/action-executor.ts',
  'decision-engine': 'decision/decision-engine.ts',
  'state-collector': 'state/state-collector.ts',
  'state-hasher': 'state/state-hasher.ts',
  'tick-loop': 'scheduler/tick-loop.ts',
  'agent-scheduler': 'scheduler/agent-scheduler.ts',
  'llm-client': 'decision/llm-client.ts',
  'api-client': 'execution/api-client.ts',
  'config': 'config.ts',
  'index': 'index.ts',
  'logger': 'monitoring/logger.ts',
  'health-check': 'monitoring/health-check.ts',
  'supabase-client': 'db/supabase-client.ts',
  'redis-client': 'coordination/redis-client.ts',
  'agent-lock': 'coordination/agent-lock.ts',
  'quota-tracker': 'coordination/quota-tracker.ts',
};

export default {
  name: 'clawcity-worker-update',
  description: 'Inspect and update the ClawCity hosted-agent worker. The worker runs on Railway and autonomously plays the game for hosted agents. When game mechanics change (new actions, endpoints, balance), use these tools to detect drift between the game skill (source of truth) and the worker code, then apply updates. Key files: tool-registry (action definitions), prompt-builder (LLM system prompt), response-parser (LLM output parsing), rule-engine (fast pre-filter rules), action-executor (API call dispatch), state-collector (game state queries).',
  version: '1.0.0',
  author: 'ClawCity',

  config: {
    repoPath: {
      type: 'string',
      description: 'Path to the clawcity.app repo root (default: current directory)',
      default: '.',
    },
  },

  tools: [
    // ============================================
    // INSPECTION TOOLS
    // ============================================

    {
      name: 'worker_list_files',
      description: 'List all worker source files with their relative paths. Use this to see the full worker structure.',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async (_params: Record<string, never>, config: SkillConfig) => {
        const srcDir = workerSrc(config);
        try {
          const files: string[] = [];
          function walk(dir: string, prefix: string) {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              if (entry.isDirectory()) {
                walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
              } else if (entry.name.endsWith('.ts')) {
                files.push(`${prefix}${entry.name}`);
              }
            }
          }
          walk(srcDir, '');
          return { success: true, data: { files, count: files.length } };
        } catch (error) {
          return { success: false, error: `Failed to list files: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },

    {
      name: 'worker_read_file',
      description: 'Read a worker source file. Use short names like "tool-registry", "prompt-builder", "action-executor", etc. or provide a relative path like "decision/prompt-builder.ts".',
      parameters: {
        type: 'object',
        properties: {
          file: {
            type: 'string',
            description: 'Short name (e.g. "tool-registry", "prompt-builder") or relative path (e.g. "decision/prompt-builder.ts")',
          },
        },
        required: ['file'],
      },
      handler: async ({ file }: { file: string }, config: SkillConfig) => {
        const srcDir = workerSrc(config);
        const relPath = WORKER_FILES[file] || file;
        const fullPath = path.join(srcDir, relPath);
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          return { success: true, data: { path: relPath, content, lines: content.split('\n').length } };
        } catch (error) {
          return { success: false, error: `Failed to read ${relPath}: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },

    {
      name: 'worker_read_game_skill',
      description: 'Read the main ClawCity game skill file (clawcity.skill.ts). This is the SOURCE OF TRUTH for all game actions, endpoints, and mechanics. Compare its tool definitions against the worker tool-registry to find drift.',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async (_params: Record<string, never>, config: SkillConfig) => {
        const skillPath = path.join(skillDir(config), 'clawcity.skill.ts');
        try {
          const content = fs.readFileSync(skillPath, 'utf-8');
          return { success: true, data: { path: 'skill/clawcity.skill.ts', content, lines: content.split('\n').length } };
        } catch (error) {
          return { success: false, error: `Failed to read game skill: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },

    {
      name: 'worker_diff',
      description: 'Show uncommitted changes in the worker directory. Useful to review what has been modified before committing.',
      parameters: {
        type: 'object',
        properties: {
          file: {
            type: 'string',
            description: 'Optional: specific file short name or path to diff. Omit for all changes.',
          },
        },
      },
      handler: async ({ file }: { file?: string }, config: SkillConfig) => {
        const repoRoot = getRepoPath(config);
        try {
          let cmd = `cd "${repoRoot}" && git diff --stat clawcity-worker/`;
          if (file) {
            const relPath = WORKER_FILES[file] || file;
            cmd = `cd "${repoRoot}" && git diff clawcity-worker/src/${relPath}`;
          }
          const output = execSync(cmd, { encoding: 'utf-8', timeout: 10000 });
          return { success: true, data: { diff: output || '(no changes)' } };
        } catch (error) {
          return { success: false, error: `Failed to diff: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },

    {
      name: 'worker_detect_drift',
      description: 'Compare the game skill actions against the worker tool-registry and action-executor to detect missing or outdated actions. Returns lists of: actions in skill but missing from worker, actions in worker but not in skill, and endpoint mismatches.',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async (_params: Record<string, never>, config: SkillConfig) => {
        const srcDir = workerSrc(config);
        const skillPath = path.join(skillDir(config), 'clawcity.skill.ts');
        try {
          const skillContent = fs.readFileSync(skillPath, 'utf-8');
          const registryPath = path.join(srcDir, 'lib/tool-registry.ts');
          const executorPath = path.join(srcDir, 'execution/action-executor.ts');

          const registryContent = fs.existsSync(registryPath) ? fs.readFileSync(registryPath, 'utf-8') : '';
          const executorContent = fs.existsSync(executorPath) ? fs.readFileSync(executorPath, 'utf-8') : '';

          // Extract tool names from skill (handler-based tools with clawcity_ prefix)
          const skillTools: string[] = [];
          const skillNameRe = /name:\s*'clawcity_(\w+)'/g;
          let m;
          while ((m = skillNameRe.exec(skillContent)) !== null) {
            skillTools.push(m[1]);
          }

          // Extract action names from registry
          const registryActions: string[] = [];
          const registryRe = /name:\s*'(\w+)'/g;
          while ((m = registryRe.exec(registryContent)) !== null) {
            registryActions.push(m[1]);
          }

          // Extract case statements from executor
          const executorCases: string[] = [];
          const caseRe = /case\s+'(\w+)':/g;
          while ((m = caseRe.exec(executorContent)) !== null) {
            executorCases.push(m[1]);
          }

          // Skill action tools (exclude info-only tools like status, world, leaderboard, tiles, events, etc.)
          const infoOnlyTools = ['status', 'world', 'leaderboard', 'tiles', 'events', 'recipes',
            'messages', 'announcements', 'mark_announcements_read',
            'forum_threads', 'forum_thread', 'forum_vote',
            'tournament', 'tournament_leaderboard', 'tournament_history',
            'market_orders', 'market_prices'];
          const skillActionTools = skillTools.filter((t) => !infoOnlyTools.includes(t));

          // Normalize skill names to worker names (e.g. accept_trade -> trade_accept)
          const skillNormalized = skillActionTools.map((t) => {
            if (t === 'accept_trade') return 'trade_accept';
            if (t === 'reject_trade') return 'trade_reject';
            if (t === 'trade') return 'trade_propose';
            if (t === 'market_order') return 'market_create';
            if (t === 'market_fill') return 'market_fill';
            if (t === 'market_cancel') return 'market_cancel';
            if (t === 'forum_post') return 'forum_post';
            if (t === 'forum_create_thread') return 'forum_create_thread';
            if (t === 'tournament_join') return 'tournament_join';
            return t;
          });

          const missingFromRegistry = skillNormalized.filter((t) => !registryActions.includes(t));
          const extraInRegistry = registryActions.filter((t) => !skillNormalized.includes(t) && t !== 'status' && t !== 'tournament_info' && t !== 'events' && t !== 'market_orders' && t !== 'recipes' && t !== 'forum_threads');
          const missingFromExecutor = registryActions.filter((t) => !executorCases.includes(t) && !['status', 'tournament_info', 'events', 'market_orders', 'recipes', 'forum_threads'].includes(t));

          const inSync = missingFromRegistry.length === 0 && missingFromExecutor.length === 0;

          return {
            success: true,
            data: {
              in_sync: inSync,
              skill_action_tools: skillNormalized,
              registry_actions: registryActions,
              executor_cases: executorCases,
              missing_from_registry: missingFromRegistry,
              extra_in_registry: extraInRegistry,
              missing_from_executor: missingFromExecutor,
              summary: inSync
                ? 'Worker is in sync with the game skill.'
                : `Drift detected: ${missingFromRegistry.length} missing from registry, ${missingFromExecutor.length} missing from executor.`,
            },
          };
        } catch (error) {
          return { success: false, error: `Drift detection failed: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },

    // ============================================
    // UPDATE TOOLS
    // ============================================

    {
      name: 'worker_write_file',
      description: 'Write or overwrite a worker source file. Use short names like "tool-registry", "prompt-builder", etc. WARNING: This overwrites the file entirely. Read it first, make changes, then write back.',
      parameters: {
        type: 'object',
        properties: {
          file: {
            type: 'string',
            description: 'Short name (e.g. "tool-registry") or relative path',
          },
          content: {
            type: 'string',
            description: 'Full file content to write',
          },
        },
        required: ['file', 'content'],
      },
      handler: async ({ file, content }: { file: string; content: string }, config: SkillConfig) => {
        const srcDir = workerSrc(config);
        const relPath = WORKER_FILES[file] || file;
        const fullPath = path.join(srcDir, relPath);
        try {
          // Ensure directory exists
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, content, 'utf-8');
          return { success: true, data: { path: relPath, bytes: content.length, lines: content.split('\n').length } };
        } catch (error) {
          return { success: false, error: `Failed to write ${relPath}: ${error instanceof Error ? error.message : String(error)}` };
        }
      },
    },

    // ============================================
    // VERIFICATION TOOLS
    // ============================================

    {
      name: 'worker_typecheck',
      description: 'Run TypeScript compilation check (tsc --noEmit) on the worker. Returns errors if any, or confirms clean compilation.',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async (_params: Record<string, never>, config: SkillConfig) => {
        const workerDir = path.join(getRepoPath(config), 'clawcity-worker');
        try {
          const output = execSync('npx tsc --noEmit 2>&1', {
            cwd: workerDir,
            encoding: 'utf-8',
            timeout: 30000,
          });
          return { success: true, data: { output: output || 'Clean compilation - no errors.' } };
        } catch (error) {
          const execError = error as { stdout?: string; stderr?: string };
          const output = execError.stdout || execError.stderr || String(error);
          return { success: false, error: output, data: { errors: output } };
        }
      },
    },

    {
      name: 'worker_build',
      description: 'Run full TypeScript build (tsc) on the worker, producing dist/ output. Use this before deploying to verify the build succeeds.',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async (_params: Record<string, never>, config: SkillConfig) => {
        const workerDir = path.join(getRepoPath(config), 'clawcity-worker');
        try {
          const output = execSync('npm run build 2>&1', {
            cwd: workerDir,
            encoding: 'utf-8',
            timeout: 60000,
          });
          return { success: true, data: { output: output || 'Build succeeded.' } };
        } catch (error) {
          const execError = error as { stdout?: string; stderr?: string };
          const output = execError.stdout || execError.stderr || String(error);
          return { success: false, error: output };
        }
      },
    },

    {
      name: 'worker_architecture',
      description: 'Get a concise overview of the worker architecture: file layout, data flow, key interfaces, and configuration. Useful as context before making changes.',
      parameters: {
        type: 'object',
        properties: {},
      },
      handler: async (_params: Record<string, never>) => {
        return {
          success: true,
          data: {
            overview: 'ClawCity Hosted Agent Worker - runs on Railway, processes agent ticks autonomously.',
            flow: [
              '1. tick-loop.ts: Main 10s loop fetches active agent_configs from Supabase',
              '2. agent-scheduler.ts: Filters to agents due for a tick (starter=5min, pro=2min)',
              '3. state-collector.ts: Gathers AgentState from DB + API (agent, tiles, trades, tournaments, events)',
              '4. state-hasher.ts: SHA-256 of meaningful state; skips LLM if unchanged',
              '5. rule-engine.ts: Fast pre-filter for obvious actions (favorable trades, low food, etc.)',
              '6. decision-engine.ts: Orchestrates rules + LLM fallback',
              '7. prompt-builder.ts: Builds system/personality/state prompts from tool-registry',
              '8. llm-client.ts: Calls Claude Sonnet 4.5 via OpenRouter with JSON response format',
              '9. response-parser.ts: Validates LLM JSON output against ACTION_NAMES from tool-registry',
              '10. action-executor.ts: Dispatches decision to correct API endpoint',
              '11. Logs decision to decision_log table, updates agent_config tick time + state hash',
            ],
            key_files: {
              'lib/tool-registry.ts': 'SOURCE OF TRUTH for worker actions. 18 action tools + 6 info tools. Derived from skill/clawcity.skill.ts.',
              'decision/prompt-builder.ts': 'Generates LLM prompts. System prompt built from tool-registry. State prompt includes tournaments, events, items, buildings.',
              'decision/response-parser.ts': 'Validates LLM output. VALID_ACTIONS from tool-registry. Parses all action-specific fields.',
              'decision/rule-engine.ts': 'Fast pre-filter. Decision interface has all action fields. Tournament-aware rules.',
              'execution/action-executor.ts': 'Switch on all 18 actions. Calls apiRequest with correct endpoint/method/body.',
              'execution/api-client.ts': 'apiRequest(path, apiKey, body?, method?) - supports GET/POST/DELETE.',
              'state/state-collector.ts': 'collectAgentState(agentId, apiKey?) - DB queries + API calls for extended data.',
            },
            update_checklist: [
              '1. Read game skill (worker_read_game_skill) to see current tool definitions',
              '2. Detect drift (worker_detect_drift) to find missing/outdated actions',
              '3. Update tool-registry.ts with new/changed action tools',
              '4. Update prompt-builder.ts if game mechanics descriptions changed',
              '5. Update response-parser.ts if new action fields are needed',
              '6. Update rule-engine.ts Decision interface + add new rules',
              '7. Update action-executor.ts with new switch cases',
              '8. Update state-collector.ts if new state data is available',
              '9. Run worker_typecheck to verify compilation',
              '10. Commit and deploy',
            ],
          },
        };
      },
    },
  ],
};
