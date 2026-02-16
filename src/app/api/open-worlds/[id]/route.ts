import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { errorResponse, jsonResponse } from '@/lib/auth';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 500);
  }

  try {
    const { id } = await params;
    const supabase = createServerClient();

    const { data: world, error } = await supabase
      .from('open_worlds')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !world) {
      return errorResponse('Open world not found', 404);
    }

    const [{ data: owner }, { count: activeAgents }] = await Promise.all([
      supabase
        .from('agents')
        .select('id, name')
        .eq('id', world.owner_agent_id)
        .maybeSingle(),
      supabase
        .from('agent_context')
        .select('*', { count: 'exact', head: true })
        .eq('mode', 'open_world')
        .eq('world_id', world.id),
    ]);

    return jsonResponse({
      success: true,
      data: {
        ...world,
        owner_agent_name: owner?.name || 'Unknown',
        active_agents: activeAgents || 0,
      },
    });
  } catch (error) {
    console.error('open-world detail error:', error);
    return errorResponse('Internal server error', 500);
  }
}
