'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { generateSoulMarkdown } from '@/lib/agent-soul';

const SOUL_MAX_LENGTH = 8000;
const AUTO_MODE_FEEDBACK_POLL_MS = 15_000;

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
  auto_mode_enabled: boolean;
  engine?: string;
}

interface UserProfile {
  tier: string;
  max_agents: number;
  monthly_credit_limit: number;
  credits_used: number;
  llm_calls_used?: number;
  autoplay_calls_used?: number;
  credits_cycle_end: string | null;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

type AutoModeStatus = 'success' | 'failed' | 'busy' | 'skipped_disabled' | 'uncertain_timeout_deferred';

interface AutoModeFeedbackEntry {
  id: string;
  agent_id: string;
  started_at: string;
  finished_at: string;
  status: AutoModeStatus;
  summary: string;
  details?: string;
  error_code?: string;
}

interface AutoModeSchedulerStatus {
  enabled: boolean;
  global_enabled: boolean;
  interval_ms: number;
  timeout_ms: number;
  pass: number | null;
  next_tick_at: string | null;
  in_flight: boolean;
  deferred_once: boolean;
  last_tick_started_at: string | null;
  last_tick_finished_at: string | null;
  last_tick_result: string | null;
  last_tick_error_code: string | null;
  memory?: {
    last_distilled_at: string | null;
    ticks_since_distill: number;
    memory_version: number;
    memory_bytes: number;
  } | null;
  budget?: {
    tier: string | null;
    interval_ms: number | null;
    call_ceiling: number;
    reserve_calls: number;
    remaining_calls_total: number;
    remaining_calls_autoplay: number;
    scheduled_ticks_remaining: number;
    affordable_ticks_remaining: number;
    run_fraction: number;
  } | null;
  gateway?: {
    ready: boolean;
    status_code: number | null;
    checked_at: string | null;
    error: string | null;
  } | null;
}

interface AgentMemoryState {
  last_distilled_at: string | null;
  ticks_since_distill: number;
  memory_version: number;
  memory_digest: string | null;
  memory_bytes: number;
}

function formatCycleEnd(value: string | null | undefined): string {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString();
}

function formatFeedbackTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleTimeString();
}

function statusClass(status: AutoModeStatus): string {
  if (status === 'success') return 'text-[var(--accent)]';
  if (status === 'failed' || status === 'uncertain_timeout_deferred') return 'text-[var(--red)]';
  return 'text-[var(--muted)]';
}

function formatStatusLabel(status: AutoModeStatus): string {
  return status.replace(/_/g, ' ');
}

function formatEta(targetIso: string | null): string {
  if (!targetIso) return 'waiting for scheduler';
  const targetMs = Date.parse(targetIso);
  if (!Number.isFinite(targetMs)) return 'waiting for scheduler';
  const delta = Math.max(0, targetMs - Date.now());
  const minutes = Math.floor(delta / 60_000);
  const seconds = Math.floor((delta % 60_000) / 1000);
  return `next tick in ${minutes}m ${seconds}s`;
}

function normalizeFailureReason(entry: AutoModeFeedbackEntry): string {
  const code = (entry.error_code || entry.status || '').toLowerCase();
  if (code === 'gateway_unavailable') return 'Gateway runtime is currently unavailable. Railway will retry once healthy.';
  if (code === 'gateway_auth') return 'Gateway auth mismatch detected; check Railway token wiring.';
  if (code === 'billing_unavailable') return 'Billing sync is temporarily unavailable; ticks are paused to avoid inconsistent usage accounting.';
  if (code === 'unknown_command') return 'Unknown command requested by model; prompt now forces valid CLI forms.';
  if (code === 'invalid_usage') return 'Invalid CLI usage shape; only exact command syntax is allowed.';
  if (code === 'gateway_timeout') return 'Gateway timeout while waiting for model response.';
  if (code === 'uncertain_timeout_deferred') return 'Gateway timeout; result may be uncertain, next interval deferred once.';
  if (code === 'busy') return 'Agent already had an in-flight tick.';
  return entry.details || 'Execution failed.';
}

