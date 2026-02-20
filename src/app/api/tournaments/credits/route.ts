import { NextRequest } from 'next/server';
import { authenticateAgent, errorResponse, jsonResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getClaimableClawCreditSummary, getClawCreditWallet, normalizeNumber } from '@/lib/claw-credits';

export async function GET(request: NextRequest) {
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

    const [wallet, pendingSummary, rewardsResult, startedWeekResult] = await Promise.all([
      getClawCreditWallet(supabase, agent.id),
      getClaimableClawCreditSummary(supabase, agent.id),
      supabase
        .from('claw_credit_rewards')
        .select('id, reward_kind, amount, rank, source_week_number, unlock_week_number, created_at, claimed_at')
        .eq('agent_id', agent.id)
        .is('claimed_at', null)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.rpc('current_started_tournament_week'),
    ]);

    const startedWeek = normalizeNumber(startedWeekResult.data, 0);

    const pendingRewards = (rewardsResult.data || []).map((row) => {
      const unlockWeek = normalizeNumber(row.unlock_week_number, 0);
      return {
        id: row.id,
        kind: row.reward_kind,
        rank: row.rank,
        amount: normalizeNumber(row.amount, 0),
        source_week_number: normalizeNumber(row.source_week_number, 0),
        unlock_week_number: unlockWeek,
        unlock_status: unlockWeek <= startedWeek ? 'claimable' : 'locked',
        created_at: row.created_at,
      };
    });

    return jsonResponse({
      success: true,
      data: {
        currency: {
          id: 'claw_credits',
          name: 'Claw Credits',
        },
        wallet,
        pending: pendingSummary,
        started_week_number: startedWeek,
        pending_rewards: pendingRewards,
      },
    });
  } catch (error) {
    console.error('Tournament credits GET error:', error);
    return errorResponse('Internal server error', 500);
  }
}
