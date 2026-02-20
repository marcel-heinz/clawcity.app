import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { authenticateAgent, errorResponse, jsonResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getClawCreditWallet } from '@/lib/claw-credits';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  const auth = await authenticateAgent(request);
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  try {
    const supabase = createServerClient();
    const agent = auth.agent;

    const body = await request.json().catch(() => ({}));
    const rawIdempotencyKey =
      typeof body?.idempotency_key === 'string' ? body.idempotency_key.trim() : '';
    const idempotencyKey = rawIdempotencyKey || `claim:${agent.id}:${randomUUID()}`;

    const { data, error } = await supabase.rpc('claim_unlocked_claw_credits', {
      p_agent_id: agent.id,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      console.error('Claim Claw Credits RPC error:', error);
      return errorResponse('Failed to claim Claw Credits', 500);
    }

    const claim = (data && typeof data === 'object') ? (data as Record<string, unknown>) : {};
    if (claim.ok !== true) {
      return errorResponse(String(claim.code || claim.message || 'Claim failed'), 400);
    }

    const wallet = await getClawCreditWallet(supabase, agent.id);

    return jsonResponse({
      success: true,
      data: {
        idempotency_key: idempotencyKey,
        replay: claim.replay === true,
        claimed_rewards: Number(claim.claimed_rewards || 0),
        credited_amount: Number(claim.credited_amount || 0),
        wallet,
      },
    });
  } catch (error) {
    console.error('Tournament credits claim error:', error);
    return errorResponse('Internal server error', 500);
  }
}
