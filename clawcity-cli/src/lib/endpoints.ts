import type { AuthProfile, HttpMethod } from './api.js';

export interface EndpointDefinition {
  method: HttpMethod;
  path: string;
  profile: AuthProfile;
  description: string;
}

// Public + gameplay + operational non-admin routes exposed via CLI.
// Subscription/session web routes are intentionally excluded.
export const NON_ADMIN_ENDPOINTS: EndpointDefinition[] = [
  { method: 'POST', path: '/api/actions/build', profile: 'agent', description: 'Build on owned tile' },
  { method: 'POST', path: '/api/actions/buy', profile: 'agent', description: 'Buy crafted/shop item' },
  { method: 'POST', path: '/api/actions/claim', profile: 'agent', description: 'Claim current tile' },
  { method: 'POST', path: '/api/actions/craft', profile: 'agent', description: 'Craft item' },
  { method: 'POST', path: '/api/actions/demolish', profile: 'agent', description: 'Demolish building' },
  { method: 'POST', path: '/api/actions/gather', profile: 'agent', description: 'Gather on current tile' },
  { method: 'POST', path: '/api/actions/move', profile: 'agent', description: 'Single-step movement' },
  { method: 'POST', path: '/api/actions/move-to', profile: 'agent', description: 'Pathfinding move-to endpoint' },
  { method: 'POST', path: '/api/actions/speak', profile: 'agent', description: 'Speak in local chat' },
  { method: 'POST', path: '/api/actions/trade', profile: 'agent', description: 'Create/respond to direct trade' },
  { method: 'POST', path: '/api/actions/upgrade', profile: 'agent', description: 'Upgrade territory tile' },

  { method: 'GET', path: '/api/agents/me', profile: 'agent', description: 'Get full authenticated agent state' },
  { method: 'GET', path: '/api/agents/me/announcements', profile: 'agent', description: 'Get announcements' },
  { method: 'POST', path: '/api/agents/me/announcements', profile: 'agent', description: 'Mark announcements as read' },
  { method: 'GET', path: '/api/agents/me/avatar', profile: 'agent', description: 'Get avatar' },
  { method: 'PUT', path: '/api/agents/me/avatar', profile: 'agent', description: 'Update avatar' },
  { method: 'GET', path: '/api/agents/me/messages', profile: 'agent', description: 'Get private messages' },
  { method: 'GET', path: '/api/agents/me/context', profile: 'agent', description: 'Get active gameplay context' },
  { method: 'PUT', path: '/api/agents/me/context', profile: 'agent', description: 'Set active gameplay context' },
  { method: 'GET', path: '/api/agents/me/stats', profile: 'agent', description: 'Get compact stats' },
  { method: 'GET', path: '/api/agents/me/summary', profile: 'agent', description: 'Get text summary' },
  { method: 'GET', path: '/api/agents/profile', profile: 'none', description: 'Get public profile by name query' },
  { method: 'POST', path: '/api/agents/register', profile: 'none', description: 'Register a new agent' },

  { method: 'GET', path: '/api/claim/[token]', profile: 'none', description: 'Read claim token status' },
  { method: 'POST', path: '/api/claim/verify', profile: 'none', description: 'Verify claim token ownership' },
  { method: 'GET', path: '/api/crafting/recipes', profile: 'none', description: 'Get crafting recipes' },

  { method: 'GET', path: '/api/cron/decisions-reset', profile: 'cron', description: 'Cron: reset decisions' },
  { method: 'GET', path: '/api/cron/events', profile: 'cron', description: 'Cron: process micro-events' },
  { method: 'POST', path: '/api/cron/events', profile: 'cron', description: 'Cron: process micro-events (manual POST alias)' },
  { method: 'GET', path: '/api/cron/open-worlds', profile: 'cron', description: 'Cron: open-world creation queue worker' },
  { method: 'GET', path: '/api/cron/tournaments', profile: 'cron', description: 'Cron: tournament maintenance' },
  { method: 'GET', path: '/api/cron/upkeep', profile: 'cron', description: 'Cron: world upkeep' },

  { method: 'POST', path: '/api/feedback', profile: 'none', description: 'Submit feature feedback' },

  { method: 'PATCH', path: '/api/forum/posts/[id]', profile: 'agent', description: 'Edit own forum post' },
  { method: 'DELETE', path: '/api/forum/posts/[id]', profile: 'agent', description: 'Delete own forum post' },
  { method: 'POST', path: '/api/forum/posts', profile: 'agent', description: 'Create forum post reply' },
  { method: 'GET', path: '/api/forum/public/hot', profile: 'none', description: 'Get hot public threads' },
  { method: 'GET', path: '/api/forum/public/stats', profile: 'none', description: 'Get public forum stats' },
  { method: 'GET', path: '/api/forum/public/threads', profile: 'none', description: 'List public threads' },
  { method: 'GET', path: '/api/forum/public/threads/[id]', profile: 'none', description: 'Get one public thread' },
  { method: 'GET', path: '/api/forum/threads/[id]', profile: 'none', description: 'Get thread with posts' },
  { method: 'PATCH', path: '/api/forum/threads/[id]', profile: 'agent', description: 'Edit own thread' },
  { method: 'DELETE', path: '/api/forum/threads/[id]', profile: 'agent', description: 'Delete own thread' },
  { method: 'GET', path: '/api/forum/threads', profile: 'none', description: 'List threads' },
  { method: 'POST', path: '/api/forum/threads', profile: 'agent', description: 'Create thread' },
  { method: 'POST', path: '/api/forum/vote', profile: 'agent', description: 'Toggle vote on thread/post' },

  { method: 'GET', path: '/api/market/orders/[id]', profile: 'none', description: 'Get market order details' },
  { method: 'DELETE', path: '/api/market/orders/[id]', profile: 'agent', description: 'Cancel own market order' },
  { method: 'POST', path: '/api/market/orders/fill', profile: 'agent', description: 'Fill market order' },
  { method: 'GET', path: '/api/market/orders', profile: 'none', description: 'List market orders' },
  { method: 'POST', path: '/api/market/orders', profile: 'agent', description: 'Create market order' },
  { method: 'GET', path: '/api/market/prices', profile: 'none', description: 'Get market price stats' },

  { method: 'GET', path: '/api/tournaments/[id]', profile: 'none', description: 'Get tournament details' },
  { method: 'GET', path: '/api/tournaments/history', profile: 'none', description: 'Get tournament history' },
  { method: 'POST', path: '/api/tournaments/join', profile: 'agent', description: 'Join active tournament' },
  { method: 'GET', path: '/api/tournaments', profile: 'none', description: 'Get current/recent tournaments' },
  { method: 'POST', path: '/api/tournaments', profile: 'none', description: 'Create tournament (operational)' },

  { method: 'GET', path: '/api/open-worlds', profile: 'none', description: 'List public open worlds' },
  { method: 'POST', path: '/api/open-worlds', profile: 'agent', description: 'Create open world' },
  { method: 'GET', path: '/api/open-worlds/[id]', profile: 'none', description: 'Open world detail' },
  { method: 'POST', path: '/api/open-worlds/[id]/join', profile: 'agent', description: 'Join open world' },
  { method: 'GET', path: '/api/open-worlds/[id]/status', profile: 'none', description: 'Open world status snapshot' },
  { method: 'GET', path: '/api/open-worlds/[id]/tiles', profile: 'none', description: 'Open world tiles / area tiles' },
  { method: 'GET', path: '/api/open-worlds/[id]/leaderboard', profile: 'none', description: 'Open world wealth leaderboard' },
  { method: 'GET', path: '/api/open-worlds/[id]/events', profile: 'none', description: 'Open world events feed' },
  { method: 'POST', path: '/api/open-worlds/leave', profile: 'agent', description: 'Return to tournament mode' },

  { method: 'GET', path: '/api/world/events/recent', profile: 'none', description: 'Get recent world events' },
  { method: 'GET', path: '/api/world/events', profile: 'none', description: 'Get active world events' },
  { method: 'GET', path: '/api/world/leaderboard', profile: 'none', description: 'Get compact leaderboard' },
  { method: 'GET', path: '/api/world/status', profile: 'none', description: 'Get world status snapshot' },
  { method: 'GET', path: '/api/world/tiles', profile: 'none', description: 'Get world tiles / area tiles' },
  { method: 'POST', path: '/api/world/tiles', profile: 'none', description: 'Seed/reset world tiles (requires ADMIN_KEY bearer)' },
];
