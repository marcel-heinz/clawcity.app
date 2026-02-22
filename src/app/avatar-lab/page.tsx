'use client';

import { type ChangeEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import NextImage from 'next/image';
import {
  AVATAR_LAB_MODELS,
  ResolvedAvatarLabConfig,
  resolveAvatarLabConfig,
} from '@/lib/avatar-lab';
import { AvatarLabPerfMetrics, AvatarLabViewport } from '@/components/avatar-lab/AvatarLabViewport';

interface AvatarLabSelfData {
  agent: {
    id: string;
    name: string;
  };
  avatar?: Record<string, unknown>;
  avatar_lab?: ResolvedAvatarLabConfig;
  session_expires_at?: string;
}

interface AvatarLabSelfResponse {
  success?: boolean;
  error?: string;
  data?: AvatarLabSelfData;
}

function defaultConfig(name = 'Agent'): ResolvedAvatarLabConfig {
  return resolveAvatarLabConfig(name, {});
}

export default function AvatarLabOperatorPage() {
  const [loading, setLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [agent, setAgent] = useState<{ id: string; name: string } | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);

  const [baseline, setBaseline] = useState<ResolvedAvatarLabConfig>(defaultConfig());
  const [draft, setDraft] = useState<ResolvedAvatarLabConfig>(defaultConfig());

  const [compareMode, setCompareMode] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingSkin, setIsUploadingSkin] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [leftMetrics, setLeftMetrics] = useState<AvatarLabPerfMetrics | null>(null);
  const [rightMetrics, setRightMetrics] = useState<AvatarLabPerfMetrics | null>(null);

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseline),
    [draft, baseline]
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/avatar-lab/me', { cache: 'no-store' });
        const data = (await response.json()) as AvatarLabSelfResponse;

        if (!response.ok || !data.success || !data.data) {
          setIsAuthorized(false);
          setError(data.error || 'Avatar lab session not found. Request a new secure link from your agent CLI.');
          return;
        }

        const resolved = resolveAvatarLabConfig(
          data.data.agent.name,
          data.data.avatar_lab ?? data.data.avatar
        );

        setAgent(data.data.agent);
        setSessionExpiresAt(data.data.session_expires_at || null);
        setBaseline(resolved);
        setDraft(resolved);
        setIsAuthorized(true);
      } catch {
        setIsAuthorized(false);
        setError('Failed to load avatar lab session.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const updateDraft = <K extends keyof ResolvedAvatarLabConfig>(
    key: K,
    value: ResolvedAvatarLabConfig[K]
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSkinUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError('Skin upload must be <= 5MB');
      return;
    }

    setIsUploadingSkin(true);
    setError(null);
    setStatusMessage(null);

    try {
      const form = new FormData();
      form.append('file', file);

      const response = await fetch('/api/avatar-lab/me/skin', {
        method: 'POST',
        body: form,
      });
      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        data?: { skin_data_url?: string };
      };

      if (!response.ok || !data.success || !data.data?.skin_data_url) {
        setError(data.error || 'Failed to upload skin image');
        return;
      }

      updateDraft('skin_data_url', data.data.skin_data_url);
      setStatusMessage(`Skin uploaded: ${file.name}`);
    } catch {
      setError('Failed to upload skin image');
    } finally {
      setIsUploadingSkin(false);
    }
  };

  const handleSave = async () => {
    if (!agent) return;

    setIsSaving(true);
    setError(null);
    setStatusMessage(null);

    try {
      const avatarPayload: Record<string, unknown> = { ...draft };
      if (!draft.skin_data_url) {
        avatarPayload.skin_data_url = null;
      }

      const response = await fetch('/api/avatar-lab/me/avatar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar: avatarPayload }),
      });

      const data = (await response.json()) as {
        success?: boolean;
        error?: string;
        data?: {
          avatar?: Record<string, unknown>;
          avatar_lab?: ResolvedAvatarLabConfig;
        };
      };

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to save avatar');
        return;
      }

      const nextBaseline = resolveAvatarLabConfig(
        agent.name,
        data.data?.avatar_lab ?? data.data?.avatar ?? draft
      );
      setBaseline(nextBaseline);
      setDraft(nextBaseline);
      setStatusMessage(`Avatar updated for ${agent.name}.`);
    } catch {
      setError('Failed to save avatar changes');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/avatar-lab/session', { method: 'DELETE' });
    } finally {
      setIsAuthorized(false);
      setAgent(null);
      setStatusMessage(null);
      setError('Avatar lab session closed. Request a new secure link to continue.');
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[var(--background)] p-6 text-[var(--muted)]">
        Loading avatar lab session...
      </main>
    );
  }

  if (!isAuthorized || !agent) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] p-4">
        <div className="w-full max-w-lg rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Avatar Lab Access Required</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {error || 'This session is not authorized. Generate a fresh link from `clawcity avatar lab-link`.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/"
              className="rounded border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm hover:border-[var(--accent)]"
            >
              Back to ClawCity
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
              Customize your agent avatar and publish changes live.
            </p>
            {sessionExpiresAt && (
              <p className="text-xs text-[var(--muted)]">
                Session expires: {new Date(sessionExpiresAt).toLocaleString()}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Agent</h2>
              <div className="mt-2 rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2">
                <div className="text-sm font-semibold text-[var(--foreground)]">{agent.name}</div>
                <div className="text-xs text-[var(--muted)]">{agent.id}</div>
              </div>
            </div>

            <div className="border-t border-[var(--border)] pt-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Model & Palette</h2>

              <label className="mt-2 flex flex-col gap-1 text-sm">
                <span className="text-[var(--muted)]">Model archetype</span>
                <select
                  value={draft.model_type}
                  onChange={(event) =>
                    updateDraft('model_type', event.target.value as ResolvedAvatarLabConfig['model_type'])
                  }
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
                  <input
                    type="color"
                    value={draft.body_color}
                    onChange={(event) => updateDraft('body_color', event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Secondary</span>
                  <input
                    type="color"
                    value={draft.claw_color}
                    onChange={(event) => updateDraft('claw_color', event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Eye</span>
                  <input
                    type="color"
                    value={draft.eye_color}
                    onChange={(event) => updateDraft('eye_color', event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--muted)]">Accent</span>
                  <input
                    type="color"
                    value={draft.accent_color}
                    onChange={(event) => updateDraft('accent_color', event.target.value)}
                  />
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
                    onChange={(event) =>
                      updateDraft(
                        'animation_profile',
                        event.target.value as ResolvedAvatarLabConfig['animation_profile']
                      )
                    }
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
                disabled={!isDirty || isSaving || isUploadingSkin}
                className="mt-3 w-full rounded border border-[var(--accent)] bg-[var(--accent-light)] px-3 py-2 text-sm font-semibold text-[var(--foreground)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {isSaving
                  ? 'Applying...'
                  : isUploadingSkin
                    ? 'Uploading skin...'
                    : `Apply to ${agent.name}`}
              </button>
            </div>
          </aside>

          <section className="space-y-4">
            <div className={`grid gap-4 ${compareMode ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
              {compareMode && (
                <AvatarLabViewport
                  title={`Current (${agent.name})`}
                  config={baseline}
                  onMetrics={setLeftMetrics}
                />
              )}
              <AvatarLabViewport
                title={compareMode ? 'Draft Variant' : `Preview (${agent.name})`}
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
