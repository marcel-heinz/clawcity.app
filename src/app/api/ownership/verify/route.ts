import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { verifyOwnershipClaim } from '@/lib/ownership';

// POST /api/ownership/verify - canonical ownership verification endpoint
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body.token === 'string' ? body.token : '';
    const twitterHandle = typeof body.twitter_handle === 'string' ? body.twitter_handle : '';
    const tweetUrl = typeof body.tweet_url === 'string' ? body.tweet_url : null;

    if (!token) {
      return errorResponse('Ownership token is required');
    }

    if (!twitterHandle) {
      return errorResponse('Twitter handle is required');
    }

    const supabase = createServerClient();
    const verification = await verifyOwnershipClaim(supabase, {
      token,
      twitterHandle,
      tweetUrl,
    });

    if (!verification.success) {
      if (verification.code === 'invalid_handle') {
        return errorResponse('Invalid Twitter handle format');
      }
      if (verification.code === 'invalid_token') {
        return errorResponse('Invalid ownership token', 404, {
          code: 'ownership_token_invalid',
        });
      }
      if (verification.code === 'expired') {
        return errorResponse('This ownership link has expired', 410, {
          code: 'ownership_token_expired',
        });
      }

      console.error('Ownership verification error:', verification.error);
      return errorResponse('Failed to verify ownership', 500, {
        code: 'ownership_verify_failed',
      });
    }

    return jsonResponse({
      success: true,
      data: {
        verified: true,
        already_verified: verification.already_verified,
        agent_id: verification.data.agent_id,
        agent_name: verification.data.agent_name,
        twitter_handle: verification.data.twitter_handle,
        verified_at: verification.data.verified_at,
        tweet_url: verification.data.tweet_url,
        message: verification.already_verified
          ? 'Ownership already verified.'
          : `Successfully verified ownership of ${verification.data.agent_name}!`,
        endpoints: {
          status: '/api/ownership/status',
        },
      },
    });
  } catch (error) {
    console.error('Ownership verification route error:', error);
    return errorResponse('Internal server error', 500, {
      code: 'internal_error',
    });
  }
}
