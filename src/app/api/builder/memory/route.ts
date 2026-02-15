import { NextRequest, NextResponse } from 'next/server';
import { createAuthServerClient } from '@/lib/supabase-auth-server';
import {
  distillAgentMemory,
  getAgentMemory,
  isOpenClawConfigured,
  resetAgentMemory,
  updateAgentMemory,
} from '@/lib/openclaw';

async function requireOwnedConfig(configId: string, userId: string) {
  const supabase = await createAuthServerClient();
  const { data: config, error } = await supabase
    .from('agent_configs')
    .select('id, user_id')
    .eq('id', configId)
    .eq('user_id', userId)
    .single();

  if (error || !config) return null;
  return config;
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
    const configId = (url.searchParams.get('config_id') || '').trim();
    if (!configId) {
      return NextResponse.json({ error: 'Missing config_id' }, { status: 400 });
    }

    const config = await requireOwnedConfig(configId, user.id);
    if (!config) {
      return NextResponse.json({ error: 'Config not found' }, { status: 404 });
    }

    const result = await getAgentMemory(config.id);
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to fetch memory', details: result.details || null },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      config_id: config.id,
      content: result.content || '',
      state: result.state || null,
    });
  } catch (error) {
    console.error('Builder memory GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch memory' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    if (!isOpenClawConfigured()) {
      return NextResponse.json({ error: 'OpenClaw gateway not configured' }, { status: 503 });
    }

    const supabase = await createAuthServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as {
      config_id?: string;
      content?: string;
    };
    const configId = (body.config_id || '').trim();
    const content = typeof body.content === 'string' ? body.content : '';

    if (!configId) {
      return NextResponse.json({ error: 'Missing config_id' }, { status: 400 });
    }

    const config = await requireOwnedConfig(configId, user.id);
    if (!config) {
      return NextResponse.json({ error: 'Config not found' }, { status: 404 });
    }

    const result = await updateAgentMemory(config.id, content);
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to update memory', details: result.details || null },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      config_id: config.id,
      content: result.content || '',
      state: result.state || null,
    });
  } catch (error) {
    console.error('Builder memory PUT error:', error);
    return NextResponse.json({ error: 'Failed to update memory' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isOpenClawConfigured()) {
      return NextResponse.json({ error: 'OpenClaw gateway not configured' }, { status: 503 });
    }

    const supabase = await createAuthServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as {
      config_id?: string;
      action?: string;
      mode?: 'soft' | 'hard';
    };
    const configId = (body.config_id || '').trim();
    const action = (body.action || '').trim().toLowerCase();

    if (!configId || !action) {
      return NextResponse.json({ error: 'Missing config_id or action' }, { status: 400 });
    }

    const config = await requireOwnedConfig(configId, user.id);
    if (!config) {
      return NextResponse.json({ error: 'Config not found' }, { status: 404 });
    }

    if (action === 'distill') {
      const result = await distillAgentMemory(config.id);
      if (!result.success) {
        return NextResponse.json(
          { error: result.error || 'Failed to distill memory', details: result.details || null },
          { status: 502 }
        );
      }

      return NextResponse.json({
        success: true,
        action,
        config_id: config.id,
        content: result.content || '',
        state: result.state || null,
      });
    }

    if (action === 'reset') {
      const mode = body.mode === 'hard' ? 'hard' : 'soft';
      const result = await resetAgentMemory(config.id, mode);
      if (!result.success) {
        return NextResponse.json(
          { error: result.error || 'Failed to reset memory', details: result.details || null },
          { status: 502 }
        );
      }

      return NextResponse.json({
        success: true,
        action,
        mode,
        config_id: config.id,
        content: result.content || '',
        state: result.state || null,
      });
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  } catch (error) {
    console.error('Builder memory POST error:', error);
    return NextResponse.json({ error: 'Failed to process memory action' }, { status: 500 });
  }
}
