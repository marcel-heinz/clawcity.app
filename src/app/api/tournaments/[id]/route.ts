import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { Tournament, TournamentEntry } from '@/lib/tournament-types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const PARTICIPATION_SETTING_KEYS = [
  'claw_credit_participation_reward',
  'claw_credit_participation_min_moved_tiles',
] as const;

type ParticipationSettingKey = (typeof PARTICIPATION_SETTING_KEYS)[number];

function toInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return fallback;
}

function getForumBonusLabel(
  forumBonusPercent: number,
  forumBonusPoints: number
): string {
  if (forumBonusPoints > 0) return `+${forumBonusPoints}`;
  if (forumBonusPercent > 0) return `+${forumBonusPercent}%`;
  return '-';
}

/**
 * GET /api/tournaments/[id]
 * Returns tournament details with full leaderboard
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 500);
  }

  try {
    const supabase = createServerClient();
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const refresh = url.searchParams.get('refresh') === 'true';
    const includeParticipation = url.searchParams.get('include_participation') === 'true';

    // Get tournament details
    const { data: tournament, error: tournamentError } = await supabase
      .from('tournaments')
      .select('*')
      .eq('id', id)
      .single();

    if (tournamentError) {
      if (tournamentError.code === 'PGRST116') {
        return errorResponse('Tournament not found', 404);
      }
      console.error('Error fetching tournament:', tournamentError);
      return errorResponse('Failed to fetch tournament', 500);
    }

    // Optionally refresh scores for active tournaments
    if (refresh && tournament.status === 'active') {
      await supabase.rpc('update_tournament_scores', {
        p_tournament_id: id,
      });
    }

    // Get leaderboard rows directly from tournament entries so forum bonus data is always available.
    const { data: leaderboardRows, error: leaderboardError } = await supabase
      .from('tournament_entries')
      .select(
        'id, tournament_id, agent_id, current_score, forum_bonus_percent, final_rank, joined_at, updated_at, starting_forum_upvotes'
      )
      .eq('tournament_id', id)
      .order('current_score', { ascending: false })
      .order('joined_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (leaderboardError) {
      console.error('Error fetching leaderboard:', leaderboardError);
      return errorResponse('Failed to fetch leaderboard', 500);
    }

    const leaderboardBaseRows = leaderboardRows || [];
    const leaderboardAgentIds = [...new Set(leaderboardBaseRows.map((row) => row.agent_id))];

    let agentNameMap = new Map<string, string>();
    if (leaderboardAgentIds.length > 0) {
      const { data: leaderboardAgents, error: leaderboardAgentsError } = await supabase
        .from('agents')
        .select('id, name')
        .in('id', leaderboardAgentIds);

      if (leaderboardAgentsError) {
        console.error('Error fetching leaderboard agent names:', leaderboardAgentsError);
      } else {
        agentNameMap = new Map((leaderboardAgents || []).map((agent) => [agent.id, agent.name]));
      }
    }

    const strategyBonusMap = new Map<string, number>();
    if (tournament.type === 'territory_conqueror' && leaderboardAgentIds.length > 0) {
      const tournamentEnd = new Date(tournament.ends_at).getTime();
      const boundedUpperTime = Number.isFinite(tournamentEnd) ? Math.min(Date.now(), tournamentEnd) : Date.now();
      const upperBound = new Date(boundedUpperTime).toISOString();

      const { data: strategyRows, error: strategyError } = await supabase
        .from('forum_threads')
        .select('author_id')
        .eq('category', 'strategy')
        .in('author_id', leaderboardAgentIds)
        .gte('created_at', tournament.starts_at)
        .lte('created_at', upperBound);

      if (strategyError) {
        console.error('Error fetching strategy forum bonuses:', strategyError);
      } else {
        for (const row of strategyRows || []) {
          strategyBonusMap.set(row.author_id, (strategyBonusMap.get(row.author_id) || 0) + 1);
        }
      }
    }

    const upvotesByAgentMap = new Map<string, number>();
    if (
      (tournament.type === 'wealth_sprint' || tournament.type === 'master_gatherer') &&
      tournament.status === 'active' &&
      leaderboardAgentIds.length > 0
    ) {
      const [{ data: threadUpvotes, error: threadUpvotesError }, { data: postUpvotes, error: postUpvotesError }] =
        await Promise.all([
          supabase
            .from('forum_threads')
            .select('author_id, vote_count')
            .in('author_id', leaderboardAgentIds),
          supabase
            .from('forum_posts')
            .select('author_id, vote_count')
            .in('author_id', leaderboardAgentIds),
        ]);

      if (threadUpvotesError) {
        console.error('Error fetching thread upvotes for leaderboard bonuses:', threadUpvotesError);
      }
      if (postUpvotesError) {
        console.error('Error fetching post upvotes for leaderboard bonuses:', postUpvotesError);
      }

      for (const row of threadUpvotes || []) {
        upvotesByAgentMap.set(row.author_id, (upvotesByAgentMap.get(row.author_id) || 0) + toInt(row.vote_count, 0));
      }
      for (const row of postUpvotes || []) {
        upvotesByAgentMap.set(row.author_id, (upvotesByAgentMap.get(row.author_id) || 0) + toInt(row.vote_count, 0));
      }
    }

    const leaderboard = leaderboardBaseRows.map((row, index) => {
      const storedForumBonusPercent = Math.max(0, toInt(row.forum_bonus_percent, 0));

      // Wealth/Master Gatherer bonuses are upvote-based and shown live in the leaderboard bonus column.
      let forumBonusPercent = storedForumBonusPercent;
      if (
        tournament.status === 'active' &&
        (tournament.type === 'wealth_sprint' || tournament.type === 'master_gatherer')
      ) {
        const upvotesNow = upvotesByAgentMap.get(row.agent_id) || 0;
        const startingUpvotes = Math.max(0, toInt(row.starting_forum_upvotes, 0));
        const gainedUpvotes = Math.max(0, upvotesNow - startingUpvotes);
        const percentPerUpvote = tournament.type === 'wealth_sprint' ? 5 : 10;
        forumBonusPercent = Math.min(50, gainedUpvotes * percentPerUpvote);
      }

      // Territory Conqueror forum bonus is +1 point per strategy thread (max 10), not percent.
      const forumBonusPoints = tournament.type === 'territory_conqueror'
        ? Math.min(10, strategyBonusMap.get(row.agent_id) || 0)
        : 0;

      return {
        ...row,
        agent_name: agentNameMap.get(row.agent_id) || 'Unknown',
        forum_bonus_percent: forumBonusPercent,
        live_rank: offset + index + 1,
        forum_bonus_points: forumBonusPoints,
        forum_bonus_label: getForumBonusLabel(forumBonusPercent, forumBonusPoints),
      };
    });

    // Get total participant count
    const { count: totalParticipants, error: countError } = await supabase
      .from('tournament_entries')
      .select('*', { count: 'exact', head: true })
      .eq('tournament_id', id);

    if (countError) {
      console.error('Error counting participants:', countError);
    }

    // Get winners if tournament ended
    let winners: { rank: number; agent_name: string; final_score: number }[] = [];
    if (tournament.status === 'ended') {
      const { data: winnersData } = await supabase
        .from('tournament_winners')
        .select('rank, final_score, agent_id')
        .eq('tournament_id', id)
        .order('rank', { ascending: true });

      if (winnersData) {
        // Get agent names for winners
        const agentIds = winnersData.map(w => w.agent_id);
        const { data: agents } = await supabase
          .from('agents')
          .select('id, name')
          .in('id', agentIds);

        const agentMap = new Map(agents?.map(a => [a.id, a.name]) || []);
        winners = winnersData.map(w => ({
          rank: w.rank,
          agent_name: agentMap.get(w.agent_id) || 'Unknown',
          final_score: w.final_score,
        }));
      }
    }

    let participation:
      | {
          rules: {
            rank_requirement: string;
            min_moved_tiles: number;
            reward_amount: number;
          };
          summary: {
            participant_count: number;
            qualified_count: number;
            qualification_rate: number;
          };
          entries: {
            agent_id: string;
            agent_name: string;
            final_rank: number;
            moved_tiles: number;
            qualified: boolean;
            reward_amount: number;
          }[];
        }
      | undefined;

    if (includeParticipation) {
      const [settingsResult, participantCountResult, qualifiedCountResult, participationRowsResult] =
        await Promise.all([
          supabase
            .from('game_settings')
            .select('key, value')
            .in('key', [...PARTICIPATION_SETTING_KEYS]),
          supabase
            .from('tournament_participation')
            .select('*', { count: 'exact', head: true })
            .eq('tournament_id', id),
          supabase
            .from('tournament_participation')
            .select('*', { count: 'exact', head: true })
            .eq('tournament_id', id)
            .eq('qualified', true),
          supabase
            .from('tournament_participation')
            .select('agent_id, final_rank, moved_tiles, qualified, reward_amount')
            .eq('tournament_id', id)
            .order('final_rank', { ascending: true })
            .range(offset, offset + limit - 1),
        ]);

      if (settingsResult.error) {
        console.error('Error fetching participation settings:', settingsResult.error);
      }
      if (participantCountResult.error) {
        console.error('Error counting participation entries:', participantCountResult.error);
      }
      if (qualifiedCountResult.error) {
        console.error('Error counting participation qualifiers:', qualifiedCountResult.error);
      }
      if (participationRowsResult.error) {
        console.error('Error fetching participation entries:', participationRowsResult.error);
      }

      const settingsMap = new Map<ParticipationSettingKey, number>();
      for (const row of settingsResult.data || []) {
        if (!PARTICIPATION_SETTING_KEYS.includes(row.key as ParticipationSettingKey)) continue;
        settingsMap.set(row.key as ParticipationSettingKey, toInt(row.value, 0));
      }

      const minMovedTiles = settingsMap.get('claw_credit_participation_min_moved_tiles') ?? 3;
      const rewardAmount = settingsMap.get('claw_credit_participation_reward') ?? 100;

      const participationRows = participationRowsResult.data || [];
      const participantCount = participantCountResult.count || 0;
      const qualifiedCount = qualifiedCountResult.count || 0;
      const qualificationRate =
        participantCount > 0 ? Math.round((qualifiedCount / participantCount) * 100) : 0;

      let agentNameMap = new Map<string, string>();
      const agentIds = [...new Set(participationRows.map((row) => row.agent_id))];
      if (agentIds.length > 0) {
        const { data: agents, error: agentsError } = await supabase
          .from('agents')
          .select('id, name')
          .in('id', agentIds);

        if (agentsError) {
          console.error('Error fetching participation agent names:', agentsError);
        } else {
          agentNameMap = new Map((agents || []).map((agent) => [agent.id, agent.name]));
        }
      }

      participation = {
        rules: {
          rank_requirement: 'rank >= 4',
          min_moved_tiles: minMovedTiles,
          reward_amount: rewardAmount,
        },
        summary: {
          participant_count: participantCount,
          qualified_count: qualifiedCount,
          qualification_rate: qualificationRate,
        },
        entries: participationRows.map((row) => ({
          agent_id: row.agent_id,
          agent_name: agentNameMap.get(row.agent_id) || 'Unknown',
          final_rank: toInt(row.final_rank, 0),
          moved_tiles: toInt(row.moved_tiles, 0),
          qualified: row.qualified === true,
          reward_amount: toInt(row.reward_amount, 0),
        })),
      };
    }

    return jsonResponse({
      success: true,
      data: {
        tournament: tournament as Tournament,
        leaderboard: (leaderboard || []) as TournamentEntry[],
        total_participants: totalParticipants || 0,
        winners,
        ...(participation ? { participation } : {}),
        pagination: {
          limit,
          offset,
          has_more: (leaderboard.length || 0) === limit,
        },
      },
    });
  } catch (error) {
    console.error('Tournament detail error:', error);
    return errorResponse('Internal server error', 500);
  }
}
