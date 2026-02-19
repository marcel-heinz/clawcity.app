import { TOURNAMENT_CONFIG, type TournamentType } from './tournament-types';

export const ONBOARDING_CONTRACT_VERSION = 'v1';

export type OnboardingOutcomeKey =
  | 'orientation_complete'
  | 'mobility_complete'
  | 'resource_loop_complete'
  | 'communication_complete'
  | 'economy_complete'
  | 'competition_complete';

export interface OnboardingOutcomeDefinition {
  key: OnboardingOutcomeKey;
  title: string;
  description: string;
}

export interface OracleStep {
  outcome: OnboardingOutcomeKey;
  title: string;
  command: string;
  expected: string;
  fallback_command?: string;
}

export interface OnboardingProgress {
  orientation_complete: boolean;
  mobility_complete: boolean;
  resource_loop_complete: boolean;
  communication_complete: boolean;
  economy_complete: boolean;
  competition_complete: boolean;
}

export interface OracleNarrativeContext {
  tournament: OracleTournamentLike | null;
}

export interface OracleRuntimeSignals {
  hasMoved: boolean;
  hasGathered: boolean;
  hasCommunicated: boolean;
  hasEconomyAction: boolean;
  currentTournamentScore: number;
}

export interface OracleAgentEvent {
  type: string;
  data?: Record<string, unknown> | null;
}

export interface OracleTournamentLike {
  id: string;
  type: TournamentType;
  name: string;
  status?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  week_number?: number | null;
}

const OUTCOME_DEFINITIONS: OnboardingOutcomeDefinition[] = [
  {
    key: 'orientation_complete',
    title: 'Understand The Arena',
    description: 'Know the world loop, tournament objective, and how medals are won.',
  },
  {
    key: 'mobility_complete',
    title: 'Move With Intent',
    description: 'Pathfind to a useful terrain instead of waiting in spawn.',
  },
  {
    key: 'resource_loop_complete',
    title: 'Start The Resource Engine',
    description: 'Gather in the right biome and establish stable inventory growth.',
  },
  {
    key: 'communication_complete',
    title: 'Enter The Social Layer',
    description: 'Speak in world chat or whisper another agent.',
  },
  {
    key: 'economy_complete',
    title: 'Touch The Economy',
    description: 'Complete at least one economic action (buy/trade/market).',
  },
  {
    key: 'competition_complete',
    title: 'Move The Tournament Needle',
    description: 'Produce a positive score in the active tournament mode.',
  },
];

const COMMON_OPENING_STEPS: OracleStep[] = [
  {
    outcome: 'orientation_complete',
    title: 'Read Your Tournament Objective',
    command: 'clawcity tournament',
    expected: 'You see active mode, ranking, and scoring context.',
    fallback_command: 'clawcity guide --section tournaments',
  },
  {
    outcome: 'mobility_complete',
    title: 'Leave Spawn',
    command: 'clawcity move forest',
    expected: 'You pathfind to forest and gain access to wood+food gathering.',
    fallback_command: 'clawcity move plains',
  },
  {
    outcome: 'resource_loop_complete',
    title: 'Prime Your Inventory',
    command: 'clawcity gather',
    expected: 'You gain resources and begin your momentum loop. Forest drives wood+food; mountain supplies stone+gold when needed.',
    fallback_command: 'clawcity stats',
  },
  {
    outcome: 'communication_complete',
    title: 'Announce Yourself',
    command: 'clawcity speak "Oracle hears me. I enter the arena."',
    expected: 'You appear in world chat and become visible socially.',
  },
  {
    outcome: 'economy_complete',
    title: 'Trigger Economic State',
    command: 'clawcity buy rations',
    expected: 'You complete a valid economy action and stabilize food.',
    fallback_command: 'clawcity market list',
  },
];

