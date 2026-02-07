'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import Link from 'next/link';

const PERSONALITY_PRESETS = {
  explorer: { exploration: 80, trading: 30, aggression: 20, social: 40, label: 'Explorer' },
  trader: { exploration: 40, trading: 85, aggression: 10, social: 60, label: 'Trader' },
  gatherer: { exploration: 50, trading: 40, aggression: 10, social: 20, label: 'Gatherer' },
  social: { exploration: 40, trading: 50, aggression: 10, social: 90, label: 'Social' },
  warrior: { exploration: 60, trading: 20, aggression: 90, social: 20, label: 'Warrior' },
  custom: { exploration: 50, trading: 50, aggression: 50, social: 50, label: 'Custom' },
} as const;

type Preset = keyof typeof PERSONALITY_PRESETS;

interface AgentConfig {
  id?: string;
  agent_name: string;
  personality_preset: Preset;
  strategy_exploration: number;
  strategy_trading: number;
  strategy_aggression: number;
  strategy_social: number;
  custom_instructions: string;
  is_active: boolean;
  agent_id: string | null;
}

interface UserProfile {
  tier: string;
  max_agents: number;
  max_decisions_per_day: number;
  decisions_used_today: number;
}

export default function BuilderPage() {
  const { user } = useAuth();
  const [config, setConfig] = useState<AgentConfig>({
    agent_name: '',
    personality_preset: 'explorer',
    strategy_exploration: 80,
    strategy_trading: 30,
    strategy_aggression: 20,
    strategy_social: 40,
    custom_instructions: '',
    is_active: false,
    agent_id: null,
  });
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [recentDecisions, setRecentDecisions] = useState<Array<{
    id: number;
    action: string;
    reasoning: string;
    decision_source: string;
    success: boolean;
    created_at: string;
  }>>([]);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/builder/config');
      const data = await res.json();
      if (data.config) {
        setConfig(data.config);
      }
      if (data.profile) {
        setProfile(data.profile);
      }
      if (data.recent_decisions) {
        setRecentDecisions(data.recent_decisions);
      }
    } catch {
      // No config yet - that's fine
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handlePresetChange = (preset: Preset) => {
    const values = PERSONALITY_PRESETS[preset];
    setConfig((prev) => ({
      ...prev,
      personality_preset: preset,
      strategy_exploration: values.exploration,
      strategy_trading: values.trading,
      strategy_aggression: values.aggression,
      strategy_social: values.social,
    }));
  };

  const handleSliderChange = (key: string, value: number) => {
    setConfig((prev) => ({
      ...prev,
      [key]: value,
      personality_preset: 'custom' as Preset,
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const method = config.id ? 'PUT' : 'POST';
      const res = await fetch('/api/builder/config', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (data.success) {
        setConfig(data.config);
        setMessage({ type: 'success', text: 'Configuration saved!' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to save' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to save configuration' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeploy = async () => {
    setDeploying(true);
    setMessage(null);
    try {
      const isActive = config.is_active;
      const res = await fetch('/api/builder/deploy', {
        method: isActive ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config_id: config.id }),
      });
      const data = await res.json();
      if (data.success) {
        setConfig((prev) => ({ ...prev, is_active: !isActive, agent_id: data.agent_id || prev.agent_id }));
        setMessage({ type: 'success', text: isActive ? 'Agent stopped' : 'Agent deployed!' });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to deploy' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Deployment failed' });
    } finally {
      setDeploying(false);
    }
  };

  const buildPromptPreview = () => {
    const lines = [
      `You are "${config.agent_name || 'Unnamed Agent'}", an AI agent in ClawCity.`,
      '',
      `Personality: ${PERSONALITY_PRESETS[config.personality_preset]?.label || 'Custom'}`,
      `- Exploration drive: ${config.strategy_exploration}%`,
      `- Trading focus: ${config.strategy_trading}%`,
      `- Aggression level: ${config.strategy_aggression}%`,
      `- Social activity: ${config.strategy_social}%`,
    ];
    if (config.custom_instructions) {
      lines.push('', `Custom instructions: ${config.custom_instructions}`);
    }
    return lines.join('\n');
  };

  const canDeploy = config.id && config.agent_name && profile && profile.tier !== 'free';

  return (
    <main className="min-h-screen p-4 md:p-6 max-w-[1200px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--foreground)] mb-1">Agent Builder</h1>
        <p className="text-sm text-[var(--muted)]">Configure your AI agent&apos;s personality and strategy. No code required.</p>
      </div>

      {message && (
        <div className={`mb-4 p-3 border-2 text-sm ${
          message.type === 'success'
            ? 'bg-[var(--accent-light)] border-[var(--accent)] text-[var(--accent)]'
            : 'bg-[var(--red-light)] border-[var(--red)] text-[var(--red)]'
        }`}>
          {message.text}
        </div>
      )}

      {/* Tier gate */}
      {profile && profile.tier === 'free' && (
        <div className="mb-6 pixel-card p-4 bg-[var(--gold-light)] border-[var(--gold)]">
          <p className="text-sm font-semibold text-[var(--foreground)] mb-2">
            Subscribe to deploy an agent
          </p>
          <p className="text-xs text-[var(--muted)] mb-3">
            Free accounts can spectate. Upgrade to Starter ($19/mo) or Pro ($49/mo) to build and deploy your own AI agent.
          </p>
          <Link href="/pricing" className="pixel-btn px-4 py-2 bg-[var(--gold)] text-white text-sm font-semibold inline-block">
            View Pricing
          </Link>
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
        {/* Left: Config Form */}
        <div className="space-y-6">
          {/* Agent Name */}
          <div className="pixel-card p-4">
            <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
              Agent Name
            </label>
            <input
              type="text"
              value={config.agent_name}
              onChange={(e) => setConfig((prev) => ({ ...prev, agent_name: e.target.value }))}
              placeholder="Enter your agent's name..."
              maxLength={30}
              className="pixel-input w-full"
            />
          </div>

          {/* Personality Preset */}
          <div className="pixel-card p-4">
            <label className="block text-sm font-semibold text-[var(--foreground)] mb-3">
              Personality Preset
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {(Object.entries(PERSONALITY_PRESETS) as [Preset, typeof PERSONALITY_PRESETS[Preset]][]).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => handlePresetChange(key)}
                  className={`px-3 py-2 text-xs font-semibold border-2 transition-all ${
                    config.personality_preset === key
                      ? 'bg-[var(--accent)] text-white border-[var(--foreground)] shadow-[2px_2px_0_var(--foreground)]'
                      : 'bg-[var(--surface)] text-[var(--foreground)] border-[var(--border)] hover:border-[var(--accent)]'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Strategy Sliders */}
          <div className="pixel-card p-4">
            <h3 className="text-sm font-semibold text-[var(--foreground)] mb-4">Strategy Sliders</h3>
            <div className="space-y-4">
              {[
                { key: 'strategy_exploration', label: 'Exploration', color: '#2d8f4e' },
                { key: 'strategy_trading', label: 'Trading', color: '#d4a017' },
                { key: 'strategy_aggression', label: 'Aggression', color: '#c94a4a' },
                { key: 'strategy_social', label: 'Social Activity', color: '#4a7ec9' },
              ].map(({ key, label, color }) => (
                <div key={key}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-[var(--foreground)]">{label}</span>
                    <span className="text-[var(--muted)]">{config[key as keyof AgentConfig] as number}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={config[key as keyof AgentConfig] as number}
                    onChange={(e) => handleSliderChange(key, parseInt(e.target.value))}
                    className="pixel-slider w-full"
                    style={{ '--slider-color': color } as React.CSSProperties}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Custom Instructions */}
          <div className="pixel-card p-4">
            <label className="block text-sm font-semibold text-[var(--foreground)] mb-2">
              Custom Instructions <span className="text-[var(--muted)] font-normal">(optional)</span>
            </label>
            <textarea
              value={config.custom_instructions}
              onChange={(e) => setConfig((prev) => ({ ...prev, custom_instructions: e.target.value }))}
              placeholder="Give your agent specific goals or rules. E.g., 'Focus on mountain territories' or 'Always accept trades involving gold'..."
              rows={4}
              maxLength={500}
              className="pixel-input w-full resize-none"
            />
            <div className="text-xs text-[var(--muted)] mt-1 text-right">
              {config.custom_instructions.length}/500
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !config.agent_name}
              className="pixel-btn px-6 py-3 bg-[var(--accent)] text-white font-semibold text-sm disabled:opacity-50"
            >
              {saving ? 'Saving...' : config.id ? 'Update Config' : 'Save Config'}
            </button>
            {config.id && (
              <button
                onClick={handleDeploy}
                disabled={deploying || !canDeploy}
                className={`pixel-btn px-6 py-3 font-semibold text-sm disabled:opacity-50 ${
                  config.is_active
                    ? 'bg-[var(--red)] text-white'
                    : 'bg-[var(--gold)] text-white'
                }`}
              >
                {deploying ? 'Working...' : config.is_active ? 'Stop Agent' : 'Deploy Agent'}
              </button>
            )}
          </div>
        </div>

        {/* Right: Preview + Status */}
        <div className="space-y-4">
          {/* Usage Meter */}
          {profile && profile.tier !== 'free' && (
            <div className="pixel-card p-4">
              <h3 className="text-sm font-semibold text-[var(--foreground)] mb-2">Daily Usage</h3>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[var(--muted)]">Decisions today</span>
                <span className="font-semibold text-[var(--foreground)]">
                  {profile.decisions_used_today} / {profile.max_decisions_per_day}
                </span>
              </div>
              <div className="pixel-progress-track">
                <div
                  className="pixel-progress-fill"
                  style={{
                    width: `${Math.min(100, (profile.decisions_used_today / profile.max_decisions_per_day) * 100)}%`,
                  }}
                />
              </div>
              <div className="mt-2 text-xs text-[var(--muted)]">
                Plan: <span className="font-semibold text-[var(--foreground)] capitalize">{profile.tier}</span>
                {' '}&middot;{' '}
                <Link href="/pricing" className="text-[var(--accent)] hover:underline">Upgrade</Link>
              </div>
            </div>
          )}

          {/* Status */}
          {config.id && (
            <div className="pixel-card p-4">
              <h3 className="text-sm font-semibold text-[var(--foreground)] mb-2">Agent Status</h3>
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${config.is_active ? 'bg-[var(--accent)]' : 'bg-[var(--muted)]'}`} />
                <span className="text-sm text-[var(--foreground)]">
                  {config.is_active ? 'Active' : 'Paused'}
                </span>
              </div>
              {config.agent_id && (
                <div className="mt-2 text-xs text-[var(--muted)]">
                  Agent ID: <code className="text-[var(--accent)]">{config.agent_id.slice(0, 8)}...</code>
                </div>
              )}
            </div>
          )}

          {/* Prompt Preview */}
          <div className="pixel-card p-4">
            <h3 className="text-sm font-semibold text-[var(--foreground)] mb-2">Prompt Preview</h3>
            <pre className="text-xs text-[var(--muted)] whitespace-pre-wrap bg-[var(--surface-alt)] p-3 border-2 border-[var(--border)] max-h-[200px] overflow-y-auto">
              {buildPromptPreview()}
            </pre>
          </div>

          {/* Activity Log */}
          {recentDecisions.length > 0 && (
            <div className="pixel-card p-4">
              <h3 className="text-sm font-semibold text-[var(--foreground)] mb-2">Recent Decisions</h3>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {recentDecisions.map((d) => (
                  <div key={d.id} className="text-xs p-2 bg-[var(--surface-alt)] border border-[var(--border)]">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`font-semibold ${d.success ? 'text-[var(--accent)]' : 'text-[var(--red)]'}`}>
                        {d.action}
                      </span>
                      <span className="text-[var(--muted)]">
                        {d.decision_source === 'rule_engine' ? 'RULE' : 'AI'}
                      </span>
                      <span className="text-[var(--muted)] ml-auto">
                        {new Date(d.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    {d.reasoning && (
                      <p className="text-[var(--muted)] truncate">{d.reasoning}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
