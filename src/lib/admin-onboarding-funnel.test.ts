import { describe, expect, it } from 'vitest';
import { buildOnboardingFunnel } from './admin-onboarding-funnel';

describe('admin onboarding funnel', () => {
  it('builds monotonic funnel counts and completion rate', () => {
    const summary = buildOnboardingFunnel([
      {
        id: 'a1',
        hasMoved: true,
        hasGathered: true,
        hasCommunicated: true,
        hasEconomyAction: true,
        hasCompetitionScore: true,
      },
      {
        id: 'a2',
        hasMoved: true,
        hasGathered: true,
        hasCommunicated: false,
        hasEconomyAction: true,
        hasCompetitionScore: false,
      },
      {
        id: 'a3',
        hasMoved: false,
        hasGathered: false,
        hasCommunicated: false,
        hasEconomyAction: false,
        hasCompetitionScore: false,
      },
    ]);

    expect(summary.cohort_total).toBe(3);
    expect(summary.outcomes.map((row) => row.funnel_count)).toEqual([3, 2, 2, 1, 1, 1]);
    expect(summary.completed_all_count).toBe(1);
    expect(summary.completed_all_rate).toBe(33.3);
    expect(summary.outcomes[3].conversion_from_previous).toBe(50);
    expect(summary.outcomes[3].dropoff_from_previous).toBe(1);
  });

  it('returns zero-safe percentages for empty cohort', () => {
    const summary = buildOnboardingFunnel([]);
    expect(summary.cohort_total).toBe(0);
    expect(summary.completed_all_count).toBe(0);
    expect(summary.completed_all_rate).toBe(0);
    expect(summary.outcomes.every((row) => row.funnel_count === 0)).toBe(true);
    expect(summary.outcomes.every((row) => row.funnel_rate === 0)).toBe(true);
  });
});
