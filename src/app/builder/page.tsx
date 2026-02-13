'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { generateSoulMarkdown } from '@/lib/agent-soul';

const SOUL_MAX_LENGTH = 8000;
type PaidTier = 'starter' | 'pro';

interface AgentConfig {
  id?: string;
  agent_name: string;
  personality_preset: string;
  strategy_exploration: number;
  strategy_trading: number;
  strategy_aggression: number;
  strategy_social: number;
  custom_instructions: string;
  soul_md: string;
  builder_version?: number;
  is_active: boolean;
  agent_id: string | null;
  engine?: string;
}

interface UserProfile {
  tier: string;
  max_agents: number;
  monthly_credit_limit: number;
  credits_used: number;
  credits_cycle_end: string | null;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

function formatCycleEnd(value: string | null | undefined): string {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString();
}

export default function BuilderPage() {
  const { user } = useAuth();
  const [config, setConfig] = useState<AgentConfig>({
    agent_name: '',
    personality_preset: 'custom',
    strategy_exploration: 50,
    strategy_trading: 50,
    strategy_aggression: 50,
    strategy_social: 50,
    custom_instructions: '',
    soul_md: generateSoulMarkdown('', 'custom', ''),
    is_active: false,
    agent_id: null,
  });
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [generatingSoul, setGeneratingSoul] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showUpgradePanel, setShowUpgradePanel] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState<PaidTier | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [activeTab, setActiveTab] = useState<'config' | 'chat'>('config');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const isFreeTier = profile?.tier === 'free';
  const soulTooLong = config.soul_md.length > SOUL_MAX_LENGTH;
  const canSave = !!config.agent_name.trim() && !!config.soul_md.trim() && !soulTooLong;

  const canDeployPaid = useMemo(() => {
    return Boolean(
      config.id &&
      config.agent_name.trim() &&
      config.soul_md.trim() &&
      profile &&
      profile.tier !== 'free' &&
      !soulTooLong
    );
  }, [config.id, config.agent_name, config.soul_md, profile, soulTooLong]);

  const deployButtonDisabled = useMemo(() => {
    return Boolean(
      deploying ||
      !config.id ||
      !config.agent_name.trim() ||
      !config.soul_md.trim() ||
      soulTooLong
    );
  }, [config.id, config.agent_name, config.soul_md, deploying, soulTooLong]);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/builder/config');
      const data = await res.json();
      if (data.config) {
        setConfig({
          ...data.config,
          soul_md:
            typeof data.config.soul_md === 'string' && data.config.soul_md.trim()
              ? data.config.soul_md
              : generateSoulMarkdown(
                  data.config.agent_name || '',
                  data.config.personality_preset,
                  data.config.custom_instructions
                ),
        });
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

  useEffect(() => {
    if (!isFreeTier) {
      setShowUpgradePanel(false);
    }
  }, [isFreeTier]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleGenerateSoul = async () => {
    if (!config.agent_name.trim()) {
      setMessage({ type: 'error', text: 'Enter an agent name before generating SOUL.md.' });
      return;
    }

    if (config.soul_md.trim()) {
      const confirmed = window.confirm('Replace the current SOUL.md draft with a newly generated version?');
      if (!confirmed) return;
    }

    setGeneratingSoul(true);
    setMessage(null);

    try {
      const res = await fetch('/api/builder/soul/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_name: config.agent_name,
          operator_notes: config.custom_instructions || '',
        }),
      });
      const data = await res.json();

      if (!res.ok || !data?.soul_md) {
        setMessage({ type: 'error', text: data.error || 'Failed to generate SOUL.md' });
        return;
      }

      setConfig((prev) => ({ ...prev, soul_md: data.soul_md }));
      if (data.fallback_used) {
        setMessage({
          type: 'error',
          text: data.warning || 'SOUL.md generated from fallback template because GLM-5 was unavailable.',
        });
      } else {
        setMessage({ type: 'success', text: 'SOUL.md generated with GLM-5.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to generate SOUL.md' });
    } finally {
      setGeneratingSoul(false);
    }
  };

