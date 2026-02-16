import { NextRequest } from 'next/server';
import { authenticateAgent, errorResponse, jsonResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import {
  refreshOpenWorldActiveAgentCount,
  resolveGameplayContext,
  setTournamentContext,
} from '@/lib/game-context';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 500);
  }

  const auth = await authenticateAgent(request);
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  try {
    const contextBefore = await resolveGameplayContext(auth.agent.id);
    const supabase = createServerClient();

    if (contextBefore.mode === 'open_world' && contextBefore.world_id) {
      await supabase
        .from('open_world_memberships')
        .update({ last_left_at: new Date().toISOString() })
        .eq('world_id', contextBefore.world_id)
        .eq('agent_id', auth.agent.id);
    }

    const nextContext = await setTournamentContext(auth.agent.id);

    if (contextBefore.mode === 'open_world' && contextBefore.world_id) {
      await refreshOpenWorldActiveAgentCount(contextBefore.world_id);
    }

    return jsonResponse({
      success: true,
      data: {
        context: nextContext,
        message: 'Switched to tournament realm',
      },
    });
  } catch (error) {
    console.error('open-world leave error:', error);
    return errorResponse('Internal server error', 500);
  }
}
