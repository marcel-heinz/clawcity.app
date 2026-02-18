import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { progressNextWorldGeneration } from '@/lib/world-generation-worker';

function isAuthorizedAdmin(request: NextRequest): boolean {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return false;
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${adminKey}`;
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  if (!isAuthorizedAdmin(request)) {
    return errorResponse('Unauthorized - admin access required', 401);
  }

  try {
    const supabase = createServerClient();
    const [runtimeStateResult, activeValidationResult, nextValidationResult] = await Promise.all([
      supabase
        .from('world_runtime_state')
        .select('*')
        .eq('singleton', true)
        .single(),
      supabase.rpc('validate_world_table', { p_table_name: 'tiles', p_expect_clean: false }),
      supabase.rpc('validate_world_table', { p_table_name: 'tiles_next', p_expect_clean: false }),
    ]);

    return jsonResponse({
      success: true,
      data: {
        runtime_state: runtimeStateResult.data,
        active_world_validation: activeValidationResult.data,
        next_world_validation: nextValidationResult.data,
      },
    });
  } catch (error) {
    console.error('World generation status error:', error);
    return errorResponse('Internal server error', 500);
  }
}

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  if (!isAuthorizedAdmin(request)) {
    return errorResponse('Unauthorized - admin access required', 401);
  }

  try {
    const supabase = createServerClient();
    const body = await request.json().catch(() => ({}));
    const action = typeof body.action === 'string' ? body.action : 'step';
    const force = Boolean(body.force);

    if (action === 'prepare') {
      const { data, error } = await supabase.rpc('world_prepare_next_generation', {
        p_force: force,
      });

      if (error) {
        return errorResponse(`Failed to prepare next world generation: ${error.message}`, 500);
      }

      return jsonResponse({
        success: true,
        data: {
          message: force
            ? 'Force-reinitialized next world generation'
            : 'Prepared/resumed next world generation',
          state: data,
        },
      });
    }

    if (action === 'step' || action === 'prepare_and_step') {
      const result = await progressNextWorldGeneration({
        supabase,
        forceRestart: action === 'prepare_and_step' && force,
      });

      const statusCode = result.status === 'failed' ? 500 : 200;
      return jsonResponse(
        {
          success: result.status !== 'failed',
          data: {
            message: result.message,
            status: result.status,
            detail: result.detail,
          },
        },
        statusCode
      );
    }

    return errorResponse('Invalid action. Use: prepare, step, prepare_and_step', 400);
  } catch (error) {
    console.error('World generation action error:', error);
    return errorResponse('Internal server error', 500);
  }
}
