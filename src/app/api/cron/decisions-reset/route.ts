import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sets this header for cron jobs)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createServerClient();
    await supabase.rpc('reset_daily_decisions');

    return NextResponse.json({ success: true, message: 'Daily decisions reset' });
  } catch (error) {
    console.error('Decisions reset error:', error);
    return NextResponse.json({ error: 'Reset failed' }, { status: 500 });
  }
}
