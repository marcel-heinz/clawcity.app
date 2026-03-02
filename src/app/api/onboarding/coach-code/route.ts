import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { errorResponse, jsonResponse } from '@/lib/auth';
import { COACH_CODE_TTL_MINUTES, issueCoachHandoffCodeFromToken } from '@/lib/onboarding-coach-code';

// POST /api/onboarding/coach-code
// Coach-facing endpoint: issue one-time handoff code from coach token.
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured.', 503, {
      code: 'database_not_configured',
    });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) {
      return errorResponse('Coach token is required.', 400, {
        code: 'missing_coach_token',
      });
    }

    const supabase = createServerClient();
    const issued = await issueCoachHandoffCodeFromToken(supabase, token);
    if (!issued.success) {
      if (issued.code === 'invalid_token') {
        return errorResponse('Invalid coach token.', 404, {
          code: 'invalid_coach_token',
        });
      }
      if (issued.code === 'expired_token') {
        return errorResponse('Coach token expired. Regenerate via agent onboarding flow.', 410, {
          code: 'expired_coach_token',
        });
      }
      if (issued.code === 'schema_missing') {
        return errorResponse('Coach-code schema missing. Apply latest DB migrations.', 503, {
          code: 'coach_code_schema_missing',
        });
      }

      console.error('onboarding/coach-code issue error:', issued.error);
      return errorResponse('Failed to issue coach code.', 500, {
        code: 'issue_coach_code_failed',
      });
    }

    if (issued.data.already_confirmed) {
      return jsonResponse({
        success: true,
        data: {
          already_confirmed: true,
          message: `Coach handoff is already confirmed for ${issued.data.agent_name}.`,
        },
      });
    }

    return jsonResponse({
      success: true,
      data: {
        agent_id: issued.data.agent_id,
        agent_name: issued.data.agent_name,
        coach_code: issued.data.code,
        coach_code_expires_at: issued.data.code_expires_at,
        expires_in_minutes: COACH_CODE_TTL_MINUTES,
        message: 'Share this one-time coach code with your agent. It is required to complete onboarding handoff.',
      },
    });
  } catch (error) {
    console.error('onboarding/coach-code route error:', error);
    return errorResponse('Internal server error', 500, {
      code: 'internal_error',
    });
  }
}
