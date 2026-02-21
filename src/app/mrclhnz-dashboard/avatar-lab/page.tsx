'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import NextImage from 'next/image';
import {
  AVATAR_LAB_MODELS,
  ResolvedAvatarLabConfig,
  resolveAvatarLabConfig,
} from '@/lib/avatar-lab';
import { AvatarLabPerfMetrics, AvatarLabViewport } from '@/components/avatar-lab/AvatarLabViewport';

interface AvatarLabAgent {
  id: string;
  name: string;
  x: number;
  y: number;
  last_active: string;
  avatar?: Record<string, unknown>;
  avatar_lab?: ResolvedAvatarLabConfig;
}

interface AvatarLabPreset {
  id: string;
  name: string;
  createdAt: string;
  config: ResolvedAvatarLabConfig;
}

const rawAdminPath = process.env.NEXT_PUBLIC_ADMIN_PATH || '/mrclhnz-dashboard';
const adminPath = rawAdminPath.startsWith('/') ? rawAdminPath : `/${rawAdminPath}`;
const PRESETS_STORAGE_KEY = 'clawcity-avatar-lab-presets-v1';
const MAX_PRESETS = 8;

function defaultConfig(name = 'Prototype'): ResolvedAvatarLabConfig {
  return resolveAvatarLabConfig(name, {});
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function parsePresetArray(input: unknown): AvatarLabPreset[] {
  if (!Array.isArray(input)) return [];

  const parsed: AvatarLabPreset[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const data = item as Partial<AvatarLabPreset>;
    if (
      typeof data.id !== 'string' ||
      typeof data.name !== 'string' ||
      typeof data.createdAt !== 'string' ||
      !data.config ||
      typeof data.config !== 'object'
    ) {
      continue;
    }

    parsed.push({
      id: data.id,
      name: data.name,
      createdAt: data.createdAt,
      config: resolveAvatarLabConfig('Preset', data.config),
    });
  }

  return parsed.slice(0, MAX_PRESETS);
}

async function toCompressedSkinDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image uploads are supported');
  }

  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to read file data'));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Failed to decode image'));
    el.src = rawDataUrl;
  });

  const maxDimension = 256;
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (width <= 0 || height <= 0) throw new Error('Invalid image dimensions');

  const ratio = Math.min(maxDimension / width, maxDimension / height, 1);
  const outW = clampInt(width * ratio, 16, maxDimension);
  const outH = clampInt(height * ratio, 16, maxDimension);

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.clearRect(0, 0, outW, outH);
  ctx.drawImage(img, 0, 0, outW, outH);

  const webp = canvas.toDataURL('image/webp', 0.9);
  if (webp.startsWith('data:image/webp')) {
    return webp;
  }
  return canvas.toDataURL('image/png');
}