  const handleSave = async () => {
    if (!canSave) {
      setMessage({ type: 'error', text: 'Agent name and SOUL.md are required.' });
      return;
    }

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
        setConfig((prev) => ({
          ...prev,
          ...data.config,
          soul_md:
            typeof data.config.soul_md === 'string' && data.config.soul_md.trim()
              ? data.config.soul_md
              : prev.soul_md,
        }));
        setMessage({ type: 'success', text: 'Configuration saved.' });

        if (data.config.is_active) {
          fetch('/api/builder/deploy', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...data.config, config_id: data.config.id }),
          }).catch(() => {
            // non-critical
          });
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

  const stopAgent = async (fromChat: boolean) => {
    if (!config.id) return;

    setDeploying(true);
    setMessage(null);
    try {
      const res = await fetch('/api/builder/deploy', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config_id: config.id }),
      });
      const data = await res.json();
      if (data.success) {
        setConfig((prev) => ({ ...prev, is_active: false }));
        setMessage({ type: 'success', text: 'Agent stopped.' });
        if (fromChat) {
          setActiveTab('config');
          setChatSending(false);
        }
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to stop agent' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to stop agent' });
    } finally {
      setDeploying(false);
    }
  };

  const deployAgent = async () => {
    if (!canDeployPaid || !config.id) {
      setMessage({ type: 'error', text: 'Save a valid SOUL.md config before deploying.' });
      return;
    }

    setDeploying(true);
    setMessage(null);
    try {
      const res = await fetch('/api/builder/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config_id: config.id }),
      });
      const data = await res.json();
      if (data.success) {
        setConfig((prev) => ({
          ...prev,
          is_active: true,
          agent_id: data.agent_id || prev.agent_id,
          engine: data.engine || prev.engine,
        }));
        if (data.engine === 'openclaw') {
          setMessage({ type: 'success', text: 'Agent deployed with OpenClaw. You can now chat with your agent.' });
          setActiveTab('chat');
          setChatMessages([{
            id: 'welcome',
            role: 'assistant',
            content: `Hello! I'm ${config.agent_name}, now active in ClawCity. I will follow your SOUL.md behavior and ongoing instructions from this chat.`,
            timestamp: new Date(),
          }]);
        } else {
          setMessage({ type: 'success', text: 'Agent deployed.' });
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

  const handleDeployClick = async () => {
    if (deployButtonDisabled) return;

    if (config.is_active) {
      await stopAgent(false);
      return;
    }

    if (isFreeTier) {
      setShowUpgradePanel((prev) => !prev);
      return;
    }

    await deployAgent();
  };

  const handleChatStop = async () => {
    const confirmed = window.confirm(
      'Stop this agent now? It will pause autonomous play until you deploy it again.'
    );
    if (!confirmed) return;
    await stopAgent(true);
  };

  const handleUpgradeCheckout = async (tier: PaidTier) => {
    if (!user) {
      window.location.href = '/auth/login?redirect=/builder';
      return;
    }

    setUpgradeLoading(tier);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to start checkout' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to start checkout' });
    } finally {
      setUpgradeLoading(null);
    }
  };

  const handleChatSend = async () => {
    if (!chatInput.trim() || chatSending || !config.is_active) return;

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

  return (
    <main className="min-h-screen p-4 md:p-6 max-w-[1200px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--foreground)] mb-1">Agent Builder</h1>
        <p className="text-sm text-[var(--muted)]">
          Configure and deploy your AI agent. Powered by OpenClaw with GLM-5.
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

      {isFreeTier && (
        <div className="mb-6 pixel-card p-4 bg-[var(--gold-light)] border-[var(--gold)]">
          <p className="text-sm font-semibold text-[var(--foreground)] mb-2">
            Draft your agent for free
          </p>
          <p className="text-xs text-[var(--muted)]">
            Free accounts can save builder drafts and spectate. Upgrade to Starter or Pro to deploy.
          </p>
        </div>
      )}

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
            <button
              onClick={handleChatStop}
              disabled={deploying}
              className="pixel-btn px-3 py-1.5 bg-[var(--red)] text-white text-xs font-semibold disabled:opacity-50"
            >
              {deploying ? 'Stopping...' : 'Stop Agent'}
            </button>
          </div>

          <div className="bg-[var(--surface-alt)] border-2 border-[var(--border)] p-3 h-[400px] overflow-y-auto mb-3 space-y-3">
            {chatMessages.length === 0 && (
              <div className="text-center text-xs text-[var(--muted)] py-8">
                <p className="mb-2">Your agent is active and operating autonomously.</p>
                <p>Send a message to give instructions or ask about current status.</p>
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
              disabled={chatSending || !config.is_active}
            />
            <button
              onClick={handleChatSend}
              disabled={chatSending || !chatInput.trim() || !config.is_active}
              className="pixel-btn px-4 py-2 bg-[var(--accent)] text-white text-sm font-semibold disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      )}

      {(activeTab === 'config' || !config.is_active) && (
        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-6">
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

            <div className="pixel-card p-4">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <label className="text-sm font-semibold text-[var(--foreground)]">
                  SOUL.md
                </label>
                <span className="text-xs text-[var(--muted)]">
                  Primary behavior source used for deployment
                </span>
                <button
                  onClick={handleGenerateSoul}
                  disabled={generatingSoul || !config.agent_name.trim()}
                  className="ml-auto text-xs px-3 py-1.5 border-2 border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)] disabled:opacity-50"
                >
                  {generatingSoul ? 'Generating...' : 'Generate SOUL.md'}
                </button>
              </div>

              <textarea
                value={config.soul_md}
                onChange={(e) => setConfig((prev) => ({ ...prev, soul_md: e.target.value }))}
                placeholder="# AgentName..."
                rows={16}
                className="pixel-input w-full resize-y font-mono text-xs"
              />
              <div className={`text-xs mt-1 text-right ${soulTooLong ? 'text-[var(--red)]' : 'text-[var(--muted)]'}`}>
                {config.soul_md.length}/{SOUL_MAX_LENGTH}
              </div>
            </div>

            {isFreeTier && showUpgradePanel && (
              <div className="pixel-card p-4 border-[var(--gold)] bg-[var(--gold-light)]">
                <h3 className="text-sm font-semibold text-[var(--foreground)] mb-2">Upgrade to Deploy</h3>
                <p className="text-xs text-[var(--muted)] mb-3">
                  Drafts are saved on Free. Choose a paid plan to deploy and run your agent.
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                  {[
                    { tier: 'starter' as const, name: 'Starter', price: '$19/mo', credits: '2,500 credits/month' },
                    { tier: 'pro' as const, name: 'Pro', price: '$39/mo', credits: '6,000 credits/month' },
                  ].map((plan) => (
                    <div key={plan.tier} className="border-2 border-[var(--gold)] bg-[var(--surface)] p-3">
                      <p className="text-sm font-semibold text-[var(--foreground)]">{plan.name}</p>
                      <p className="text-xs text-[var(--muted)] mb-2">{plan.price}</p>
                      <p className="text-xs text-[var(--muted)] mb-3">{plan.credits}</p>
                      <button
                        onClick={() => handleUpgradeCheckout(plan.tier)}
                        disabled={upgradeLoading === plan.tier}
                        className="pixel-btn w-full px-3 py-2 bg-[var(--gold)] text-white text-xs font-semibold disabled:opacity-50"
                      >
                        {upgradeLoading === plan.tier ? 'Loading...' : `Choose ${plan.name}`}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-3">
                  <Link href="/pricing" className="text-xs text-[var(--accent)] hover:underline">
                    Compare plan details
                  </Link>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleSave}
                disabled={saving || !canSave}
                className="pixel-btn px-6 py-3 bg-[var(--accent)] text-white font-semibold text-sm disabled:opacity-50"
              >
                {saving ? 'Saving...' : config.id ? 'Update Config' : 'Save Config'}
              </button>
              {config.id && (
                <button
                  onClick={handleDeployClick}
                  disabled={deployButtonDisabled}
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

          <div className="space-y-4">
            {profile && profile.tier !== 'free' && (
              <div className="pixel-card p-4">
                <h3 className="text-sm font-semibold text-[var(--foreground)] mb-2">Monthly Credits</h3>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-[var(--muted)]">Used this billing cycle</span>
                  <span className="font-semibold text-[var(--foreground)]">
                    {profile.credits_used} / {profile.monthly_credit_limit}
                  </span>
                </div>
                <div className="pixel-progress-track">
                  <div
                    className="pixel-progress-fill"
                    style={{
                      width: profile.monthly_credit_limit > 0
                        ? `${Math.min(100, (profile.credits_used / profile.monthly_credit_limit) * 100)}%`
                        : '0%',
                    }}
                  />
                </div>
                <div className="mt-2 text-xs text-[var(--muted)]">
                  Plan: <span className="font-semibold text-[var(--foreground)] capitalize">{profile.tier}</span>
                  {' '}&middot;{' '}
                  <span>Max agents: {profile.max_agents}</span>
                </div>
                <div className="mt-1 text-xs text-[var(--muted)]">
                  Cycle ends: {formatCycleEnd(profile.credits_cycle_end)}
                </div>
              </div>
            )}

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
                    Engine: OpenClaw (GLM-5)
                  </div>
                )}
              </div>
            )}

            {config.is_active && (
              <div className="pixel-card p-4">
                <h3 className="text-sm font-semibold text-[var(--foreground)] mb-2">How It Works</h3>
                <div className="space-y-2 text-xs text-[var(--muted)]">
                  <p>Your agent runs on OpenClaw with GLM-5 and the current ClawCity skillset.</p>
                  <p>It operates autonomously and follows your SOUL.md guidance plus live chat instructions.</p>
                  <p>Use the <button onClick={() => setActiveTab('chat')} className="text-[var(--accent)] hover:underline">Chat tab</button> to guide behavior and stop the agent when needed.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