export default function BuilderPage() {
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
    auto_mode_enabled: true,
  });
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [generatingSoul, setGeneratingSoul] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [activeTab, setActiveTab] = useState<'config' | 'chat'>('config');
  const [autoModeSaving, setAutoModeSaving] = useState(false);
  const [feedbackEntries, setFeedbackEntries] = useState<AutoModeFeedbackEntry[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [schedulerStatus, setSchedulerStatus] = useState<AutoModeSchedulerStatus | null>(null);
  const [schedulerLoading, setSchedulerLoading] = useState(false);
  const [memoryContent, setMemoryContent] = useState('');
  const [memoryState, setMemoryState] = useState<AgentMemoryState | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memorySaving, setMemorySaving] = useState(false);
  const [memoryDistilling, setMemoryDistilling] = useState(false);
  const [memoryResetting, setMemoryResetting] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const isFreeTier = profile?.tier === 'free';
  const soulTooLong = config.soul_md.length > SOUL_MAX_LENGTH;

  const canDeployPaid = useMemo(() => {
    return Boolean(
      config.agent_name.trim() &&
      config.soul_md.trim() &&
      profile &&
      profile.tier !== 'free' &&
      !soulTooLong
    );
  }, [config.agent_name, config.soul_md, profile, soulTooLong]);

  const deployButtonDisabled = useMemo(() => {
    if (isFreeTier) {
      return Boolean(deploying || saving);
    }

    return Boolean(
      deploying ||
      saving ||
      !config.agent_name.trim() ||
      !config.soul_md.trim() ||
      soulTooLong
    );
  }, [config.agent_name, config.soul_md, deploying, isFreeTier, saving, soulTooLong]);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/builder/config');
      const data = await res.json();
      if (data.config) {
        setConfig({
          ...data.config,
          auto_mode_enabled: data.config.auto_mode_enabled !== false,
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
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const fetchAutoModeFeedback = useCallback(async (limit = 25) => {
    if (!config.id) {
      setFeedbackEntries([]);
      return;
    }

    setFeedbackLoading(true);
    try {
      const query = new URLSearchParams({
        config_id: config.id,
        limit: String(limit),
      });
      const res = await fetch(`/api/builder/auto-mode/feedback?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setFeedbackEntries(Array.isArray(data.entries) ? data.entries : []);
      }
    } catch {
      // ignore feedback fetch failures; toggle/manual chat remains available
    } finally {
      setFeedbackLoading(false);
    }
  }, [config.id]);

  const fetchAutoModeStatus = useCallback(async () => {
    if (!config.id) {
      setSchedulerStatus(null);
      return;
    }

    setSchedulerLoading(true);
    try {
      const query = new URLSearchParams({ config_id: config.id });
      const res = await fetch(`/api/builder/auto-mode/status?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success && data.scheduler) {
        setSchedulerStatus(data.scheduler as AutoModeSchedulerStatus);
      }
    } catch {
      // ignore status fetch failures; chat control remains available
    } finally {
      setSchedulerLoading(false);
    }
  }, [config.id]);

  const fetchMemory = useCallback(async () => {
    if (!config.id) {
      setMemoryContent('');
      setMemoryState(null);
      return;
    }

    setMemoryLoading(true);
    try {
      const query = new URLSearchParams({ config_id: config.id });
      const res = await fetch(`/api/builder/memory?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setMemoryContent(typeof data.content === 'string' ? data.content : '');
        setMemoryState(data.state || null);
      }
    } catch {
      // ignore - memory controls are optional
    } finally {
      setMemoryLoading(false);
    }
  }, [config.id]);

  useEffect(() => {
    if (!config.id) {
      setFeedbackEntries([]);
      return;
    }

    void fetchAutoModeFeedback();
    void fetchAutoModeStatus();
    void fetchMemory();
    const shouldPoll = config.is_active || activeTab === 'chat';
    if (!shouldPoll) {
      return;
    }

    const interval = setInterval(() => {
      void fetchAutoModeFeedback();
      void fetchAutoModeStatus();
      void fetchMemory();
    }, AUTO_MODE_FEEDBACK_POLL_MS);

    return () => clearInterval(interval);
  }, [activeTab, config.id, config.is_active, fetchAutoModeFeedback, fetchAutoModeStatus, fetchMemory]);

  const handleAutoModeToggle = async (enabled: boolean) => {
    const previousEnabled = config.auto_mode_enabled !== false;
    setConfig((prev) => ({ ...prev, auto_mode_enabled: enabled }));

    if (!config.id) {
      setMessage({
        type: 'warning',
        text: 'Auto-mode preference saved locally and will persist after your first draft save.',
      });
      return;
    }

    setAutoModeSaving(true);
    try {
      const res = await fetch('/api/builder/auto-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config_id: config.id, enabled }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setConfig((prev) => ({ ...prev, auto_mode_enabled: previousEnabled }));
        setMessage({
          type: 'error',
          text: data.error || 'Failed to update auto-mode setting.',
        });
        return;
      }

      setConfig((prev) => ({ ...prev, auto_mode_enabled: data.auto_mode_enabled !== false }));
      if (config.is_active) {
        setMessage({
          type: 'success',
          text: `Auto-mode ${enabled ? 'enabled' : 'disabled'} for this agent.`,
        });
      }
      void fetchAutoModeFeedback();
      void fetchAutoModeStatus();
    } catch {
      setConfig((prev) => ({ ...prev, auto_mode_enabled: previousEnabled }));
      setMessage({ type: 'error', text: 'Failed to update auto-mode setting.' });
    } finally {
      setAutoModeSaving(false);
    }
  };

  const handleMemorySave = async () => {
    if (!config.id) {
      setMessage({ type: 'warning', text: 'Save the draft once before editing Memory.md.' });
      return;
    }

    setMemorySaving(true);
    try {
      const res = await fetch('/api/builder/memory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config_id: config.id,
          content: memoryContent,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setMessage({ type: 'error', text: data.error || 'Failed to save Memory.md' });
        return;
      }
      setMemoryContent(typeof data.content === 'string' ? data.content : memoryContent);
      setMemoryState(data.state || null);
      setMessage({ type: 'success', text: 'Memory.md saved.' });
      void fetchAutoModeStatus();
    } catch {
      setMessage({ type: 'error', text: 'Failed to save Memory.md' });
    } finally {
      setMemorySaving(false);
    }
  };

  const handleMemoryDistill = async () => {
    if (!config.id) {
      setMessage({ type: 'warning', text: 'Save the draft once before distilling memory.' });
      return;
    }

    setMemoryDistilling(true);
    try {
      const res = await fetch('/api/builder/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config_id: config.id,
          action: 'distill',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setMessage({ type: 'error', text: data.error || 'Failed to distill Memory.md' });
        return;
      }
      setMemoryContent(typeof data.content === 'string' ? data.content : memoryContent);
      setMemoryState(data.state || null);
      setMessage({ type: 'success', text: 'Memory.md distilled and applied.' });
      void fetchAutoModeStatus();
    } catch {
      setMessage({ type: 'error', text: 'Failed to distill Memory.md' });
    } finally {
      setMemoryDistilling(false);
    }
  };

  const handleMemoryReset = async (mode: 'soft' | 'hard') => {
    if (!config.id) return;
    const confirmed = window.confirm(
      mode === 'hard'
        ? 'Hard reset will clear Memory.md and sessions. Continue?'
        : 'Soft reset will clear volatile sessions but retain Memory.md. Continue?'
    );
    if (!confirmed) return;

    setMemoryResetting(true);
    try {
      const res = await fetch('/api/builder/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config_id: config.id,
          action: 'reset',
          mode,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setMessage({ type: 'error', text: data.error || 'Failed to reset memory' });
        return;
      }
      setMemoryContent(typeof data.content === 'string' ? data.content : '');
      setMemoryState(data.state || null);
      setMessage({
        type: 'success',
        text: mode === 'hard'
          ? 'Hard memory reset complete.'
          : 'Soft memory reset complete (distilled memory retained).',
      });
      void fetchAutoModeStatus();
    } catch {
      setMessage({ type: 'error', text: 'Failed to reset memory' });
    } finally {
      setMemoryResetting(false);
    }
  };

  const saveConfigDraft = useCallback(async (
    overrides?: Partial<AgentConfig>,
    options?: { syncActiveAgent?: boolean }
  ) => {
    const nextConfig: AgentConfig = { ...config, ...(overrides || {}) };
    const hasAgentName = Boolean(nextConfig.agent_name?.trim());
    const hasSoul = Boolean(nextConfig.soul_md?.trim());

    if (!hasAgentName || !hasSoul) {
      return { success: false as const, error: 'Agent name and SOUL.md are required.' };
    }

    if (nextConfig.soul_md.length > SOUL_MAX_LENGTH) {
      return { success: false as const, error: `SOUL.md exceeds ${SOUL_MAX_LENGTH} characters.` };
    }

    setSaving(true);
    try {
      const method = nextConfig.id ? 'PUT' : 'POST';
      const res = await fetch('/api/builder/config', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextConfig),
      });
      const data = await res.json();
      if (!data.success) {
        return { success: false as const, error: data.error || 'Failed to save draft' };
      }

      setConfig((prev) => ({
        ...prev,
        ...data.config,
        auto_mode_enabled: data.config.auto_mode_enabled !== false,
        soul_md:
          typeof data.config.soul_md === 'string' && data.config.soul_md.trim()
            ? data.config.soul_md
            : nextConfig.soul_md,
      }));

      if (options?.syncActiveAgent && data.config.is_active) {
        fetch('/api/builder/deploy', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data.config, config_id: data.config.id }),
        }).catch(() => {
          // non-critical
        });
      }

      return { success: true as const, config: data.config as AgentConfig };
    } catch {
      return { success: false as const, error: 'Failed to save draft' };
    } finally {
      setSaving(false);
    }
  }, [config]);

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
      const saveResult = await saveConfigDraft(
        { soul_md: data.soul_md },
        { syncActiveAgent: true }
      );
      if (!saveResult.success) {
        setMessage({
          type: 'error',
          text: `Generated SOUL.md locally but failed to save draft. ${saveResult.error}`,
        });
        return;
      }

      if (data.fallback_used) {
        setMessage({
          type: 'warning',
          text: data.warning || 'SOUL.md generated from fallback template because model generation was unavailable.',
        });
      } else {
        setMessage({ type: 'success', text: 'SOUL.md generated.' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to generate SOUL.md' });
    } finally {
      setGeneratingSoul(false);
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
      const stopped = Boolean(data?.success && data?.stopped && data?.verified_not_configured);
      if (stopped) {
        setConfig((prev) => ({ ...prev, is_active: false }));
        setMessage({
          type: 'success',
          text: data?.in_flight_at_stop
            ? 'Stop accepted. Current tick may finish, then the agent remains stopped.'
            : 'Agent stopped.',
        });
        if (fromChat) {
          setActiveTab('config');
          setChatSending(false);
        }
      } else {
        const details = typeof data?.details === 'string' && data.details.trim()
          ? ` (${data.details})`
          : '';
        setMessage({ type: 'error', text: `${data?.error || 'Failed to stop agent'}${details}` });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to stop agent' });
    } finally {
      setDeploying(false);
      void fetchAutoModeStatus();
      void fetchAutoModeFeedback();
    }
  };

  const deployAgent = async () => {
    if (!canDeployPaid) {
      setMessage({ type: 'error', text: 'A valid agent name and SOUL.md are required before deploying.' });
      return;
    }

    setDeploying(true);
    setMessage(null);
    try {
      const draftSave = await saveConfigDraft();
      if (!draftSave.success || !draftSave.config?.id) {
        setMessage({
          type: 'error',
          text: `Could not save latest draft before deploy. ${draftSave.error || ''}`.trim(),
        });
        return;
      }

      const res = await fetch('/api/builder/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config_id: draftSave.config.id }),
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
      window.location.href = '/pricing?from=builder&plan=starter';
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
        content: data.success
          ? data.response
          : `Error: ${data.error || 'Failed to get response'}${data.details ? `\n${data.details}` : ''}`,
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
          Configure and deploy your AI agent.
        </p>
      </div>

      {message && (
        <div className={`mb-4 p-3 border-2 text-sm ${
          message.type === 'success'
            ? 'bg-[var(--accent-light)] border-[var(--accent)] text-[var(--accent)]'
            : message.type === 'warning'
              ? 'bg-[var(--gold-light)] border-[var(--gold)] text-[var(--foreground)]'
            : 'bg-[var(--red-light)] border-[var(--red)] text-[var(--red)]'
        }`}>
          {message.text}
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
              onClick={() => handleAutoModeToggle(!(config.auto_mode_enabled !== false))}
              disabled={autoModeSaving}
              className={`pixel-btn px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                config.auto_mode_enabled !== false
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--surface)] text-[var(--foreground)]'
              }`}
            >
              {autoModeSaving ? 'Saving...' : `Auto-Mode: ${config.auto_mode_enabled !== false ? 'On' : 'Off'}`}
            </button>
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
                <p className="mb-2">
                  {config.auto_mode_enabled !== false
                    ? 'Your agent is active in auto-mode.'
                    : 'Auto-mode is off for this agent.'}
                </p>
                <p>
                  {config.auto_mode_enabled !== false
                    ? 'Background ticks keep it playing; chat messages act as live operator overrides.'
                    : 'You can still control the agent manually from chat.'}
                </p>
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

          <div className="mt-4 border-2 border-[var(--border)] p-3 bg-[var(--surface-alt)]">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-[var(--foreground)]">Recent Auto-Mode Activity</h3>
              <span className="text-[10px] text-[var(--muted)]">
                Polling every {AUTO_MODE_FEEDBACK_POLL_MS / 1000}s
              </span>
            </div>

            {schedulerStatus?.gateway?.ready === false && (
              <p className="text-[10px] text-[var(--red)] mb-2">
                Gateway unavailable ({schedulerStatus.gateway.error || 'runtime_unreachable'}). Auto-mode ticks will pause until Railway recovers.
              </p>
            )}

            {(feedbackLoading || schedulerLoading) && feedbackEntries.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">Loading activity...</p>
            ) : feedbackEntries.length === 0 ? (
              <div className="text-xs text-[var(--muted)] space-y-1">
                <p>
                  {config.auto_mode_enabled !== false
                    ? `Auto-mode active, ${formatEta(schedulerStatus?.next_tick_at || null)}.`
                    : 'Auto-mode is currently off for this agent.'}
                </p>
                {schedulerStatus?.last_tick_finished_at && (
                  <p>
                    Last tick: {schedulerStatus.last_tick_result || 'unknown'} at{' '}
                    {formatFeedbackTime(schedulerStatus.last_tick_finished_at)}.
                  </p>
                )}
                {schedulerStatus?.last_tick_error_code && (
                  <p>Last failure reason: {schedulerStatus.last_tick_error_code}</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {feedbackEntries.slice(0, 8).map((entry) => (
                  <div key={entry.id} className="border border-[var(--border)] bg-[var(--surface)] p-2">
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-semibold uppercase ${statusClass(entry.status)}`}>
                        {formatStatusLabel(entry.status)}
                      </span>
                      <span className="text-[10px] text-[var(--muted)]">
                        {formatFeedbackTime(entry.finished_at)}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--foreground)] mt-1">{entry.summary}</p>
                    {(entry.details || entry.error_code) && (
                      <p className="text-[10px] text-[var(--muted)] mt-1">{normalizeFailureReason(entry)}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {(activeTab === 'config' || !config.is_active) && (
        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-6">
            {isFreeTier && (
              <div className="pixel-card p-4 bg-[var(--gold-light)] border-[var(--gold)] h-[146px] flex flex-col justify-center">
                <p className="text-sm font-semibold text-[var(--foreground)] mb-2">
                  Draft your agent for free
                </p>
                <p className="text-xs text-[var(--muted)]">
                  Free accounts can save builder drafts and spectate. Upgrade to Starter or Pro to deploy.
                </p>
              </div>
            )}

            <div className="pixel-card p-4 h-[146px] flex flex-col justify-center">
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
              <p className="text-[11px] text-[var(--muted)] mb-2">
                Available on Free, Starter, and Pro.
              </p>

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

            <div className="pixel-card p-4">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <label className="text-sm font-semibold text-[var(--foreground)]">
                  Memory.md
                </label>
                <span className="text-xs text-[var(--muted)]">
                  Distilled long-term memory (auto-maintained every 100 autoplay ticks)
                </span>
                <button
                  onClick={handleMemoryDistill}
                  disabled={memoryDistilling || !config.id}
                  className="ml-auto text-xs px-3 py-1.5 border-2 border-[var(--border)] text-[var(--foreground)] hover:border-[var(--accent)] disabled:opacity-50"
                >
                  {memoryDistilling ? 'Distilling...' : 'Distill Memory Now'}
                </button>
              </div>
              <p className="text-[11px] text-[var(--muted)] mb-2">
                You and the agent can update memory facts. Structured `MEMORY_OP` payloads are auto-applied.
              </p>
              <textarea
                value={memoryContent}
                onChange={(e) => setMemoryContent(e.target.value)}
                placeholder={memoryLoading ? 'Loading memory...' : '# Memory\\n\\n## Active Context\\n- ...'}
                rows={10}
                className="pixel-input w-full resize-y font-mono text-xs"
                disabled={memoryLoading}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  onClick={handleMemorySave}
                  disabled={memorySaving || memoryLoading || !config.id}
                  className="pixel-btn px-3 py-1.5 bg-[var(--accent)] text-white text-xs font-semibold disabled:opacity-50"
                >
                  {memorySaving ? 'Saving...' : 'Save Memory.md'}
                </button>
                <button
                  onClick={() => handleMemoryReset('soft')}
                  disabled={memoryResetting || !config.id}
                  className="pixel-btn px-3 py-1.5 bg-[var(--surface)] text-[var(--foreground)] text-xs font-semibold disabled:opacity-50"
                >
                  Soft Reset
                </button>
                <button
                  onClick={() => handleMemoryReset('hard')}
                  disabled={memoryResetting || !config.id}
                  className="pixel-btn px-3 py-1.5 bg-[var(--red)] text-white text-xs font-semibold disabled:opacity-50"
                >
                  Hard Reset
                </button>
                {memoryState && (
                  <span className="text-[10px] text-[var(--muted)] ml-auto">
                    v{memoryState.memory_version} · {memoryState.memory_bytes} bytes · ticks {memoryState.ticks_since_distill}
                  </span>
                )}
              </div>
            </div>

          </div>

          <div className="space-y-6">
            <div className="pixel-card p-4 h-[146px] flex flex-col justify-center">
              <button
                onClick={handleDeployClick}
                disabled={deployButtonDisabled}
                className={`pixel-btn w-full px-6 py-3 font-semibold text-sm disabled:opacity-50 ${
                  config.is_active
                    ? 'bg-[var(--red)] text-white'
                    : 'bg-[var(--gold)] text-white'
                }`}
              >
                {deploying || saving ? 'Working...' : config.is_active ? 'Stop Agent' : 'Deploy Agent'}
              </button>
            </div>

            <div className="pixel-card p-4">
              <h3 className="text-sm font-semibold text-[var(--foreground)] mb-2">Agent Status</h3>
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${config.is_active ? 'bg-[var(--accent)]' : 'bg-[var(--muted)]'}`} />
                <span className="text-sm text-[var(--foreground)]">
                  {config.is_active ? 'Active' : 'Paused'}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 border border-[var(--border)] bg-[var(--surface-alt)] p-2">
                <div>
                  <div className="text-xs font-semibold text-[var(--foreground)]">Auto-Mode</div>
                  <div className="text-[10px] text-[var(--muted)]">
                    Off stops background ticks; chat control still works.
                  </div>
                </div>
                <button
                  onClick={() => handleAutoModeToggle(!(config.auto_mode_enabled !== false))}
                  disabled={autoModeSaving}
                  className={`pixel-btn px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                    config.auto_mode_enabled !== false
                      ? 'bg-[var(--accent)] text-white'
                      : 'bg-[var(--surface)] text-[var(--foreground)]'
                  }`}
                >
                  {autoModeSaving ? 'Saving...' : config.auto_mode_enabled !== false ? 'On' : 'Off'}
                </button>
              </div>
              {config.agent_id && (
                <div className="mt-2 text-xs text-[var(--muted)]">
                  Agent ID: <code className="text-[var(--accent)]">{config.agent_id.slice(0, 8)}...</code>
                </div>
              )}
              {config.engine === 'openclaw' && (
                <div className="mt-1 text-xs text-[var(--accent)]">
                  Engine: OpenClaw
                </div>
              )}
              {feedbackEntries[0] && (
                <div className="mt-2 text-xs text-[var(--muted)]">
                  Last tick: <span className={statusClass(feedbackEntries[0].status)}>{feedbackEntries[0].summary}</span>
                </div>
              )}
              {schedulerStatus?.next_tick_at && config.auto_mode_enabled !== false && (
                <div className="mt-1 text-xs text-[var(--muted)]">
                  Scheduler: {formatEta(schedulerStatus.next_tick_at)}
                </div>
              )}
              {schedulerStatus?.budget && (
                <div className="mt-1 text-xs text-[var(--muted)]">
                  Budget: {schedulerStatus.budget.remaining_calls_autoplay} auto calls left
                  {' '}({Math.round((schedulerStatus.budget.run_fraction || 0) * 100)}% pace)
                </div>
              )}
              {schedulerStatus?.memory && (
                <div className="mt-1 text-xs text-[var(--muted)]">
                  Memory: v{schedulerStatus.memory.memory_version}, {schedulerStatus.memory.ticks_since_distill}/100 ticks
                </div>
              )}
              {schedulerStatus?.last_tick_error_code && (
                <div className="mt-1 text-xs text-[var(--red)]">
                  Reason: {schedulerStatus.last_tick_error_code}
                </div>
              )}
            </div>

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
                {typeof profile.llm_calls_used === 'number' && (
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    Calls used: {profile.llm_calls_used}
                    {typeof profile.autoplay_calls_used === 'number' ? ` (auto: ${profile.autoplay_calls_used})` : ''}
                  </div>
                )}
              </div>
            )}

            {config.is_active && (
              <div className="pixel-card p-4">
                <h3 className="text-sm font-semibold text-[var(--foreground)] mb-2">How It Works</h3>
                <div className="space-y-2 text-xs text-[var(--muted)]">
                  <p>Your agent runs on OpenClaw and the current ClawCity skillset.</p>
                  <p>Auto-mode runs background decision ticks so the agent keeps playing even without chat.</p>
                  <p>Chat remains a live control channel: your latest instructions steer subsequent auto-mode turns.</p>
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
