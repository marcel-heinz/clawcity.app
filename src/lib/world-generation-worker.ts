import { SupabaseClient } from '@supabase/supabase-js';
import {
  generateWorldTilesRange,
  normalizeWorldGenConfig,
  type WorldGenConfig,
} from './game-logic';
import { createServerClient, isSupabaseConfigured } from './supabase';

interface GenerationState {
  next_design_no: number | null;
  next_status: string;
  next_cursor_y: number;
  next_generated_rows: number;
  next_config: WorldGenConfig | null;
}

export interface WorldGenerationProgressResult {
  status: 'skipped' | 'progress' | 'ready' | 'failed';
  message: string;
  detail?: Record<string, unknown>;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const int = Math.floor(n);
  if (int <= 0) return fallback;
  return int;
}

function toGenerationState(value: unknown): GenerationState | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;

  const status = typeof row.next_status === 'string' ? row.next_status : 'empty';
  const cursor = Number(row.next_cursor_y ?? 0);
  const generatedRows = Number(row.next_generated_rows ?? 0);
  const designNo = row.next_design_no === null ? null : Number(row.next_design_no);
  const config = row.next_config === null
    ? null
    : normalizeWorldGenConfig(row.next_config as Partial<WorldGenConfig>);

  return {
    next_design_no: Number.isFinite(designNo as number) ? designNo : null,
    next_status: status,
    next_cursor_y: Number.isFinite(cursor) ? cursor : 0,
    next_generated_rows: Number.isFinite(generatedRows) ? generatedRows : 0,
    next_config: config,
  };
}

export async function progressNextWorldGeneration(
  options?: {
    supabase?: SupabaseClient;
    forceRestart?: boolean;
    chunkRows?: number;
    batchSize?: number;
  }
): Promise<WorldGenerationProgressResult> {
  if (!isSupabaseConfigured) {
    return {
      status: 'skipped',
      message: 'Skipped world generation: database not configured.',
    };
  }

  const supabase = options?.supabase ?? createServerClient();
  const forceRestart = options?.forceRestart === true;
  const chunkRows = Math.min(
    200,
    parsePositiveInt(process.env.WORLD_GEN_CHUNK_ROWS, options?.chunkRows ?? 10)
  );
  const batchSize = Math.min(
    2000,
    parsePositiveInt(process.env.WORLD_GEN_BATCH_SIZE, options?.batchSize ?? 500)
  );

  const { data: prepData, error: prepError } = await supabase.rpc('world_prepare_next_generation', {
    p_force: forceRestart,
  });

  if (prepError) {
    return {
      status: 'failed',
      message: 'Failed to prepare next-world generation state.',
      detail: { error: prepError.message },
    };
  }

  const prepState = toGenerationState(prepData);
  if (!prepState) {
    return {
      status: 'failed',
      message: 'Failed to parse next-world generation state.',
    };
  }

  if (prepState.next_status === 'ready') {
    return {
      status: 'ready',
      message: `Next world design #${prepState.next_design_no ?? '?'} already ready.`,
      detail: {
        next_design_no: prepState.next_design_no,
        rows: prepState.next_generated_rows,
      },
    };
  }

  if (prepState.next_status !== 'generating') {
    return {
      status: 'skipped',
      message: `Skipped world generation: status=${prepState.next_status}.`,
      detail: { next_design_no: prepState.next_design_no },
    };
  }

  if (!prepState.next_design_no || !prepState.next_config) {
    return {
      status: 'failed',
      message: 'Generation state is missing next design/config.',
      detail: { state: prepData as Record<string, unknown> },
    };
  }

  const startY = Math.max(0, Math.min(500, prepState.next_cursor_y));
  const endYExclusive = Math.min(500, startY + chunkRows);

  if (startY >= 500) {
    const { data: doneData, error: doneError } = await supabase.rpc('world_mark_next_generation_progress', {
      p_design_no: prepState.next_design_no,
      p_new_cursor_y: 500,
      p_last_error: null,
    });

    if (doneError) {
      return {
        status: 'failed',
        message: 'Failed to finalize next-world generation state.',
        detail: { error: doneError.message },
      };
    }

    const doneState = toGenerationState(doneData);
    return {
      status: doneState?.next_status === 'ready' ? 'ready' : 'progress',
      message: `Finalized generation state for design #${prepState.next_design_no}.`,
      detail: doneData as Record<string, unknown>,
    };
  }

  const tiles = generateWorldTilesRange(startY, endYExclusive, prepState.next_config);

  for (let i = 0; i < tiles.length; i += batchSize) {
    const batch = tiles.slice(i, i + batchSize);
    const { error } = await supabase
      .from('tiles_next')
      .upsert(batch, { onConflict: 'x,y' });

    if (error) {
      await supabase.rpc('world_mark_next_generation_progress', {
        p_design_no: prepState.next_design_no,
        p_new_cursor_y: startY,
        p_last_error: `insert_failed: ${error.message}`,
      });

      return {
        status: 'failed',
        message: `Failed inserting world chunk [${startY}, ${endYExclusive}).`,
        detail: {
          error: error.message,
          start_y: startY,
          end_y_exclusive: endYExclusive,
          next_design_no: prepState.next_design_no,
        },
      };
    }
  }

  const { data: progressData, error: progressError } = await supabase.rpc('world_mark_next_generation_progress', {
    p_design_no: prepState.next_design_no,
    p_new_cursor_y: endYExclusive,
    p_last_error: null,
  });

  if (progressError) {
    return {
      status: 'failed',
      message: 'Failed to update world generation progress.',
      detail: { error: progressError.message },
    };
  }

  const progressState = toGenerationState(progressData);
  const nowReady = progressState?.next_status === 'ready';

  return {
    status: nowReady ? 'ready' : 'progress',
    message: nowReady
      ? `Generated and validated next world design #${prepState.next_design_no}.`
      : `Generated world chunk [${startY}, ${endYExclusive}) for design #${prepState.next_design_no}.`,
    detail: {
      next_design_no: prepState.next_design_no,
      start_y: startY,
      end_y_exclusive: endYExclusive,
      next_status: progressState?.next_status ?? 'unknown',
      next_cursor_y: progressState?.next_cursor_y ?? endYExclusive,
      next_generated_rows: progressState?.next_generated_rows ?? undefined,
    },
  };
}
