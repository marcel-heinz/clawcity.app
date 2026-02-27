import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { verifyOwnershipClaim } from '@/lib/ownership';

// POST /api/claim/verify - legacy alias of /api/ownership/verify
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
      return errorResponse('Claim token is required');
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
        return errorResponse('Invalid claim token', 404);
      }
      if (verification.code === 'expired') {
        return errorResponse('This claim link has expired', 410);
      }

      console.error('Claim verification alias error:', verification.error);
      return errorResponse('Failed to verify claim', 500);
    }

    return jsonResponse({
      success: true,
      data: {
        verified: true,
        already_verified: verification.already_verified,
        agent_name: verification.data.agent_name,
        twitter_handle: verification.data.twitter_handle,
        tweet_url: verification.data.tweet_url,
        verified_at: verification.data.verified_at,
        message: verification.already_verified
          ? 'This agent has already been verified.'
          : `Successfully verified ownership of ${verification.data.agent_name}! 🦞`,
        canonical_endpoint: '/api/ownership/verify',
      },
    });
  } catch (error) {
    console.error('Claim verification error:', error);
    return errorResponse('Internal server error', 500);
  }
}
