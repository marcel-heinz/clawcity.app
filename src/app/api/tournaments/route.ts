import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { Tournament } from '@/lib/tournament-types';

/**
 * GET /api/tournaments
 * Returns current active tournament, recent ended tournaments, and next upcoming
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return jsonResponse({
      success: true,
      data: {
        current: null,
        recent: [],
        upcoming: null,
      },
    });
  }

  try {
    const supabase = createServerClient();
    const url = new URL(request.url);
    const recentLimit = parseInt(url.searchParams.get('recent_limit') || '5');

    // Get current active tournament
    const { data: currentTournament, error: currentError } = await supabase
      .from('tournaments')
      .select('*')
      .eq('status', 'active')
      .order('starts_at', { ascending: false })
      .limit(1)
      .single();

    if (currentError && currentError.code !== 'PGRST116') {
      console.error('Error fetching current tournament:', currentError);
    }

    // Get recent ended tournaments
    const { data: recentTournaments, error: recentError } = await supabase
      .from('tournaments')
      .select('*')
      .eq('status', 'ended')
      .order('ends_at', { ascending: false })
      .limit(recentLimit);

    if (recentError) {
      console.error('Error fetching recent tournaments:', recentError);
    }

    // Get next upcoming tournament (if no active one)
    let upcomingTournament: Tournament | null = null;
    if (!currentTournament) {
      const { data: upcoming, error: upcomingError } = await supabase
        .from('tournaments')
        .select('*')
        .eq('status', 'upcoming')
        .order('starts_at', { ascending: true })
        .limit(1)
        .single();

      if (upcomingError && upcomingError.code !== 'PGRST116') {
        console.error('Error fetching upcoming tournament:', upcomingError);
      }
      upcomingTournament = upcoming as Tournament | null;
    }

    // If there's a current tournament, get top 3 for the banner
    let topThree: { agent_id: string; agent_name: string; current_score: number; live_rank: number }[] = [];
    if (currentTournament) {
      const { data: leaderboard } = await supabase
        .from('tournament_leaderboard')
        .select('agent_id, agent_name, current_score, live_rank')
        .eq('tournament_id', currentTournament.id)
        .order('current_score', { ascending: false })
        .limit(3);

      topThree = leaderboard || [];
    }

    return jsonResponse({
      success: true,
      data: {
        current: currentTournament as Tournament | null,
        recent: (recentTournaments || []) as Tournament[],
        upcoming: upcomingTournament,
        top_three: topThree,
      },
    });
  } catch (error) {
    console.error('Tournaments list error:', error);
    return errorResponse('Internal server error', 500);
  }
}

/**
 * POST /api/tournaments
 * Admin endpoint to create a new tournament (or bootstrap first one)
 */
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 500);
  }

  try {
    const supabase = createServerClient();
    const body = await request.json().catch(() => ({}));

    // Optional: specify explicit start time.
    // If omitted, DB function uses chained 8h cadence (or next UTC slot on bootstrap).
    const startsAt = body.starts_at ? new Date(body.starts_at).toISOString() : null;

    // Call the database function to create next tournament
    const { data, error } = await supabase.rpc('create_next_tournament', {
      p_starts_at: startsAt,
    });

    if (error) {
      console.error('Error creating tournament:', error);
      return errorResponse('Failed to create tournament: ' + error.message, 500);
    }

    // Fetch the created tournament
    const { data: tournament, error: fetchError } = await supabase
      .from('tournaments')
      .select('*')
      .eq('id', data)
      .single();

    if (fetchError) {
      console.error('Error fetching created tournament:', fetchError);
      return errorResponse('Tournament created but failed to fetch details', 500);
    }

    return jsonResponse({
      success: true,
      data: {
        tournament: tournament as Tournament,
        message: 'Tournament created successfully',
      },
    }, 201);
  } catch (error) {
    console.error('Create tournament error:', error);
    return errorResponse('Internal server error', 500);
  }
}
