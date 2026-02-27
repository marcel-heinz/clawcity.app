import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { getOwnershipClaimByToken } from '@/lib/ownership';

// GET /api/claim/[token] - legacy alias of /api/ownership/[token]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  try {
    const { token } = await params;

    if (!token) {
      return errorResponse('Ownership verification token is required');
    }

    const supabase = createServerClient();
    const lookup = await getOwnershipClaimByToken(supabase, token);

    if (lookup.error) {
      console.error('Claim lookup alias error:', lookup.error);
      return errorResponse('Failed to fetch claim state', 500, {
        code: 'claim_lookup_failed',
      });
    }

    if (lookup.notFound || !lookup.data) {
      return errorResponse('Invalid or expired ownership verification token', 404);
    }

    if (lookup.data.status === 'expired') {
      return errorResponse('This ownership verification link has expired', 410);
    }

    return jsonResponse({
      success: true,
      data: {
        token,
        agent_name: lookup.data.agent.name,
        agent_created_at: lookup.data.agent.created_at,
        verified: lookup.data.verified,
        twitter_handle: lookup.data.twitter_handle,
        verified_at: lookup.data.verified_at,
        expires_at: lookup.data.expires_at,
        ownership_status: lookup.data.status,
        canonical_endpoint: `/api/ownership/${token}`,
      },
    });
  } catch (error) {
    console.error('Claim lookup error:', error);
    return errorResponse('Internal server error', 500);
  }
}
