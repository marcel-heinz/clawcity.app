'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  RENDER_LAB_ASSET_PACKS,
  RenderLabAssetPackId,
} from '@/lib/render-lab/asset-packs';
import {
  RenderLabCameraPreset,
  RenderLabPerfMetrics,
  RenderLabViewport,
  RenderLabVisualControls,
} from '@/components/render-lab/RenderLabViewport';
import { Tile } from '@/lib/types';

interface RenderLabSnapshot {
  id: string;
  name: string;
  createdAt: string;
  centerX: number;
  centerY: number;
  radius: number;
  sample: number;
  tiles: Tile[];
}

const STORAGE_KEY = 'clawcity-render-lab-snapshots-v1';
const MAX_SNAPSHOTS = 5;

const rawAdminPath = process.env.NEXT_PUBLIC_ADMIN_PATH || '/mrclhnz-dashboard';
const adminPath = rawAdminPath.startsWith('/') ? rawAdminPath : `/${rawAdminPath}`;

const DEFAULT_VISUAL_CONTROLS: RenderLabVisualControls = {
  featureDensity: 1,
  prototypeDensity: 0.12,
  jitter: 0.14,
  assetScale: 1,
  showGrid: false,
  showPrototypeBuildings: true,
  showRoads: true,
  showSettlements: true,
  showHorizonMountains: true,
  terrainRelief: 1,
  mountainBoost: 1,
  roadDensity: 0.45,
  settlementDensity: 0.22,
  renderDistance: 96,
  ambientIntensity: 0.45,
  sunIntensity: 1.2,
  fogNear: 28,
  fogFar: 95,
  exposure: 1.12,
};

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function nowIso(): string {
  return new Date().toISOString();
}

function isTileArray(value: unknown): value is Tile[] {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;

  const sample = value[0] as Partial<Tile>;
  return (
    typeof sample.x === 'number' &&
    typeof sample.y === 'number' &&
    typeof sample.terrain === 'string'
  );
}

function parseSnapshot(value: unknown): RenderLabSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Partial<RenderLabSnapshot>;
  if (
    typeof data.id !== 'string' ||
    typeof data.name !== 'string' ||
    typeof data.createdAt !== 'string' ||
    typeof data.centerX !== 'number' ||
    typeof data.centerY !== 'number' ||
    typeof data.radius !== 'number' ||
    typeof data.sample !== 'number' ||
    !isTileArray(data.tiles)
  ) {
    return null;
  }

  return {
    id: data.id,
    name: data.name,
    createdAt: data.createdAt,
    centerX: data.centerX,
    centerY: data.centerY,
    radius: data.radius,
    sample: data.sample,
    tiles: data.tiles,
  };
}

