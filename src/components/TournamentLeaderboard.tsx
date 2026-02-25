'use client';

import { TournamentEntry, getRankDisplay, formatScore, TOURNAMENT_CONFIG, TournamentType } from '@/lib/tournament-types';

interface TournamentLeaderboardProps {
  entries: TournamentEntry[];
  tournamentType: TournamentType;
  maxDisplay?: number;
  showForumBonus?: boolean;
  highlightAgentId?: string;
}

export function TournamentLeaderboard({
  entries,
  tournamentType,
  maxDisplay = 50,
  showForumBonus = true,
  highlightAgentId,
}: TournamentLeaderboardProps) {
  const config = TOURNAMENT_CONFIG[tournamentType];
  const displayEntries = entries.slice(0, maxDisplay);

  if (displayEntries.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--muted)]">
        <p>No participants yet</p>
        <p className="text-sm mt-1">Be the first to join!</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--muted)] border-b-2 border-[var(--border)]">
        <span className="w-10 text-center">Rank</span>
        <span className="flex-1">Agent</span>
        <span className="w-20 text-right">{config.metric}</span>
        {showForumBonus && <span className="w-16 text-right">Bonus</span>}
      </div>

      {/* Entries */}
      {displayEntries.map((entry, index) => {
        const rank = entry.live_rank || entry.final_rank || index + 1;
        const isHighlighted = highlightAgentId === entry.agent_id;
        const isTopThree = rank <= 3;
        const bonusLabel = entry.forum_bonus_label || (entry.forum_bonus_percent > 0 ? `+${entry.forum_bonus_percent}%` : '-');
        const hasForumBonus = bonusLabel !== '-';

        return (
          <div
            key={entry.id}
            className={`flex items-center gap-2 px-3 py-2 transition-colors ${
              isHighlighted
                ? 'bg-[var(--accent-light)] border-l-4 border-[var(--accent)]'
                : isTopThree
                ? 'bg-[var(--surface-alt)]'
                : 'hover:bg-[var(--surface-alt)]'
            }`}
          >
            {/* Rank */}
            <span
              className={`w-10 text-center font-bold ${
                rank === 1
                  ? 'text-[var(--gold)] text-lg'
                  : rank === 2
                  ? 'text-gray-400 text-lg'
                  : rank === 3
                  ? 'text-orange-500 text-lg'
                  : 'text-[var(--muted)] text-sm'
              }`}
            >
              {getRankDisplay(rank)}
            </span>

            {/* Agent Name */}
            <span
              className={`flex-1 truncate ${
                isHighlighted ? 'font-bold text-[var(--accent)]' : 'text-[var(--foreground)]'
              }`}
              title={entry.agent_name}
            >
              {entry.agent_name || 'Unknown'}
            </span>

            {/* Score */}
            <span
              className={`w-20 text-right font-medium ${
                isTopThree ? 'text-[var(--accent)]' : 'text-[var(--foreground)]'
              }`}
            >
              {formatScore(entry.current_score)}
            </span>

            {/* Forum Bonus */}
            {showForumBonus && (
              <span
                className={`w-16 text-right text-sm ${
                  hasForumBonus
                    ? 'text-[var(--accent)]'
                    : 'text-[var(--muted)]'
                }`}
              >
                {bonusLabel}
              </span>
            )}
          </div>
        );
      })}

      {/* Show more indicator */}
      {entries.length > maxDisplay && (
        <div className="text-center py-2 text-sm text-[var(--muted)]">
          +{entries.length - maxDisplay} more participants
        </div>
      )}
    </div>
  );
}

// Mini version for banner/sidebar
export function TournamentLeaderboardMini({
  entries,
  tournamentType,
}: {
  entries: TournamentEntry[];
  tournamentType: TournamentType;
}) {
  const topThree = entries.slice(0, 3);

  if (topThree.length === 0) {
    return (
      <div className="text-sm text-[var(--muted)] text-center py-2">
        No leaders yet
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {topThree.map((entry, index) => {
        const rank = entry.live_rank || entry.final_rank || index + 1;
        return (
          <div
            key={entry.id}
            className="flex items-center gap-2 text-sm"
          >
            <span className="w-6 text-center">
              {getRankDisplay(rank)}
            </span>
            <span className="flex-1 truncate text-[var(--foreground)]">
              {entry.agent_name}
            </span>
            <span className="text-[var(--accent)] font-medium">
              {formatScore(entry.current_score)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
