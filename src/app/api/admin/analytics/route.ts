import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminSession, isAdminConfigured } from '@/lib/admin-auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';

interface DailyMetric {
  date: string;
  count: number;
}

interface AnalyticsData {
  newAgentsPerDay: DailyMetric[];
  activeAgentsPerDay: DailyMetric[];
  tradesPerDay: DailyMetric[];
  eventsPerDay: DailyMetric[];
  forumThreadsPerDay: DailyMetric[];
  forumPostsPerDay: DailyMetric[];
  retentionRate: {
    day1: number;
    day7: number;
    day30: number;
  };
  topAgentsByActivity: Array<{
    name: string;
    eventCount: number;
  }>;
  resourceDistribution: {
    totalGold: number;
    totalWood: number;
    totalFood: number;
    totalStone: number;
  };
  hourlyActivityHeatmap: Array<{
    hour: number;
    count: number;
  }>;
}

// Helper to get date string in YYYY-MM-DD format
function formatDateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Helper to generate array of last N days
function getLastNDays(n: number): string[] {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    days.push(formatDateKey(date));
  }
  return days;
}

interface EventsSummary {
  events_per_day: Array<{ date: string; count: number }> | null;
  active_agents_per_day: Array<{ date: string; count: number }> | null;
  events_per_hour: Array<{ hour: number; count: number }> | null;
  top_agents: Array<{ agent_id: string; event_count: number }> | null;
  total_events: number;
}

// Try to use the RPC function for efficient aggregated analytics.
// Falls back to paginated row fetching if the RPC function doesn't exist yet.
async function getEventsSummary(
  supabase: ReturnType<typeof createServerClient>,
  thirtyDaysAgo: Date,
): Promise<EventsSummary | null> {
  const { data, error } = await supabase.rpc('analytics_events_summary', {
    since_date: thirtyDaysAgo.toISOString(),
  });

  if (error || !data) return null;
  return data as EventsSummary;
}

