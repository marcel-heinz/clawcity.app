import {
  getOnboardingOutcomeDefinitions,
  type OnboardingOutcomeKey,
} from './onboarding-oracle';

export interface AgentOnboardingSignals {
  id: string;
  hasMoved: boolean;
  hasGathered: boolean;
  hasCommunicated: boolean;
  hasEconomyAction: boolean;
  hasCompetitionScore: boolean;
}

export interface OnboardingFunnelOutcome {
  key: OnboardingOutcomeKey;
  title: string;
  standalone_count: number;
  standalone_rate: number;
  funnel_count: number;
  funnel_rate: number;
  conversion_from_previous: number;
  dropoff_from_previous: number;
}

export interface OnboardingFunnelSummary {
  cohort_label: string;
  cohort_total: number;
  outcomes: OnboardingFunnelOutcome[];
  completed_all_count: number;
  completed_all_rate: number;
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

function getOutcomeValue(
  key: OnboardingOutcomeKey,
  signal: AgentOnboardingSignals,
): boolean {
  switch (key) {
    case 'orientation_complete':
      return true;
    case 'mobility_complete':
      return signal.hasMoved;
    case 'resource_loop_complete':
      return signal.hasGathered;
    case 'communication_complete':
      return signal.hasCommunicated;
    case 'economy_complete':
      return signal.hasEconomyAction;
    case 'competition_complete':
      return signal.hasCompetitionScore;
    default:
      return false;
  }
}

export function buildOnboardingFunnel(
  signals: AgentOnboardingSignals[],
  cohortLabel = 'Agents created in last 30 days',
): OnboardingFunnelSummary {
  const cohortTotal = signals.length;
  const outcomes = getOnboardingOutcomeDefinitions();

  let previousFunnelCount = cohortTotal;
  const outcomeRows: OnboardingFunnelOutcome[] = outcomes.map((outcome, index) => {
    const standaloneCount = signals.reduce((count, signal) => {
      return count + (getOutcomeValue(outcome.key, signal) ? 1 : 0);
    }, 0);

    const funnelCount = signals.reduce((count, signal) => {
      const passedAllUpToCurrent = outcomes
        .slice(0, index + 1)
        .every((step) => getOutcomeValue(step.key, signal));
      return count + (passedAllUpToCurrent ? 1 : 0);
    }, 0);

    const standaloneRate = cohortTotal > 0 ? roundPercent((standaloneCount / cohortTotal) * 100) : 0;
    const funnelRate = cohortTotal > 0 ? roundPercent((funnelCount / cohortTotal) * 100) : 0;
    const conversionFromPrevious =
      index === 0
        ? (cohortTotal > 0 ? 100 : 0)
        : (previousFunnelCount > 0
          ? roundPercent((funnelCount / previousFunnelCount) * 100)
          : 0);
    const dropoffFromPrevious = index === 0 ? 0 : Math.max(previousFunnelCount - funnelCount, 0);

    previousFunnelCount = funnelCount;

    return {
      key: outcome.key,
      title: outcome.title,
      standalone_count: standaloneCount,
      standalone_rate: standaloneRate,
      funnel_count: funnelCount,
      funnel_rate: funnelRate,
      conversion_from_previous: conversionFromPrevious,
      dropoff_from_previous: dropoffFromPrevious,
    };
  });

  const completedAllCount = outcomeRows.length > 0 ? outcomeRows[outcomeRows.length - 1].funnel_count : 0;
  const completedAllRate =
    cohortTotal > 0 ? roundPercent((completedAllCount / cohortTotal) * 100) : 0;

  return {
    cohort_label: cohortLabel,
    cohort_total: cohortTotal,
    outcomes: outcomeRows,
    completed_all_count: completedAllCount,
    completed_all_rate: completedAllRate,
  };
}
