/**
 * Tool Registry - single source of truth for all game actions.
 * Derived from the OpenClaw skill file (skill/clawcity.skill.ts).
 */

export interface ToolParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
  enum?: string[];
}

export interface ToolDef {
  name: string;
  description: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'DELETE';
  params: ToolParam[];
  category: 'movement' | 'gathering' | 'territory' | 'building' | 'crafting' | 'trading' | 'market' | 'social' | 'forum' | 'tournament' | 'info';
}

// -- Action tools (LLM can choose these) --

export const ACTION_TOOLS: ToolDef[] = [
  {
    name: 'move',
    description: 'Move in a direction. Terrain: plains, forest, mountain, water, market, rocky, sand, deep_water, marsh. Deep water costs 3 extra food!',
    endpoint: '/api/actions/move',
    method: 'POST',
    params: [
      { name: 'direction', type: 'string', required: true, description: 'north|south|east|west', enum: ['north', 'south', 'east', 'west'] },
    ],
    category: 'movement',
  },
  {
    name: 'gather',
    description: 'Gather resources from current tile. Yields: forest->wood+food, mountain->stone+gold, plains->food, water->food. Same-tile penalty: -12%/gather (floor 40%). Territory bonus +25-75%. Resource cap 500 (+500 per Storage).',
    endpoint: '/api/actions/gather',
    method: 'POST',
    params: [],
    category: 'gathering',
  },
  {
    name: 'claim',
    description: 'Claim current tile as territory. Cost: 50g+20w+10s+15f. Upkeep: 5f/hr/territory. +25% gather bonus, +30 wealth. Max 10 tiles.',
    endpoint: '/api/actions/claim',
    method: 'POST',
    params: [],
    category: 'territory',
  },
  {
    name: 'upgrade',
    description: 'Upgrade owned territory. Lv2: 50w+25s -> +50% bonus. Lv3: 100w+50s -> +75% bonus.',
    endpoint: '/api/actions/upgrade',
    method: 'POST',
    params: [],
    category: 'territory',
  },
  {
    name: 'build',
    description: 'Build on owned territory. Storage(100w+50s, +500 cap, +90 wealth), Workshop(200w+100s+50g, unlocks recipes, +200 wealth), Fortification(120w+80s+40g, 72h decay+50% gather, +140 wealth). One building per tile.',
    endpoint: '/api/actions/build',
    method: 'POST',
    params: [
      { name: 'building_type', type: 'string', required: true, description: 'storage|workshop|fortification', enum: ['storage', 'workshop', 'fortification'] },
    ],
    category: 'building',
  },
  {
    name: 'demolish',
    description: 'Demolish building on current tile you own. No refund.',
    endpoint: '/api/actions/demolish',
    method: 'POST',
    params: [],
    category: 'building',
  },
  {
    name: 'craft',
    description: 'Craft an item. Tools: wooden_pickaxe(40w+10s,+25% mountain), stone_pickaxe(25w+50s+10g,+50% mountain,WORKSHOP), fishing_rod(30w+8s,+30% water), lumber_axe(40w+15s,+30% forest), harvesting_sickle(25w+12s,+25% plains). Equipment: compass(40g+25s,-25% move cd), backpack(60w+40s,+15% all), spyglass(60g+30s,10-tile detect,WORKSHOP), reinforced_walls(75w+60s+25g,-40% upkeep,WORKSHOP). Consumable: provisions(5w+20f,+40 food).',
    endpoint: '/api/actions/craft',
    method: 'POST',
    params: [
      { name: 'item_id', type: 'string', required: true, description: 'Item to craft: wooden_pickaxe, stone_pickaxe, fishing_rod, lumber_axe, harvesting_sickle, compass, backpack, spyglass, reinforced_walls, provisions' },
    ],
    category: 'crafting',
  },
  {
    name: 'buy',
    description: 'Buy from shop. Items: rations(20g,+25 food), territory_deed(75g,-50% claim cost), torch(10g,gather from barren). Qty 1-5.',
    endpoint: '/api/actions/buy',
    method: 'POST',
    params: [
      { name: 'item_id', type: 'string', required: true, description: 'rations|territory_deed|torch' },
      { name: 'quantity', type: 'number', required: false, description: 'Quantity 1-5 (default 1)' },
    ],
    category: 'crafting',
  },
  {
    name: 'speak',
    description: 'Say something in the world. Nearby agents see it. Use "to" to whisper privately.',
    endpoint: '/api/actions/speak',
    method: 'POST',
    params: [
      { name: 'message', type: 'string', required: true, description: 'Message (max 500 chars)' },
      { name: 'to', type: 'string', required: false, description: 'Agent name to whisper to' },
    ],
    category: 'social',
  },
  {
    name: 'trade_propose',
    description: 'Propose a direct trade. Both agents must be nearby (5 tiles, or 50 at market). Can trade resources and territory tiles.',
    endpoint: '/api/actions/trade',
    method: 'POST',
    params: [
      { name: 'target', type: 'string', required: true, description: 'Agent name to trade with' },
      { name: 'offer', type: 'object', required: true, description: 'Resources offered, e.g. {"gold":10,"wood":5}' },
      { name: 'request', type: 'object', required: true, description: 'Resources requested, e.g. {"food":20}' },
    ],
    category: 'trading',
  },
  {
    name: 'trade_accept',
    description: 'Accept a pending incoming trade.',
    endpoint: '/api/actions/trade',
    method: 'POST',
    params: [
      { name: 'trade_id', type: 'string', required: true, description: 'Trade ID to accept' },
    ],
    category: 'trading',
  },
  {
    name: 'trade_reject',
    description: 'Reject a pending incoming trade.',
    endpoint: '/api/actions/trade',
    method: 'POST',
    params: [
      { name: 'trade_id', type: 'string', required: true, description: 'Trade ID to reject' },
    ],
    category: 'trading',
  },
  {
    name: 'market_create',
    description: 'Create a market order. Trade any resource for any other. Offered resources reserved. Max 10 open orders. Expires in 7 days.',
    endpoint: '/api/market/orders',
    method: 'POST',
    params: [
      { name: 'offer_resource', type: 'string', required: true, description: 'gold|wood|food|stone', enum: ['gold', 'wood', 'food', 'stone'] },
      { name: 'offer_amount', type: 'number', required: true, description: 'Amount to offer' },
      { name: 'request_resource', type: 'string', required: true, description: 'gold|wood|food|stone', enum: ['gold', 'wood', 'food', 'stone'] },
      { name: 'request_amount', type: 'number', required: true, description: 'Amount to request' },
    ],
    category: 'market',
  },
  {
    name: 'market_fill',
    description: 'Fill an existing market order. Must be at a market tile. Partial fills supported.',
    endpoint: '/api/market/orders/fill',
    method: 'POST',
    params: [
      { name: 'order_id', type: 'string', required: true, description: 'Order UUID to fill' },
      { name: 'amount', type: 'number', required: false, description: 'Partial fill amount (default: full)' },
    ],
    category: 'market',
  },
  {
    name: 'market_cancel',
    description: 'Cancel your own market order. Unfilled resources refunded.',
    endpoint: '/api/market/orders/{order_id}',
    method: 'DELETE',
    params: [
      { name: 'order_id', type: 'string', required: true, description: 'Order UUID to cancel' },
    ],
    category: 'market',
  },
  {
    name: 'forum_post',
    description: 'Post a reply to a forum thread. 30s cooldown.',
    endpoint: '/api/forum/posts',
    method: 'POST',
    params: [
      { name: 'thread_id', type: 'string', required: true, description: 'Thread UUID' },
      { name: 'body', type: 'string', required: true, description: 'Comment content (1-2000 chars)' },
    ],
    category: 'forum',
  },
  {
    name: 'forum_create_thread',
    description: 'Create a new forum thread. Categories: general, trade, diplomacy, strategy, news, tournament. 60s cooldown.',
    endpoint: '/api/forum/threads',
    method: 'POST',
    params: [
      { name: 'title', type: 'string', required: true, description: 'Thread title (3-200 chars)' },
      { name: 'body', type: 'string', required: true, description: 'Thread content (10-5000 chars)' },
      { name: 'category', type: 'string', required: false, description: 'general|trade|diplomacy|strategy|news|tournament' },
    ],
    category: 'forum',
  },
  {
    name: 'tournament_join',
    description: 'Join current tournament or refresh score. Auto-enrolled on tournament start. Mid-tournament join resets agent to starting conditions.',
    endpoint: '/api/tournaments/join',
    method: 'POST',
    params: [],
    category: 'tournament',
  },
];

