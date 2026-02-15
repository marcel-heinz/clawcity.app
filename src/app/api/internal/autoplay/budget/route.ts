import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { assertInternalApiAuth } from '@/lib/internal-api-auth';
import { computeBudgetSnapshot, EXPECTED_CALLS_PER_AUTOPLAY_TICK } from '@/lib/autoplay-budget';

interface ConfigWithUser {
  id: string;
  user_id: string;
  users: {
    tier: string;
    monthly_credit_limit: number;
    credits_used: number | string;
    credits_cycle_end: string | null;
    llm_calls_used: number;
    autoplay_calls_used: number;
  }[] | {
    tier: string;
    monthly_credit_limit: number;
    credits_used: number | string;
    credits_cycle_end: string | null;
    llm_calls_used: number;
    autoplay_calls_used: number;
  } | null;
}

export async function GET(request: NextRequest) {
  const authError = assertInternalApiAuth(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const configId = url.searchParams.get('config_id');
    if (!configId) {
      return NextResponse.json({ error: 'Missing config_id' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
      .from('agent_configs')
      .select('id, user_id, users!inner(tier, monthly_credit_limit, credits_used, credits_cycle_end, llm_calls_used, autoplay_calls_used)')
      .eq('id', configId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Config not found' }, { status: 404 });
    }

    const row = data as unknown as ConfigWithUser;
    const user = Array.isArray(row.users) ? row.users[0] : row.users;
    if (!user) {
      return NextResponse.json({ error: 'User profile missing for config' }, { status: 404 });
    }

    const snapshot = computeBudgetSnapshot({
      tier: user.tier,
      monthlyCreditLimit: Number(user.monthly_credit_limit || 0),
      llmCallsUsed: Number(user.llm_calls_used || 0),
      creditsCycleEnd: user.credits_cycle_end,
    });

    return NextResponse.json({
      success: true,
      config_id: row.id,
      user_id: row.user_id,
      tier: user.tier,
      monthly_credit_limit: Number(user.monthly_credit_limit || 0),
      llm_calls_used: Number(user.llm_calls_used || 0),
      autoplay_calls_used: Number(user.autoplay_calls_used || 0),
      credits_used: Number(user.credits_used || 0),
      credits_cycle_end: user.credits_cycle_end,
      expected_calls_per_autoplay_tick: EXPECTED_CALLS_PER_AUTOPLAY_TICK,
      interval_ms: snapshot.intervalMs,
      call_ceiling: snapshot.callCeiling,
      reserve_calls: snapshot.reserveCalls,
      remaining_calls_total: snapshot.remainingCallsTotal,
      remaining_calls_autoplay: snapshot.remainingCallsAutoplay,
      scheduled_ticks_remaining: snapshot.scheduledTicksRemaining,
      affordable_ticks_remaining: snapshot.affordableTicksRemaining,
      run_fraction: snapshot.runFraction,
    });
  } catch (error) {
    console.error('Internal autoplay budget error:', error);
    return NextResponse.json({ error: 'Failed to compute autoplay budget' }, { status: 500 });
  }
}
