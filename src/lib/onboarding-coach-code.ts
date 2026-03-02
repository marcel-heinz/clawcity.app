import { randomBytes } from 'crypto';
import { hashToken } from './game-logic';
import { createServerClient } from './supabase';

type SupabaseClientLike = ReturnType<typeof createServerClient>;

export const COACH_TOKEN_TTL_HOURS = 24;
export const COACH_CODE_TTL_MINUTES = 15;

type CoachCodeIssueFailureCode =
  | 'invalid_token'
  | 'expired_token'
  | 'schema_missing'
  | 'internal_error';

type CoachCodeConsumeFailureCode =
  | 'missing_code'
  | 'invalid_code'
  | 'expired_code'
  | 'consumed_code'
  | 'schema_missing'
  | 'internal_error';

interface AgentCoachCodeRow {
  id: string;
  name: string;
  onboarding_coach_handoff_confirmed_at?: string | null;
  onboarding_coach_token_hash?: string | null;
  onboarding_coach_token_expires_at?: string | null;
  onboarding_coach_code_hash?: string | null;
  onboarding_coach_code_expires_at?: string | null;
  onboarding_coach_code_consumed_at?: string | null;
}

function isColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = 'message' in error && typeof error.message === 'string'
    ? error.message.toLowerCase()
    : '';
  return message.includes('column');
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
  return code === 'PGRST116';
}

function isExpired(value: string | null | undefined): boolean {
  if (!value) return false;
  return new Date(value).getTime() <= Date.now();
}

function nowIso(): string {
  return new Date().toISOString();
}

function generateCoachCode(): string {
  // 8 chars base32-like set to keep it easy for humans to relay.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i += 1) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

export function buildCoachTokenExpiry(): string {
  return new Date(Date.now() + COACH_TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

export async function issueCoachHandoffCodeFromToken(
  supabase: SupabaseClientLike,
  token: string,
): Promise<
  | {
      success: true;
      data: {
        agent_id: string;
        agent_name: string;
        code: string;
        code_expires_at: string;
        already_confirmed: boolean;
      };
    }
  | {
      success: false;
      code: CoachCodeIssueFailureCode;
      error?: unknown;
    }
> {
  const tokenHash = hashToken(token);
  const { data: agentRow, error } = await supabase
    .from('agents')
    .select('id, name, onboarding_coach_handoff_confirmed_at, onboarding_coach_token_hash, onboarding_coach_token_expires_at')
    .eq('onboarding_coach_token_hash', tokenHash)
    .maybeSingle();

  if (error) {
    if (isColumnError(error)) return { success: false, code: 'schema_missing', error };
    if (isNotFoundError(error)) return { success: false, code: 'invalid_token' };
    return { success: false, code: 'internal_error', error };
  }
  if (!agentRow) {
    return { success: false, code: 'invalid_token' };
  }

  const row = agentRow as AgentCoachCodeRow;
  if (isExpired(row.onboarding_coach_token_expires_at)) {
    return { success: false, code: 'expired_token' };
  }

  const alreadyConfirmed = typeof row.onboarding_coach_handoff_confirmed_at === 'string'
    && row.onboarding_coach_handoff_confirmed_at.length > 0;
  if (alreadyConfirmed) {
    return {
      success: true,
      data: {
        agent_id: row.id,
        agent_name: row.name,
        code: '',
        code_expires_at: nowIso(),
        already_confirmed: true,
      },
    };
  }

  const code = generateCoachCode();
  const codeHash = hashToken(code);
  const expiresAt = new Date(Date.now() + COACH_CODE_TTL_MINUTES * 60 * 1000).toISOString();
  const issuedAt = nowIso();

  const { error: updateError } = await supabase
    .from('agents')
    .update({
      onboarding_coach_code_hash: codeHash,
      onboarding_coach_code_expires_at: expiresAt,
      onboarding_coach_code_issued_at: issuedAt,
      onboarding_coach_code_consumed_at: null,
    })
    .eq('id', row.id);

  if (updateError) {
    if (isColumnError(updateError)) return { success: false, code: 'schema_missing', error: updateError };
    return { success: false, code: 'internal_error', error: updateError };
  }

  return {
    success: true,
    data: {
      agent_id: row.id,
      agent_name: row.name,
      code,
      code_expires_at: expiresAt,
      already_confirmed: false,
    },
  };
}

export async function consumeCoachHandoffCodeForAgent(
  supabase: SupabaseClientLike,
  agentId: string,
  coachCode: string,
): Promise<
  | { success: true; consumed_at: string }
  | { success: false; code: CoachCodeConsumeFailureCode; error?: unknown }
> {
  const trimmed = coachCode.trim();
  if (!trimmed) {
    return { success: false, code: 'missing_code' };
  }

  const { data: agentRow, error } = await supabase
    .from('agents')
    .select('id, onboarding_coach_code_hash, onboarding_coach_code_expires_at, onboarding_coach_code_consumed_at')
    .eq('id', agentId)
    .maybeSingle();

  if (error) {
    if (isColumnError(error)) return { success: false, code: 'schema_missing', error };
    return { success: false, code: 'internal_error', error };
  }
  if (!agentRow) {
    return { success: false, code: 'invalid_code' };
  }

  const row = agentRow as AgentCoachCodeRow;
  if (!row.onboarding_coach_code_hash) {
    return { success: false, code: 'invalid_code' };
  }

  if (row.onboarding_coach_code_consumed_at) {
    return { success: false, code: 'consumed_code' };
  }

  if (isExpired(row.onboarding_coach_code_expires_at)) {
    return { success: false, code: 'expired_code' };
  }

  const incomingHash = hashToken(trimmed);
  if (incomingHash !== row.onboarding_coach_code_hash) {
    return { success: false, code: 'invalid_code' };
  }

  const consumedAt = nowIso();
  const { error: updateError } = await supabase
    .from('agents')
    .update({ onboarding_coach_code_consumed_at: consumedAt })
    .eq('id', agentId)
    .is('onboarding_coach_code_consumed_at', null);

  if (updateError) {
    if (isColumnError(updateError)) return { success: false, code: 'schema_missing', error: updateError };
    return { success: false, code: 'internal_error', error: updateError };
  }

  return { success: true, consumed_at: consumedAt };
}
