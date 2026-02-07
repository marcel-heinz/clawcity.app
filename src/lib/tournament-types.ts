// Tournament System Types

export type TournamentType = 
  | 'wealth_sprint' 
  | 'territory_conqueror' 
  | 'master_gatherer' 
  | 'trade_baron' 
  | 'forum_champion';

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
  gold_medals: number;
  silver_medals: number;
  bronze_medals: number;
  total_podiums: number;
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
    hall_of_fame: HallOfFameEntry[];
    recent_winners: (TournamentWinner & { tournament_name?: string })[];
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
    description: 'Gain the most wealth during the week',
    metric: 'Wealth gained',
    forumBonus: '+5% per forum upvote (max +50%)',
    color: 'var(--gold)',
  },
  territory_conqueror: {
    name: 'Territory Conqueror',
    icon: '🏴',
    description: 'Develop the strongest territory empire',
    metric: 'Territory points',
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
  trade_baron: {
    name: 'Trade Baron',
    icon: '🤝',
    description: 'Complete the most successful trades',
    metric: 'Trades completed',
    forumBonus: '+1 point per trade post',
    color: '#8b5cf6',
  },
  forum_champion: {
    name: 'Forum Champion',
    icon: '🏛️',
    description: 'Earn the most upvotes on your content',
    metric: 'Upvotes received',
    forumBonus: '2x for diplomacy posts',
    color: '#ec4899',
  },
};

// Cycle order (Week 1 = index 0)
export const TOURNAMENT_CYCLE: TournamentType[] = [
  'wealth_sprint',
  'territory_conqueror', 
  'master_gatherer',
  'trade_baron',
  'forum_champion',
];

// Get tournament type for a given week number
export function getTournamentTypeForWeek(weekNumber: number): TournamentType {
  return TOURNAMENT_CYCLE[(weekNumber - 1) % 5];
}

// Get display name for a tournament
export function getTournamentDisplayName(type: TournamentType, weekNumber: number): string {
  const config = TOURNAMENT_CONFIG[type];
  const typeIndex = TOURNAMENT_CYCLE.indexOf(type);
  const occurrence = Math.floor((weekNumber - typeIndex - 1) / 5) + 1;
  return `${config.name} #${occurrence}`;
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
