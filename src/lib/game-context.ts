import { createServerClient } from '@/lib/supabase';
import { Agent, AgentContext } from '@/lib/types';

export type GameplayMode = 'tournament' | 'open_world';

export interface GameplayContext extends AgentContext {
  mode: GameplayMode;
}

const DEFAULT_CONTEXT: GameplayContext = {
  mode: 'tournament',
  world_id: null,
  world_name: null,
  switched_at: new Date(0).toISOString(),
};

function mapContextRow(row: Record<string, unknown> | null): GameplayContext {
  if (!row) return { ...DEFAULT_CONTEXT, switched_at: new Date().toISOString() };

  const modeRaw = typeof row.mode === 'string' ? row.mode : 'tournament';
  const mode: GameplayMode = modeRaw === 'open_world' ? 'open_world' : 'tournament';
  const world = row.open_worlds as { name?: string } | null;

  return {
    mode,
    world_id: typeof row.world_id === 'string' ? row.world_id : null,
    world_name: world?.name || null,
    switched_at:
      typeof row.switched_at === 'string'
        ? row.switched_at
        : new Date().toISOString(),
  };
}

export async function resolveGameplayContext(agentId: string): Promise<GameplayContext> {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('agent_context')
    .select('mode, world_id, switched_at, open_worlds (name)')
    .eq('agent_id', agentId)
    .single();

  if (!error && data) {
    return mapContextRow(data as unknown as Record<string, unknown>);
  }

  await supabase.from('agent_context').upsert({
    agent_id: agentId,
    mode: 'tournament',
    world_id: null,
    switched_at: new Date().toISOString(),
  });

  return {
    mode: 'tournament',
    world_id: null,
    world_name: null,
    switched_at: new Date().toISOString(),
  };
}

export async function setTournamentContext(agentId: string): Promise<GameplayContext> {
  const switchedAt = new Date().toISOString();
  const supabase = createServerClient();

  await supabase.from('agent_context').upsert({
    agent_id: agentId,
    mode: 'tournament',
    world_id: null,
    switched_at: switchedAt,
  });

  return {
    mode: 'tournament',
    world_id: null,
    world_name: null,
    switched_at: switchedAt,
  };
}

export async function setOpenWorldContext(agentId: string, worldId: string): Promise<GameplayContext> {
  const switchedAt = new Date().toISOString();
  const supabase = createServerClient();

  const { data: world } = await supabase
    .from('open_worlds')
    .select('id, name')
    .eq('id', worldId)
    .eq('status', 'active')
    .single();

  if (!world) {
    throw new Error('Open world not found or not active');
  }

  await supabase.from('agent_context').upsert({
    agent_id: agentId,
    mode: 'open_world',
    world_id: worldId,
    switched_at: switchedAt,
  });

  return {
    mode: 'open_world',
    world_id: worldId,
    world_name: world.name,
    switched_at: switchedAt,
  };
}

export async function refreshOpenWorldActiveAgentCount(worldId: string): Promise<number> {
  const supabase = createServerClient();
  const { count } = await supabase
    .from('agent_context')
    .select('*', { count: 'exact', head: true })
    .eq('mode', 'open_world')
    .eq('world_id', worldId);

  const activeCount = count || 0;
  await supabase
    .from('open_worlds')
    .update({ active_agents: activeCount })
    .eq('id', worldId);

  return activeCount;
}

function baseAgentToOpenWorldState(baseAgent: Agent, worldId: string): Record<string, unknown> {
  return {
    world_id: worldId,
    agent_id: baseAgent.id,
    x: baseAgent.x,
    y: baseAgent.y,
    gold: baseAgent.gold,
    wood: baseAgent.wood,
    food: baseAgent.food,
    stone: baseAgent.stone,
    reputation: baseAgent.reputation,
    claimed: baseAgent.claimed || false,
    claimed_by_twitter: baseAgent.claimed_by_twitter || null,
    avatar: baseAgent.avatar || {},
    last_active: baseAgent.last_active,
    last_move_at: baseAgent.last_move_at || null,
    last_gather_at: baseAgent.last_gather_at || null,
    last_trade_at: baseAgent.last_trade_at || null,
    last_forum_thread_at: baseAgent.last_forum_thread_at || null,
    last_forum_post_at: baseAgent.last_forum_post_at || null,
    total_gathered_gold: baseAgent.total_gathered_gold || 0,
    total_gathered_wood: baseAgent.total_gathered_wood || 0,
    total_gathered_food: baseAgent.total_gathered_food || 0,
    total_gathered_stone: baseAgent.total_gathered_stone || 0,
    last_food_upkeep_at: baseAgent.last_food_upkeep_at || null,
    food_depleted_at: baseAgent.food_depleted_at || null,
    last_announcement_seen_at: baseAgent.last_announcement_seen_at || null,
    last_gather_x: baseAgent.last_gather_x || null,
    last_gather_y: baseAgent.last_gather_y || null,
    consecutive_same_tile: baseAgent.consecutive_same_tile || 0,
    last_craft_at: baseAgent.last_craft_at || null,
    last_build_at: baseAgent.last_build_at || null,
  };
}

