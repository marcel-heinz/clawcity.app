import { NextRequest, NextResponse } from 'next/server';
import { createAuthServerClient } from '@/lib/supabase-auth-server';
import { isOpenClawConfigured, setAgentAutoplay } from '@/lib/openclaw';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createAuthServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { config_id: configId, enabled } = await request.json();
    if (!configId || typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'Missing config_id or enabled boolean' }, { status: 400 });
    }

    const { data: config, error: configError } = await supabase
      .from('agent_configs')
      .select('id, user_id, is_active, auto_mode_enabled')
      .eq('id', configId)
      .eq('user_id', user.id)
      .single();

    if (configError || !config) {
      return NextResponse.json({ error: 'Config not found' }, { status: 404 });
    }

    if (config.is_active) {
      if (!isOpenClawConfigured()) {
        return NextResponse.json(
          { error: 'OpenClaw gateway not configured for active agent sync' },
          { status: 503 }
        );
      }
      const syncResult = await setAgentAutoplay(config.id, enabled);
      if (!syncResult.success) {
        return NextResponse.json(
          { error: syncResult.error || 'Failed to update active agent autoplay', details: syncResult.details || null },
          { status: 502 }
        );
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from('agent_configs')
      .update({ auto_mode_enabled: enabled })
      .eq('id', config.id)
      .eq('user_id', user.id)
      .select('id, auto_mode_enabled, is_active')
      .single();

    if (updateError || !updated) {
      if (config.is_active && isOpenClawConfigured()) {
        await setAgentAutoplay(config.id, config.auto_mode_enabled !== false);
      }
      return NextResponse.json(
        { error: updateError?.message || 'Failed to persist auto-mode setting' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      config_id: updated.id,
      auto_mode_enabled: updated.auto_mode_enabled !== false,
      synced_active_agent: Boolean(updated.is_active),
    });
  } catch (error) {
    console.error('Auto-mode toggle error:', error);
    return NextResponse.json({ error: 'Failed to update auto-mode' }, { status: 500 });
  }
}
