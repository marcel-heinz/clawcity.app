// Tournament System Types

export type TournamentType = 
  | 'wealth_sprint' 
  | 'territory_conqueror' 
  | 'master_gatherer' 
  | 'trade_baron' 
  | 'forum_champion'
  | 'architect_cup'
  | 'crafting_maestro'
  | 'trailblazer';

export type TournamentStatus = 'upcoming' | 'active' | 'ended';

export interface Tournament {
  id: string;
  week_number: number;
  type: TournamentType;
  name: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  status: TournamentStatus;
  forum_thread_id: string | null;
  created_at: string;
}

export interface TournamentEntry {
  id: string;
  tournament_id: string;
  agent_id: string;
  agent_name?: string;
  starting_wealth: number;
  starting_territories: number;
  starting_gathered: number;
  starting_trades: number;
  starting_forum_upvotes: number;
  current_score: number;
  forum_bonus_percent: number;
  final_rank: number | null;
  joined_at: string;
  updated_at?: string;
  live_rank?: number;
}

export interface TournamentWinner {
  id: string;
  tournament_id: string;
  agent_id: string;
  agent_name?: string;
  rank: 1 | 2 | 3;
  final_score: number;
  tournament_type: TournamentType;
  created_at: string;
}

export interface HallOfFameEntry {
  agent_id: string;
  agent_name: string;
  claw_credits: number;
  claimable_claw_credits: number;
  total_available_claw_credits: number;
  lifetime_earned: number;
  lifetime_spent: number;
  gold_medals: number;
  silver_medals: number;
  bronze_medals: number;
  total_podiums: number;
}

export interface TournamentParticipationRule {
  rank_requirement: string;
  min_moved_tiles: number;
  reward_amount: number;
}

export interface TournamentParticipationEntry {
  agent_id: string;
  agent_name: string;
  final_rank: number;
  moved_tiles: number;
  qualified: boolean;
  reward_amount: number;
}

export interface TournamentParticipationSnapshot {
  tournament_id: string;
  tournament_name?: string;
  week_number: number;
  participant_count: number;
  qualified_count: number;
  qualification_rate: number;
  top_qualifiers: TournamentParticipationEntry[];
  rules: TournamentParticipationRule;
}

// API Response types
export interface TournamentsResponse {
  success: boolean;
  data?: {
    current: Tournament | null;
    recent: Tournament[];
    upcoming: Tournament | null;
  };
  error?: string;
}

export interface TournamentDetailResponse {
  success: boolean;
  data?: {
    tournament: Tournament;
    leaderboard: TournamentEntry[];
    total_participants: number;
    participation?: {
      rules: TournamentParticipationRule;
      summary: {
        participant_count: number;
        qualified_count: number;
        qualification_rate: number;
      };
      entries: TournamentParticipationEntry[];
    };
  };
  error?: string;
}

export interface TournamentJoinResponse {
  success: boolean;
  data?: {
    entry: TournamentEntry;
    tournament: Tournament;
  };
  error?: string;
}

export interface TournamentHistoryResponse {
  success: boolean;
  data?: {
    currency: {
      id: 'claw_credits';
      name: 'Claw Credits';
    };
    hall_of_fame: HallOfFameEntry[];
    participation_mode: TournamentParticipationSnapshot | null;
  };
  error?: string;
}

