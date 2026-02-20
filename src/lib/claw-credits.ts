import { SupabaseClient } from '@supabase/supabase-js';

export type TournamentPerkId = 'instant_storage' | 'durable_axe';

export interface ClawCreditWallet {
  agent_id: string;
  balance: number;
  lifetime_earned: number;
  lifetime_spent: number;
}

export interface ClawCreditReward {
  id: string;
  reward_kind: 'podium_gold' | 'podium_silver' | 'podium_bronze' | 'participation';
  amount: number;
  source_week_number: number;
  unlock_week_number: number;
  created_at: string;
}

export interface PerkLoadout {
  storage_bonus_count: number;
  durable_axe_uses_remaining: number;
  durable_axe_purchases: number;
}

export interface ActiveTournamentRef {
  id: string;
  week_number: number;
  name: string;
  starts_at: string;
  ends_at: string;
}

export function normalizeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getActiveTournamentRef(
  supabase: SupabaseClient,
): Promise<ActiveTournamentRef | null> {
  const { data } = await supabase
    .from('tournaments')
    .select('id, week_number, name, starts_at, ends_at')
    .eq('status', 'active')
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    week_number: data.week_number,
    name: data.name,
    starts_at: data.starts_at,
    ends_at: data.ends_at,
  };
}

export async function getActiveStorageBonus(
  supabase: SupabaseClient,
  agentId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('get_active_tournament_storage_bonus', {
    p_agent_id: agentId,
  });

  if (error) {
    return 0;
  }

  return normalizeNumber(data, 0);
}

export async function getActiveDurableAxeUses(
  supabase: SupabaseClient,
  agentId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('get_active_tournament_durable_axe_uses', {
    p_agent_id: agentId,
  });

  if (error) {
    return 0;
  }

  return normalizeNumber(data, 0);
}

export async function consumeDurableAxeUse(
  supabase: SupabaseClient,
  agentId: string,
): Promise<{ applied: boolean; usesRemaining: number }> {
  const { data, error } = await supabase.rpc('consume_durable_axe_use', {
    p_agent_id: agentId,
  });

  if (error || !data || typeof data !== 'object') {
    return { applied: false, usesRemaining: 0 };
  }

  const payload = data as Record<string, unknown>;
  return {
    applied: payload.applied === true,
    usesRemaining: normalizeNumber(payload.uses_remaining, 0),
  };
}

export async function getClawCreditWallet(
  supabase: SupabaseClient,
  agentId: string,
): Promise<ClawCreditWallet> {
  const { data } = await supabase
    .from('claw_credit_wallets')
    .select('agent_id, balance, lifetime_earned, lifetime_spent')
    .eq('agent_id', agentId)
    .maybeSingle();

  return {
    agent_id: agentId,
    balance: normalizeNumber(data?.balance, 0),
    lifetime_earned: normalizeNumber(data?.lifetime_earned, 0),
    lifetime_spent: normalizeNumber(data?.lifetime_spent, 0),
  };
}

export async function getClaimableClawCreditSummary(
  supabase: SupabaseClient,
  agentId: string,
): Promise<{ pending: number; claimable: number; locked: number; pending_rewards: number }> {
  const startedWeekResult = await supabase.rpc('current_started_tournament_week');
  const startedWeek = normalizeNumber(startedWeekResult.data, 0);

  const { data: rewards } = await supabase
    .from('claw_credit_rewards')
    .select('amount, unlock_week_number, claimed_at')
    .eq('agent_id', agentId)
    .is('claimed_at', null);

  const pendingRows = rewards || [];
  let pending = 0;
  let claimable = 0;
  let locked = 0;

  for (const row of pendingRows) {
    const amount = normalizeNumber(row.amount, 0);
    const unlockWeek = normalizeNumber(row.unlock_week_number, 0);
    pending += amount;
    if (unlockWeek <= startedWeek) {
      claimable += amount;
    } else {
      locked += amount;
    }
  }

  return {
    pending,
    claimable,
    locked,
    pending_rewards: pendingRows.length,
  };
}

export async function getActivePerkLoadout(
  supabase: SupabaseClient,
  agentId: string,
): Promise<{ tournament: ActiveTournamentRef | null; loadout: PerkLoadout }> {
  const tournament = await getActiveTournamentRef(supabase);
  if (!tournament) {
    return {
      tournament: null,
      loadout: {
        storage_bonus_count: 0,
        durable_axe_uses_remaining: 0,
        durable_axe_purchases: 0,
      },
    };
  }

  const { data } = await supabase
    .from('tournament_perk_loadouts')
    .select('storage_bonus_count, durable_axe_uses_remaining, durable_axe_purchases')
    .eq('tournament_id', tournament.id)
    .eq('agent_id', agentId)
    .maybeSingle();

  return {
    tournament,
    loadout: {
      storage_bonus_count: normalizeNumber(data?.storage_bonus_count, 0),
      durable_axe_uses_remaining: normalizeNumber(data?.durable_axe_uses_remaining, 0),
      durable_axe_purchases: normalizeNumber(data?.durable_axe_purchases, 0),
    },
  };
}
