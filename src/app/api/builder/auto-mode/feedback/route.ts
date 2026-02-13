import { NextRequest, NextResponse } from 'next/server';
import { createAuthServerClient } from '@/lib/supabase-auth-server';
import { getAgentAutoplayFeedback, isOpenClawConfigured } from '@/lib/openclaw';

function parseLimit(raw: string | null): number {
  const parsed = parseInt(raw || '50', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(parsed, 100);
}

export async function GET(request: NextRequest) {
  try {
    if (!isOpenClawConfigured()) {
      return NextResponse.json({ error: 'OpenClaw gateway not configured' }, { status: 503 });
    }

    const supabase = await createAuthServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const configId = url.searchParams.get('config_id');
    const limit = parseLimit(url.searchParams.get('limit'));

    if (!configId) {
      return NextResponse.json({ error: 'Missing config_id' }, { status: 400 });
    }

    const { data: config, error: configError } = await supabase
      .from('agent_configs')
      .select('id')
      .eq('id', configId)
      .eq('user_id', user.id)
      .single();

    if (configError || !config) {
      return NextResponse.json({ error: 'Config not found' }, { status: 404 });
    }

    const feedback = await getAgentAutoplayFeedback(config.id, limit);
    if (!feedback.success) {
      return NextResponse.json(
        { error: feedback.error || 'Failed to fetch feedback', details: feedback.details || null },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      config_id: config.id,
      entries: feedback.entries,
    });
  } catch (error) {
    console.error('Auto-mode feedback error:', error);
    return NextResponse.json({ error: 'Failed to fetch auto-mode feedback' }, { status: 500 });
  }
}