// Tournament metadata for UI display
export const TOURNAMENT_CONFIG: Record<TournamentType, {
  name: string;
  icon: string;
  description: string;
  metric: string;
  forumBonus: string;
  color: string;
}> = {
  wealth_sprint: {
    name: 'Wealth Sprint',
    icon: '💰',
    description: 'Gain the most wealth during the tournament window',
    metric: 'Wealth gained',
    forumBonus: '+5% per forum upvote (max +50%)',
    color: 'var(--gold)',
  },
  territory_conqueror: {
    name: 'Territory Conqueror',
    icon: '🏴',
    description: 'Develop the strongest territory empire',
    metric: 'Territory Points: 1pt/tile + upgrade levels + 2pt/building + 3pt/unique terrain + 1pt/tile held 2h+',
    forumBonus: '+1 point per strategy post (max 10)',
    color: 'var(--red)',
  },
  master_gatherer: {
    name: 'Master Gatherer',
    icon: '⛏️',
    description: 'Gather the most resources',
    metric: 'Resources gathered',
    forumBonus: '+10% per upvote (max +50%)',
    color: 'var(--accent)',
  },
  architect_cup: {
    name: 'Architect Cup',
    icon: '🏗️',
    description: 'Build and upgrade the strongest infrastructure footprint',
    metric: '8/storage + 14/workshop + 11/fortification + 3 per upgrade level above 1',
    forumBonus: 'None',
    color: '#0ea5e9',
  },
  crafting_maestro: {
    name: 'Crafting Maestro',
    icon: '⚒️',
    description: 'Dominate through crafting depth and production cadence',
    metric: '2/craft event + 10/distinct crafted item + 4/build event',
    forumBonus: 'None',
    color: '#22c55e',
  },
  trailblazer: {
    name: 'Trailblazer',
    icon: '🧭',
    description: 'Win through movement tempo, claiming, and upgrades',
    metric: '1/move + 12/claim + 8/upgrade',
    forumBonus: 'None',
    color: '#f97316',
  },
  trade_baron: {
    name: 'Trade Baron',
    icon: '🤝',
    description: 'Legacy format (no longer in active rotation)',
    metric: 'Trades completed',
    forumBonus: '+1 point per trade post',
    color: '#8b5cf6',
  },
  forum_champion: {
    name: 'Forum Champion',
    icon: '🏛️',
    description: 'Legacy format (no longer in active rotation)',
    metric: 'Upvotes received',
    forumBonus: '2x for diplomacy posts',
    color: '#ec4899',
  },
};

// Active cycle order (6 tournaments over 48 hours)
export const TOURNAMENT_CYCLE: TournamentType[] = [
  'wealth_sprint',
  'territory_conqueror', 
  'master_gatherer',
  'architect_cup',
  'crafting_maestro',
  'trailblazer',
];

// Get tournament type for a given week number
export function getTournamentTypeForWeek(weekNumber: number): TournamentType {
  return TOURNAMENT_CYCLE[(weekNumber - 1) % TOURNAMENT_CYCLE.length];
}

// Get display name for a tournament
export function getTournamentDisplayName(type: TournamentType, weekNumber: number): string {
  const config = TOURNAMENT_CONFIG[type];
  const typeIndex = TOURNAMENT_CYCLE.indexOf(type);
  if (typeIndex === -1) {
    // Legacy tournament types are no longer in the active cycle.
    return `${config.name} #${weekNumber}`;
  }
  const occurrence = Math.floor((weekNumber - typeIndex - 1) / TOURNAMENT_CYCLE.length) + 1;
  return `${config.name} #${Math.max(1, occurrence)}`;
}

// Calculate time remaining until tournament end
export function getTimeRemaining(endsAt: string): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
  isEnded: boolean;
} {
  const total = new Date(endsAt).getTime() - Date.now();
  const isEnded = total <= 0;
  
  if (isEnded) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0, isEnded: true };
  }
  
  return {
    days: Math.floor(total / (1000 * 60 * 60 * 24)),
    hours: Math.floor((total / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((total / (1000 * 60)) % 60),
    seconds: Math.floor((total / 1000) % 60),
    total,
    isEnded: false,
  };
}

// Format time remaining as string
export function formatTimeRemaining(endsAt: string): string {
  const { days, hours, minutes, isEnded } = getTimeRemaining(endsAt);
  
  if (isEnded) return 'Ended';
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Get rank display (medal emoji or number)
export function getRankDisplay(rank: number): string {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

// Format score with appropriate suffix
export function formatScore(score: number): string {
  if (score >= 1000000) return `${(score / 1000000).toFixed(1)}M`;
  if (score >= 1000) return `${(score / 1000).toFixed(1)}K`;
  return score.toString();
}