export default function RenderLabPage() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [centerX, setCenterX] = useState(250);
  const [centerY, setCenterY] = useState(250);
  const [radius, setRadius] = useState(40);
  const [sample, setSample] = useState(1);
  const [liveTiles, setLiveTiles] = useState<Tile[]>([]);
  const [isLoadingTiles, setIsLoadingTiles] = useState(false);
  const [tilesError, setTilesError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const [dataMode, setDataMode] = useState<'live' | 'snapshot'>('live');
  const [snapshots, setSnapshots] = useState<RenderLabSnapshot[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [snapshotName, setSnapshotName] = useState('');
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);
  const [exportJson, setExportJson] = useState('');
  const [importJson, setImportJson] = useState('');

  const [compareMode, setCompareMode] = useState(true);
  const [cameraPreset, setCameraPreset] = useState<RenderLabCameraPreset>('isometric');
  const [leftPackId, setLeftPackId] = useState<RenderLabAssetPackId>('current');
  const [rightPackId, setRightPackId] = useState<RenderLabAssetPackId>('frontier');
  const [controls, setControls] = useState<RenderLabVisualControls>(DEFAULT_VISUAL_CONTROLS);

  const [leftMetrics, setLeftMetrics] = useState<RenderLabPerfMetrics | null>(null);
  const [rightMetrics, setRightMetrics] = useState<RenderLabPerfMetrics | null>(null);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;

      const loaded = parsed
        .map((item) => parseSnapshot(item))
        .filter((item): item is RenderLabSnapshot => item !== null)
        .slice(0, MAX_SNAPSHOTS);

      setSnapshots(loaded);
      if (loaded.length > 0) {
        setSelectedSnapshotId(loaded[0].id);
      }
    } catch {
      // Ignore invalid local storage payload.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
  }, [snapshots]);

  const checkAuth = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/auth');
      const data = await response.json();
      setIsAuthenticated(Boolean(data.authenticated));
    } catch {
      setIsAuthenticated(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const response = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();

      if (!data.success) {
        setLoginError(data.error || 'Login failed');
        return;
      }

      setPassword('');
      setIsAuthenticated(true);
    } catch {
      setLoginError('Connection error');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/admin/auth', { method: 'DELETE' });
    } finally {
      setIsAuthenticated(false);
    }
  };

  const fetchLiveTiles = useCallback(async () => {
    setIsLoadingTiles(true);
    setTilesError(null);

    const x = clampInt(centerX, 0, 499);
    const y = clampInt(centerY, 0, 499);
    const r = clampInt(radius, 5, 250);
    const s = clampInt(sample, 1, 10);

    try {
      const response = await fetch(`/api/world/tiles?x=${x}&y=${y}&radius=${r}&sample=${s}`);
      const data = await response.json();

      if (!data.success || !Array.isArray(data.data?.tiles)) {
        setTilesError(data.error || 'Failed to fetch tiles');
        return;
      }

      setLiveTiles(data.data.tiles as Tile[]);
      setLastLoadedAt(nowIso());
      setCenterX(x);
      setCenterY(y);
      setRadius(r);
      setSample(s);
    } catch {
      setTilesError('Failed to fetch tiles (network error).');
    } finally {
      setIsLoadingTiles(false);
    }
  }, [centerX, centerY, radius, sample]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchLiveTiles();
    }
  }, [isAuthenticated, fetchLiveTiles]);

  const selectedSnapshot = useMemo(
    () => snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? null,
    [snapshots, selectedSnapshotId]
  );

  const activeTiles = dataMode === 'snapshot'
    ? (selectedSnapshot?.tiles ?? [])
    : liveTiles;

  const activeCenter = dataMode === 'snapshot' && selectedSnapshot
    ? { x: selectedSnapshot.centerX, y: selectedSnapshot.centerY }
    : { x: centerX, y: centerY };

  const saveSnapshot = () => {
    if (activeTiles.length === 0) {
      setSnapshotMessage('Cannot save snapshot: no tiles loaded.');
      return;
    }

    const trimmedName = snapshotName.trim();
    const name = trimmedName.length > 0
      ? trimmedName
      : `Snapshot ${new Date().toLocaleString()}`;

    const snapshot: RenderLabSnapshot = {
      id: `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      createdAt: nowIso(),
      centerX: activeCenter.x,
      centerY: activeCenter.y,
      radius,
      sample,
      tiles: activeTiles,
    };

    setSnapshots((prev) => [snapshot, ...prev].slice(0, MAX_SNAPSHOTS));
    setSelectedSnapshotId(snapshot.id);
    setDataMode('snapshot');
    setSnapshotName('');
    setSnapshotMessage(`Saved snapshot "${name}".`);
  };

  const deleteSelectedSnapshot = () => {
    if (!selectedSnapshot) return;

    setSnapshots((prev) => prev.filter((snapshot) => snapshot.id !== selectedSnapshot.id));
    setSelectedSnapshotId((prev) => {
      if (prev !== selectedSnapshot.id) return prev;
      const remaining = snapshots.filter((snapshot) => snapshot.id !== selectedSnapshot.id);
      return remaining[0]?.id ?? null;
    });
    setSnapshotMessage(`Deleted snapshot "${selectedSnapshot.name}".`);
  };

  const exportSelectedSnapshot = () => {
    if (!selectedSnapshot) {
      setSnapshotMessage('Select a snapshot to export.');
      return;
    }

    setExportJson(JSON.stringify(selectedSnapshot, null, 2));
    setSnapshotMessage(`Prepared export for "${selectedSnapshot.name}".`);
  };

  const importSnapshotsFromJson = () => {
    if (!importJson.trim()) {
      setSnapshotMessage('Paste snapshot JSON first.');
      return;
    }

    try {
      const parsed = JSON.parse(importJson) as unknown;
      const imported: RenderLabSnapshot[] = [];

      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const snapshot = parseSnapshot(item);
          if (snapshot) imported.push(snapshot);
        }
      } else {
        const snapshot = parseSnapshot(parsed);
        if (snapshot) imported.push(snapshot);
      }

      if (imported.length === 0) {
        setSnapshotMessage('No valid snapshots found in JSON payload.');
        return;
      }

      setSnapshots((prev) => {
        const byId = new Map<string, RenderLabSnapshot>();
        for (const snapshot of imported) byId.set(snapshot.id, snapshot);
        for (const snapshot of prev) {
          if (!byId.has(snapshot.id)) byId.set(snapshot.id, snapshot);
        }
        return Array.from(byId.values())
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, MAX_SNAPSHOTS);
      });

      setSelectedSnapshotId(imported[0].id);
      setDataMode('snapshot');
      setSnapshotMessage(`Imported ${imported.length} snapshot(s).`);
    } catch {
      setSnapshotMessage('Invalid JSON.');
    }
  };

  if (isAuthenticated === null) {
    return (
      <main className="min-h-screen bg-[var(--background)] p-6 text-[var(--muted)]">
        Loading render lab...
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] p-4">
        <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <div className="mb-6 text-center">
            <span className="text-5xl">🧪</span>
            <h1 className="mt-3 text-xl font-bold text-[var(--foreground)]">Render Lab</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">Admin access required</p>
          </div>

          <form onSubmit={handleLogin}>
            <label htmlFor="password" className="mb-2 block text-sm text-[var(--muted)]">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mb-4 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[var(--foreground)] focus:border-[var(--accent)] focus:outline-none"
              placeholder="Enter admin password"
              autoFocus
            />

            {loginError && (
              <div className="mb-4 rounded border border-red-500/50 bg-red-900/25 px-3 py-2 text-sm text-red-400">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn || !password}
              className="w-full rounded bg-[var(--accent)] py-2 font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoggingIn ? 'Logging in...' : 'Login'}
            </button>
          </form>

          <div className="mt-4 text-center">
            <Link href="/" className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--accent)]">
              ← Back to ClawCity
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const updateControl = <K extends keyof RenderLabVisualControls>(key: K, value: RenderLabVisualControls[K]) => {
    setControls((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <main className="min-h-screen bg-[var(--background)] p-4 md:p-6">
      <div className="mx-auto flex max-w-[1900px] flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">🧪 Render Lab</h1>
            <p className="text-sm text-[var(--muted)]">
              Private A/B sandbox for terrain, buildings, lighting, and camera presets.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={adminPath}
              className="rounded border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm hover:border-[var(--accent)]"
            >
              ← Admin
            </Link>
            <Link
              href={`${adminPath}/analytics`}
              className="rounded border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm hover:border-[var(--accent)]"
            >
              📊 Analytics
            </Link>
            <Link
              href={`${adminPath}/railway`}
              className="rounded border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm hover:border-[var(--accent)]"
            >
              🚂 Railway
            </Link>
            <Link
              href={`${adminPath}/avatar-lab`}
              className="rounded border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm hover:border-[var(--accent)]"
            >
              🦀 Avatar Lab
            </Link>
            <button
              onClick={handleLogout}
              className="rounded border border-red-500/50 bg-red-900/20 px-3 py-1.5 text-sm text-red-400 hover:bg-red-900/40"
            >
              Logout
            </button>
          </div>
        </header>

        <section className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Data Source</h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setDataMode('live')}
                  className={`rounded border px-3 py-2 text-sm ${
                    dataMode === 'live'
                      ? 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--foreground)]'
                      : 'border-[var(--border)]'
                  }`}
                >
                  Live tiles
                </button>
                <button
                  onClick={() => setDataMode('snapshot')}
                  className={`rounded border px-3 py-2 text-sm ${
                    dataMode === 'snapshot'
                      ? 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--foreground)]'
                      : 'border-[var(--border)]'
                  }`}
                >
                  Snapshot replay
                </button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Center X</span>
                  <input
                    type="number"
                    min={0}
                    max={499}
                    value={centerX}
                    onChange={(event) => setCenterX(Number(event.target.value))}
                    className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Center Y</span>
                  <input
                    type="number"
                    min={0}
                    max={499}
                    value={centerY}
                    onChange={(event) => setCenterY(Number(event.target.value))}
                    className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Radius</span>
                  <input
                    type="number"
                    min={5}
                    max={250}
                    value={radius}
                    onChange={(event) => setRadius(Number(event.target.value))}
                    className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Sample</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={sample}
                    onChange={(event) => setSample(Number(event.target.value))}
                    className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1"
                  />
                </label>
              </div>

              <button
                onClick={fetchLiveTiles}
                disabled={isLoadingTiles}
                className="mt-3 w-full rounded border border-[var(--accent)] bg-[var(--accent-light)] px-3 py-2 text-sm font-semibold text-[var(--foreground)] transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {isLoadingTiles ? 'Loading tiles...' : 'Reload live tiles'}
              </button>

              <div className="mt-2 text-xs text-[var(--muted)]">
                Active set: {activeTiles.length.toLocaleString()} tiles
                {lastLoadedAt ? ` • Last live load: ${new Date(lastLoadedAt).toLocaleTimeString()}` : ''}
              </div>

              {tilesError && (
                <div className="mt-2 rounded border border-red-500/50 bg-red-900/20 px-3 py-2 text-xs text-red-400">
                  {tilesError}
                </div>
              )}
            </div>

            <div className="border-t border-[var(--border)] pt-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Snapshots</h2>
              <label className="mt-3 flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">Select snapshot</span>
                <select
                  value={selectedSnapshotId ?? ''}
                  onChange={(event) => setSelectedSnapshotId(event.target.value || null)}
                  className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1"
                >
                  <option value="">None</option>
                  {snapshots.map((snapshot) => (
                    <option key={snapshot.id} value={snapshot.id}>
                      {snapshot.name} ({snapshot.tiles.length.toLocaleString()} tiles)
                    </option>
                  ))}
                </select>
              </label>

              <label className="mt-2 flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">New snapshot name</span>
                <input
                  type="text"
                  value={snapshotName}
                  onChange={(event) => setSnapshotName(event.target.value)}
                  placeholder="e.g. Marsh readability pass"
                  className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1"
                />
              </label>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  onClick={saveSnapshot}
                  className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs hover:border-[var(--accent)]"
                >
                  Save current
                </button>
                <button
                  onClick={deleteSelectedSnapshot}
                  disabled={!selectedSnapshot}
                  className="rounded border border-red-500/50 bg-red-900/20 px-2 py-1.5 text-xs text-red-300 hover:bg-red-900/35 disabled:opacity-40"
                >
                  Delete selected
                </button>
                <button
                  onClick={exportSelectedSnapshot}
                  disabled={!selectedSnapshot}
                  className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs hover:border-[var(--accent)] disabled:opacity-40"
                >
                  Export JSON
                </button>
                <button
                  onClick={importSnapshotsFromJson}
                  className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs hover:border-[var(--accent)]"
                >
                  Import JSON
                </button>
              </div>

              {snapshotMessage && (
                <div className="mt-2 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--muted)]">
                  {snapshotMessage}
                </div>
              )}

              <label className="mt-3 flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">Export payload</span>
                <textarea
                  value={exportJson}
                  onChange={(event) => setExportJson(event.target.value)}
                  rows={6}
                  className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 font-mono text-xs"
                />
              </label>

              <label className="mt-2 flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">Import payload</span>
                <textarea
                  value={importJson}
                  onChange={(event) => setImportJson(event.target.value)}
                  rows={6}
                  className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 font-mono text-xs"
                />
              </label>
            </div>

            <div className="border-t border-[var(--border)] pt-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Lab Controls</h2>

              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={compareMode}
                    onChange={(event) => setCompareMode(event.target.checked)}
                  />
                  A/B compare
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={controls.showPrototypeBuildings}
                    onChange={(event) => updateControl('showPrototypeBuildings', event.target.checked)}
                  />
                  Prototype buildings
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={controls.showGrid}
                    onChange={(event) => updateControl('showGrid', event.target.checked)}
                  />
                  Grid helper
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={controls.showRoads}
                    onChange={(event) => updateControl('showRoads', event.target.checked)}
                  />
                  Road overlay
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={controls.showSettlements}
                    onChange={(event) => updateControl('showSettlements', event.target.checked)}
                  />
                  Settlement overlay
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={controls.showHorizonMountains}
                    onChange={(event) => updateControl('showHorizonMountains', event.target.checked)}
                  />
                  Horizon mountains
                </label>
              </div>

              <label className="mt-2 flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">Camera preset</span>
                <select
                  value={cameraPreset}
                  onChange={(event) => setCameraPreset(event.target.value as RenderLabCameraPreset)}
                  className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1"
                >
                  <option value="cinematic">Cinematic follow</option>
                  <option value="isometric">Isometric</option>
                  <option value="tactical">Tactical wide</option>
                  <option value="topdown">Top-down</option>
                </select>
              </label>

              <label className="mt-2 flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">Left pack</span>
                <select
                  value={leftPackId}
                  onChange={(event) => setLeftPackId(event.target.value as RenderLabAssetPackId)}
                  className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1"
                >
                  {RENDER_LAB_ASSET_PACKS.map((pack) => (
                    <option key={pack.id} value={pack.id}>{pack.label}</option>
                  ))}
                </select>
              </label>

              {compareMode && (
                <label className="mt-2 flex flex-col gap-1 text-sm">
                  <span className="text-[var(--muted)]">Right pack</span>
                  <select
                    value={rightPackId}
                    onChange={(event) => setRightPackId(event.target.value as RenderLabAssetPackId)}
                    className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1"
                  >
                    {RENDER_LAB_ASSET_PACKS.map((pack) => (
                      <option key={pack.id} value={pack.id}>{pack.label}</option>
                    ))}
                  </select>
                </label>
              )}

              <div className="mt-3 space-y-2 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Feature density: {controls.featureDensity.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={controls.featureDensity}
                    onChange={(event) => updateControl('featureDensity', Number(event.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Prototype density: {controls.prototypeDensity.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={0.6}
                    step={0.01}
                    value={controls.prototypeDensity}
                    onChange={(event) => updateControl('prototypeDensity', Number(event.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Terrain relief: {controls.terrainRelief.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0.5}
                    max={2}
                    step={0.01}
                    value={controls.terrainRelief}
                    onChange={(event) => updateControl('terrainRelief', Number(event.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Mountain boost: {controls.mountainBoost.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0.5}
                    max={2.4}
                    step={0.01}
                    value={controls.mountainBoost}
                    onChange={(event) => updateControl('mountainBoost', Number(event.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Asset scale: {controls.assetScale.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0.6}
                    max={1.5}
                    step={0.01}
                    value={controls.assetScale}
                    onChange={(event) => updateControl('assetScale', Number(event.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Position jitter: {controls.jitter.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={0.35}
                    step={0.01}
                    value={controls.jitter}
                    onChange={(event) => updateControl('jitter', Number(event.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Road density: {controls.roadDensity.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={controls.roadDensity}
                    onChange={(event) => updateControl('roadDensity', Number(event.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Settlement density: {controls.settlementDensity.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={0.7}
                    step={0.01}
                    value={controls.settlementDensity}
                    onChange={(event) => updateControl('settlementDensity', Number(event.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Render distance: {controls.renderDistance.toFixed(0)}</span>
                  <input
                    type="range"
                    min={30}
                    max={170}
                    step={1}
                    value={controls.renderDistance}
                    onChange={(event) => updateControl('renderDistance', Number(event.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Ambient light: {controls.ambientIntensity.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1.2}
                    step={0.01}
                    value={controls.ambientIntensity}
                    onChange={(event) => updateControl('ambientIntensity', Number(event.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Sun intensity: {controls.sunIntensity.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0.2}
                    max={2.2}
                    step={0.01}
                    value={controls.sunIntensity}
                    onChange={(event) => updateControl('sunIntensity', Number(event.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Fog near: {controls.fogNear.toFixed(0)}</span>
                  <input
                    type="range"
                    min={8}
                    max={80}
                    step={1}
                    value={controls.fogNear}
                    onChange={(event) => updateControl('fogNear', Number(event.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Fog far: {controls.fogFar.toFixed(0)}</span>
                  <input
                    type="range"
                    min={25}
                    max={160}
                    step={1}
                    value={controls.fogFar}
                    onChange={(event) => updateControl('fogFar', Number(event.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Exposure: {controls.exposure.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0.6}
                    max={1.6}
                    step={0.01}
                    value={controls.exposure}
                    onChange={(event) => updateControl('exposure', Number(event.target.value))}
                  />
                </label>
              </div>
            </div>
          </aside>

          <section className="space-y-4">
            <div className={`grid gap-4 ${compareMode ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
              <RenderLabViewport
                title={compareMode ? 'Variant A' : 'Render Preview'}
                tiles={activeTiles}
                centerX={activeCenter.x}
                centerY={activeCenter.y}
                packId={leftPackId}
                cameraPreset={cameraPreset}
                controls={controls}
                onMetrics={setLeftMetrics}
              />

              {compareMode && (
                <RenderLabViewport
                  title="Variant B"
                  tiles={activeTiles}
                  centerX={activeCenter.x}
                  centerY={activeCenter.y}
                  packId={rightPackId}
                  cameraPreset={cameraPreset}
                  controls={controls}
                  onMetrics={setRightMetrics}
                />
              )}
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Performance panel</h3>
              <div className={`mt-3 grid gap-3 text-sm ${compareMode ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
                <div className="rounded border border-[var(--border)] bg-[var(--background)] p-3">
                  <div className="mb-1 font-semibold text-[var(--foreground)]">Variant A</div>
                  {leftMetrics ? (
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>FPS: {leftMetrics.fps.toFixed(1)}</div>
                      <div>Frame: {leftMetrics.frameMs.toFixed(1)} ms</div>
                      <div>Draw calls: {leftMetrics.drawCalls}</div>
                      <div>Triangles: {leftMetrics.triangles.toLocaleString()}</div>
                      <div>Geometries: {leftMetrics.geometries}</div>
                      <div>Textures: {leftMetrics.textures}</div>
                    </div>
                  ) : (
                    <div className="text-xs text-[var(--muted)]">Waiting for metrics...</div>
                  )}
                </div>

                {compareMode && (
                  <div className="rounded border border-[var(--border)] bg-[var(--background)] p-3">
                    <div className="mb-1 font-semibold text-[var(--foreground)]">Variant B</div>
                    {rightMetrics ? (
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>FPS: {rightMetrics.fps.toFixed(1)}</div>
                        <div>Frame: {rightMetrics.frameMs.toFixed(1)} ms</div>
                        <div>Draw calls: {rightMetrics.drawCalls}</div>
                        <div>Triangles: {rightMetrics.triangles.toLocaleString()}</div>
                        <div>Geometries: {rightMetrics.geometries}</div>
                        <div>Textures: {rightMetrics.textures}</div>
                      </div>
                    ) : (
                      <div className="text-xs text-[var(--muted)]">Waiting for metrics...</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
