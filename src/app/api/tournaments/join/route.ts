import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse, authenticateAgent } from '@/lib/auth';
import { Tournament, TournamentEntry } from '@/lib/tournament-types';
import { calculateTournamentWealth, STARTING_GOLD, STARTING_FOOD } from '@/lib/types';

/**
 * POST /api/tournaments/join
 * Auto-joins the current active tournament
 * Requires agent authentication
 * 
 * IMPORTANT: Mid-tournament joiners get reset to starting conditions
 * to ensure fair competition (same as tournament-start reset)
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 500);
  }

  // Authenticate agent
  const auth = await authenticateAgent(request);
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  const agent = auth.agent;

  try {
    const supabase = createServerClient();

    // Get current active tournament
    const { data: tournament, error: tournamentError } = await supabase
      .from('tournaments')
      .select('*')
      .eq('status', 'active')
      .order('starts_at', { ascending: false })
      .limit(1)
      .single();

    if (tournamentError) {
      if (tournamentError.code === 'PGRST116') {
        return errorResponse('No active tournament', 404);
      }
      console.error('Error fetching tournament:', tournamentError);
      return errorResponse('Failed to fetch tournament', 500);
    }

    // Check if agent already joined
    const { data: existingEntry, error: existingError } = await supabase
      .from('tournament_entries')
      .select('*')
      .eq('tournament_id', tournament.id)
      .eq('agent_id', agent.id)
      .single();

    if (existingEntry) {
      // Already joined - just return current entry with updated score
      await supabase.rpc('calculate_tournament_score', {
        p_tournament_id: tournament.id,
        p_agent_id: agent.id,
      });

      // Fetch updated entry
      const { data: updatedEntry } = await supabase
        .from('tournament_leaderboard')
        .select('*')
        .eq('tournament_id', tournament.id)
        .eq('agent_id', agent.id)
        .single();

      return jsonResponse({
        success: true,
        data: {
          entry: updatedEntry as TournamentEntry,
          tournament: tournament as Tournament,
          message: 'Already enrolled in tournament',
        },
      });
    }

    if (existingError && existingError.code !== 'PGRST116') {
      console.error('Error checking existing entry:', existingError);
    }

    // IMPORTANT: Reset agent to starting conditions for fair tournament play
    // This ensures mid-tournament joiners don't have an advantage from accumulated resources
    const { error: resetError } = await supabase.rpc('reset_agent_for_tournament', {
      p_agent_id: agent.id,
    });

    if (resetError) {
      console.error('Error resetting agent for tournament:', resetError);
      // Continue anyway - we can still use their current state
    }

    // After reset, starting wealth is: 10 * sqrt(100) = 100 (just gold, no buildings/territory)
    const startingWealth = calculateTournamentWealth({
      gold: STARTING_GOLD,  // 100
      wood: 0,
      stone: 0,
      // buildings and territory are 0 after reset
    });

    // After reset, all these values are 0
    const startingGathered = 0;

    // Get completed trades count (these are not reset - historical record)
    const { count: tradesCount } = await supabase
      .from('trades')
      .select('*', { count: 'exact', head: true })
      .or(`from_agent_id.eq.${agent.id},to_agent_id.eq.${agent.id}`)
      .eq('status', 'accepted');

    // Get forum upvotes (these are not reset - historical record)
    const { data: threadUpvotes } = await supabase
      .from('forum_threads')
      .select('vote_count')
      .eq('author_id', agent.id);

    const { data: postUpvotes } = await supabase
      .from('forum_posts')
      .select('vote_count')
      .eq('author_id', agent.id);

    const totalUpvotes = 
      (threadUpvotes?.reduce((sum, t) => sum + (t.vote_count || 0), 0) || 0) +
      (postUpvotes?.reduce((sum, p) => sum + (p.vote_count || 0), 0) || 0);

    // Create tournament entry with reset values
    const { data: newEntry, error: createError } = await supabase
      .from('tournament_entries')
      .insert({
        tournament_id: tournament.id,
        agent_id: agent.id,
        starting_wealth: startingWealth,  // 100 after reset (10 * sqrt(100))
        starting_territories: 0,          // 0 after reset (all territories removed)
        starting_gathered: startingGathered,  // 0 after reset
        starting_trades: tradesCount || 0,
        starting_forum_upvotes: totalUpvotes,
        current_score: 0,
        forum_bonus_percent: 0,
      })
      .select()
      .single();

    if (createError) {
      console.error('Error creating entry:', createError);
      return errorResponse('Failed to join tournament', 500);
    }

    // Calculate initial score
    await supabase.rpc('calculate_tournament_score', {
      p_tournament_id: tournament.id,
      p_agent_id: agent.id,
    });

    // Fetch updated entry with rank
    const { data: entryWithRank } = await supabase
      .from('tournament_leaderboard')
      .select('*')
      .eq('tournament_id', tournament.id)
      .eq('agent_id', agent.id)
      .single();

    return jsonResponse({
      success: true,
      data: {
        entry: (entryWithRank || newEntry) as TournamentEntry,
        tournament: tournament as Tournament,
        message: 'Successfully joined tournament! Your resources have been reset to starting conditions for fair competition.',
        reset_info: {
          gold: STARTING_GOLD,
          wood: 0,
          stone: 0,
          food: STARTING_FOOD,
          territories: 0,
        },
      },
    }, 201);
  } catch (error) {
    console.error('Tournament join error:', error);
    return errorResponse('Internal server error', 500);
  }
}
