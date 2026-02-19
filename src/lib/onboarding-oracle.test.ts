import { describe, expect, it } from 'vitest';
import {
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
});
