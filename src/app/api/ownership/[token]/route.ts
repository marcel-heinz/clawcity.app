import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getOwnershipClaimByToken } from '@/lib/ownership';

// GET /api/ownership/[token] - canonical ownership lookup endpoint
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
      return errorResponse('Ownership token is required');
    }

    const supabase = createServerClient();
    const lookup = await getOwnershipClaimByToken(supabase, token);

    if (lookup.error) {
      console.error('Ownership lookup error:', lookup.error);
      return errorResponse('Failed to fetch ownership state', 500, {
        code: 'ownership_lookup_failed',
      });
    }

    if (lookup.notFound || !lookup.data) {
      return errorResponse('Invalid or expired ownership token', 404, {
        code: 'ownership_token_invalid',
      });
    }

    if (lookup.data.status === 'expired') {
      return errorResponse('This ownership link has expired', 410, {
        code: 'ownership_token_expired',
        details: {
          ownership: lookup.data,
        },
      });
    }

    return jsonResponse({
      success: true,
      data: {
        ...lookup.data,
        endpoints: {
          verify: '/api/ownership/verify',
          status: '/api/ownership/status',
        },
        compatibility_aliases: {
          lookup: `/api/claim/${token}`,
          verify: '/api/claim/verify',
        },
      },
    });
  } catch (error) {
    console.error('Ownership token route error:', error);
    return errorResponse('Internal server error', 500, {
      code: 'internal_error',
    });
  }
}
