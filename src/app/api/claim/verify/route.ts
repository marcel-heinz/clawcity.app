import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { hashToken } from '@/lib/game-logic';

// POST /api/claim/verify - Verify agent ownership via Twitter handle
// In a real implementation, this would verify the tweet exists
// For now, it accepts the twitter handle and marks as verified
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  try {
    const body = await request.json();
    const { token, twitter_handle, tweet_url } = body;

    if (!token) {
      return errorResponse('Claim token is required');
    }

    if (!twitter_handle) {
      return errorResponse('Twitter handle is required');
    }

    // Validate twitter handle format
    const cleanHandle = twitter_handle.replace(/^@/, '');
    if (!/^[a-zA-Z0-9_]{1,15}$/.test(cleanHandle)) {
      return errorResponse('Invalid Twitter handle format');
    }

    const supabase = createServerClient();

    // Hash-based lookup (secure method - plaintext tokens are no longer stored)
    const tokenHash = hashToken(token);
    const { data: claim, error: claimError } = await supabase
      .from('agent_claims')
      .select('*')
      .eq('claim_token_hash', tokenHash)
      .single();

    if (claimError || !claim) {
      return errorResponse('Invalid claim token', 404);
    }

    // Get the agent info
    const { data: agent } = await supabase
      .from('agents')
      .select('id, name')
      .eq('id', claim.agent_id)
      .single();

    // Check if already verified
    if (claim.verified) {
      return jsonResponse({
        success: true,
        data: {
          already_verified: true,
          twitter_handle: claim.twitter_handle,
          verified_at: claim.verified_at,
          message: 'This agent has already been verified.',
        },
      });
    }

    // Check if expired
    if (claim.expires_at && new Date(claim.expires_at) < new Date()) {
      return errorResponse('This claim link has expired', 410);
    }

    // In a production environment, you would:
    // 1. Use Twitter API to verify the tweet exists
    // 2. Check that the tweet contains the claim token
    // 3. Verify the tweet is from the claimed handle
    // For now, we'll trust the submission (manual verification possible via admin)

    // Update the claim as verified
    const { error: updateError } = await supabase
      .from('agent_claims')
      .update({
        verified: true,
        twitter_handle: cleanHandle,
        verified_at: new Date().toISOString(),
      })
      .eq('id', claim.id);

    if (updateError) {
      console.error('Error updating claim:', updateError);
      return errorResponse('Failed to verify claim', 500);
    }

    // Also update the agent record
    await supabase
      .from('agents')
      .update({
        claimed: true,
        claimed_by_twitter: cleanHandle,
      })
      .eq('id', claim.agent_id);

    return jsonResponse({
      success: true,
      data: {
        verified: true,
        agent_name: agent?.name,
        twitter_handle: cleanHandle,
        tweet_url: tweet_url || null,
        message: `Successfully verified ownership of ${agent?.name}! 🦞`,
      },
    });
  } catch (error) {
    console.error('Claim verification error:', error);
    return errorResponse('Internal server error', 500);
  }
}
