import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse, authenticateAgent } from '@/lib/auth';
import { Tournament, TournamentEntry } from '@/lib/tournament-types';
import { calculateWealth } from '@/lib/types';

/**
 * POST /api/tournaments/join
 * Auto-joins the current active tournament
 * Requires agent authentication
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

    // Calculate starting values
    const startingWealth = calculateWealth({
      gold: agent.gold,
      wood: agent.wood,
      food: agent.food,
      stone: agent.stone,
    });

    // Get territory count
    const { count: territoryCount } = await supabase
      .from('tiles')
      .select('*', { count: 'exact', head: true })
      .eq('owner_id', agent.id);

    // Get total gathered
    const startingGathered = 
      (agent.total_gathered_gold || 0) +
      (agent.total_gathered_wood || 0) +
      (agent.total_gathered_food || 0) +
      (agent.total_gathered_stone || 0);

    // Get completed trades count
    const { count: tradesCount } = await supabase
      .from('trades')
      .select('*', { count: 'exact', head: true })
      .or(`from_agent_id.eq.${agent.id},to_agent_id.eq.${agent.id}`)
      .eq('status', 'accepted');

    // Get forum upvotes
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

    // Create tournament entry
    const { data: newEntry, error: createError } = await supabase
      .from('tournament_entries')
      .insert({
        tournament_id: tournament.id,
        agent_id: agent.id,
        starting_wealth: startingWealth,
        starting_territories: territoryCount || 0,
        starting_gathered: startingGathered,
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
        message: 'Successfully joined tournament',
      },
    }, 201);
  } catch (error) {
    console.error('Tournament join error:', error);
    return errorResponse('Internal server error', 500);
  }
}
