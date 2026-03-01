import { describe, expect, it } from 'vitest';
import {
  buildAutomationPreflight,
  buildCoachBadges,
  buildCoachFeedback,
  buildCoachObjectives,
  buildStarterPrompt,
  buildTournamentObjective,
  deriveSignalsFromEvents,
  evaluateOnboardingProgress,
  getCompletedOutcomeCount,
  getOutcomeOrderedSteps,
  getPendingOutcomeSteps,
  ONBOARDING_CONTRACT_VERSION,
  type OracleTournamentLike,
} from './onboarding-oracle';

describe('onboarding oracle contract', () => {
  const tournament: OracleTournamentLike = {
    id: 'tour-1',
    type: 'territory_conqueror',
    name: 'Territory Conqueror',
    status: 'active',
  };

  it('exposes a versioned outcome contract', () => {
    expect(ONBOARDING_CONTRACT_VERSION).toBe('v1');
  });

  it('returns tournament-tailored quickstart steps', () => {
    const steps = getOutcomeOrderedSteps(tournament.type);
    expect(steps.length).toBeGreaterThanOrEqual(6);
    expect(steps.at(-1)?.outcome).toBe('competition_complete');
    expect(steps.at(-1)?.command).toBe('clawcity claim');
  });

  it('derives progress from runtime signals and score', () => {
    const signals = deriveSignalsFromEvents(
      [
        { type: 'move' },
        { type: 'gather' },
        { type: 'speak' },
        { type: 'buy' },
      ],
      12,
    );
    const progress = evaluateOnboardingProgress(signals);

    expect(progress.mobility_complete).toBe(true);
    expect(progress.resource_loop_complete).toBe(true);
    expect(progress.communication_complete).toBe(true);
    expect(progress.economy_complete).toBe(true);
    expect(progress.competition_complete).toBe(true);
    expect(progress.orientation_complete).toBe(true);
    expect(getCompletedOutcomeCount(progress)).toBe(6);
  });

  it('returns pending steps only for incomplete outcomes', () => {
    const signals = deriveSignalsFromEvents([{ type: 'move' }], 0);
    const progress = evaluateOnboardingProgress(signals);
    const pending = getPendingOutcomeSteps(progress, tournament.type);

    expect(pending.some((step) => step.outcome === 'mobility_complete')).toBe(false);
    expect(pending.some((step) => step.outcome === 'resource_loop_complete')).toBe(true);
    expect(pending.some((step) => step.outcome === 'competition_complete')).toBe(true);
  });

  it('builds objective/prompt text for active tournaments', () => {
    const objective = buildTournamentObjective(tournament);
    const prompt = buildStarterPrompt(tournament);

    expect(objective).toContain('Territory Conqueror');
    expect(prompt).toContain('Primary objective:');
    expect(prompt).toContain(objective);
  });

  it('returns automation preflight metadata with part 3 script link', () => {
    const preflight = buildAutomationPreflight('https://www.clawcity.app');
    expect(preflight.headline).toContain('loop script');
    expect(preflight.part3_url).toContain('/skill-workflows.md#part-3-automation-scripts');
  });

  it('builds coach objectives and feedback for agent-human handoff', () => {
    const progress = evaluateOnboardingProgress(
      deriveSignalsFromEvents([{ type: 'move' }, { type: 'gather' }, { type: 'buy' }], 0),
    );
    const objectives = buildCoachObjectives(tournament, progress);
    const badges = buildCoachBadges(tournament, progress, 0);
    const feedback = buildCoachFeedback({
      progress,
      completedOutcomes: getCompletedOutcomeCount(progress),
      totalOutcomes: 6,
      currentScore: 0,
      currentRank: null,
      tournament,
      nextSteps: getPendingOutcomeSteps(progress, tournament.type),
      recentEvents: [{ type: 'gather' }, { type: 'move' }],
    });

    expect(objectives.length).toBeGreaterThanOrEqual(3);
    expect(objectives[0].title).toContain('Loop');
    expect(badges.length).toBeGreaterThanOrEqual(3);
    expect(feedback.what_happened.length).toBeGreaterThan(0);
    expect(feedback.what_to_do_next.length).toBeGreaterThan(0);
  });
});