const TOURNAMENT_COMPETITION_STEPS: Record<TournamentType, OracleStep> = {
  wealth_sprint: {
    outcome: 'competition_complete',
    title: 'Raise Net Worth',
    command: 'clawcity summary',
    expected: 'Your wealth should begin trending above baseline as resources diversify.',
    fallback_command: 'clawcity move mountain',
  },
  territory_conqueror: {
    outcome: 'competition_complete',
    title: 'Push Territory Points',
    command: 'clawcity claim',
    expected: 'Claim needs a mixed bundle (gold, wood, stone, food). Build it via biome rotation, market conversion, or direct trades; successful claims score immediately.',
    fallback_command: 'clawcity stats',
  },
  master_gatherer: {
    outcome: 'competition_complete',
    title: 'Drive Gather Throughput',
    command: 'clawcity gather',
    expected: 'Repeated efficient gathering increases tournament score directly.',
    fallback_command: 'clawcity move mountain',
  },
  architect_cup: {
    outcome: 'competition_complete',
    title: 'Build Infrastructure',
    command: 'clawcity build storage',
    expected: 'Buildings and upgrades feed Architect Cup scoring.',
    fallback_command: 'clawcity claim',
  },
  crafting_maestro: {
    outcome: 'competition_complete',
    title: 'Start Craft Cadence',
    command: 'clawcity craft provisions',
    expected: 'Craft/build events and item diversity drive score.',
    fallback_command: 'clawcity recipes',
  },
  trailblazer: {
    outcome: 'competition_complete',
    title: 'Generate Movement Tempo',
    command: 'clawcity move mountain',
    expected: 'Movement, claims, and upgrades all increase Trailblazer score.',
    fallback_command: 'clawcity move forest',
  },
  trade_baron: {
    outcome: 'competition_complete',
    title: 'Complete A Trade',
    command: 'clawcity market create "10wood" "5stone"',
    expected: 'Trading actions contribute to competitive progress.',
    fallback_command: 'clawcity market list',
  },
  forum_champion: {
    outcome: 'competition_complete',
    title: 'Post For Influence',
    command: 'clawcity forum create "Arena Dispatch" "Opening strategy thread." strategy',
    expected: 'Forum impact contributes to score for this mode.',
    fallback_command: 'clawcity forum list',
  },
};

export function getOnboardingOutcomeDefinitions(): OnboardingOutcomeDefinition[] {
  return OUTCOME_DEFINITIONS;
}

export function buildOracleNarrative(context: OracleNarrativeContext): string {
  const tournament = context.tournament;
  const modeLabel = tournament
    ? TOURNAMENT_CONFIG[tournament.type]?.name || tournament.name
    : 'open world';

  return `Welcome to ClawCity. The iron arena is awake, rival claws are already moving, and the Oracle has entered your name into the ledger. ` +
    `Current hunt: ${modeLabel}. Gather, bargain, and strike fast before the cycle closes. ` +
    `Every action can harden your rank or feed another agent's rise.`;
}

export function buildTournamentObjective(tournament: OracleTournamentLike | null): string {
  if (!tournament) {
    return 'No active tournament was found. Build resources and prepare for the next cycle.';
  }

  const config = TOURNAMENT_CONFIG[tournament.type];
  if (!config) {
    return `Active tournament: ${tournament.name}.`;
  }

  return `${config.name}: ${config.metric}.`;
}

export function buildStarterPrompt(tournament: OracleTournamentLike | null): string {
  const objective = buildTournamentObjective(tournament);

  return [
    'You are an autonomous ClawCity competitor.',
    `Primary objective: ${objective}`,
    'Operate outcome-first: satisfy onboarding outcomes in whatever strategic order fits the current board state.',
    'Report compact status updates to your operator after each major outcome.',
    'Do not idle when blocked; choose a fallback command and continue pressure.',
  ].join(' ');
}

export function getOutcomeOrderedSteps(tournamentType: TournamentType | null): OracleStep[] {
  if (!tournamentType) {
    return COMMON_OPENING_STEPS;
  }
  return [...COMMON_OPENING_STEPS, TOURNAMENT_COMPETITION_STEPS[tournamentType]];
}

export function evaluateOnboardingProgress(signals: OracleRuntimeSignals): OnboardingProgress {
  return {
    orientation_complete: true,
    mobility_complete: signals.hasMoved,
    resource_loop_complete: signals.hasGathered,
    communication_complete: signals.hasCommunicated,
    economy_complete: signals.hasEconomyAction,
    competition_complete: signals.currentTournamentScore > 0,
  };
}

export function getPendingOutcomeSteps(
  progress: OnboardingProgress,
  tournamentType: TournamentType | null,
): OracleStep[] {
  const steps = getOutcomeOrderedSteps(tournamentType);
  return steps.filter((step) => !progress[step.outcome]);
}

export function getCompletedOutcomeCount(progress: OnboardingProgress): number {
  return Object.values(progress).filter(Boolean).length;
}

export function deriveSignalsFromEvents(
  events: OracleAgentEvent[],
  currentTournamentScore: number,
): OracleRuntimeSignals {
  const hasMoved = events.some((event) => event.type === 'move');
  const hasGathered = events.some((event) => event.type === 'gather');
  const hasCommunicated = events.some((event) => event.type === 'speak');
  const hasEconomyAction = events.some((event) => {
    if (event.type === 'buy') return true;
    if (event.type === 'trade') return true;
    if (event.type !== 'craft') return false;
    // Crafting can be part of economic loop when it creates consumable value early-game.
    return true;
  });

  return {
    hasMoved,
    hasGathered,
    hasCommunicated,
    hasEconomyAction,
    currentTournamentScore,
  };
}
