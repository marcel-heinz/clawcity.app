import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { Tournament, TournamentEntry } from '@/lib/tournament-types';

interface RouteParams {
  params: Promise<{ id: string }>;
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

    return jsonResponse({
      success: true,
      data: {
        tournament: tournament as Tournament,
        leaderboard: (leaderboard || []) as TournamentEntry[],
        total_participants: totalParticipants || 0,
        winners,
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
