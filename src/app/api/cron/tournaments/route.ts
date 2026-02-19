import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { progressNextWorldGeneration } from '@/lib/world-generation-worker';
import { ensureBaselineMarketLiquidity } from '@/lib/market-liquidity';

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
    const runActivationFlow = async (
      tournament: { id: string; name: string },
      options?: { alreadyActive?: boolean; source?: 'scheduled' | 'created_now' }
    ) => {
      const alreadyActive = options?.alreadyActive === true;
      const source = options?.source || 'scheduled';

      // Prepare tournament start atomically: reset + optional world swap at 2-tournament boundary.
      const { data: prepData, error: prepError } = await supabase.rpc('prepare_world_for_tournament_start', {
        p_tournament_id: tournament.id,
      });

      if (prepError) {
        console.error(`Failed to prepare world start for ${tournament.name} (${tournament.id}):`, prepError);
        results.push(
          `WARN: World prepare failed for ${tournament.name} (${tournament.id}) [source=${source}]; falling back to reset-only`
        );

        // Fallback path if world-prepare RPC is unavailable or errored.
        const { data: resetCount, error: resetError } = await supabase.rpc('reset_all_agents_for_tournament', {
          p_tournament_id: tournament.id,
        });

        if (resetError) {
          console.error(`Fallback reset failed for ${tournament.name} (${tournament.id}):`, resetError);
          results.push(
            `WARN: Reset fallback also failed for ${tournament.name} (${tournament.id}) [source=${source}]`
          );
        } else {
          results.push(
            `Reset ${resetCount ?? 0} agents for ${tournament.name} (${tournament.id}) [source=${source}]`
          );
        }
      } else if (prepData && typeof prepData === 'object') {
        const prep = prepData as Record<string, unknown>;
        const prepStatus = typeof prep.status === 'string' ? prep.status : 'unknown';
        const resetCount = typeof prep.reset_agent_count === 'number' ? prep.reset_agent_count : 0;
        const prepMessage = typeof prep.message === 'string' ? prep.message : 'Prepared tournament start.';
        const targetDesign = prep.target_design_no;
        const activeDesign = prep.active_design_no;

        results.push(
          `Prepared ${tournament.name} (${tournament.id}) [source=${source}] status=${prepStatus} reset=${resetCount} design_target=${targetDesign} design_active=${activeDesign}`
        );
        results.push(`Prepare note: ${prepMessage}`);
      } else {
        results.push(
          `Prepared ${tournament.name} (${tournament.id}) [source=${source}] with unknown response format`
        );
      }

      if (!alreadyActive) {
        const { error: activateError } = await supabase
          .from('tournaments')
          .update({ status: 'active' })
          .eq('id', tournament.id);

        if (activateError) {
          console.error(`Failed to activate ${tournament.name} (${tournament.id}):`, activateError);
          results.push(`ERROR: Failed to activate ${tournament.name} (${tournament.id})`);
          return;
        }

        results.push(`Activated: ${tournament.name} (${tournament.id})`);
      } else {
        results.push(`Activation not needed: ${tournament.name} (${tournament.id}) already active [source=${source}]`);
      }

      // Auto-enroll all agents into the active tournament with fresh baselines
      const { data: enrolledCount, error: enrollError } = await supabase.rpc('auto_enroll_all_agents', {
        p_tournament_id: tournament.id,
      });

      if (enrollError) {
        console.error(`Failed to auto-enroll agents for ${tournament.name} (${tournament.id}):`, enrollError);
        results.push(`ERROR: Failed to auto-enroll agents for ${tournament.name} (${tournament.id})`);
      } else {
        results.push(
          `Auto-enrolled ${enrolledCount ?? 0} agents into ${tournament.name} (${tournament.id}) [source=${source}]`
        );
      }
    };

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
      await runActivationFlow(tournament, { source: 'scheduled' });
    }

    // 3. Backfill late joiners + refresh active tournament scores for near-live leaderboard updates
    const { data: activeTournaments } = await supabase
      .from('tournaments')
      .select('id, name')
      .eq('status', 'active');

    for (const tournament of activeTournaments || []) {
      const { data: backfilledCount, error: backfillError } = await supabase.rpc('auto_enroll_all_agents', {
        p_tournament_id: tournament.id,
      });

      if (backfillError) {
        console.error(`Failed to backfill participants for ${tournament.name}:`, backfillError);
        results.push(`ERROR: Failed to backfill participants for ${tournament.name}`);
      } else if ((backfilledCount ?? 0) > 0) {
        results.push(`Backfilled ${backfilledCount} participants: ${tournament.name}`);
      }

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
        // Get the created tournament name/status so we can immediately process if it is already active.
        const { data: newTournament } = await supabase
          .from('tournaments')
          .select('id, name, status')
          .eq('id', newId)
          .single();
        
        results.push(`Created: ${newTournament?.name || newId}`);

        if (newTournament?.status === 'active') {
          await runActivationFlow(
            {
              id: newTournament.id,
              name: newTournament.name,
            },
            { alreadyActive: true, source: 'created_now' }
          );
        }
      }
    }

    // 5. Incremental generation of the next world design in the staging buffer.
    const worldGeneration = await progressNextWorldGeneration({ supabase });
    results.push(`World generation: ${worldGeneration.message}`);

    // 6. Ensure baseline market liquidity is available after resets/activations.
    const liquidityResult = await ensureBaselineMarketLiquidity(supabase);
    if (liquidityResult.ok) {
      results.push(`Market liquidity: ${liquidityResult.message}`);
    } else {
      results.push(`WARN: Market liquidity seeding failed: ${liquidityResult.message}`);
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
