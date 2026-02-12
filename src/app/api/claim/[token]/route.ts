import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { hashToken } from '@/lib/game-logic';

// GET /api/claim/[token] - Get claim info for a token
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  try {
    const { token } = await params;

    if (!token) {
      return errorResponse('Claim token is required');
    }

    const supabase = createServerClient();

    // Hash-based lookup (secure method - plaintext tokens are no longer stored)
    const tokenHash = hashToken(token);
    const { data: claim, error } = await supabase
      .from('agent_claims')
      .select(`
        id,
        verified,
        twitter_handle,
        created_at,
        verified_at,
        expires_at,
        agent_id
      `)
      .eq('claim_token_hash', tokenHash)
      .single();

    if (error || !claim) {
      return errorResponse('Invalid or expired claim token', 404);
    }

    // Get the agent info separately
    const { data: agent } = await supabase
      .from('agents')
      .select('id, name, created_at')
      .eq('id', claim.agent_id)
      .single();

    // Check if expired
    if (claim.expires_at && new Date(claim.expires_at) < new Date()) {
      return errorResponse('This claim link has expired', 410);
    }

    return jsonResponse({
      success: true,
      data: {
        token: token,  // Return the token they provided, not from DB
        agent_name: agent?.name,
        agent_created_at: agent?.created_at,
        verified: claim.verified,
        twitter_handle: claim.twitter_handle,
        verified_at: claim.verified_at,
        expires_at: claim.expires_at,
      },
    });
  } catch (error) {
    console.error('Claim lookup error:', error);
    return errorResponse('Internal server error', 500);
  }
}
