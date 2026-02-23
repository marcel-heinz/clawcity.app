import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminSession, isAdminConfigured } from '@/lib/admin-auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getAllCooldowns } from '@/lib/game-settings';
import { isRateLimitRedisEnabled } from '@/lib/rate-limit';
import { toPublicAvatarLabView } from '@/lib/avatar-lab';
import { isAgentOnline, PRESENCE_ONLINE_WINDOW_MS, resolveLastSeenAt } from '@/lib/presence';

interface PerkSpendSummary {
  purchases: number;
  units: number;
  credits_spent: number;
}

interface ClawCreditOverview {
  wallet_balance_total: number;
  lifetime_claimed_total: number;
  lifetime_spent_total: number;
  unclaimed_total: number;
  claimable_total: number;
  locked_total: number;
  unclaimed_rewards_count: number;
  claimed_rewards_count: number;
  total_rewards_count: number;
  started_week_number: number;
  perk_spend_total: number;
  perk_purchases_count: number;
  perk_units_total: number;
  by_perk: {
    instant_storage: PerkSpendSummary;
    durable_axe: PerkSpendSummary;
  };
}

type TournamentPerkId = keyof ClawCreditOverview['by_perk'];

interface TournamentPerkPurchaseRow {
  id: string;
  perk_id: string | null;
  quantity: number | string | null;
  claw_credit_cost: number | string | null;
}

const PAGE_SIZE = 1000;

