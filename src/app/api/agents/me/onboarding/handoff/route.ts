import { NextRequest } from 'next/server';
import { authenticateAgent, errorResponse, jsonResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { consumeCoachHandoffCodeForAgent } from '@/lib/onboarding-coach-code';

function normalizeField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = 'message' in error && typeof error.message === 'string'
    ? error.message.toLowerCase()
    : '';
  return message.includes('column');
}

// POST /api/agents/me/onboarding/handoff
// Confirms coach handoff completion before mutating gameplay loops.
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured.', 503, {
      code: 'database_not_configured',
    });
  }

  const auth = await authenticateAgent(request);
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401, {
      code: 'unauthorized',
    });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const coachCode = normalizeField((body as Record<string, unknown>).coach_code);
    const storageMethod = normalizeField((body as Record<string, unknown>).storage_method);
    const kickoffStrategy = normalizeField((body as Record<string, unknown>).kickoff_strategy);
    const ownershipLinkShared = (body as Record<string, unknown>).ownership_link_shared === true;

    if (coachCode.length < 4) {
      return errorResponse('coach_code is required.', 400, {
        code: 'missing_coach_code',
      });
    }

    if (storageMethod.length < 3) {
      return errorResponse('storage_method is required (min 3 chars).', 400, {
        code: 'invalid_storage_method',
      });
    }
    if (kickoffStrategy.length < 8) {
      return errorResponse('kickoff_strategy is required (min 8 chars).', 400, {
        code: 'invalid_kickoff_strategy',
      });
    }

    const supabase = createServerClient();
    const consumed = await consumeCoachHandoffCodeForAgent(supabase, auth.agent.id, coachCode);
    if (!consumed.success) {
      if (consumed.code === 'missing_code' || consumed.code === 'invalid_code') {
        return errorResponse('Invalid coach handoff code.', 403, {
          code: 'invalid_coach_code',
        });
      }
      if (consumed.code === 'expired_code') {
        return errorResponse('Coach handoff code expired. Ask coach to issue a new one-time code.', 410, {
          code: 'expired_coach_code',
        });
      }
      if (consumed.code === 'consumed_code') {
        return errorResponse('Coach handoff code already used. Ask coach to issue a new one-time code.', 409, {
          code: 'consumed_coach_code',
        });
      }
      if (consumed.code === 'schema_missing') {
        return errorResponse('Coach-code schema missing. Apply latest DB migrations.', 503, {
          code: 'coach_code_schema_missing',
        });
      }

      console.error('agents/me/onboarding/handoff code consume failed:', consumed.error);
      return errorResponse('Failed to verify coach handoff code.', 500, {
        code: 'verify_coach_code_failed',
      });
    }

    const nowIso = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('agents')
      .update({
        onboarding_gate_required: true,
        onboarding_coach_handoff_confirmed_at: nowIso,
        onboarding_coach_storage_method: storageMethod,
        onboarding_coach_kickoff_strategy: kickoffStrategy,
        onboarding_coach_handoff_source: 'cli_handoff',
      })
      .eq('id', auth.agent.id);

    if (updateError) {
      if (isColumnError(updateError)) {
        return errorResponse('Onboarding gate columns are missing. Apply latest DB migrations.', 503, {
          code: 'onboarding_gate_schema_missing',
        });
      }
      console.error('agents/me/onboarding/handoff update failed:', updateError);
      return errorResponse('Failed to persist onboarding handoff.', 500, {
        code: 'onboarding_handoff_update_failed',
      });
    }

    return jsonResponse({
      success: true,
      data: {
        onboarding: {
          coach_handoff_confirmed: true,
          coach_handoff_confirmed_at: nowIso,
          coach_code_consumed_at: consumed.consumed_at,
          storage_method: storageMethod,
          kickoff_strategy: kickoffStrategy,
          ownership_link_shared: ownershipLinkShared,
          ownership_link_note: 'Ownership verification link is optional trust setup, not required for gameplay.',
          next_required_step: 'Run `clawcity oracle` before mutating gameplay actions.',
        },
      },
    });
  } catch (error) {
    console.error('agents/me/onboarding/handoff route error:', error);
    return errorResponse('Internal server error', 500, {
      code: 'internal_error',
    });
  }
}
