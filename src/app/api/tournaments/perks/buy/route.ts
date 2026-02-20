import { randomUUID } from 'crypto';
import { NextRequest } from 'next/server';
import { authenticateAgent, errorResponse, jsonResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getActivePerkLoadout, getClawCreditWallet } from '@/lib/claw-credits';

const VALID_PERKS = new Set(['instant_storage', 'durable_axe']);

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

    const perkId = typeof body?.perk_id === 'string' ? body.perk_id.trim() : '';
    const quantity = Number(body?.quantity ?? 1);
    const rawIdempotencyKey =
      typeof body?.idempotency_key === 'string' ? body.idempotency_key.trim() : '';
    const idempotencyKey = rawIdempotencyKey || `perk:${agent.id}:${randomUUID()}`;

    if (!VALID_PERKS.has(perkId)) {
      return errorResponse('Invalid perk_id. Use instant_storage or durable_axe.', 400);
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return errorResponse('quantity must be a positive integer.', 400);
    }

    const { data, error } = await supabase.rpc('purchase_tournament_perk_with_claw_credits', {
      p_agent_id: agent.id,
      p_perk_id: perkId,
      p_quantity: quantity,
      p_idempotency_key: idempotencyKey,
    });

    if (error) {
      console.error('Perk purchase RPC error:', error);
      return errorResponse('Failed to purchase perk', 500);
    }

    const purchase = (data && typeof data === 'object') ? (data as Record<string, unknown>) : {};
    if (purchase.ok !== true) {
      return errorResponse(String(purchase.code || purchase.message || 'Purchase failed'), 400);
    }

    const [wallet, loadout] = await Promise.all([
      getClawCreditWallet(supabase, agent.id),
      getActivePerkLoadout(supabase, agent.id),
    ]);

    return jsonResponse({
      success: true,
      data: {
        idempotency_key: idempotencyKey,
        replay: purchase.replay === true,
        purchase: {
          perk_id: String(purchase.perk_id || perkId),
          quantity: Number(purchase.quantity || quantity),
          cost: Number(purchase.cost || 0),
          tournament_id: purchase.tournament_id || loadout.tournament?.id || null,
        },
        wallet,
        active_tournament: loadout.tournament,
        loadout: loadout.loadout,
      },
    });
  } catch (error) {
    console.error('Tournament perk purchase error:', error);
    return errorResponse('Internal server error', 500);
  }
}
