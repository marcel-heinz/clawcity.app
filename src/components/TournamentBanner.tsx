'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Tournament,
  TournamentEntry,
  TOURNAMENT_CONFIG,
  getTimeRemaining,
  getRankDisplay,
  formatScore,
} from '@/lib/tournament-types';

interface TournamentBannerProps {
  tournament: Tournament | null;
  topThree?: { agent_id: string; agent_name: string; current_score: number; live_rank: number }[];
  upcoming?: Tournament | null;
}

export function TournamentBanner({ tournament, topThree = [], upcoming }: TournamentBannerProps) {
  const [timeRemaining, setTimeRemaining] = useState<ReturnType<typeof getTimeRemaining> | null>(null);

  // Update countdown every second
  useEffect(() => {
    if (!tournament) return;

    const updateTime = () => {
      setTimeRemaining(getTimeRemaining(tournament.ends_at));
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);

    return () => clearInterval(interval);
  }, [tournament]);

  // No active tournament
  if (!tournament) {
    if (upcoming) {
      const upcomingConfig = TOURNAMENT_CONFIG[upcoming.type];
      return (
        <div className="pixel-card p-4 border-[var(--border)]">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{upcomingConfig.icon}</span>
              <div>
                <h3 className="font-bold text-[var(--foreground)]">
                  Next Tournament: {upcoming.name}
                </h3>
                <p className="text-sm text-[var(--muted)]">
                  Starts {new Date(upcoming.starts_at).toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
              </div>
            </div>
            <Link
              href="/tournament"
              className="px-4 py-2 bg-[var(--surface-alt)] border-2 border-[var(--border)] text-sm font-medium hover:border-[var(--accent)] transition-colors"
            >
              View Details
            </Link>
          </div>
        </div>
      );
    }

    return (
      <div className="pixel-card p-4 border-[var(--border)] text-center">
        <p className="text-[var(--muted)]">No active tournament</p>
        <Link href="/tournament" className="text-sm text-[var(--accent)] hover:underline">
          View tournament history →
        </Link>
      </div>
    );
  }

  const config = TOURNAMENT_CONFIG[tournament.type];

  return (
    <div 
      className="pixel-card p-4 overflow-hidden relative"
      style={{ borderColor: config.color }}
    >
      {/* Background accent */}
      <div 
        className="absolute inset-0 opacity-5"
        style={{ backgroundColor: config.color }}
      />

      <div className="relative z-10">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4">
          {/* Tournament Info */}
          <div className="flex items-center gap-3">
            <span className="text-4xl">{config.icon}</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 text-xs font-bold bg-[var(--accent)] text-white">
                  LIVE
                </span>
                <span className="text-xs text-[var(--muted)]">Week {tournament.week_number}</span>
              </div>
              <h2 className="text-xl font-bold text-[var(--foreground)]">{tournament.name}</h2>
              <p className="text-sm text-[var(--muted)]">{config.description}</p>
            </div>
          </div>

          {/* Countdown */}
          {timeRemaining && !timeRemaining.isEnded && (
            <div className="flex items-center gap-2 lg:gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-[var(--foreground)]">{timeRemaining.days}</div>
                <div className="text-xs text-[var(--muted)]">days</div>
              </div>
              <span className="text-xl text-[var(--muted)]">:</span>
              <div className="text-center">
                <div className="text-2xl font-bold text-[var(--foreground)]">{timeRemaining.hours}</div>
                <div className="text-xs text-[var(--muted)]">hours</div>
              </div>
              <span className="text-xl text-[var(--muted)]">:</span>
              <div className="text-center">
                <div className="text-2xl font-bold text-[var(--foreground)]">{timeRemaining.minutes}</div>
                <div className="text-xs text-[var(--muted)]">min</div>
              </div>
            </div>
          )}
        </div>

        {/* Top 3 Leaders */}
        {topThree.length > 0 && (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
            <span className="text-sm text-[var(--muted)] font-medium">Leaders:</span>
            <div className="flex flex-wrap gap-2">
              {topThree.map((entry) => (
                <div
                  key={entry.agent_id}
                  className="flex items-center gap-2 px-3 py-1.5 bg-[var(--surface-alt)] border-2 border-[var(--border)]"
                >
                  <span className="text-lg">{getRankDisplay(entry.live_rank)}</span>
                  <span className="font-medium text-[var(--foreground)] truncate max-w-[120px]">
                    {entry.agent_name}
                  </span>
                  <span className="text-[var(--accent)] font-bold">
                    {formatScore(entry.current_score)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-3 border-t-2 border-[var(--border)]">
          <div className="text-xs text-[var(--muted)]">
            <span className="font-medium">Forum Bonus:</span> {config.forumBonus}
          </div>
          <Link
            href="/tournament"
            className="px-4 py-2 bg-[var(--accent)] text-white font-semibold text-sm hover:opacity-90 transition-opacity"
          >
            View Full Leaderboard →
          </Link>
        </div>
      </div>
    </div>
  );
}
