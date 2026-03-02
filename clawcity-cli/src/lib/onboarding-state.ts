import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve as resolvePath } from 'node:path';

export type OnboardingMode = 'manual' | 'scripted';
export type ScriptUsageKind = 'generated' | 'custom' | 'inline';
type OracleSource = 'command' | 'install';

export interface OnboardingState {
  version: 1;
  created_at: string;
  updated_at: string;
  agent_name: string;
  mode: OnboardingMode;
  generated_script_path: string | null;
  generated_script_created: boolean;
  coach_handoff: {
    required: boolean;
    completed: boolean;
    completed_at: string | null;
    storage_method: string | null;
    kickoff_strategy: string | null;
  };
  oracle: {
    required_before_actions: boolean;
    completed: boolean;
    completed_at: string | null;
    source: OracleSource | null;
  };
  script_usage: {
    any_script_observed: boolean;
    generated_script_observed: boolean;
    kind: ScriptUsageKind | null;
    observed_at: string | null;
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

export function getOnboardingStatePath(): string {
  const fromEnv = process.env.CLAWCITY_ONBOARDING_STATE_PATH;
  if (fromEnv && fromEnv.trim().length > 0) {
    return resolvePath(fromEnv);
  }
  return resolvePath(homedir(), '.config', 'clawcity', 'onboarding-state.json');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseMode(value: unknown): OnboardingMode {
  return value === 'manual' ? 'manual' : 'scripted';
}

function parseScriptKind(value: unknown): ScriptUsageKind | null {
  if (value === 'generated' || value === 'custom' || value === 'inline') return value;
  return null;
}

function parseOracleSource(value: unknown): OracleSource | null {
  if (value === 'command' || value === 'install') return value;
  return null;
}

export async function readOnboardingState(): Promise<OnboardingState | null> {
  try {
    const raw = await readFile(getOnboardingStatePath(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const record = asRecord(parsed);
    if (!record) return null;

    const coach = asRecord(record.coach_handoff) || {};
    const oracle = asRecord(record.oracle) || {};
    const scriptUsage = asRecord(record.script_usage) || {};

    return {
      version: 1,
      created_at: asString(record.created_at) || nowIso(),
      updated_at: asString(record.updated_at) || nowIso(),
      agent_name: asString(record.agent_name) || 'unknown',
      mode: parseMode(record.mode),
      generated_script_path: asString(record.generated_script_path),
      generated_script_created: asBoolean(record.generated_script_created) === true,
      coach_handoff: {
        required: asBoolean(coach.required) !== false,
        completed: asBoolean(coach.completed) === true,
        completed_at: asString(coach.completed_at),
        storage_method: asString(coach.storage_method),
        kickoff_strategy: asString(coach.kickoff_strategy),
      },
      oracle: {
        required_before_actions: asBoolean(oracle.required_before_actions) !== false,
        completed: asBoolean(oracle.completed) === true,
        completed_at: asString(oracle.completed_at),
        source: parseOracleSource(oracle.source),
      },
      script_usage: {
        any_script_observed: asBoolean(scriptUsage.any_script_observed) === true,
        generated_script_observed: asBoolean(scriptUsage.generated_script_observed) === true,
        kind: parseScriptKind(scriptUsage.kind),
        observed_at: asString(scriptUsage.observed_at),
      },
    };
  } catch {
    return null;
  }
}

export async function writeOnboardingState(state: OnboardingState): Promise<void> {
  const path = getOnboardingStatePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function initializeOnboardingState(input: {
  agentName: string;
  mode: OnboardingMode;
  generatedScriptPath: string | null;
  generatedScriptCreated: boolean;
  coachStorageMethod?: string | null;
  coachKickoffStrategy?: string | null;
  coachHandoffCompleted?: boolean;
}): Promise<OnboardingState> {
  const now = nowIso();
  const storageMethod = input.coachStorageMethod ? input.coachStorageMethod : null;
  const kickoffStrategy = input.coachKickoffStrategy ? input.coachKickoffStrategy : null;
  const handoffCompleted = input.coachHandoffCompleted === true
    || Boolean(storageMethod && kickoffStrategy);
  const state: OnboardingState = {
    version: 1,
    created_at: now,
    updated_at: now,
    agent_name: input.agentName,
    mode: input.mode,
    generated_script_path: input.generatedScriptPath,
    generated_script_created: input.generatedScriptCreated,
    coach_handoff: {
      required: true,
      completed: handoffCompleted,
      completed_at: handoffCompleted ? now : null,
      storage_method: storageMethod,
      kickoff_strategy: kickoffStrategy,
    },
    oracle: {
      required_before_actions: true,
      completed: false,
      completed_at: null,
      source: null,
    },
    script_usage: {
      any_script_observed: false,
      generated_script_observed: false,
      kind: null,
      observed_at: null,
    },
  };

  await writeOnboardingState(state);
  return state;
}

export async function markCoachHandoffCompleted(input: {
  storageMethod: string;
  kickoffStrategy: string;
}): Promise<OnboardingState | null> {
  const state = await readOnboardingState();
  if (!state) return null;
  const now = nowIso();
  state.coach_handoff.completed = true;
  state.coach_handoff.completed_at = now;
  state.coach_handoff.storage_method = input.storageMethod;
  state.coach_handoff.kickoff_strategy = input.kickoffStrategy;
  state.updated_at = now;
  await writeOnboardingState(state);
  return state;
}

export async function markOracleCompleted(source: OracleSource): Promise<OnboardingState | null> {
  const state = await readOnboardingState();
  if (!state) return null;
  const now = nowIso();
  state.oracle.completed = true;
  state.oracle.completed_at = now;
  state.oracle.source = source;
  state.updated_at = now;
  await writeOnboardingState(state);
  return state;
}

export async function markScriptUsage(kind: ScriptUsageKind): Promise<OnboardingState | null> {
  const state = await readOnboardingState();
  if (!state) return null;
  const now = nowIso();
  state.script_usage.any_script_observed = true;
  state.script_usage.generated_script_observed = state.script_usage.generated_script_observed || kind === 'generated';
  state.script_usage.kind = kind;
  state.script_usage.observed_at = now;
  state.updated_at = now;
  await writeOnboardingState(state);
  return state;
}

export async function assertOnboardingReadyForMutatingAction(action: string): Promise<void> {
  const state = await readOnboardingState();
  if (!state) return;

  if (state.coach_handoff.required && !state.coach_handoff.completed) {
    console.error(`Error: coach handoff gate is incomplete before "${action}".`);
    console.error('Complete handoff via: clawcity onboarding handoff --coach-code "<code>" --storage "<method>" --kickoff "<20-action strategy>"');
    process.exit(2);
  }

  if (state.oracle.required_before_actions && !state.oracle.completed) {
    console.error(`Error: Oracle onboarding must run before "${action}".`);
    console.error('Run: clawcity oracle');
    process.exit(2);
  }
}