export default function AvatarLabPage() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [agents, setAgents] = useState<AvatarLabAgent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isProcessingSkin, setIsProcessingSkin] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [compareMode, setCompareMode] = useState(true);
  const [draft, setDraft] = useState<ResolvedAvatarLabConfig>(defaultConfig());

  const [leftMetrics, setLeftMetrics] = useState<AvatarLabPerfMetrics | null>(null);
  const [rightMetrics, setRightMetrics] = useState<AvatarLabPerfMetrics | null>(null);

  const [presets, setPresets] = useState<AvatarLabPreset[]>([]);
  const [presetName, setPresetName] = useState('');

  useEffect(() => {
    const raw = window.localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return;
    try {
      setPresets(parsePresetArray(JSON.parse(raw) as unknown));
    } catch {
      setPresets([]);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
  }, [presets]);

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

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );

  const baseline = useMemo(() => {
    if (!selectedAgent) return defaultConfig();
    return selectedAgent.avatar_lab
      ? resolveAvatarLabConfig(selectedAgent.name, selectedAgent.avatar_lab)
      : resolveAvatarLabConfig(selectedAgent.name, selectedAgent.avatar);
  }, [selectedAgent]);

  useEffect(() => {
    setDraft(baseline);
  }, [baseline]);

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseline),
    [draft, baseline]
  );

  const fetchAgents = useCallback(async (search = '') => {
    setIsLoadingAgents(true);
    setError(null);

    try {
      const trimmed = search.trim();
      const params = new URLSearchParams();
      if (trimmed) params.set('search', trimmed);
      const suffix = params.toString().length > 0 ? `?${params.toString()}` : '';
      const response = await fetch(`/api/admin/avatar-lab${suffix}`);
      const data = await response.json();

      if (!data.success || !Array.isArray(data.data?.agents)) {
        setError(data.error || 'Failed to load agents');
        return;
      }

      const loaded = (data.data.agents as AvatarLabAgent[]).map((agent) => ({
        ...agent,
        avatar_lab: resolveAvatarLabConfig(agent.name, agent.avatar_lab ?? agent.avatar),
      }));
      setAgents(loaded);
      setSelectedAgentId((prev) => {
        if (!loaded.length) return null;
        if (prev && loaded.some((agent) => agent.id === prev)) return prev;
        return loaded[0].id;
      });
    } catch {
      setError('Failed to load agents (network error)');
    } finally {
      setIsLoadingAgents(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchAgents('');
    }
  }, [isAuthenticated, fetchAgents]);

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

  const updateDraft = <K extends keyof ResolvedAvatarLabConfig>(key: K, value: ResolvedAvatarLabConfig[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const applyPreset = (preset: AvatarLabPreset) => {
    setDraft(resolveAvatarLabConfig(selectedAgent?.name ?? 'Preset', preset.config));
    setStatusMessage(`Preset loaded: ${preset.name}`);
  };

  const savePreset = () => {
    const name = presetName.trim() || `Preset ${new Date().toLocaleTimeString()}`;
    const preset: AvatarLabPreset = {
      id: `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      createdAt: new Date().toISOString(),
      config: draft,
    };
    setPresets((prev) => [preset, ...prev].slice(0, MAX_PRESETS));
    setPresetName('');
    setStatusMessage(`Saved preset "${name}".`);
  };

  const deletePreset = (id: string) => {
    setPresets((prev) => prev.filter((preset) => preset.id !== id));
  };

  const handleSkinUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (file.size > 4_000_000) {
      setError('Skin upload must be <= 4MB');
      return;
    }

    setIsProcessingSkin(true);
    setError(null);
    try {
      const dataUrl = await toCompressedSkinDataUrl(file);
      updateDraft('skin_data_url', dataUrl);
      setStatusMessage(`Skin loaded (${file.name})`);
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'Failed to process skin';
      setError(message);
    } finally {
      setIsProcessingSkin(false);
    }
  };

  const handleSave = async () => {
    if (!selectedAgent) return;
    setIsSaving(true);
    setError(null);
    setStatusMessage(null);

    try {
      const avatarPayload: Record<string, unknown> = { ...draft };
      if (!draft.skin_data_url) {
        avatarPayload.skin_data_url = null;
      }

      const response = await fetch('/api/admin/avatar-lab', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: selectedAgent.id,
          avatar: avatarPayload,
        }),
      });

      const data = await response.json();
      if (!data.success) {
        setError(data.error || 'Failed to save avatar');
        return;
      }

      const savedAgent = data.data?.agent as { id: string; avatar?: Record<string, unknown>; avatar_lab?: ResolvedAvatarLabConfig } | undefined;
      if (savedAgent) {
        setAgents((prev) => prev.map((agent) => {
          if (agent.id !== savedAgent.id) return agent;
          return {
            ...agent,
            avatar: savedAgent.avatar,
            avatar_lab: savedAgent.avatar_lab ?? resolveAvatarLabConfig(agent.name, savedAgent.avatar),
          };
        }));
      }

      setStatusMessage(`Updated avatar for ${selectedAgent.name}.`);
    } catch {
      setError('Failed to save avatar (network error)');
    } finally {
      setIsSaving(false);
    }
  };

  if (isAuthenticated === null) {
    return (
      <main className="min-h-screen bg-[var(--background)] p-6 text-[var(--muted)]">
        Loading avatar lab...
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] p-4">
        <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <div className="mb-6 text-center">
            <span className="text-5xl">🦀</span>
            <h1 className="mt-3 text-xl font-bold text-[var(--foreground)]">Avatar Lab</h1>
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

  return (
    <main className="min-h-screen bg-[var(--background)] p-4 md:p-6">
      <div className="mx-auto flex max-w-[1900px] flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">🦀 Avatar Lab</h1>
            <p className="text-sm text-[var(--muted)]">
              Admin-only avatar engine sandbox: recolor, skin upload, and next-gen model archetypes.
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
              href={`${adminPath}/render-lab`}
              className="rounded border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm hover:border-[var(--accent)]"
            >
              🧪 Render Lab
            </Link>
            <button
              onClick={handleLogout}
              className="rounded border border-red-500/50 bg-red-900/20 px-3 py-1.5 text-sm text-red-400 hover:bg-red-900/40"
            >
              Logout
            </button>
          </div>
        </header>

        {error && (
          <div className="rounded border border-red-500/60 bg-red-900/20 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
        {statusMessage && (
          <div className="rounded border border-green-500/60 bg-green-900/20 px-3 py-2 text-sm text-green-300">
            {statusMessage}
          </div>
        )}

        <section className="grid gap-4 xl:grid-cols-[390px_minmax(0,1fr)]">
          <aside className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Agent Target</h2>
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search agent name..."
                  className="flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
                />
                <button
                  onClick={() => fetchAgents(query)}
                  disabled={isLoadingAgents}
                  className="rounded border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm hover:border-[var(--accent)] disabled:opacity-50"
                >
                  {isLoadingAgents ? '...' : 'Search'}
                </button>
              </div>

              <label className="mt-2 flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">Selected agent</span>
                <select
                  value={selectedAgentId ?? ''}
                  onChange={(event) => setSelectedAgentId(event.target.value || null)}
                  className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1"
                >
                  <option value="">None</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} ({agent.x}, {agent.y})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="border-t border-[var(--border)] pt-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Model & Palette</h2>

              <label className="mt-2 flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">Model archetype</span>
                <select
                  value={draft.model_type}
                  onChange={(event) => updateDraft('model_type', event.target.value as ResolvedAvatarLabConfig['model_type'])}
                  className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1"
                >
                  {AVATAR_LAB_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-1 text-xs text-[var(--muted)]">
                {AVATAR_LAB_MODELS.find((model) => model.id === draft.model_type)?.description}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Body</span>
                  <input type="color" value={draft.body_color} onChange={(event) => updateDraft('body_color', event.target.value)} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Secondary</span>
                  <input type="color" value={draft.claw_color} onChange={(event) => updateDraft('claw_color', event.target.value)} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Eye</span>
                  <input type="color" value={draft.eye_color} onChange={(event) => updateDraft('eye_color', event.target.value)} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Accent</span>
                  <input type="color" value={draft.accent_color} onChange={(event) => updateDraft('accent_color', event.target.value)} />
                </label>
              </div>
            </div>

            <div className="border-t border-[var(--border)] pt-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Skin & Material</h2>
              <div className="mt-2 space-y-2 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Skin image (PNG/JPG/WebP)</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleSkinUpload}
                    className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => updateDraft('skin_data_url', null)}
                    className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 hover:border-[var(--accent)]"
                  >
                    Clear skin
                  </button>
                  <button
                    onClick={() => setDraft(baseline)}
                    className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 hover:border-[var(--accent)]"
                  >
                    Revert draft
                  </button>
                </div>

                {draft.skin_data_url && (
                  <NextImage
                    src={draft.skin_data_url}
                    alt="Skin preview"
                    width={80}
                    height={80}
                    unoptimized
                    className="h-20 w-20 rounded border border-[var(--border)] object-cover"
                  />
                )}

                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Skin scale: {draft.skin_scale.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0.2}
                    max={4}
                    step={0.05}
                    value={draft.skin_scale}
                    onChange={(event) => updateDraft('skin_scale', Number(event.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Skin tint blend: {draft.skin_tint_strength.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={draft.skin_tint_strength}
                    onChange={(event) => updateDraft('skin_tint_strength', Number(event.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Roughness: {draft.material_roughness.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.01}
                    value={draft.material_roughness}
                    onChange={(event) => updateDraft('material_roughness', Number(event.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Metalness: {draft.material_metalness.toFixed(2)}</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={draft.material_metalness}
                    onChange={(event) => updateDraft('material_metalness', Number(event.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-[var(--muted)]">Animation profile</span>
                  <select
                    value={draft.animation_profile}
                    onChange={(event) => updateDraft('animation_profile', event.target.value as ResolvedAvatarLabConfig['animation_profile'])}
                    className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1"
                  >
                    <option value="idle">Idle spin</option>
                    <option value="energetic">Energetic</option>
                    <option value="float">Floating</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="border-t border-[var(--border)] pt-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Presets</h2>
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                  placeholder="Preset name..."
                  className="flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-sm"
                />
                <button
                  onClick={savePreset}
                  className="rounded border border-[var(--border)] bg-[var(--background)] px-3 py-1 text-sm hover:border-[var(--accent)]"
                >
                  Save
                </button>
              </div>
              <div className="mt-2 max-h-36 space-y-1 overflow-auto">
                {presets.map((preset) => (
                  <div key={preset.id} className="flex items-center justify-between rounded border border-[var(--border)] px-2 py-1 text-xs">
                    <button onClick={() => applyPreset(preset)} className="truncate text-left hover:text-[var(--accent)]">
                      {preset.name}
                    </button>
                    <button onClick={() => deletePreset(preset.id)} className="text-red-400 hover:opacity-80">
                      ×
                    </button>
                  </div>
                ))}
                {presets.length === 0 && (
                  <div className="text-xs text-[var(--muted)]">No local presets yet.</div>
                )}
              </div>
            </div>

            <div className="border-t border-[var(--border)] pt-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Publish</h2>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={compareMode}
                  onChange={(event) => setCompareMode(event.target.checked)}
                />
                Compare with current avatar
              </label>

              <button
                onClick={handleSave}
                disabled={!selectedAgent || !isDirty || isSaving || isProcessingSkin}
                className="mt-3 w-full rounded border border-[var(--accent)] bg-[var(--accent-light)] px-3 py-2 text-sm font-semibold text-[var(--foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {isSaving
                  ? 'Applying...'
                  : isProcessingSkin
                    ? 'Processing skin...'
                    : `Apply to ${selectedAgent?.name ?? 'agent'}`}
              </button>
            </div>
          </aside>

          <section className="space-y-4">
            <div className={`grid gap-4 ${compareMode ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
              {compareMode && (
                <AvatarLabViewport
                  title={`Current (${selectedAgent?.name ?? 'No agent'})`}
                  config={baseline}
                  onMetrics={setLeftMetrics}
                />
              )}
              <AvatarLabViewport
                title={compareMode ? 'Draft Variant' : `Preview (${selectedAgent?.name ?? 'No agent'})`}
                config={draft}
                onMetrics={compareMode ? setRightMetrics : setLeftMetrics}
              />
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Performance panel</h3>
              <div className={`mt-3 grid gap-3 text-sm ${compareMode ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
                <div className="rounded border border-[var(--border)] bg-[var(--background)] p-3">
                  <div className="mb-1 font-semibold text-[var(--foreground)]">
                    {compareMode ? 'Current' : 'Preview'}
                  </div>
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
                    <div className="mb-1 font-semibold text-[var(--foreground)]">Draft</div>
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
