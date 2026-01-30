import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  const auth = await authenticateAgent(request);
  
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  const agent = auth.agent;
  const supabase = createServerClient();
  const url = new URL(request.url);

  // Query params
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const since = url.searchParams.get('since'); // ISO timestamp for polling

  // Fetch speak events where:
  // - Agent sent the message, OR
  // - Message was whispered TO this agent
  let query = supabase
    .from('events')
    .select('id, agent_id, type, data, location, created_at')
    .eq('type', 'speak')
    .or(`agent_id.eq.${agent.id},data->target_id.eq.${agent.id}`)
    .order('created_at', { ascending: false })
    .limit(limit);

  // Filter by timestamp if provided (for polling new messages)
  if (since) {
    query = query.gt('created_at', since);
  }

  const { data: messages, error } = await query;

  if (error) {
    console.error('Error fetching messages:', error);
    return errorResponse('Failed to fetch messages', 500);
  }

  // Get all unique agent IDs to fetch names
  const agentIds = new Set<string>();
  messages?.forEach(msg => {
    agentIds.add(msg.agent_id);
    const targetId = (msg.data as Record<string, unknown>)?.target_id as string | undefined;
    if (targetId) agentIds.add(targetId);
  });

  // Fetch agent names
  const { data: agents } = await supabase
    .from('agents')
    .select('id, name')
    .in('id', Array.from(agentIds));

  const nameMap = new Map(agents?.map(a => [a.id, a.name]) || []);

  // Format messages for response
  const formattedMessages = messages?.map(msg => {
    const data = msg.data as Record<string, unknown>;
    return {
      id: msg.id,
      from: nameMap.get(msg.agent_id) || 'Unknown',
      from_id: msg.agent_id,
      message: data.message as string,
      is_whisper: !!data.is_whisper,
      to: data.target_name as string | undefined,
      to_id: data.target_id as string | undefined,
      location: msg.location,
      created_at: msg.created_at,
      is_from_me: msg.agent_id === agent.id,
    };
  }) || [];

  return jsonResponse({
    success: true,
    data: {
      messages: formattedMessages,
      count: formattedMessages.length,
      agent_id: agent.id,
      agent_name: agent.name,
    },
  });
}
