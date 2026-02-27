import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import {
  Tournament,
  TournamentEntry,
  type TournamentViewerEntry,
  type TournamentViewerStatus,
} from '@/lib/tournament-types';

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

    // Get leaderboard from view
    const { data: leaderboard, error: leaderboardError } = await supabase
      .from('tournament_leaderboard')
      .select('*')
      .eq('tournament_id', id)
      .order('current_score', { ascending: false })
      .range(offset, offset + limit - 1);

    if (leaderboardError) {
      console.error('Error fetching leaderboard:', leaderboardError);
      return errorResponse('Failed to fetch leaderboard', 500);
    }

    // Get total participant count
    const { count: totalParticipants, error: countError } = await supabase
      .from('tournament_entries')
      .select('*', { count: 'exact', head: true })
      .eq('tournament_id', id);

    if (countError) {
      console.error('Error counting participants:', countError);
    }

    const hasAuthorizationHeader = !!request.headers.get('authorization');
    let viewerStatus: TournamentViewerStatus = 'anonymous';
    let viewerEntry: TournamentViewerEntry | null = null;
    if (hasAuthorizationHeader) {
      const auth = await authenticateAgent(request);
      if (auth.success && auth.agent) {
        const { data: viewerRow, error: viewerError } = await supabase
          .from('tournament_leaderboard')
          .select('id, tournament_id, agent_id, agent_name, current_score, live_rank, final_rank, joined_at')
          .eq('tournament_id', id)
          .eq('agent_id', auth.agent.id)
          .maybeSingle();

        if (viewerError) {
          console.error('Error fetching viewer tournament entry:', viewerError);
        } else if (viewerRow) {
          viewerEntry = {
            id: viewerRow.id,
            tournament_id: viewerRow.tournament_id,
            agent_id: viewerRow.agent_id,
            agent_name: viewerRow.agent_name,
            current_score: viewerRow.current_score,
            live_rank: viewerRow.live_rank,
            final_rank: viewerRow.final_rank,
            joined_at: viewerRow.joined_at,
          };
        }
        viewerStatus = viewerEntry ? 'joined' : 'not_joined';
      }
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
        participants: {
          total: totalParticipants || 0,
        },
        viewer_status: viewerStatus,
        viewer_entry: viewerEntry,
        winners,
        ...(participation ? { participation } : {}),
        pagination: {
          limit,
          offset,
          has_more: (leaderboard?.length || 0) === limit,
        },
      },
    });
  } catch (error) {
    console.error('Tournament detail error:', error);
    return errorResponse('Internal server error', 500);
  }
}
