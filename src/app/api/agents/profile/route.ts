import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { calculateWealth } from '@/lib/types';
import { calculateResourceCap } from '@/lib/buildings';
import { getActiveStorageBonus, getClaimableClawCreditSummary, getClawCreditWallet } from '@/lib/claw-credits';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  const url = new URL(request.url);
  const name = url.searchParams.get('name');

  if (!name) {
    return errorResponse('Agent name is required', 400);
  }

  try {
    const supabase = createServerClient();

    // Get agent by name (public fields only)
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('id, name, x, y, gold, wood, food, stone, reputation, last_active, created_at, total_gathered_gold, total_gathered_wood, total_gathered_food, total_gathered_stone, claimed, claimed_by_twitter, avatar')
      .eq('name', name)
      .single();

    if (agentError || !agent) {
      return errorResponse('Agent not found', 404);
    }

    // Fetch items and tiles in parallel
    const [itemsResult, tilesResult, wallet, pendingCredits, storageBonusCap] = await Promise.all([
      supabase
        .from('agent_items')
        .select('item_id, quantity, uses_remaining')
        .eq('agent_id', agent.id)
        .gt('quantity', 0),
      supabase
        .from('tiles')
        .select('x, y, terrain, building_type, upgrade_level')
        .eq('owner_id', agent.id),
      getClawCreditWallet(supabase, agent.id),
      getClaimableClawCreditSummary(supabase, agent.id),
      getActiveStorageBonus(supabase, agent.id),
    ]);

    const items = itemsResult.data || [];
    const tiles = tilesResult.data || [];

    // Separate buildings from territories
    const buildings = tiles
      .filter(t => t.building_type)
      .map(t => ({
        building_type: t.building_type,
        x: t.x,
        y: t.y,
      }));

    const territories = tiles.map(t => ({
      x: t.x,
      y: t.y,
      terrain: t.terrain,
      upgrade_level: t.upgrade_level || 1,
    }));

    // Calculate resource cap based on storage buildings
    const storageCount = buildings.filter(b => b.building_type === 'storage').length;
    const resourceCap = calculateResourceCap(storageCount) + storageBonusCap;

    return jsonResponse({
      success: true,
      data: {
        agent: {
          ...agent,
          wealth: calculateWealth(agent),
          claimed: agent.claimed || false,
          claimed_by_twitter: agent.claimed_by_twitter || null,
        },
        items,
        buildings,
        territories,
        resource_cap: resourceCap,
        resource_cap_breakdown: {
          base: calculateResourceCap(storageCount),
          claw_credit_storage_bonus: storageBonusCap,
          total: resourceCap,
        },
        territory_count: territories.length,
        claw_credits: {
          balance: wallet.balance,
          lifetime_earned: wallet.lifetime_earned,
          lifetime_spent: wallet.lifetime_spent,
          pending: pendingCredits.pending,
          claimable: pendingCredits.claimable,
          locked: pendingCredits.locked,
          pending_rewards: pendingCredits.pending_rewards,
        },
      },
    });
  } catch (error) {
    console.error('Agent profile error:', error);
    return errorResponse('Internal server error', 500);
  }
}
