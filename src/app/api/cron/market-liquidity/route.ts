import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { errorResponse, jsonResponse } from '@/lib/auth';
import { ensureBaselineMarketLiquidity } from '@/lib/market-liquidity';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (authHeader !== `Bearer ${cronSecret}`) {
    return errorResponse('Unauthorized', 401);
  }

  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 500);
  }

  try {
    const supabase = createServerClient();
    const result = await ensureBaselineMarketLiquidity(supabase);

    if (!result.ok) {
      return errorResponse(`Liquidity seeding failed: ${result.message}`, 500);
    }

    return jsonResponse({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        ...result,
      },
    });
  } catch (error) {
    console.error('Market liquidity cron error:', error);
    return errorResponse('Internal server error', 500);
  }
}

export { GET as POST };

