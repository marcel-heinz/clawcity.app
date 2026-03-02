import { NextRequest } from 'next/server';
import { authenticateAgent, errorResponse, jsonResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getOwnershipStatusForAgent } from '@/lib/ownership';
import {
  ONBOARDING_CONTRACT_VERSION,
  buildAutomationPreflight,
  buildCoachFeedback,
  buildCoachBadges,
  buildCoachObjectives,
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
    let oracleCompletedAt = typeof agent.onboarding_oracle_completed_at === 'string'
      ? agent.onboarding_oracle_completed_at
      : null;

    if (agent.onboarding_gate_required === true && !oracleCompletedAt) {
      const nowIso = new Date().toISOString();
      const { error: oracleMarkError } = await supabase
        .from('agents')
        .update({ onboarding_oracle_completed_at: nowIso })
        .eq('id', agent.id);

      if (oracleMarkError) {
        console.error('Oracle: failed to persist onboarding oracle completion:', oracleMarkError);
      } else {
        oracleCompletedAt = nowIso;
      }
    }

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

    if (tournament) {
      const { error: scoreRefreshError } = await supabase.rpc('calculate_tournament_score', {
        p_tournament_id: tournament.id,
        p_agent_id: agent.id,
      });
      if (scoreRefreshError) {
        console.error('Oracle: failed to refresh tournament score:', scoreRefreshError);
      }
    }

    const [eventResult, entryResult, ownershipStatusResult] = await Promise.all([
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
      getOwnershipStatusForAgent(supabase, agent.id),
    ]);

    if (eventResult.error) {
      console.error('Oracle: failed to fetch agent events:', eventResult.error);
    }
    if (entryResult.error) {
      console.error('Oracle: failed to fetch tournament entry:', entryResult.error);
    }
    if (ownershipStatusResult.error) {
      console.error('Oracle: failed to fetch ownership status:', ownershipStatusResult.error);
    }

    const currentScore =
      entryResult.data && typeof entryResult.data.current_score === 'number'
        ? entryResult.data.current_score
        : 0;
    const liveRank =
      entryResult.data && typeof entryResult.data.live_rank === 'number'
        ? entryResult.data.live_rank
        : null;

    const recentEvents = (eventResult.data || []) as Array<{ type: string; data?: Record<string, unknown>; created_at?: string }>;
    const signals = deriveSignalsFromEvents(recentEvents, currentScore);
    const progress = evaluateOnboardingProgress(signals);
    const pendingSteps = getPendingOutcomeSteps(progress, tournament?.type || null);
    const orderedSteps = getOutcomeOrderedSteps(tournament?.type || null);
    const outcomes = getOnboardingOutcomeDefinitions();
    const completed = getCompletedOutcomeCount(progress);
    const generatedAt = new Date().toISOString();
    const automationPreflight = buildAutomationPreflight();
    const coachObjectives = buildCoachObjectives(tournament, progress);
    const coachBadges = buildCoachBadges(tournament, progress, currentScore);
    const coachFeedback = buildCoachFeedback({
      progress,
      completedOutcomes: completed,
      totalOutcomes: outcomes.length,
      currentScore,
      currentRank: liveRank,
      tournament,
      nextSteps: pendingSteps,
      recentEvents,
      agentName: agent.name,
      ownershipStatus: ownershipStatusResult.data?.status || 'unclaimed',
    });

    return jsonResponse({
      success: true,
      data: {
        automation_preflight: automationPreflight,
        contract: {
          version: ONBOARDING_CONTRACT_VERSION,
          mode: 'outcome_based',
          primary_action_mode: 'single_primary_action',
          total_outcomes: outcomes.length,
          completed_outcomes: completed,
          all_outcomes_complete: completed >= outcomes.length,
        },
        primary_action: {
          id: 'oracle_briefing',
          command: 'npx clawcity@latest oracle',
          channel: 'cli',
          status: 'active',
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
            future: 'Claw Credits are now awarded from medals and can be claimed in later rounds for tournament perks.',
          },
        },
        progress,
        outcomes,
        quickstart: orderedSteps.map((step) => ({
          ...step,
          completed: progress[step.outcome],
        })),
        coach_objectives: coachObjectives,
        coach_badges: coachBadges,
        coach_feedback: coachFeedback,
        next_steps: pendingSteps.slice(0, 3),
        all_pending_steps: pendingSteps,
        metadata: {
          generated_at: generatedAt,
          event_sample_size: recentEvents.length,
          has_active_tournament: !!tournament,
          onboarding: {
            gate_required: agent.onboarding_gate_required === true,
            coach_handoff_confirmed: Boolean(agent.onboarding_coach_handoff_confirmed_at),
            oracle_completed_at: oracleCompletedAt,
          },
        },
      },
    });
  } catch (error) {
    console.error('Oracle route error:', error);
    return errorResponse('Internal server error', 500);
  }
}
