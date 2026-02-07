import { getSupabase } from '../db/supabase-client';

/**
 * Check if user has remaining quota and increment if so.
 * Returns true if the decision is allowed.
 */
export async function consumeDecisionQuota(userId: string): Promise<boolean> {
  const supabase = getSupabase();

  const { data: user } = await supabase
    .from('users')
    .select('decisions_used_today, max_decisions_per_day')
    .eq('id', userId)
    .single();

  if (!user) return false;
  if (user.decisions_used_today >= user.max_decisions_per_day) return false;

  // Increment atomically
  await supabase.rpc('increment_decisions', { user_id_input: userId });

  return true;
}

/**
 * Check remaining quota without consuming
 */
export async function getRemainingQuota(userId: string): Promise<number> {
  const supabase = getSupabase();

  const { data: user } = await supabase
    .from('users')
    .select('decisions_used_today, max_decisions_per_day')
    .eq('id', userId)
    .single();

  if (!user) return 0;
  return Math.max(0, user.max_decisions_per_day - user.decisions_used_today);
}
