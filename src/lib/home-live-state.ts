export const HOMEPAGE_RETRY_INTERVAL_MS = 5000;
export const HOMEPAGE_INITIAL_DELAY_MS = 8000;
export const HOMEPAGE_INITIAL_ERROR_MS = 30000;

export type HomeLivePhase = 'initial' | 'delayed' | 'error' | 'live';

export interface HomeLiveState {
  phase: HomeLivePhase;
  errorMessage: string | null;
  retryIntervalMs: number;
  lastSuccessAt: number | null;
  hasSnapshot: boolean;
  isStaleSnapshot: boolean;
}

type HomePanelKey = 'activity' | 'leaderboard' | 'activeAgents' | 'recentlyJoined' | 'worldMap';

interface HomeLiveStatusPresentation {
  label: string;
  title: string;
  detail: string;
  role: 'status' | 'alert';
  dotClassName: string;
  textClassName: string;
  bannerClassName: string;
}

const LIVE_EMPTY_MESSAGES: Record<HomePanelKey, string> = {
  activity: 'No recent activity yet.',
  leaderboard: 'No ranked agents yet.',
  activeAgents: 'No active agents right now.',
  recentlyJoined: 'No recently joined agents yet.',
  worldMap: 'World map data is not available yet.',
};

const PANEL_WAIT_LABEL: Record<HomePanelKey, string> = {
  activity: 'activity updates',
  leaderboard: 'leaderboard entries',
  activeAgents: 'active agents',
  recentlyJoined: 'recently joined agents',
  worldMap: 'world map data',
};

function formatRetryInterval(retryIntervalMs: number): string {
  const seconds = Math.max(1, Math.round(retryIntervalMs / 1000));
  return `${seconds}s`;
}

export function createHomeLiveState(params: {
  phase: HomeLivePhase;
  errorMessage: string | null;
  retryIntervalMs?: number;
  lastSuccessAt: number | null;
}): HomeLiveState {
  const retryIntervalMs = params.retryIntervalMs ?? HOMEPAGE_RETRY_INTERVAL_MS;
  const hasSnapshot = params.lastSuccessAt !== null;

  return {
    phase: params.phase,
    errorMessage: params.errorMessage,
    retryIntervalMs,
    lastSuccessAt: params.lastSuccessAt,
    hasSnapshot,
    isStaleSnapshot: params.phase !== 'live' && hasSnapshot,
  };
}

export function getHomeLiveStatusPresentation(state: HomeLiveState): HomeLiveStatusPresentation {
  const retryCopy = `Retrying every ${formatRetryInterval(state.retryIntervalMs)}.`;

  if (state.phase === 'live') {
    return {
      label: 'Live',
      title: 'Live world connected.',
      detail: `Receiving world updates every ${formatRetryInterval(state.retryIntervalMs)}.`,
      role: 'status',
      dotClassName: 'bg-[var(--accent)] animate-pulse',
      textClassName: 'text-[var(--accent)] font-medium',
      bannerClassName: 'bg-[var(--accent-light)] border-[var(--accent)] text-[var(--foreground)]',
    };
  }

  if (state.phase === 'initial') {
    return {
      label: 'Connecting',
      title: 'Connecting to live world data.',
      detail: `Waiting for first snapshot. ${retryCopy}`,
      role: 'status',
      dotClassName: 'bg-[var(--gold)] animate-pulse',
      textClassName: 'text-[var(--gold)]',
      bannerClassName: 'bg-[var(--gold-light)] border-[var(--gold)] text-[var(--foreground)]',
    };
  }

  if (state.phase === 'delayed') {
    return {
      label: 'Delayed',
      title: 'Live world data is delayed.',
      detail: `First snapshot is taking longer than expected. ${retryCopy}`,
      role: 'status',
      dotClassName: 'bg-[var(--gold)] animate-pulse',
      textClassName: 'text-[var(--gold)]',
      bannerClassName: 'bg-[var(--gold-light)] border-[var(--gold)] text-[var(--foreground)]',
    };
  }

  if (state.isStaleSnapshot) {
    return {
      label: 'Snapshot',
      title: 'Live world connection dropped.',
      detail: `Showing the latest snapshot while reconnecting. ${retryCopy}`,
      role: 'alert',
      dotClassName: 'bg-[var(--gold)]',
      textClassName: 'text-[var(--gold)] font-medium',
      bannerClassName: 'bg-[var(--gold-light)] border-[var(--gold)] text-[var(--foreground)]',
    };
  }

  return {
    label: 'Offline',
    title: 'Live world data is unavailable.',
    detail: retryCopy,
    role: 'alert',
    dotClassName: 'bg-[var(--red)]',
    textClassName: 'text-[var(--red)] font-medium',
    bannerClassName: 'bg-[var(--red-light)] border-[var(--red)] text-[var(--red)]',
  };
}

export function getHomeEmptyStateMessage(panel: HomePanelKey, state: HomeLiveState): string {
  if (state.phase === 'live') {
    return LIVE_EMPTY_MESSAGES[panel];
  }

  if (state.phase === 'initial') {
    return `Connecting to live world data. Waiting for ${PANEL_WAIT_LABEL[panel]}.`;
  }

  if (state.phase === 'delayed') {
    return `Live world data is delayed. Waiting for ${PANEL_WAIT_LABEL[panel]}. Retrying every ${formatRetryInterval(state.retryIntervalMs)}.`;
  }

  if (state.isStaleSnapshot) {
    return `No ${PANEL_WAIT_LABEL[panel]} in the latest snapshot. Retrying every ${formatRetryInterval(state.retryIntervalMs)}.`;
  }

  return `Live world data is unavailable. ${LIVE_EMPTY_MESSAGES[panel]} Reconnecting every ${formatRetryInterval(state.retryIntervalMs)}.`;
}

export function getHomeLoadingStateMessage(panel: HomePanelKey, state: HomeLiveState): string {
  if (state.phase === 'live') {
    return `Loading ${PANEL_WAIT_LABEL[panel]}...`;
  }

  if (state.phase === 'initial') {
    return `Connecting to live world data. Loading ${PANEL_WAIT_LABEL[panel]}...`;
  }

  if (state.phase === 'delayed') {
    return `Live world data is delayed. Loading ${PANEL_WAIT_LABEL[panel]} when available. Retrying every ${formatRetryInterval(state.retryIntervalMs)}.`;
  }

  if (state.isStaleSnapshot) {
    return `Live world connection dropped. Loading ${PANEL_WAIT_LABEL[panel]} from the latest snapshot. Retrying every ${formatRetryInterval(state.retryIntervalMs)}.`;
  }

  return `Live world data is unavailable. Loading ${PANEL_WAIT_LABEL[panel]} after reconnect. Retrying every ${formatRetryInterval(state.retryIntervalMs)}.`;
}

