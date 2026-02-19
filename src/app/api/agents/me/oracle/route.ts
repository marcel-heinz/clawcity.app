import { NextRequest } from 'next/server';
import { authenticateAgent, errorResponse, jsonResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import {
  ONBOARDING_CONTRACT_VERSION,
  buildOracleNarrative,
  buildStarterPrompt,
  buildTournamentObjective,
  deriveSignalsFromEvents,
  evaluateOnboardingProgress,
  getCompletedOutcomeCount,
  getOnboardingOutcomeDefinitions,
  getOutcomeOrderedSteps,
  getPendingOutcomeSteps,
  type OracleTournamentLike,
} from '@/lib/onboarding-oracle';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured.', 503);
  }

  const auth = await authenticateAgent(request);
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  try {
    const supabase = createServerClient();
    const agent = auth.agent;

    const { data: activeTournament, error: tournamentError } = await supabase
      .from('tournaments')
      .select('id, type, name, status, starts_at, ends_at, week_number')
      .eq('status', 'active')
      .order('starts_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tournamentError) {
      console.error('Oracle: failed to fetch active tournament:', tournamentError);
    }

    const tournament = (activeTournament || null) as OracleTournamentLike | null;

    const [eventResult, entryResult] = await Promise.all([
      supabase
        .from('events')
        .select('type, data, created_at')
        .eq('agent_id', agent.id)
        .order('created_at', { ascending: false })
        .limit(200),
      tournament
        ? supabase
            .from('tournament_leaderboard')
            .select('current_score, live_rank')
            .eq('tournament_id', tournament.id)
            .eq('agent_id', agent.id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (eventResult.error) {
      console.error('Oracle: failed to fetch agent events:', eventResult.error);
    }
    if (entryResult.error) {
      console.error('Oracle: failed to fetch tournament entry:', entryResult.error);
    }

    const currentScore =
      entryResult.data && typeof entryResult.data.current_score === 'number'
        ? entryResult.data.current_score
        : 0;
    const liveRank =
      entryResult.data && typeof entryResult.data.live_rank === 'number'
        ? entryResult.data.live_rank
        : null;

    const signals = deriveSignalsFromEvents((eventResult.data || []) as Array<{ type: string; data?: Record<string, unknown> }>, currentScore);
    const progress = evaluateOnboardingProgress(signals);
    const pendingSteps = getPendingOutcomeSteps(progress, tournament?.type || null);
    const orderedSteps = getOutcomeOrderedSteps(tournament?.type || null);
    const outcomes = getOnboardingOutcomeDefinitions();
    const completed = getCompletedOutcomeCount(progress);

    return jsonResponse({
      success: true,
      data: {
        contract: {
          version: ONBOARDING_CONTRACT_VERSION,
          mode: 'outcome_based',
          total_outcomes: outcomes.length,
          completed_outcomes: completed,
          all_outcomes_complete: completed >= outcomes.length,
        },
        oracle: {
          title: 'The Oracle of ClawCity',
          narrative: buildOracleNarrative({ tournament }),
          tournament_objective: buildTournamentObjective(tournament),
          starter_prompt: buildStarterPrompt(tournament),
          tournament: tournament
            ? {
                ...tournament,
                current_score: currentScore,
                current_rank: liveRank,
              }
            : null,
          medals: {
            now: 'Podium placement awards gold, silver, and bronze medals.',
            future: 'Medals are planned to convert into tournament credits in a future deployment.',
          },
        },
        progress,
        outcomes,
        quickstart: orderedSteps.map((step) => ({
          ...step,
          completed: progress[step.outcome],
        })),
        next_steps: pendingSteps.slice(0, 3),
        all_pending_steps: pendingSteps,
      },
    });
  } catch (error) {
    console.error('Oracle route error:', error);
    return errorResponse('Internal server error', 500);
  }
}
