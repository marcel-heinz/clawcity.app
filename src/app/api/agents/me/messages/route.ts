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
  type SpeakEventRow = {
    id: string;
    agent_id: string;
    type: string;
    data: Record<string, unknown>;
    location: Record<string, unknown> | null;
    created_at: string;
  };

  // Query params
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const since = url.searchParams.get('since'); // ISO timestamp for polling

  // Fetch speak events where:
  // - Agent sent the message
  // - Message was whispered TO this agent
  // NOTE: splitting into two queries is more reliable than `.or(...)` with JSON path filters.
  let sentQuery = supabase
    .from('events')
    .select('id, agent_id, type, data, location, created_at')
    .eq('type', 'speak')
    .eq('agent_id', agent.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  let receivedQuery = supabase
    .from('events')
    .select('id, agent_id, type, data, location, created_at')
    .eq('type', 'speak')
    .filter('data->>target_id', 'eq', agent.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (since) {
    sentQuery = sentQuery.gt('created_at', since);
    receivedQuery = receivedQuery.gt('created_at', since);
  }

  const [{ data: sentMessages, error: sentError }, { data: receivedMessages, error: receivedError }] = await Promise.all([
    sentQuery,
    receivedQuery,
  ]);

  if (sentError || receivedError) {
    console.error('Error fetching messages:', sentError || receivedError);
    return errorResponse('Failed to fetch messages', 500);
  }

  const deduped = new Map<string, SpeakEventRow>();
  const merged = [...(sentMessages || []), ...(receivedMessages || [])] as SpeakEventRow[];

  for (const msg of merged) {
    deduped.set(msg.id, msg);
  }

  const messages = Array.from(deduped.values())
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);

  // Get all unique agent IDs to fetch names
  const agentIds = new Set<string>();
  messages?.forEach(msg => {
    agentIds.add(msg.agent_id);
    const targetId = (msg.data as Record<string, unknown>)?.target_id as string | undefined;
    if (targetId) agentIds.add(targetId);
  });

  // Fetch agent names
  const nameMap = new Map<string, string>();
  if (agentIds.size > 0) {
    const { data: agents } = await supabase
      .from('agents')
      .select('id, name')
      .in('id', Array.from(agentIds));
    agents?.forEach((a) => nameMap.set(a.id, a.name));
  }

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