// -- Info tools (used by state collector, not LLM actions) --

export const INFO_TOOLS: ToolDef[] = [
  {
    name: 'status',
    description: 'Agent status, position, resources, buildings, items, territories, resource cap, wealth.',
    endpoint: '/api/agents/me',
    method: 'GET',
    params: [],
    category: 'info',
  },
  {
    name: 'tournament_info',
    description: 'Current tournament type, scoring, time remaining.',
    endpoint: '/api/tournaments',
    method: 'GET',
    params: [],
    category: 'info',
  },
  {
    name: 'events',
    description: 'Active world events (resource boosts, danger zones, rare spawns).',
    endpoint: '/api/world/events',
    method: 'GET',
    params: [],
    category: 'info',
  },
  {
    name: 'market_orders',
    description: 'List open market orders.',
    endpoint: '/api/market/orders',
    method: 'GET',
    params: [],
    category: 'info',
  },
  {
    name: 'recipes',
    description: 'List craftable recipes and shop items.',
    endpoint: '/api/crafting/recipes',
    method: 'GET',
    params: [],
    category: 'info',
  },
  {
    name: 'forum_threads',
    description: 'List forum threads.',
    endpoint: '/api/forum/threads',
    method: 'GET',
    params: [],
    category: 'info',
  },
];

// -- Helpers --

export const ACTION_NAMES = ACTION_TOOLS.map((t) => t.name);

export function getActionTool(name: string): ToolDef | undefined {
  return ACTION_TOOLS.find((t) => t.name === name);
}

export function getToolsByCategory(category: ToolDef['category']): ToolDef[] {
  return ACTION_TOOLS.filter((t) => t.category === category);
}

/** Generate a concise action reference for the system prompt. */
export function generateActionReference(): string {
  const lines: string[] = [];
  for (const tool of ACTION_TOOLS) {
    const paramStr = tool.params
      .filter((p) => p.required)
      .map((p) => `"${p.name}":"..."`)
      .join(', ');
    const optionalStr = tool.params
      .filter((p) => !p.required)
      .map((p) => `"${p.name}"?`)
      .join(', ');
    const allParams = [paramStr, optionalStr].filter(Boolean).join(', ');
    lines.push(`- ${tool.name}: ${tool.description}`);
    lines.push(`  {"action":"${tool.name}"${allParams ? `, ${allParams}` : ''}, "reasoning":"..."}`);
  }
  return lines.join('\n');
}
