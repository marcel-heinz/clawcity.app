'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
  engine?: string;
}

interface UserProfile {
  tier: string;
  max_agents: number;
  max_decisions_per_day: number;
  decisions_used_today: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
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
  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [activeTab, setActiveTab] = useState<'config' | 'chat'>('config');
  const chatEndRef = useRef<HTMLDivElement>(null);

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
    } catch {
      // No config yet - that's fine
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

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

        // Sync personality to OpenClaw if agent is active
        if (data.config.is_active) {
          fetch('/api/builder/deploy', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...data.config, config_id: data.config.id }),
          }).catch(() => {/* non-critical */});
        }
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
        setConfig((prev) => ({
          ...prev,
          is_active: !isActive,
          agent_id: data.agent_id || prev.agent_id,
          engine: data.engine || prev.engine,
        }));
        if (!isActive && data.engine === 'openclaw') {
          setMessage({ type: 'success', text: 'Agent deployed with OpenClaw! You can now chat with your agent.' });
          setActiveTab('chat');
          setChatMessages([{
            id: 'welcome',
            role: 'assistant',
            content: `Hello! I'm ${config.agent_name}, your AI agent in ClawCity. I'm now active and will autonomously play the game based on your configured strategy. You can talk to me here to give me instructions, ask about my status, or adjust my strategy. What would you like me to do?`,
            timestamp: new Date(),
          }]);
        } else {
          setMessage({ type: 'success', text: isActive ? 'Agent stopped' : 'Agent deployed!' });
        }
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to deploy' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Deployment failed' });
    } finally {
      setDeploying(false);
    }
  };

  const handleChatSend = async () => {
    if (!chatInput.trim() || chatSending) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: chatInput.trim(),
      timestamp: new Date(),
    };

    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput('');
    setChatSending(true);

    try {
      const res = await fetch('/api/builder/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg.content }),
      });

      const data = await res.json();

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.success ? data.response : `Error: ${data.error || 'Failed to get response'}`,
        timestamp: new Date(),
      };

      setChatMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setChatMessages((prev) => [...prev, {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: 'Failed to connect to your agent. Please try again.',
        timestamp: new Date(),
      }]);
    } finally {
      setChatSending(false);
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
        <p className="text-sm text-[var(--muted)]">
          Configure and deploy your AI agent. Powered by OpenClaw &mdash; your agent understands
          all 31 game actions natively and plays autonomously.
        </p>
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

      {/* Tab switcher (only show if agent is active) */}
      {config.is_active && (
        <div className="flex gap-1 mb-6">
          <button
            onClick={() => setActiveTab('config')}
            className={`px-4 py-2 text-sm font-semibold border-2 transition-all ${
              activeTab === 'config'
                ? 'bg-[var(--accent)] text-white border-[var(--foreground)] shadow-[2px_2px_0_var(--foreground)]'
                : 'bg-[var(--surface)] text-[var(--foreground)] border-[var(--border)] hover:border-[var(--accent)]'
            }`}
          >
            Configure
          </button>
          <button
            onClick={() => setActiveTab('chat')}
            className={`px-4 py-2 text-sm font-semibold border-2 transition-all ${
              activeTab === 'chat'
                ? 'bg-[var(--accent)] text-white border-[var(--foreground)] shadow-[2px_2px_0_var(--foreground)]'
                : 'bg-[var(--surface)] text-[var(--foreground)] border-[var(--border)] hover:border-[var(--accent)]'
            }`}
          >
            Chat with Agent
          </button>
        </div>
      )}

      {/* Chat Panel */}
      {activeTab === 'chat' && config.is_active && (
        <div className="pixel-card p-4 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2.5 h-2.5 rounded-full bg-[var(--accent)]" />
            <h2 className="text-sm font-semibold text-[var(--foreground)]">
              Talking to {config.agent_name}
            </h2>
            <span className="text-xs text-[var(--muted)] ml-auto">
              Powered by OpenClaw
            </span>
          </div>

          {/* Messages */}
          <div className="bg-[var(--surface-alt)] border-2 border-[var(--border)] p-3 h-[400px] overflow-y-auto mb-3 space-y-3">
            {chatMessages.length === 0 && (
              <div className="text-center text-xs text-[var(--muted)] py-8">
                <p className="mb-2">Your agent is active and playing autonomously.</p>
                <p>Send a message to give instructions or ask about game status.</p>
                <div className="mt-4 flex flex-wrap gap-2 justify-center">
                  {['Check my status', 'What should I do next?', 'Move north and gather resources'].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setChatInput(suggestion)}
                      className="text-xs px-3 py-1.5 bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)] hover:border-[var(--accent)] transition-all"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] p-2.5 text-xs ${
                    msg.role === 'user'
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--foreground)]'
                  }`}
                >
                  {msg.role === 'assistant' ? (
                    <div className="break-words text-xs [&_h1]:text-sm [&_h1]:font-bold [&_h1]:mt-2 [&_h1]:mb-1 [&_h2]:text-xs [&_h2]:font-bold [&_h2]:mt-2 [&_h2]:mb-1 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:mt-1.5 [&_h3]:mb-0.5 [&_p]:my-1 [&_ul]:my-1 [&_ul]:pl-4 [&_ul]:list-disc [&_ol]:my-1 [&_ol]:pl-4 [&_ol]:list-decimal [&_li]:my-0.5 [&_code]:bg-black/20 [&_code]:px-1 [&_code]:rounded [&_pre]:bg-black/20 [&_pre]:p-2 [&_pre]:rounded [&_pre]:overflow-x-auto [&_strong]:font-bold [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                  )}
                  <div className={`text-[10px] mt-1 ${
                    msg.role === 'user' ? 'text-white/60' : 'text-[var(--muted)]'
                  }`}>
                    {msg.timestamp.toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}

            {chatSending && (
              <div className="flex justify-start">
                <div className="bg-[var(--surface)] border border-[var(--border)] p-2.5 text-xs text-[var(--muted)]">
                  <span className="inline-flex gap-1">
                    <span className="animate-pulse">.</span>
                    <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>.</span>
                    <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>.</span>
                  </span>
                  {' '}Thinking...
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleChatSend();
                }
              }}
              placeholder="Tell your agent what to do..."
              className="pixel-input flex-1"
              disabled={chatSending}
            />
            <button
              onClick={handleChatSend}
              disabled={chatSending || !chatInput.trim()}
              className="pixel-btn px-4 py-2 bg-[var(--accent)] text-white text-sm font-semibold disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* Config Panel (shown by default, or when config tab is active) */}
      {(activeTab === 'config' || !config.is_active) && (
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
                {config.engine === 'openclaw' && (
                  <div className="mt-1 text-xs text-[var(--accent)]">
                    Engine: OpenClaw (autonomous)
                  </div>
                )}
              </div>
            )}

            {/* How it works */}
            {config.is_active && (
              <div className="pixel-card p-4">
                <h3 className="text-sm font-semibold text-[var(--foreground)] mb-2">How It Works</h3>
                <div className="space-y-2 text-xs text-[var(--muted)]">
                  <p>Your agent is powered by OpenClaw and understands all 31 game actions natively.</p>
                  <p>Every 30 minutes, it automatically checks game state and takes actions based on your personality and strategy settings.</p>
                  <p>Switch to the <button onClick={() => setActiveTab('chat')} className="text-[var(--accent)] hover:underline">Chat tab</button> to give your agent live instructions or ask questions.</p>
                </div>
              </div>
            )}

            {/* Prompt Preview */}
            <div className="pixel-card p-4">
              <h3 className="text-sm font-semibold text-[var(--foreground)] mb-2">Prompt Preview</h3>
              <pre className="text-xs text-[var(--muted)] whitespace-pre-wrap bg-[var(--surface-alt)] p-3 border-2 border-[var(--border)] max-h-[200px] overflow-y-auto">
                {buildPromptPreview()}
              </pre>
            </div>

          </div>
        </div>
      )}
    </main>
  );
}
