import { NextRequest, NextResponse } from 'next/server';
import { createAuthServerClient } from '@/lib/supabase-auth-server';
import { getAutoplayStatus, isOpenClawConfigured } from '@/lib/openclaw';

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
    if (!configId) {
      return NextResponse.json({ error: 'Missing config_id' }, { status: 400 });
    }

    const { data: config, error: configError } = await supabase
      .from('agent_configs')
      .select('id, user_id, auto_mode_enabled')
      .eq('id', configId)
      .eq('user_id', user.id)
      .single();

    if (configError || !config) {
      return NextResponse.json({ error: 'Config not found' }, { status: 404 });
    }

    const statusResult = await getAutoplayStatus();
    if (!statusResult.success || !statusResult.status) {
      return NextResponse.json(
        { error: statusResult.error || 'Failed to fetch status', details: statusResult.details || null },
        { status: 502 }
      );
    }

    const agentStatus = statusResult.status.agents.find((entry) => entry.agent_id === config.id) || null;
    const effectiveEnabled = Boolean(
      statusResult.status.enabled &&
      statusResult.status.gateway?.ready !== false &&
      config.auto_mode_enabled !== false &&
      agentStatus?.enabled !== false
    );

    return NextResponse.json({
      success: true,
      config_id: config.id,
      scheduler: {
        enabled: effectiveEnabled,
        global_enabled: statusResult.status.enabled,
        interval_ms: statusResult.status.interval_ms,
        timeout_ms: statusResult.status.timeout_ms,
        pass: statusResult.status.pass || null,
        next_tick_at: agentStatus?.next_tick_at || statusResult.status.next_tick_at || null,
        in_flight: Boolean(agentStatus?.in_flight),
        deferred_once: Boolean(agentStatus?.deferred_once),
        last_tick_started_at: agentStatus?.last_tick_started_at || statusResult.status.last_tick_started_at || null,
        last_tick_finished_at: agentStatus?.last_tick_finished_at || statusResult.status.last_tick_finished_at || null,
        last_tick_result: agentStatus?.last_tick_result || statusResult.status.last_tick_result || null,
        last_tick_error_code: agentStatus?.last_tick_error_code || statusResult.status.last_tick_error_code || null,
        memory: agentStatus?.memory || null,
        budget: agentStatus?.budget || null,
        gateway: statusResult.status.gateway || null,
      },
    });
  } catch (error) {
    console.error('Auto-mode status error:', error);
    return NextResponse.json({ error: 'Failed to fetch auto-mode status' }, { status: 500 });
  }
}
