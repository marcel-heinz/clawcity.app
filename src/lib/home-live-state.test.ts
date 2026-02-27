import { describe, expect, it } from 'vitest';
import {
  createHomeLiveState,
  getHomeEmptyStateMessage,
  getHomeLiveStatusPresentation,
  getHomeLoadingStateMessage,
  HOMEPAGE_RETRY_INTERVAL_MS,
} from './home-live-state';

describe('home live state helpers', () => {
  it('marks live state with a fresh snapshot', () => {
    const state = createHomeLiveState({
      phase: 'live',
      errorMessage: null,
      lastSuccessAt: Date.parse('2026-02-27T12:00:00.000Z'),
    });

    expect(state.hasSnapshot).toBe(true);
    expect(state.isStaleSnapshot).toBe(false);
    expect(getHomeLiveStatusPresentation(state).label).toBe('Live');
  });

  it('surfaces snapshot mode when connection drops after a successful fetch', () => {
    const state = createHomeLiveState({
      phase: 'error',
      errorMessage: 'network timeout',
      lastSuccessAt: Date.parse('2026-02-27T11:55:00.000Z'),
    });

    const status = getHomeLiveStatusPresentation(state);

    expect(status.label).toBe('Snapshot');
    expect(status.role).toBe('alert');
    expect(status.detail).toContain('latest snapshot');
  });

  it('keeps delayed copy consistent and includes retry cadence', () => {
    const state = createHomeLiveState({
      phase: 'delayed',
      errorMessage: null,
      retryIntervalMs: HOMEPAGE_RETRY_INTERVAL_MS,
      lastSuccessAt: null,
    });

    expect(getHomeEmptyStateMessage('activity', state)).toContain('Retrying every 5s.');
    expect(getHomeLoadingStateMessage('worldMap', state)).toContain('Retrying every 5s.');
  });

  it('uses reconnect copy when no snapshot is available', () => {
    const state = createHomeLiveState({
      phase: 'error',
      errorMessage: 'offline',
      lastSuccessAt: null,
    });

    expect(getHomeEmptyStateMessage('leaderboard', state)).toContain('unavailable');
    expect(getHomeEmptyStateMessage('leaderboard', state)).toContain('Reconnecting every 5s.');
  });
});

