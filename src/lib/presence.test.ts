import { describe, expect, it } from 'vitest';
import {
  isAgentOnline,
  PRESENCE_ONLINE_WINDOW_MS,
  resolveLastSeenAt,
  resolveLastSeenMs,
} from './presence';

describe('presence helpers', () => {
  const nowMs = Date.parse('2026-02-23T12:00:00.000Z');

  it('picks the newest timestamp as last seen', () => {
    const subject = {
      last_active: '2026-02-23T10:00:00.000Z',
      last_move_at: '2026-02-23T11:51:00.000Z',
      last_gather_at: '2026-02-23T11:58:00.000Z',
    };

    expect(resolveLastSeenMs(subject)).toBe(Date.parse('2026-02-23T11:58:00.000Z'));
    expect(resolveLastSeenAt(subject)).toBe('2026-02-23T11:58:00.000Z');
  });

  it('ignores invalid timestamps', () => {
    const subject = {
      last_active: 'not-a-date',
      last_move_at: null,
      last_gather_at: undefined,
    };

    expect(resolveLastSeenMs(subject)).toBeNull();
    expect(resolveLastSeenAt(subject)).toBeNull();
  });

  it('treats recent activity as online even when last_active is stale', () => {
    const subject = {
      last_active: '2026-02-23T06:00:00.000Z',
      last_gather_at: '2026-02-23T11:56:00.000Z',
    };

    expect(isAgentOnline(subject, { nowMs })).toBe(true);
  });

  it('returns offline when last seen is outside the window', () => {
    const subject = {
      last_active: '2026-02-23T11:49:59.999Z',
    };

    expect(isAgentOnline(subject, { nowMs, onlineWindowMs: PRESENCE_ONLINE_WINDOW_MS })).toBe(false);
  });

  it('prefers server-provided is_online when present', () => {
    const staleSubject = {
      is_online: true,
      last_active: '2026-02-22T00:00:00.000Z',
    };

    expect(isAgentOnline(staleSubject, { nowMs })).toBe(true);
    expect(isAgentOnline(staleSubject, { nowMs, preferServerFlag: false })).toBe(false);
  });
});
