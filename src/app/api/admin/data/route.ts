import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminSession, isAdminConfigured } from '@/lib/admin-auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';

// GET - Fetch admin dashboard data
export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { success: false, error: 'Admin dashboard not configured' },
      { status: 503 }
    );
  }

  if (!verifyAdminSession(request)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json({
      success: true,
      data: {
        stats: {
          total_agents: 0,
          active_agents: 0,
          total_trades: 0,
          total_events: 0,
          total_territories: 0,
        },
        agents: [],
        recent_events: [],
      },
    });
  }

  try {
    const supabase = createServerClient();

    // Fetch all agents with their full data
    const { data: agents, error: agentsError } = await supabase
      .from('agents')
      .select('*')
      .order('created_at', { ascending: false });

    if (agentsError) {
      console.error('Error fetching agents:', agentsError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch agents' },
        { status: 500 }
      );
    }

    // Calculate active agents (active in last 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const activeAgents = (agents || []).filter(
      (agent) => agent.last_active >= fiveMinutesAgo
    ).length;

    // Count trades
    const { count: tradesCount, error: tradesError } = await supabase
      .from('trades')
      .select('*', { count: 'exact', head: true });

    if (tradesError) {
      console.error('Error counting trades:', tradesError);
    }

    // Count events
    const { count: eventsCount, error: eventsError } = await supabase
      .from('events')
      .select('*', { count: 'exact', head: true });

    if (eventsError) {
      console.error('Error counting events:', eventsError);
    }

    // Count territories (tiles with owners)
    const { count: territoriesCount, error: territoriesError } = await supabase
      .from('tiles')
      .select('*', { count: 'exact', head: true })
      .not('owner_id', 'is', null);

    if (territoriesError) {
      console.error('Error counting territories:', territoriesError);
    }

    // Fetch recent events
    const { data: recentEvents, error: eventsDataError } = await supabase
      .from('events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (eventsDataError) {
      console.error('Error fetching events:', eventsDataError);
    }

    // Enrich events with agent names
    const agentMap = new Map((agents || []).map((a) => [a.id, a.name]));
    const enrichedEvents = (recentEvents || []).map((event) => ({
      ...event,
      agent_name: agentMap.get(event.agent_id) || 'Unknown',
    }));

    return NextResponse.json({
      success: true,
      data: {
        stats: {
          total_agents: agents?.length || 0,
          active_agents: activeAgents,
          total_trades: tradesCount || 0,
          total_events: eventsCount || 0,
          total_territories: territoriesCount || 0,
        },
        agents: agents || [],
        recent_events: enrichedEvents,
      },
    });
  } catch (error) {
    console.error('Admin data fetch error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