function mapOpenWorldStateToAgent(row: Record<string, unknown>, baseAgent: Agent): Agent {
  return {
    ...baseAgent,
    x: Number(row.x ?? baseAgent.x),
    y: Number(row.y ?? baseAgent.y),
    gold: Number(row.gold ?? baseAgent.gold),
    wood: Number(row.wood ?? baseAgent.wood),
    food: Number(row.food ?? baseAgent.food),
    stone: Number(row.stone ?? baseAgent.stone),
    reputation: Number(row.reputation ?? baseAgent.reputation),
    claimed: Boolean(row.claimed ?? baseAgent.claimed ?? false),
    claimed_by_twitter: (row.claimed_by_twitter as string | null) || null,
    avatar: (row.avatar as Agent['avatar']) || baseAgent.avatar,
    last_active: (row.last_active as string) || baseAgent.last_active,
    last_move_at: (row.last_move_at as string | null) || null,
    last_gather_at: (row.last_gather_at as string | null) || null,
    last_trade_at: (row.last_trade_at as string | null) || null,
    last_forum_thread_at: (row.last_forum_thread_at as string | null) || null,
    last_forum_post_at: (row.last_forum_post_at as string | null) || null,
    total_gathered_gold: Number(row.total_gathered_gold ?? 0),
    total_gathered_wood: Number(row.total_gathered_wood ?? 0),
    total_gathered_food: Number(row.total_gathered_food ?? 0),
    total_gathered_stone: Number(row.total_gathered_stone ?? 0),
    last_food_upkeep_at: (row.last_food_upkeep_at as string | null) || null,
    food_depleted_at: (row.food_depleted_at as string | null) || null,
    last_announcement_seen_at: (row.last_announcement_seen_at as string | null) || null,
    last_gather_x: (row.last_gather_x as number | null) ?? null,
    last_gather_y: (row.last_gather_y as number | null) ?? null,
    consecutive_same_tile: Number(row.consecutive_same_tile ?? 0),
    last_craft_at: (row.last_craft_at as string | null) || null,
    last_build_at: (row.last_build_at as string | null) || null,
  };
}

export async function resolveAgentForContext(
  baseAgent: Agent,
  context: GameplayContext
): Promise<Agent> {
  if (context.mode !== 'open_world' || !context.world_id) {
    return baseAgent;
  }

  const supabase = createServerClient();

  const { data: existingState, error } = await supabase
    .from('open_world_agent_state')
    .select('*')
    .eq('world_id', context.world_id)
    .eq('agent_id', baseAgent.id)
    .single();

  let state = existingState;

  if (error || !state) {
    const payload = baseAgentToOpenWorldState(baseAgent, context.world_id);
    const { data: inserted } = await supabase
      .from('open_world_agent_state')
      .upsert(payload)
      .select('*')
      .eq('world_id', context.world_id)
      .eq('agent_id', baseAgent.id)
      .single();

    state = inserted || payload;
  }

  return mapOpenWorldStateToAgent(state as Record<string, unknown>, baseAgent);
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export function gameplayTableName(
  baseTable: 'agents' | 'tiles' | 'events' | 'trades' | 'agent_items',
  context: GameplayContext
): string {
  if (context.mode !== 'open_world') {
    return baseTable;
  }

  switch (baseTable) {
    case 'agents':
      return 'open_world_agent_state';
    case 'tiles':
      return 'open_world_tiles';
    case 'events':
      return 'open_world_events';
    case 'trades':
      return 'open_world_trades';
    case 'agent_items':
      return 'open_world_agent_items';
    default:
      return baseTable;
  }
}

export function scopeAgentMutation(
  query: any,
  context: GameplayContext,
  agentId: string
): any {
  if (context.mode !== 'open_world' || !context.world_id) {
    return query.eq('id', agentId);
  }

  return query.eq('world_id', context.world_id).eq('agent_id', agentId);
}

export function scopeAgentSelect(
  query: any,
  context: GameplayContext,
  agentId: string
): any {
  if (context.mode !== 'open_world' || !context.world_id) {
    return query.eq('id', agentId);
  }

  return query.eq('world_id', context.world_id).eq('agent_id', agentId);
}

export function scopeTileQuery(
  query: any,
  context: GameplayContext,
  x: number,
  y: number
): any {
  if (context.mode !== 'open_world' || !context.world_id) {
    return query.eq('x', x).eq('y', y);
  }

  return query.eq('world_id', context.world_id).eq('x', x).eq('y', y);
}

export function scopeWorldQuery(
  query: any,
  context: GameplayContext
): any {
  if (context.mode !== 'open_world' || !context.world_id) {
    return query;
  }

  return query.eq('world_id', context.world_id);
}
