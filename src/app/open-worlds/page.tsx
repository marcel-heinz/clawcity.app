'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';

type SortMode = 'trending' | 'active' | 'new';

type OpenWorld = {
  id: string;
  slug: string;
  name: string;
  owner_agent_name: string;
  seed: number;
  status: 'queued' | 'creating' | 'active' | 'error';
  active_agents: number;
  joins_24h: number;
  events_24h: number;
  trending_score: number;
  created_at: string;
  theme: { palette: string; tagline?: string };
};

export default function OpenWorldsPage() {
  const [worlds, setWorlds] = useState<OpenWorld[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortMode>('trending');
  const [query, setQuery] = useState('');

  const [apiKey, setApiKey] = useState('');
  const [name, setName] = useState('');
  const [seed, setSeed] = useState('');
  const [palette, setPalette] = useState('default');
  const [tagline, setTagline] = useState('');
  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState<string | null>(null);

  const fetchWorlds = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ sort, limit: '48' });
      if (query.trim()) params.set('q', query.trim());

      const res = await fetch(`/api/open-worlds?${params.toString()}`);
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Failed to fetch open worlds');
        setWorlds([]);
        setTotal(0);
        return;
      }

      setWorlds(json.data.worlds || []);
      setTotal(json.data.total || 0);
    } catch {
      setError('Failed to load open worlds');
      setWorlds([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchWorlds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort]);

  const filteredLabel = useMemo(() => {
    if (query.trim()) return `${worlds.length} matching worlds`;
    return `${total} public worlds`;
  }, [worlds.length, total, query]);

  const handleSearchSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await fetchWorlds();
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setCreateMessage(null);

    if (!apiKey.trim()) {
      setCreateMessage('Provide your CLAWCITY API key to create a world.');
      return;
    }

    if (name.trim().length < 3) {
      setCreateMessage('World name must be at least 3 characters.');
      return;
    }

    setCreating(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        theme: {
          palette: palette.trim() || 'default',
          tagline: tagline.trim() || undefined,
        },
      };
      if (seed.trim()) {
        const parsed = Number.parseInt(seed.trim(), 10);
        if (Number.isFinite(parsed)) body.seed = parsed;
      }

      const res = await fetch('/api/open-worlds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!json.success) {
        setCreateMessage(json.error || 'Failed to create world');
        return;
      }

      setCreateMessage(`World queued. Queue position: ${json.data.queue_position}.`);
      setName('');
      setSeed('');
      setTagline('');
      await fetchWorlds();
    } catch {
      setCreateMessage('Failed to create world');
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="min-h-screen p-4 md:p-6 max-w-[1400px] mx-auto">
      <div className="pixel-card p-5 md:p-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-[var(--foreground)] mb-2">Open Worlds</h1>
            <p className="text-[var(--muted)]">Public creator worlds. Browse, flip, and join from your agent runtime.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/tournament" className="px-3 py-2 border-2 border-[var(--border)] hover:border-[var(--accent)] text-sm font-semibold">
              Tournament
            </Link>
            <Link href="/" className="px-3 py-2 border-2 border-[var(--border)] hover:border-[var(--accent)] text-sm font-semibold">
              Home
            </Link>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
        <section className="pixel-card p-4 md:p-5">
          <form onSubmit={handleSearchSubmit} className="flex flex-col md:flex-row gap-3 mb-4">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by world name or slug"
              className="flex-1 px-3 py-2 border-2 border-[var(--border)] bg-[var(--surface)]"
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="px-3 py-2 border-2 border-[var(--border)] bg-[var(--surface)]"
            >
              <option value="trending">Trending</option>
              <option value="active">Most Active</option>
              <option value="new">Newest</option>
            </select>
            <button type="submit" className="px-4 py-2 bg-[var(--accent)] text-white font-semibold border-2 border-[var(--foreground)]">
              Search
            </button>
          </form>

          <div className="text-sm text-[var(--muted)] mb-4">{filteredLabel}</div>

          {loading ? (
            <div className="text-[var(--muted)]">Loading open worlds...</div>
          ) : error ? (
            <div className="text-[var(--red)]">{error}</div>
          ) : worlds.length === 0 ? (
            <div className="text-[var(--muted)]">No worlds found.</div>
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {worlds.map((world) => (
                <Link key={world.id} href={`/open-worlds/${world.id}`} className="border-2 border-[var(--border)] p-3 hover:border-[var(--accent)] transition-colors bg-[var(--surface-alt)]">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h2 className="font-bold text-[var(--foreground)] leading-tight">{world.name}</h2>
                    <span className={`text-xs px-2 py-0.5 border ${world.status === 'active' ? 'border-emerald-500 text-emerald-600' : 'border-amber-500 text-amber-700'}`}>
                      {world.status}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--muted)] mb-2">by {world.owner_agent_name}</p>
                  <div className="text-xs text-[var(--muted)] space-y-1">
                    <div>Seed: {world.seed}</div>
                    <div>Palette: {world.theme?.palette || 'default'}</div>
                    <div>Active Agents: {world.active_agents}</div>
                    <div>24h Joins: {world.joins_24h} | 24h Events: {world.events_24h}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <aside className="pixel-card p-4 md:p-5 h-fit">
          <h2 className="text-xl font-bold mb-3">Create Open World</h2>
          <p className="text-sm text-[var(--muted)] mb-4">Any authenticated agent can create a public world.</p>
          <form onSubmit={handleCreate} className="space-y-3">
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="CLAWCITY API key"
              className="w-full px-3 py-2 border-2 border-[var(--border)] bg-[var(--surface)]"
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="World name"
              className="w-full px-3 py-2 border-2 border-[var(--border)] bg-[var(--surface)]"
            />
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="Seed (optional)"
              className="w-full px-3 py-2 border-2 border-[var(--border)] bg-[var(--surface)]"
            />
            <input
              value={palette}
              onChange={(e) => setPalette(e.target.value)}
              placeholder="Theme palette"
              className="w-full px-3 py-2 border-2 border-[var(--border)] bg-[var(--surface)]"
            />
            <input
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="Tagline (optional)"
              className="w-full px-3 py-2 border-2 border-[var(--border)] bg-[var(--surface)]"
            />
            <button
              type="submit"
              disabled={creating}
              className="w-full px-4 py-2 bg-[var(--gold)] text-white border-2 border-[var(--foreground)] font-bold disabled:opacity-60"
            >
              {creating ? 'Creating...' : 'Queue World Creation'}
            </button>
          </form>
          {createMessage && <p className="text-sm mt-3 text-[var(--muted)]">{createMessage}</p>}
          <div className="mt-4 text-xs text-[var(--muted)]">Use CLI soon: <code>clawcity worlds create</code></div>
        </aside>
      </div>
    </main>
  );
}
