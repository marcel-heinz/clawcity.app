import { SupabaseClient } from '@supabase/supabase-js';
import { createServerClient, isSupabaseConfigured } from './supabase';
import {
  DEFAULT_WORLD_GEN_CONFIG,
  normalizeWorldGenConfig,
  type WorldGenConfig,
} from './game-logic';

export type NextWorldStatus = 'empty' | 'generating' | 'ready' | 'failed';

export interface WorldRuntimeState {
  active_design_no: number;
  active_seed: number;
  active_config: WorldGenConfig;
  next_design_no: number | null;
  next_seed: number | null;
  next_config: WorldGenConfig | null;
  next_status: NextWorldStatus;
  next_cursor_y: number;
  next_generated_rows: number;
  next_last_error: string | null;
}

function parseWorldConfig(value: unknown): WorldGenConfig {
  if (!value || typeof value !== 'object') {
    return DEFAULT_WORLD_GEN_CONFIG;
  }
  return normalizeWorldGenConfig(value as Partial<WorldGenConfig>);
}

export async function getWorldRuntimeState(
  supabase?: SupabaseClient
): Promise<WorldRuntimeState | null> {
  if (!isSupabaseConfigured) return null;

  try {
    const client = supabase ?? createServerClient();
    const { data, error } = await client
      .from('world_runtime_state')
      .select(
        'active_design_no, active_seed, active_config, next_design_no, next_seed, next_config, next_status, next_cursor_y, next_generated_rows, next_last_error'
      )
      .eq('singleton', true)
      .single();

    if (error || !data) {
      return null;
    }

    const row = data as Record<string, unknown>;
    const nextStatus = (row.next_status as NextWorldStatus | undefined) ?? 'empty';

    return {
      active_design_no: Number(row.active_design_no ?? 1),
      active_seed: Number(row.active_seed ?? DEFAULT_WORLD_GEN_CONFIG.seed),
      active_config: parseWorldConfig(row.active_config),
      next_design_no: row.next_design_no === null ? null : Number(row.next_design_no),
      next_seed: row.next_seed === null ? null : Number(row.next_seed),
      next_config: row.next_config === null ? null : parseWorldConfig(row.next_config),
      next_status: nextStatus,
      next_cursor_y: Number(row.next_cursor_y ?? 0),
      next_generated_rows: Number(row.next_generated_rows ?? 0),
      next_last_error: typeof row.next_last_error === 'string' ? row.next_last_error : null,
    };
  } catch {
    return null;
  }
}

export async function getActiveWorldConfig(
  supabase?: SupabaseClient
): Promise<WorldGenConfig> {
  const state = await getWorldRuntimeState(supabase);
  return state?.active_config ?? DEFAULT_WORLD_GEN_CONFIG;
}

export async function getNextWorldConfig(
  supabase?: SupabaseClient
): Promise<{ config: WorldGenConfig | null; status: NextWorldStatus; designNo: number | null }> {
  const state = await getWorldRuntimeState(supabase);
  if (!state) {
    return { config: null, status: 'empty', designNo: null };
  }
  return {
    config: state.next_config,
    status: state.next_status,
    designNo: state.next_design_no,
  };
}
