import { NextRequest } from 'next/server';
import { authenticateAgent, errorResponse, jsonResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getActivePerkLoadout, getClawCreditWallet, normalizeNumber } from '@/lib/claw-credits';

const SETTING_KEYS = [
  'claw_credit_perk_instant_storage_cost',
  'claw_credit_perk_storage_bonus',
  'claw_credit_perk_durable_axe_cost',
  'claw_credit_perk_durable_axe_uses',
  'claw_credit_perk_durable_axe_purchase_cap',
] as const;

type PerkSettingKey = (typeof SETTING_KEYS)[number];

export async function GET(_request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  const auth = await authenticateAgent(_request);
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  try {
    const supabase = createServerClient();
    const agent = auth.agent;

    const [wallet, activeLoadoutResult, settingsResult] = await Promise.all([
      getClawCreditWallet(supabase, agent.id),
      getActivePerkLoadout(supabase, agent.id),
      supabase
        .from('game_settings')
        .select('key, value')
        .in('key', [...SETTING_KEYS]),
    ]);

    const settingMap = new Map<PerkSettingKey, number>();
    for (const row of settingsResult.data || []) {
      if (!SETTING_KEYS.includes(row.key as PerkSettingKey)) continue;
      settingMap.set(row.key as PerkSettingKey, normalizeNumber(row.value, 0));
    }

    const instantStorageCost = settingMap.get('claw_credit_perk_instant_storage_cost') ?? 1000;
    const storageBonus = settingMap.get('claw_credit_perk_storage_bonus') ?? 500;
    const durableAxeCost = settingMap.get('claw_credit_perk_durable_axe_cost') ?? 500;
    const durableAxeUses = settingMap.get('claw_credit_perk_durable_axe_uses') ?? 30;
    const durableAxeCap = settingMap.get('claw_credit_perk_durable_axe_purchase_cap') ?? 10;

    return jsonResponse({
      success: true,
      data: {
        currency: { id: 'claw_credits', name: 'Claw Credits' },
        wallet,
        active_tournament: activeLoadoutResult.tournament,
        loadout: activeLoadoutResult.loadout,
        catalog: [
          {
            id: 'instant_storage',
            name: 'Instant Storage',
            cost: instantStorageCost,
            per_tournament_limit: 1,
            effect: `+${storageBonus} resource cap for this tournament`,
          },
          {
            id: 'durable_axe',
            name: 'Durable Axe',
            cost: durableAxeCost,
            per_purchase_uses: durableAxeUses,
            per_tournament_purchase_cap: durableAxeCap,
            effect: '+30% forest gather while uses remain',
          },
        ],
      },
    });
  } catch (error) {
    console.error('Tournament perks GET error:', error);
    return errorResponse('Internal server error', 500);
  }
}
