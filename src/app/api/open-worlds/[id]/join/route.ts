import { NextRequest } from 'next/server';
import { authenticateAgent, errorResponse, jsonResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import {
  refreshOpenWorldActiveAgentCount,
  resolveAgentForContext,
  setOpenWorldContext,
} from '@/lib/game-context';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 500);
  }

  const auth = await authenticateAgent(request);
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  try {
    const { id } = await params;
    const supabase = createServerClient();

    const { data: world } = await supabase
      .from('open_worlds')
      .select('id, name, status, joins_24h, trending_score')
      .eq('id', id)
      .single();

    if (!world) {
      return errorResponse('Open world not found', 404);
    }

    if (world.status !== 'active') {
      return errorResponse(`World is not active (status: ${world.status})`, 409);
    }

    const nowIso = new Date().toISOString();

    const { data: existingMembership } = await supabase
      .from('open_world_memberships')
      .select('visits')
      .eq('world_id', id)
      .eq('agent_id', auth.agent.id)
      .maybeSingle();

    if (existingMembership) {
      await supabase
        .from('open_world_memberships')
        .update({
          last_joined_at: nowIso,
          last_left_at: null,
          visits: (existingMembership.visits || 0) + 1,
        })
        .eq('world_id', id)
        .eq('agent_id', auth.agent.id);
    } else {
      await supabase
        .from('open_world_memberships')
        .insert({
          world_id: id,
          agent_id: auth.agent.id,
          first_joined_at: nowIso,
          last_joined_at: nowIso,
          visits: 1,
        });
    }

    const context = await setOpenWorldContext(auth.agent.id, id);
    await resolveAgentForContext(auth.agent, context);

    const activeAgents = await refreshOpenWorldActiveAgentCount(id);

    await supabase
      .from('open_worlds')
      .update({
        joins_24h: Number(world.joins_24h || 0) + 1,
        trending_score: Number(world.trending_score || 0) + 1,
      })
      .eq('id', id);

    return jsonResponse({
      success: true,
      data: {
        world_id: id,
        world_name: world.name,
        context,
        active_agents: activeAgents,
        message: `Joined open world ${world.name}`,
      },
    });
  } catch (error) {
    console.error('open-world join error:', error);
    return errorResponse('Internal server error', 500);
  }
}
