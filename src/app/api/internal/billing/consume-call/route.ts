import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { assertInternalApiAuth } from '@/lib/internal-api-auth';

type ConsumeMode = 'manual' | 'autoplay' | 'memory_distill';

interface ConsumeResult {
  allowed: boolean;
  consumed: boolean;
  reason: string;
  config_id: string;
  user_id: string;
  tier: string;
  monthly_credit_limit: number;
  call_ceiling: number;
  reserve_calls: number;
  llm_calls_used: number;
  autoplay_calls_used: number;
  remaining_calls_total: number;
  remaining_calls_autoplay: number;
  credits_used: number | string;
  credits_remaining: number | string;
  credits_cycle_end: string | null;
}

function validMode(mode: string): mode is ConsumeMode {
  return mode === 'manual' || mode === 'autoplay' || mode === 'memory_distill';
}

export async function POST(request: NextRequest) {
  const authError = assertInternalApiAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json() as {
      config_id?: string;
      mode?: string;
      idempotency_key?: string;
    };

    const configId = (body.config_id || '').trim();
    const modeRaw = (body.mode || '').trim().toLowerCase();
    const idempotencyKey = (body.idempotency_key || '').trim();

    if (!configId || !validMode(modeRaw) || !idempotencyKey) {
      return NextResponse.json(
        { error: 'Missing or invalid config_id/mode/idempotency_key' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();
    const { data, error } = await supabase.rpc('consume_llm_call', {
      p_config_id: configId,
      p_mode: modeRaw,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      console.error('consume_llm_call rpc error:', error);
      return NextResponse.json({ error: 'Failed to consume call budget' }, { status: 500 });
    }

    const row = (Array.isArray(data) ? data[0] : data) as ConsumeResult | undefined;
    if (!row) {
      return NextResponse.json({ error: 'No billing result returned' }, { status: 500 });
    }

    const status = row.allowed ? 200 : 402;
    return NextResponse.json({
      success: true,
      allowed: row.allowed,
      consumed: row.consumed,
      reason: row.reason,
      config_id: row.config_id,
      user_id: row.user_id,
      tier: row.tier,
      monthly_credit_limit: Number(row.monthly_credit_limit || 0),
      call_ceiling: Number(row.call_ceiling || 0),
      reserve_calls: Number(row.reserve_calls || 0),
      llm_calls_used: Number(row.llm_calls_used || 0),
      autoplay_calls_used: Number(row.autoplay_calls_used || 0),
      remaining_calls_total: Number(row.remaining_calls_total || 0),
      remaining_calls_autoplay: Number(row.remaining_calls_autoplay || 0),
      credits_used: Number(row.credits_used || 0),
      credits_remaining: Number(row.credits_remaining || 0),
      credits_cycle_end: row.credits_cycle_end,
    }, { status });
  } catch (error) {
    console.error('Internal consume-call error:', error);
    return NextResponse.json({ error: 'Failed to process call consumption' }, { status: 500 });
  }
}
