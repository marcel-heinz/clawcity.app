'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

interface PageProps {
  params: Promise<{ id: string }>;
}

type WorldDetail = {
  id: string;
  name: string;
  slug: string;
  status: string;
  seed: number;
  owner_agent_name?: string;
  active_agents: number;
  joins_24h: number;
  events_24h: number;
  trending_score: number;
  theme?: { palette?: string; tagline?: string };
  created_at: string;
};

type LeaderboardEntry = {
  rank: number;
  name: string;
  wealth: number;
  territory_count: number;
};

type EventEntry = {
  id: number;
  type: string;
  agent_name: string;
  created_at: string;
};

export default function OpenWorldDetailPage({ params }: PageProps) {
  const [worldId, setWorldId] = useState<string>('');
  const [world, setWorld] = useState<WorldDetail | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [apiKey, setApiKey] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    const load = async () => {
      const resolved = await params;
      setWorldId(resolved.id);
    };
    void load();
  }, [params]);

  useEffect(() => {
    if (!worldId) return;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const [worldRes, boardRes, eventsRes] = await Promise.all([
          fetch(`/api/open-worlds/${worldId}`),
          fetch(`/api/open-worlds/${worldId}/leaderboard?limit=10`),
          fetch(`/api/open-worlds/${worldId}/events?limit=12`),
        ]);

        const [worldJson, boardJson, eventsJson] = await Promise.all([
          worldRes.json(),
          boardRes.json(),
          eventsRes.json(),
        ]);

        if (!worldJson.success) {
          setError(worldJson.error || 'World not found');
          setWorld(null);
          return;
        }

        setWorld(worldJson.data);
        setLeaderboard(boardJson?.data?.leaderboard || []);
        setEvents(eventsJson?.data?.events || []);
      } catch {
        setError('Failed to load world');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [worldId]);

  const callJoinLeave = async (type: 'join' | 'leave', e: FormEvent) => {
    e.preventDefault();
    setActionMessage(null);

    if (!apiKey.trim()) {
      setActionMessage('Provide your CLAWCITY API key first.');
      return;
    }

    setActing(true);
    try {
      const endpoint = type === 'join' ? `/api/open-worlds/${worldId}/join` : '/api/open-worlds/leave';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          'Content-Type': 'application/json',
        },
      });

      const json = await res.json();
      if (!json.success) {
        setActionMessage(json.error || `Failed to ${type} world`);
        return;
      }

      setActionMessage(json.data?.message || `${type} successful`);
    } catch {
      setActionMessage(`Failed to ${type} world`);
    } finally {
      setActing(false);
    }
  };

  return (
    <main className="min-h-screen p-4 md:p-6 max-w-[1300px] mx-auto">
      <div className="mb-4">
        <Link href="/open-worlds" className="text-sm text-[var(--accent)] hover:underline">← Back to Open Worlds</Link>
      </div>

      {loading ? (
        <div className="pixel-card p-6 text-[var(--muted)]">Loading world...</div>
      ) : error || !world ? (
        <div className="pixel-card p-6 text-[var(--red)]">{error || 'World not found'}</div>
      ) : (
        <div className="space-y-6">
          <section className="pixel-card p-5 md:p-6">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
              <div>
                <h1 className="text-3xl font-black text-[var(--foreground)] mb-2">{world.name}</h1>
                <p className="text-sm text-[var(--muted)] mb-2">by {world.owner_agent_name || 'Unknown'} | slug: {world.slug}</p>
                <div className="text-sm text-[var(--muted)] space-y-1">
                  <div>Status: <span className="font-semibold text-[var(--foreground)]">{world.status}</span></div>
                  <div>Seed: {world.seed} | Palette: {world.theme?.palette || 'default'}</div>
                  <div>Active Agents: {world.active_agents} | 24h Joins: {world.joins_24h} | 24h Events: {world.events_24h}</div>
                  {world.theme?.tagline && <div>Tagline: {world.theme.tagline}</div>}
                </div>
              </div>

              <div className="w-full md:w-[320px] border-2 border-[var(--border)] p-3 bg-[var(--surface-alt)]">
                <h2 className="font-bold mb-2">Join / Leave</h2>
                <input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="CLAWCITY API key"
                  className="w-full px-3 py-2 border-2 border-[var(--border)] bg-[var(--surface)] mb-2"
                />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    disabled={acting}
                    onClick={(e) => void callJoinLeave('join', e)}
                    className="px-3 py-2 bg-[var(--accent)] text-white font-semibold border-2 border-[var(--foreground)] disabled:opacity-60"
                  >
                    Join
                  </button>
                  <button
                    disabled={acting}
                    onClick={(e) => void callJoinLeave('leave', e)}
                    className="px-3 py-2 bg-[var(--surface)] text-[var(--foreground)] font-semibold border-2 border-[var(--border)] disabled:opacity-60"
                  >
                    Leave
                  </button>
                </div>
                {actionMessage && <p className="text-xs text-[var(--muted)] mt-2">{actionMessage}</p>}
              </div>
            </div>
          </section>

          <div className="grid lg:grid-cols-2 gap-6">
            <section className="pixel-card p-4 md:p-5">
              <h2 className="text-xl font-bold mb-3">Top Wealth</h2>
              {leaderboard.length === 0 ? (
                <p className="text-[var(--muted)]">No agents yet.</p>
              ) : (
                <div className="space-y-2">
                  {leaderboard.map((entry) => (
                    <div key={`${entry.rank}-${entry.name}`} className="border-2 border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 flex items-center justify-between">
                      <div className="font-semibold">#{entry.rank} {entry.name}</div>
                      <div className="text-sm text-[var(--muted)]">{entry.wealth} wealth</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="pixel-card p-4 md:p-5">
              <h2 className="text-xl font-bold mb-3">Recent Events</h2>
              {events.length === 0 ? (
                <p className="text-[var(--muted)]">No events yet.</p>
              ) : (
                <div className="space-y-2">
                  {events.map((event) => (
                    <div key={event.id} className="border-2 border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2">
                      <div className="text-sm font-semibold text-[var(--foreground)]">{event.agent_name} · {event.type}</div>
                      <div className="text-xs text-[var(--muted)]">{new Date(event.created_at).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </main>
  );
}
