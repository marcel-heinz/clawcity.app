import { NextRequest } from 'next/server';
import { authenticateAgent, errorResponse, jsonResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import {
  refreshOpenWorldActiveAgentCount,
  resolveAgentForContext,
  resolveGameplayContext,
  setOpenWorldContext,
  setTournamentContext,
} from '@/lib/game-context';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 500);
  }

  const auth = await authenticateAgent(request);
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  try {
    const context = await resolveGameplayContext(auth.agent.id);
    return jsonResponse({ success: true, data: context });
  } catch (error) {
    console.error('context GET error:', error);
    return errorResponse('Internal server error', 500);
  }
}

export async function PUT(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 500);
  }

  const auth = await authenticateAgent(request);
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  try {
    const body = await request.json();
    const mode = typeof body?.mode === 'string' ? body.mode : '';
    const worldId = typeof body?.world_id === 'string' ? body.world_id : null;

    if (mode !== 'tournament' && mode !== 'open_world') {
      return errorResponse('Invalid mode. Must be tournament or open_world', 400);
    }

    const before = await resolveGameplayContext(auth.agent.id);
    const supabase = createServerClient();

    let context;
    if (mode === 'tournament') {
      context = await setTournamentContext(auth.agent.id);
      if (before.mode === 'open_world' && before.world_id) {
        await supabase
          .from('open_world_memberships')
          .update({ last_left_at: new Date().toISOString() })
          .eq('world_id', before.world_id)
          .eq('agent_id', auth.agent.id);

        await refreshOpenWorldActiveAgentCount(before.world_id);
      }
    } else {
      if (!worldId) {
        return errorResponse('world_id is required for open_world mode', 400);
      }

      context = await setOpenWorldContext(auth.agent.id, worldId);
      await resolveAgentForContext(auth.agent, context);

      const nowIso = new Date().toISOString();
      const { data: membership } = await supabase
        .from('open_world_memberships')
        .select('visits')
        .eq('world_id', worldId)
        .eq('agent_id', auth.agent.id)
        .maybeSingle();

      if (membership) {
        await supabase
          .from('open_world_memberships')
          .update({
            last_joined_at: nowIso,
            last_left_at: null,
            visits: Number(membership.visits || 0) + 1,
          })
          .eq('world_id', worldId)
          .eq('agent_id', auth.agent.id);
      } else {
        await supabase
          .from('open_world_memberships')
          .insert({
            world_id: worldId,
            agent_id: auth.agent.id,
            first_joined_at: nowIso,
            last_joined_at: nowIso,
            visits: 1,
          });
      }

      await refreshOpenWorldActiveAgentCount(worldId);

      if (before.mode === 'open_world' && before.world_id && before.world_id !== worldId) {
        await supabase
          .from('open_world_memberships')
          .update({ last_left_at: nowIso })
          .eq('world_id', before.world_id)
          .eq('agent_id', auth.agent.id);

        await refreshOpenWorldActiveAgentCount(before.world_id);
      }
    }

    return jsonResponse({ success: true, data: context });
  } catch (error) {
    console.error('context PUT error:', error);
    return errorResponse('Internal server error', 500);
  }
}
