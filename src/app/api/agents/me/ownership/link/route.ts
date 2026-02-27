import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getOwnershipStatusForAgent, regenerateOwnershipLink } from '@/lib/ownership';

const OWNERSHIP_LINK_REGEN_ENABLED = process.env.OWNERSHIP_LINK_REGEN_ENABLED !== 'false';
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.clawcity.app';

// POST /api/agents/me/ownership/link - regenerate claim/ownership link
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured.', 503, {
      code: 'database_not_configured',
    });
  }

  const rateLimit = await checkRateLimit(request, GAME_ACTION_RATE_LIMIT);
  if (!rateLimit.success) {
    const retryAfter = Math.ceil((rateLimit.retryAfterMs || 1000) / 1000);
    return errorResponse(`Rate limit exceeded. Try again in ${retryAfter}s.`, 429, {
      code: 'rate_limited',
      retry_after_seconds: retryAfter,
    });
  }

  const auth = await authenticateAgent(request);
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401, {
      code: 'unauthorized',
    });
  }

  if (!OWNERSHIP_LINK_REGEN_ENABLED) {
    return errorResponse('Ownership link regeneration is disabled.', 404, {
      code: 'ownership_link_regen_disabled',
    });
  }

  try {
    const supabase = createServerClient();
    const force = request.nextUrl.searchParams.get('force') === 'true';

    const statusResult = await getOwnershipStatusForAgent(supabase, auth.agent.id);
    if (statusResult.error) {
      console.error('ownership link regeneration status check failed:', statusResult.error);
      return errorResponse('Failed to read ownership status', 500, {
        code: 'ownership_status_lookup_failed',
      });
    }

    if (statusResult.data?.claimed && !force) {
      return errorResponse('Agent ownership is already verified. Pass ?force=true to rotate anyway.', 409, {
        code: 'ownership_already_verified',
      });
    }

    const regeneration = await regenerateOwnershipLink(supabase, {
      agentId: auth.agent.id,
      baseUrl: BASE_URL,
    });

    if (regeneration.error || !regeneration.data) {
      console.error('ownership link regeneration failed:', regeneration.error);
      return errorResponse('Failed to regenerate ownership link', 500, {
        code: 'ownership_link_regen_failed',
      });
    }

    return jsonResponse({
      success: true,
      data: {
        claim_token: regeneration.data.token,
        claim_link: regeneration.data.link,
        expires_at: regeneration.data.expires_at,
        ownership: {
          status: 'pending',
          lookup: `/api/ownership/${regeneration.data.token}`,
          verify: '/api/ownership/verify',
        },
        compatibility_aliases: {
          lookup: `/api/claim/${regeneration.data.token}`,
          verify: '/api/claim/verify',
        },
      },
    });
  } catch (error) {
    console.error('agents/me/ownership/link route error:', error);
    return errorResponse('Internal server error', 500, {
      code: 'internal_error',
    });
  }
}
