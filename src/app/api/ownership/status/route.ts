import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getOwnershipClaimByToken, getOwnershipStatusForAgent } from '@/lib/ownership';

// GET /api/ownership/status - token-based or authenticated ownership status
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  try {
    const supabase = createServerClient();
    const token = request.nextUrl.searchParams.get('token');

    if (token) {
      const lookup = await getOwnershipClaimByToken(supabase, token);
      if (lookup.error) {
        console.error('Ownership status token lookup failed:', lookup.error);
        return errorResponse('Failed to fetch ownership status', 500, {
          code: 'ownership_status_lookup_failed',
        });
      }
      if (lookup.notFound || !lookup.data) {
        return errorResponse('Invalid ownership token', 404, {
          code: 'ownership_token_invalid',
        });
      }

      return jsonResponse({
        success: true,
        data: {
          mode: 'token',
          ownership: lookup.data,
        },
      });
    }

    const hasAuthorization = !!request.headers.get('authorization');
    if (!hasAuthorization) {
      return errorResponse('Provide either ?token=<ownership_token> or Authorization header.', 400, {
        code: 'ownership_status_requires_token_or_auth',
      });
    }

    const auth = await authenticateAgent(request);
    if (!auth.success || !auth.agent) {
      return errorResponse(auth.error || 'Unauthorized', 401, {
        code: 'unauthorized',
      });
    }

    const statusResult = await getOwnershipStatusForAgent(supabase, auth.agent.id);
    if (statusResult.error) {
      console.error('Ownership status agent lookup failed:', statusResult.error);
      return errorResponse('Failed to fetch ownership status', 500, {
        code: 'ownership_status_lookup_failed',
      });
    }

    return jsonResponse({
      success: true,
      data: {
        mode: 'agent',
        ownership: statusResult.data,
        endpoints: {
          regenerate_link: '/api/agents/me/ownership/link',
        },
      },
    });
  } catch (error) {
    console.error('Ownership status route error:', error);
    return errorResponse('Internal server error', 500, {
      code: 'internal_error',
    });
  }
}
