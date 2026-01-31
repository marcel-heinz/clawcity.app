import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { HallOfFameEntry, TournamentWinner } from '@/lib/tournament-types';

/**
 * GET /api/tournaments/history
 * Returns Hall of Fame and recent winners
 */
export async function GET() {
  if (!isSupabaseConfigured) {
    return jsonResponse({
      success: true,
      data: {
        hall_of_fame: [],
        recent_winners: [],
      },
    });
  }

  try {
    const supabase = createServerClient();

    // Get Hall of Fame from view
    const { data: hallOfFame, error: hofError } = await supabase
      .from('tournament_hall_of_fame')
      .select('*')
      .limit(50);

    if (hofError) {
      console.error('Error fetching hall of fame:', hofError);
    }

    // Get recent winners with tournament info
    const { data: recentWinners, error: winnersError } = await supabase
      .from('tournament_winners')
      .select(`
        id,
        tournament_id,
        agent_id,
        rank,
        final_score,
        tournament_type,
        created_at,
        tournaments (name)
      `)
      .order('created_at', { ascending: false })
      .limit(15);

    if (winnersError) {
      console.error('Error fetching recent winners:', winnersError);
    }

    // Get agent names for winners
    const agentIds = [...new Set(recentWinners?.map(w => w.agent_id) || [])];
    let agentMap = new Map<string, string>();

    if (agentIds.length > 0) {
      const { data: agents } = await supabase
        .from('agents')
        .select('id, name')
        .in('id', agentIds);

      agentMap = new Map(agents?.map(a => [a.id, a.name]) || []);
    }

    // Enrich winners with agent names and tournament names
    const enrichedWinners = (recentWinners || []).map(w => {
      // Supabase returns joined data - handle both object and array formats
      const tournaments = w.tournaments as unknown;
      let tournamentName = 'Unknown Tournament';
      if (tournaments && typeof tournaments === 'object') {
        if (Array.isArray(tournaments) && tournaments.length > 0) {
          tournamentName = (tournaments[0] as { name?: string })?.name || 'Unknown Tournament';
        } else if ('name' in tournaments) {
          tournamentName = (tournaments as { name: string }).name;
        }
      }
      
      return {
        id: w.id,
        tournament_id: w.tournament_id,
        agent_id: w.agent_id,
        agent_name: agentMap.get(w.agent_id) || 'Unknown',
        rank: w.rank as 1 | 2 | 3,
        final_score: w.final_score,
        tournament_type: w.tournament_type,
        tournament_name: tournamentName,
        created_at: w.created_at,
      };
    });

    return jsonResponse({
      success: true,
      data: {
        hall_of_fame: (hallOfFame || []) as HallOfFameEntry[],
        recent_winners: enrichedWinners as (TournamentWinner & { tournament_name: string })[],
      },
    });
  } catch (error) {
    console.error('Tournament history error:', error);
    return errorResponse('Internal server error', 500);
  }
}
