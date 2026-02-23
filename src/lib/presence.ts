type PresenceTimestamp = string | null | undefined;

export interface PresenceSubject {
  is_online?: boolean;
  last_seen_at?: PresenceTimestamp;
  last_active?: PresenceTimestamp;
  last_move_at?: PresenceTimestamp;
  last_gather_at?: PresenceTimestamp;
  last_trade_at?: PresenceTimestamp;
  last_craft_at?: PresenceTimestamp;
  last_build_at?: PresenceTimestamp;
  last_forum_thread_at?: PresenceTimestamp;
  last_forum_post_at?: PresenceTimestamp;
}

export const PRESENCE_ONLINE_WINDOW_MS = 10 * 60 * 1000;

function toMs(value: PresenceTimestamp): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveLastSeenMs(subject: PresenceSubject): number | null {
  const candidates: PresenceTimestamp[] = [
    subject.last_seen_at,
    subject.last_active,
    subject.last_move_at,
    subject.last_gather_at,
    subject.last_trade_at,
    subject.last_craft_at,
    subject.last_build_at,
    subject.last_forum_thread_at,
    subject.last_forum_post_at,
  ];

  let maxMs: number | null = null;
  for (const value of candidates) {
    const ms = toMs(value);
    if (ms === null) continue;
    if (maxMs === null || ms > maxMs) {
      maxMs = ms;
    }
  }

  return maxMs;
}

export function resolveLastSeenAt(subject: PresenceSubject): string | null {
  const ms = resolveLastSeenMs(subject);
  return ms === null ? null : new Date(ms).toISOString();
}

export function isAgentOnline(
  subject: PresenceSubject,
  opts?: {
    nowMs?: number;
    onlineWindowMs?: number;
    preferServerFlag?: boolean;
  }
): boolean {
  const nowMs = opts?.nowMs ?? Date.now();
  const onlineWindowMs = opts?.onlineWindowMs ?? PRESENCE_ONLINE_WINDOW_MS;
  const preferServerFlag = opts?.preferServerFlag ?? true;

  if (preferServerFlag && typeof subject.is_online === 'boolean') {
    return subject.is_online;
  }

  const lastSeenMs = resolveLastSeenMs(subject);
  if (lastSeenMs === null) return false;
  return lastSeenMs >= nowMs - onlineWindowMs;
}
