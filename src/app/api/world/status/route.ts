import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return jsonResponse({
      success: true,
      data: {
        agents: [],
        events: [],
        stats: {
          total_agents: 0,
          active_agents: 0,
          total_trades: 0,
        },
        timestamp: new Date().toISOString(),
        message: 'Database not configured. Please set up Supabase.',
      },
    });
  }

  try {
    const supabase = createServerClient();
    const url = new URL(request.url);
    
    // Optional query params for filtering
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const x = url.searchParams.get('x');
    const y = url.searchParams.get('y');
    const radius = parseInt(url.searchParams.get('radius') || '10');

    // Get all agents (public info only)
    let agentsQuery = supabase
      .from('agents')
      .select('id, name, x, y, reputation, last_active')
      .order('reputation', { ascending: false });

    // Filter by area if coordinates provided
    if (x !== null && y !== null) {
      const centerX = parseInt(x);
      const centerY = parseInt(y);
      agentsQuery = agentsQuery
        .gte('x', centerX - radius)
        .lte('x', centerX + radius)
        .gte('y', centerY - radius)
        .lte('y', centerY + radius);
    }

    const { data: agents, error: agentsError } = await agentsQuery.limit(100);

    if (agentsError) {
      console.error('Error fetching agents:', agentsError);
      return errorResponse('Failed to fetch world status', 500);
    }

    // Get recent events
    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select(`
        id,
        agent_id,
        type,
        data,
        location,
        created_at
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (eventsError) {
      console.error('Error fetching events:', eventsError);
      return errorResponse('Failed to fetch events', 500);
    }

    // Enrich events with agent names
    const agentMap = new Map(agents?.map(a => [a.id, a.name]) || []);
    const enrichedEvents = events?.map(e => ({
      ...e,
      agent_name: agentMap.get(e.agent_id) || 'Unknown',
    })) || [];

    // Get world stats
    const { count: totalAgents } = await supabase
      .from('agents')
      .select('*', { count: 'exact', head: true });

    // Count active agents (active in last 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { count: activeAgents } = await supabase
      .from('agents')
      .select('*', { count: 'exact', head: true })
      .gte('last_active', fiveMinutesAgo);

    // Count completed trades
    const { count: totalTrades } = await supabase
      .from('trades')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'accepted');

    return jsonResponse({
      success: true,
      data: {
        agents: agents || [],
        events: enrichedEvents,
        stats: {
          total_agents: totalAgents || 0,
          active_agents: activeAgents || 0,
          total_trades: totalTrades || 0,
        },
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('World status error:', error);
    return errorResponse('Internal server error', 500);
  }
}
