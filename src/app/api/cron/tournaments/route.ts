import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';

/**
 * GET /api/cron/tournaments
 * 
 * Tournament maintenance cron job (runs every 10 minutes) to:
 * 1. Finalize any active tournaments that have ended
 * 2. Activate any upcoming tournaments that should start
 * 3. Refresh scores for active tournaments (near-live leaderboard)
 * 4. Create next tournament if none upcoming
 * 
 * Scheduled via Vercel Cron every 10 minutes.
 */
export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  
  if (authHeader !== `Bearer ${cronSecret}`) {
    return errorResponse('Unauthorized', 401);
  }

  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 500);
  }

  try {
    const supabase = createServerClient();
    const results: string[] = [];

    const nowIso = new Date().toISOString();

    // 1. Finalize any active tournaments that have ended
    const { data: endedTournaments } = await supabase
      .from('tournaments')
      .select('id, name')
      .eq('status', 'active')
      .lt('ends_at', nowIso);

    for (const tournament of endedTournaments || []) {
      const { error } = await supabase.rpc('finalize_tournament', {
        p_tournament_id: tournament.id,
      });
      
      if (error) {
        console.error(`Failed to finalize ${tournament.name}:`, error);
        results.push(`ERROR: Failed to finalize ${tournament.name}`);
      } else {
        results.push(`Finalized: ${tournament.name}`);
      }
    }

    // 2. Activate any upcoming tournaments that should start now
    const { data: toActivate } = await supabase
      .from('tournaments')
      .select('id, name')
      .eq('status', 'upcoming')
      .lte('starts_at', nowIso);

    for (const tournament of toActivate || []) {
      // IMPORTANT: Reset all agents BEFORE activating the tournament
      // This ensures everyone starts on equal footing
      const { data: resetCount, error: resetError } = await supabase.rpc('reset_all_agents_for_tournament');
      
      if (resetError) {
        console.error(`Failed to reset agents for ${tournament.name}:`, resetError);
        results.push(`ERROR: Failed to reset agents for ${tournament.name}`);
        // Continue anyway - tournament can still run
      } else {
        results.push(`Reset ${resetCount} agents to starting conditions`);
      }

      // Now activate the tournament
      const { error } = await supabase
        .from('tournaments')
        .update({ status: 'active' })
        .eq('id', tournament.id);
      
      if (error) {
        console.error(`Failed to activate ${tournament.name}:`, error);
        results.push(`ERROR: Failed to activate ${tournament.name}`);
      } else {
        results.push(`Activated: ${tournament.name}`);

        // Auto-enroll all agents into the newly activated tournament
        const { data: enrolledCount, error: enrollError } = await supabase.rpc('auto_enroll_all_agents', {
          p_tournament_id: tournament.id,
        });

        if (enrollError) {
          console.error(`Failed to auto-enroll agents for ${tournament.name}:`, enrollError);
          results.push(`ERROR: Failed to auto-enroll agents for ${tournament.name}`);
        } else {
          results.push(`Auto-enrolled ${enrolledCount} agents into ${tournament.name}`);
        }
      }
    }

    // 3. Refresh active tournament scores for near-live leaderboard updates
    const { data: activeTournaments } = await supabase
      .from('tournaments')
      .select('id, name')
      .eq('status', 'active');

    for (const tournament of activeTournaments || []) {
      const { error } = await supabase.rpc('update_tournament_scores', {
        p_tournament_id: tournament.id,
      });

      if (error) {
        console.error(`Failed to refresh scores for ${tournament.name}:`, error);
        results.push(`ERROR: Failed to refresh scores for ${tournament.name}`);
      } else {
        results.push(`Refreshed scores: ${tournament.name}`);
      }
    }

    // 4. Check if we need to create the next upcoming tournament
    const { data: upcoming } = await supabase
      .from('tournaments')
      .select('id')
      .eq('status', 'upcoming')
      .limit(1);

    if (!upcoming || upcoming.length === 0) {
      // No upcoming tournament, create one using the DB's 8h cadence logic
      const { data: newId, error } = await supabase.rpc('create_next_tournament');
      
      if (error) {
        console.error('Failed to create next tournament:', error);
        results.push('ERROR: Failed to create next tournament');
      } else {
        // Get the created tournament name
        const { data: newTournament } = await supabase
          .from('tournaments')
          .select('name')
          .eq('id', newId)
          .single();
        
        results.push(`Created: ${newTournament?.name || newId}`);
      }
    }

    return jsonResponse({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        actions: results,
      },
    });
  } catch (error) {
    console.error('Cron tournament error:', error);
    return errorResponse('Internal server error', 500);
  }
}

// Also support POST for manual triggers
export { GET as POST };