// Fallback: fetch events with pagination and aggregate in JS
async function getEventsSummaryFallback(
  supabase: ReturnType<typeof createServerClient>,
  thirtyDaysAgo: Date,
  last30Days: string[],
): Promise<{
  eventsPerDay: DailyMetric[];
  activeAgentsPerDay: DailyMetric[];
  hourlyActivityHeatmap: Array<{ hour: number; count: number }>;
  topAgentsByActivity: Array<{ agent_id: string; event_count: number }>;
}> {
  // Paginate to fetch ALL events (avoids PostgREST 1000-row default limit)
  const PAGE_SIZE = 1000;
  const allEvents: Array<{ id: string; agent_id: string; created_at: string }> = [];
  let offset = 0;

  while (true) {
    const { data } = await supabase
      .from('events')
      .select('id, agent_id, created_at')
      .gte('created_at', thirtyDaysAgo.toISOString())
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (!data || data.length === 0) break;
    allEvents.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  // Calculate events per day
  const eventsMap: Record<string, number> = {};
  last30Days.forEach(day => { eventsMap[day] = 0; });

  allEvents.forEach(event => {
    const day = formatDateKey(new Date(event.created_at));
    if (eventsMap[day] !== undefined) {
      eventsMap[day]++;
    }
  });

  const eventsPerDay: DailyMetric[] = last30Days.map(date => ({
    date,
    count: eventsMap[date] || 0,
  }));

  // Calculate unique active agents per day
  const activeAgentsMap: Record<string, Set<string>> = {};
  last30Days.forEach(day => { activeAgentsMap[day] = new Set(); });

  allEvents.forEach(event => {
    const day = formatDateKey(new Date(event.created_at));
    if (activeAgentsMap[day]) {
      activeAgentsMap[day].add(event.agent_id);
    }
  });

  const activeAgentsPerDay: DailyMetric[] = last30Days.map(date => ({
    date,
    count: activeAgentsMap[date]?.size || 0,
  }));

  // Hourly activity heatmap
  const hourlyActivity: number[] = Array(24).fill(0);
  allEvents.forEach(event => {
    const hour = new Date(event.created_at).getUTCHours();
    hourlyActivity[hour]++;
  });

  const hourlyActivityHeatmap = hourlyActivity.map((count, hour) => ({
    hour,
    count,
  }));

  // Top agents by activity
  const agentEventCounts: Record<string, number> = {};
  allEvents.forEach(event => {
    agentEventCounts[event.agent_id] = (agentEventCounts[event.agent_id] || 0) + 1;
  });

  const topAgentsByActivity = Object.entries(agentEventCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([agent_id, event_count]) => ({ agent_id, event_count }));

  return { eventsPerDay, activeAgentsPerDay, hourlyActivityHeatmap, topAgentsByActivity };
}

// GET - Fetch analytics data
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
    // Return empty data if Supabase not configured
    const emptyDays = getLastNDays(30).map(date => ({ date, count: 0 }));
    return NextResponse.json({
      success: true,
      data: {
        newAgentsPerDay: emptyDays,
        activeAgentsPerDay: emptyDays,
        tradesPerDay: emptyDays,
        eventsPerDay: emptyDays,
        forumThreadsPerDay: emptyDays,
        forumPostsPerDay: emptyDays,
        retentionRate: { day1: 0, day7: 0, day30: 0 },
        topAgentsByActivity: [],
        resourceDistribution: { totalGold: 0, totalWood: 0, totalFood: 0, totalStone: 0 },
        hourlyActivityHeatmap: Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0 })),
      } as AnalyticsData,
    });
  }

  try {
    const supabase = createServerClient();
    const last30Days = getLastNDays(30);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Fetch all agents created in last 30 days (for new agents metric)
    const { data: agents } = await supabase
      .from('agents')
      .select('id, name, created_at, last_active, gold, wood, food, stone')
      .gte('created_at', thirtyDaysAgo.toISOString())
      .limit(10000);

    // Calculate new agents per day
    const newAgentsMap: Record<string, number> = {};
    last30Days.forEach(day => { newAgentsMap[day] = 0; });

    (agents || []).forEach(agent => {
      const day = formatDateKey(new Date(agent.created_at));
      if (newAgentsMap[day] !== undefined) {
        newAgentsMap[day]++;
      }
    });

    const newAgentsPerDay: DailyMetric[] = last30Days.map(date => ({
      date,
      count: newAgentsMap[date] || 0,
    }));

    // Fetch all agents for resource distribution and name mapping
    const { data: allAgents } = await supabase
      .from('agents')
      .select('id, name, gold, wood, food, stone, last_active')
      .limit(10000);

    // Calculate resource distribution
    const resourceDistribution = {
      totalGold: 0,
      totalWood: 0,
      totalFood: 0,
      totalStone: 0,
    };
    (allAgents || []).forEach(agent => {
      resourceDistribution.totalGold += agent.gold || 0;
      resourceDistribution.totalWood += agent.wood || 0;
      resourceDistribution.totalFood += agent.food || 0;
      resourceDistribution.totalStone += agent.stone || 0;
    });

    const agentNameMap = new Map((allAgents || []).map(a => [a.id, a.name]));

    // ========================================
    // EVENT-BASED METRICS
    // Use RPC aggregate function (efficient, no row limit)
    // Falls back to paginated fetch if migration not applied yet
    // ========================================
    let eventsPerDay: DailyMetric[];
    let activeAgentsPerDay: DailyMetric[];
    let hourlyActivityHeatmap: Array<{ hour: number; count: number }>;
    let topAgentsByActivity: Array<{ name: string; eventCount: number }>;

    const rpcResult = await getEventsSummary(supabase, thirtyDaysAgo);

    if (rpcResult) {
      // RPC function available — use aggregated DB results
      const rpcEventsPerDay = rpcResult.events_per_day || [];
      const rpcActivePerDay = rpcResult.active_agents_per_day || [];
      const rpcHourly = rpcResult.events_per_hour || [];
      const rpcTopAgents = rpcResult.top_agents || [];

      // Merge RPC results into the full 30-day array (fill gaps with 0)
      const eventsMap: Record<string, number> = {};
      last30Days.forEach(day => { eventsMap[day] = 0; });
      rpcEventsPerDay.forEach(row => {
        const key = String(row.date); // comes as YYYY-MM-DD from DB
        if (eventsMap[key] !== undefined) eventsMap[key] = row.count;
      });
      eventsPerDay = last30Days.map(date => ({ date, count: eventsMap[date] || 0 }));

      const activeMap: Record<string, number> = {};
      last30Days.forEach(day => { activeMap[day] = 0; });
      rpcActivePerDay.forEach(row => {
        const key = String(row.date);
        if (activeMap[key] !== undefined) activeMap[key] = row.count;
      });
      activeAgentsPerDay = last30Days.map(date => ({ date, count: activeMap[date] || 0 }));

      // Fill all 24 hours (DB only returns hours with events)
      const hourMap: Record<number, number> = {};
      for (let i = 0; i < 24; i++) hourMap[i] = 0;
      rpcHourly.forEach(row => { hourMap[row.hour] = row.count; });
      hourlyActivityHeatmap = Array.from({ length: 24 }, (_, i) => ({
        hour: i,
        count: hourMap[i] || 0,
      }));

      topAgentsByActivity = rpcTopAgents.map(row => ({
        name: agentNameMap.get(row.agent_id) || 'Unknown',
        eventCount: row.event_count,
      }));
    } else {
      // Fallback: paginated fetch (works without migration)
      const fallback = await getEventsSummaryFallback(supabase, thirtyDaysAgo, last30Days);
      eventsPerDay = fallback.eventsPerDay;
      activeAgentsPerDay = fallback.activeAgentsPerDay;
      hourlyActivityHeatmap = fallback.hourlyActivityHeatmap;
      topAgentsByActivity = fallback.topAgentsByActivity.map(row => ({
        name: agentNameMap.get(row.agent_id) || 'Unknown',
        eventCount: row.event_count,
      }));
    }

    // Fetch trades for the last 30 days
    const { data: trades } = await supabase
      .from('trades')
      .select('id, created_at')
      .eq('status', 'accepted')
      .gte('created_at', thirtyDaysAgo.toISOString())
      .limit(10000);

    // Calculate trades per day
    const tradesMap: Record<string, number> = {};
    last30Days.forEach(day => { tradesMap[day] = 0; });

    (trades || []).forEach(trade => {
      const day = formatDateKey(new Date(trade.created_at));
      if (tradesMap[day] !== undefined) {
        tradesMap[day]++;
      }
    });

    const tradesPerDay: DailyMetric[] = last30Days.map(date => ({
      date,
      count: tradesMap[date] || 0,
    }));

    // Fetch forum threads
    const { data: threads } = await supabase
      .from('forum_threads')
      .select('id, created_at')
      .gte('created_at', thirtyDaysAgo.toISOString())
      .limit(10000);

    // Calculate forum threads per day
    const threadsMap: Record<string, number> = {};
    last30Days.forEach(day => { threadsMap[day] = 0; });

    (threads || []).forEach(thread => {
      const day = formatDateKey(new Date(thread.created_at));
      if (threadsMap[day] !== undefined) {
        threadsMap[day]++;
      }
    });

    const forumThreadsPerDay: DailyMetric[] = last30Days.map(date => ({
      date,
      count: threadsMap[date] || 0,
    }));

    // Fetch forum posts
    const { data: posts } = await supabase
      .from('forum_posts')
      .select('id, created_at')
      .gte('created_at', thirtyDaysAgo.toISOString())
      .limit(10000);

    // Calculate forum posts per day
    const postsMap: Record<string, number> = {};
    last30Days.forEach(day => { postsMap[day] = 0; });

    (posts || []).forEach(post => {
      const day = formatDateKey(new Date(post.created_at));
      if (postsMap[day] !== undefined) {
        postsMap[day]++;
      }
    });

    const forumPostsPerDay: DailyMetric[] = last30Days.map(date => ({
      date,
      count: postsMap[date] || 0,
    }));

    // Calculate retention rates
    const { data: allAgentsForRetention } = await supabase
      .from('agents')
      .select('id, created_at, last_active')
      .limit(10000);

    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const sevenDaysMs = 7 * oneDayMs;
    const thirtyDaysMs = 30 * oneDayMs;

    let day1Total = 0, day1Retained = 0;
    let day7Total = 0, day7Retained = 0;
    let day30Total = 0, day30Retained = 0;

    (allAgentsForRetention || []).forEach(agent => {
      const createdAt = new Date(agent.created_at).getTime();
      const lastActive = new Date(agent.last_active).getTime();
      const ageSinceCreation = now - createdAt;
      const activeWithinPeriod = lastActive - createdAt;

      // Day 1 retention
      if (ageSinceCreation > oneDayMs) {
        day1Total++;
        if (activeWithinPeriod >= oneDayMs || lastActive > createdAt + oneDayMs / 2) {
          day1Retained++;
        }
      }

      // Day 7 retention
      if (ageSinceCreation > sevenDaysMs) {
        day7Total++;
        if (activeWithinPeriod >= sevenDaysMs || lastActive > createdAt + sevenDaysMs) {
          day7Retained++;
        }
      }

      // Day 30 retention
      if (ageSinceCreation > thirtyDaysMs) {
        day30Total++;
        if (activeWithinPeriod >= thirtyDaysMs || lastActive > createdAt + thirtyDaysMs) {
          day30Retained++;
        }
      }
    });

    const retentionRate = {
      day1: day1Total > 0 ? Math.round((day1Retained / day1Total) * 100) : 0,
      day7: day7Total > 0 ? Math.round((day7Retained / day7Total) * 100) : 0,
      day30: day30Total > 0 ? Math.round((day30Retained / day30Total) * 100) : 0,
    };

    const analyticsData: AnalyticsData = {
      newAgentsPerDay,
      activeAgentsPerDay,
      tradesPerDay,
      eventsPerDay,
      forumThreadsPerDay,
      forumPostsPerDay,
      retentionRate,
      topAgentsByActivity,
      resourceDistribution,
      hourlyActivityHeatmap,
    };

    return NextResponse.json({
      success: true,
      data: analyticsData,
    });
  } catch (error) {
    console.error('Analytics fetch error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
