import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getOwnershipStatusForAgent } from '@/lib/ownership';

// GET /api/agents/me/ownership - authenticated ownership status endpoint
export async function GET(request: NextRequest) {
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
    const supabase = createServerClient();
    const statusResult = await getOwnershipStatusForAgent(supabase, auth.agent.id);

    if (statusResult.error) {
      console.error('agents/me/ownership lookup failed:', statusResult.error);
      return errorResponse('Failed to fetch ownership state', 500, {
        code: 'ownership_status_lookup_failed',
      });
    }

    return jsonResponse({
      success: true,
      data: {
        ownership: statusResult.data,
        endpoints: {
          canonical_status: '/api/ownership/status',
          canonical_verify: '/api/ownership/verify',
          canonical_lookup_template: '/api/ownership/{token}',
          regenerate_link: '/api/agents/me/ownership/link',
        },
        compatibility_aliases: {
          lookup_template: '/api/claim/{token}',
          verify: '/api/claim/verify',
        },
      },
    });
  } catch (error) {
    console.error('agents/me/ownership route error:', error);
    return errorResponse('Internal server error', 500, {
      code: 'internal_error',
    });
  }
}
