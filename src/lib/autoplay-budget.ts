import { TIER_CONFIG } from '@/lib/stripe';

export const CALLS_PER_CREDIT = 4;
export const AUTOPLAY_RESERVE_FRACTION = 0.05;
export const EXPECTED_CALLS_PER_AUTOPLAY_TICK = 1.05;

export interface BudgetSnapshot {
  callCeiling: number;
  reserveCalls: number;
  remainingCallsTotal: number;
  remainingCallsAutoplay: number;
  scheduledTicksRemaining: number;
  affordableTicksRemaining: number;
  runFraction: number;
  intervalMs: number | null;
}

export function normalizeCycleEnd(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function computeCallCeiling(monthlyCreditLimit: number): number {
  return Math.max(0, Math.floor(monthlyCreditLimit * CALLS_PER_CREDIT));
}

export function computeReserveCalls(callCeiling: number): number {
  return Math.max(0, Math.ceil(callCeiling * AUTOPLAY_RESERVE_FRACTION));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function resolveTierIntervalMs(tier: string | null | undefined): number | null {
  if (tier === 'starter') return TIER_CONFIG.starter.tickInterval;
  if (tier === 'pro') return TIER_CONFIG.pro.tickInterval;
  return null;
}

export function computeBudgetSnapshot(input: {
  tier: string | null | undefined;
  monthlyCreditLimit: number;
  llmCallsUsed: number;
  creditsCycleEnd: string | null | undefined;
  nowMs?: number;
}): BudgetSnapshot {
  const nowMs = input.nowMs ?? Date.now();
  const callCeiling = computeCallCeiling(input.monthlyCreditLimit);
  const reserveCalls = computeReserveCalls(callCeiling);
  const remainingCallsTotal = Math.max(0, callCeiling - Math.max(0, input.llmCallsUsed || 0));
  const remainingCallsAutoplay = Math.max(0, remainingCallsTotal - reserveCalls);

  const intervalMs = resolveTierIntervalMs(input.tier);
  const cycleEndMs = normalizeCycleEnd(input.creditsCycleEnd);

  let scheduledTicksRemaining = 0;
  if (intervalMs && cycleEndMs && cycleEndMs > nowMs) {
    scheduledTicksRemaining = Math.ceil((cycleEndMs - nowMs) / intervalMs);
  }

  const affordableTicksRemaining = Math.floor(remainingCallsAutoplay / EXPECTED_CALLS_PER_AUTOPLAY_TICK);
  const runFraction = scheduledTicksRemaining > 0
    ? clamp(affordableTicksRemaining / scheduledTicksRemaining, 0, 1)
    : (remainingCallsAutoplay > 0 ? 1 : 0);

  return {
    callCeiling,
    reserveCalls,
    remainingCallsTotal,
    remainingCallsAutoplay,
    scheduledTicksRemaining,
    affordableTicksRemaining,
    runFraction,
    intervalMs,
  };
}