function toInt(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isTournamentPerkId(value: unknown): value is TournamentPerkId {
  return value === 'instant_storage' || value === 'durable_axe';
}

function createEmptyClawCreditOverview(): ClawCreditOverview {
  return {
    wallet_balance_total: 0,
    lifetime_claimed_total: 0,
    lifetime_spent_total: 0,
    unclaimed_total: 0,
    claimable_total: 0,
    locked_total: 0,
    unclaimed_rewards_count: 0,
    claimed_rewards_count: 0,
    total_rewards_count: 0,
    started_week_number: 0,
    perk_spend_total: 0,
    perk_purchases_count: 0,
    perk_units_total: 0,
    by_perk: {
      instant_storage: {
        purchases: 0,
        units: 0,
        credits_spent: 0,
      },
      durable_axe: {
        purchases: 0,
        units: 0,
        credits_spent: 0,
      },
    },
  };
}

async function getClawCreditOverview(
  supabase: ReturnType<typeof createServerClient>,
): Promise<ClawCreditOverview> {
  const overview = createEmptyClawCreditOverview();

  try {
    const startedWeekResult = await supabase.rpc('current_started_tournament_week');
    overview.started_week_number = toInt(startedWeekResult.data);

    // Aggregate wallet balances and lifetime claimed/spent.
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('claw_credit_wallets')
        .select('agent_id, balance, lifetime_earned, lifetime_spent')
        .order('agent_id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        throw new Error(`Failed to fetch claw_credit_wallets: ${error.message}`);
      }

      if (!data || data.length === 0) {
        break;
      }

      for (const row of data) {
        overview.wallet_balance_total += toInt(row.balance);
        overview.lifetime_claimed_total += toInt(row.lifetime_earned);
        overview.lifetime_spent_total += toInt(row.lifetime_spent);
      }

      if (data.length < PAGE_SIZE) {
        break;
      }
    }

    // Aggregate unclaimed rewards and split by claimability.
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('claw_credit_rewards')
        .select('id, amount, unlock_week_number')
        .is('claimed_at', null)
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        throw new Error(`Failed to fetch unclaimed claw_credit_rewards: ${error.message}`);
      }

      if (!data || data.length === 0) {
        break;
      }

      overview.unclaimed_rewards_count += data.length;
      for (const row of data) {
        const amount = Math.max(0, toInt(row.amount));
        const unlockWeek = toInt(row.unlock_week_number);
        overview.unclaimed_total += amount;
        if (unlockWeek <= overview.started_week_number) {
          overview.claimable_total += amount;
        } else {
          overview.locked_total += amount;
        }
      }

      if (data.length < PAGE_SIZE) {
        break;
      }
    }

    // Aggregate perk purchases and spend breakdown.
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from('tournament_perk_purchases')
        .select('id, perk_id, quantity, claw_credit_cost')
        .order('created_at', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        throw new Error(`Failed to fetch tournament_perk_purchases: ${error.message}`);
      }

      if (!data || data.length === 0) {
        break;
      }

      const purchaseRows = data as TournamentPerkPurchaseRow[];

      overview.perk_purchases_count += purchaseRows.length;
      for (const row of purchaseRows) {
        const quantity = Math.max(0, toInt(row.quantity));
        const cost = Math.max(0, toInt(row.claw_credit_cost));
        overview.perk_spend_total += cost;
        overview.perk_units_total += quantity;

        const perkId = row.perk_id;
        if (isTournamentPerkId(perkId)) {
          overview.by_perk[perkId].purchases += 1;
          overview.by_perk[perkId].units += quantity;
          overview.by_perk[perkId].credits_spent += cost;
        }
      }

      if (data.length < PAGE_SIZE) {
        break;
      }
    }

    // Counts for quick sanity checks and reward lifecycle overview.
    const [{ count: totalRewardsCount, error: totalRewardsError }, { count: claimedRewardsCount, error: claimedRewardsError }] = await Promise.all([
      supabase
        .from('claw_credit_rewards')
        .select('*', { count: 'exact', head: true }),
      supabase
        .from('claw_credit_rewards')
        .select('*', { count: 'exact', head: true })
        .not('claimed_at', 'is', null),
    ]);

    if (totalRewardsError) {
      console.error('Error counting total claw credit rewards:', totalRewardsError);
    } else {
      overview.total_rewards_count = toInt(totalRewardsCount);
    }

    if (claimedRewardsError) {
      console.error('Error counting claimed claw credit rewards:', claimedRewardsError);
    } else {
      overview.claimed_rewards_count = toInt(claimedRewardsCount);
    }

    if (overview.total_rewards_count > 0 || overview.claimed_rewards_count > 0) {
      overview.unclaimed_rewards_count = Math.max(
        0,
        overview.total_rewards_count - overview.claimed_rewards_count,
      );
    }
  } catch (error) {
    console.error('Error aggregating claw credit admin overview:', error);
  }

  return overview;
}

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
          agent_limit: 1000,
          avatar_lab_links_today: 0,
          avatar_lab_links_30d: 0,
        },
        cooldowns: {
          move: 2000,
          gather: 5000,
          trade: 5000,
          forum_thread: 60000,
          forum_post: 30000,
        },
        forum: {
          total_threads: 0,
          total_posts: 0,
          threads_today: 0,
          posts_today: 0,
          active_authors: 0,
          hot_category: null,
        },
        claw_credits: createEmptyClawCreditOverview(),
        agents: [],
        recent_events: [],
      },
    });
  }

  try {
    const supabase = createServerClient();
    const nowMs = Date.now();
    const systemFlagProbe = await supabase
      .from('agents')
      .select('is_system')
      .limit(1);
    const supportsSystemFlag = !(
      systemFlagProbe.error &&
      systemFlagProbe.error.message?.includes('is_system')
    );

    // Fetch all agents with their full data
    let agentsQuery = supabase
      .from('agents')
      .select('id, name, x, y, gold, wood, food, stone, reputation, created_at, last_active, claimed, claimed_by_twitter, last_move_at, last_gather_at, last_trade_at, total_gathered_gold, total_gathered_wood, total_gathered_food, total_gathered_stone, last_forum_thread_at, last_forum_post_at, last_food_upkeep_at, food_depleted_at, last_announcement_seen_at, last_gather_x, last_gather_y, consecutive_same_tile, last_craft_at, last_build_at, avatar')
      .order('created_at', { ascending: false });
    if (supportsSystemFlag) {
      agentsQuery = agentsQuery.eq('is_system', false);
    }
    const { data: agents, error: agentsError } = await agentsQuery;

    if (agentsError) {
      console.error('Error fetching agents:', agentsError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch agents' },
        { status: 500 }
      );
    }

    // Calculate active agents using the shared presence model.
    let activeAgents = (agents || []).filter((agent) => isAgentOnline(agent, { nowMs })).length;
    const presenceCutoffIso = new Date(nowMs - PRESENCE_ONLINE_WINDOW_MS).toISOString();
    const presenceOrFilters = [
      `last_active.gte.${presenceCutoffIso}`,
      `last_move_at.gte.${presenceCutoffIso}`,
      `last_gather_at.gte.${presenceCutoffIso}`,
      `last_trade_at.gte.${presenceCutoffIso}`,
      `last_craft_at.gte.${presenceCutoffIso}`,
      `last_build_at.gte.${presenceCutoffIso}`,
      `last_forum_thread_at.gte.${presenceCutoffIso}`,
      `last_forum_post_at.gte.${presenceCutoffIso}`,
    ].join(',');
    let activeAgentsQuery = supabase
      .from('agents')
      .select('*', { count: 'exact', head: true })
      .or(presenceOrFilters);
    if (supportsSystemFlag) {
      activeAgentsQuery = activeAgentsQuery.eq('is_system', false);
    }
    const { count: activeAgentCount, error: activeAgentCountError } = await activeAgentsQuery;
    if (!activeAgentCountError && typeof activeAgentCount === 'number') {
      activeAgents = activeAgentCount;
    } else if (activeAgentCountError) {
      console.error('Error counting online agents for admin dashboard:', activeAgentCountError);
    }

    // Count completed trades (only accepted trades)
    const { count: tradesCount, error: tradesError } = await supabase
      .from('trades')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'accepted');

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

    // Fetch agent limit setting
    const { data: limitSetting, error: limitError } = await supabase
      .from('game_settings')
      .select('value')
      .eq('key', 'agent_limit')
      .single();

    if (limitError) {
      console.error('Error fetching agent limit:', limitError);
    }

    const agentLimit = limitSetting?.value ? Number(limitSetting.value) : 1000;

    // Fetch cooldown settings
    const cooldowns = await getAllCooldowns();

    // Avatar Lab operator link issuance metrics (requested links)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    let avatarLabLinksToday = 0;
    let avatarLabLinks30d = 0;

    const [avatarTodayResult, avatar30dResult] = await Promise.all([
      supabase
        .from('agent_avatar_lab_links')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', todayStart.toISOString()),
      supabase
        .from('agent_avatar_lab_links')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', thirtyDaysAgo.toISOString()),
    ]);

    if (avatarTodayResult.error) {
      console.error('Error counting avatar lab links today:', avatarTodayResult.error);
    } else {
      avatarLabLinksToday = avatarTodayResult.count || 0;
    }

    if (avatar30dResult.error) {
      console.error('Error counting avatar lab links in last 30 days:', avatar30dResult.error);
    } else {
      avatarLabLinks30d = avatar30dResult.count || 0;
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

    // ============================================
    // FORUM ROMANUM STATS
    // ============================================

    // Get total threads
    const { count: totalThreads } = await supabase
      .from('forum_threads')
      .select('*', { count: 'exact', head: true });

    // Get total posts
    const { count: totalPosts } = await supabase
      .from('forum_posts')
      .select('*', { count: 'exact', head: true });

    // Get threads created today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { count: threadsToday } = await supabase
      .from('forum_threads')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString());

    // Get posts created today
    const { count: postsToday } = await supabase
      .from('forum_posts')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString());

    // Get unique active authors (posted in last 24 hours)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { data: recentThreadAuthors } = await supabase
      .from('forum_threads')
      .select('author_id')
      .gte('created_at', yesterday.toISOString());

    const { data: recentPostAuthors } = await supabase
      .from('forum_posts')
      .select('author_id')
      .gte('created_at', yesterday.toISOString());

    const uniqueAuthors = new Set([
      ...(recentThreadAuthors || []).map((t) => t.author_id),
      ...(recentPostAuthors || []).map((p) => p.author_id),
    ]);

    // Get most active category (most threads)
    const { data: categoryStats } = await supabase
      .from('forum_threads')
      .select('category')
      .limit(1000);

    let hotCategory: string | null = null;
    if (categoryStats && categoryStats.length > 0) {
      const categoryCounts: Record<string, number> = {};
      categoryStats.forEach((t) => {
        categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1;
      });
      hotCategory =
        Object.entries(categoryCounts).sort(([, a], [, b]) => b - a)[0]?.[0] ||
        null;
    }

    const clawCredits = await getClawCreditOverview(supabase);
    const compactAgents = (agents || []).map((agent) => ({
      ...agent,
      avatar: toPublicAvatarLabView(agent.name, agent.avatar),
      last_seen_at: resolveLastSeenAt(agent),
      is_online: isAgentOnline(agent, { nowMs }),
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
          agent_limit: agentLimit,
          avatar_lab_links_today: avatarLabLinksToday,
          avatar_lab_links_30d: avatarLabLinks30d,
        },
        cooldowns,
        infrastructure: {
          upstash_redis: isRateLimitRedisEnabled(),
        },
        forum: {
          total_threads: totalThreads || 0,
          total_posts: totalPosts || 0,
          threads_today: threadsToday || 0,
          posts_today: postsToday || 0,
          active_authors: uniqueAuthors.size,
          hot_category: hotCategory,
        },
        claw_credits: clawCredits,
        agents: compactAgents,
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
