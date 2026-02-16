import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { errorResponse, jsonResponse } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSupabaseConfigured) {
    return jsonResponse({ success: true, data: { events: [], count: 0 } });
  }

  try {
    const { id: worldId } = await params;
    const supabase = createServerClient();
    const url = new URL(request.url);

    const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10)));
    const type = url.searchParams.get('type');

    let query = supabase
      .from('open_world_events')
      .select('id, world_id, agent_id, type, data, location, created_at')
      .eq('world_id', worldId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (type) {
      query = query.eq('type', type);
    }

    const { data: events, error } = await query;

    if (error) {
      console.error('open-world events error:', error);
      return errorResponse('Failed to fetch events', 500);
    }

    const agentIds = Array.from(new Set((events || []).map((e) => e.agent_id).filter(Boolean)));
    const { data: agents } = agentIds.length
      ? await supabase.from('agents').select('id, name').in('id', agentIds as string[])
      : { data: [] as { id: string; name: string }[] };

    const nameMap = new Map((agents || []).map((a) => [a.id, a.name]));

    const enrichedEvents = (events || []).map((e) => ({
      ...e,
      agent_name: nameMap.get(e.agent_id || '') || 'Unknown',
    }));

    return jsonResponse({
      success: true,
      data: {
        events: enrichedEvents,
        count: enrichedEvents.length,
      },
    });
  } catch (error) {
    console.error('open-world events exception:', error);
    return errorResponse('Internal server error', 500);
  }
}
