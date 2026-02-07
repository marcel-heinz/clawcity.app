import { NextRequest, NextResponse } from 'next/server';
import { createAuthServerClient } from '@/lib/supabase-auth-server';

export async function GET() {
  try {
    const supabase = await createAuthServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch user profile
    const { data: profile } = await supabase
      .from('users')
      .select('tier, max_agents, max_decisions_per_day, decisions_used_today')
      .eq('id', user.id)
      .single();

    // Fetch existing config
    const { data: config } = await supabase
      .from('agent_configs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Fetch recent decisions if config exists
    let recentDecisions: unknown[] = [];
    if (config) {
      const { data: decisions } = await supabase
        .from('decision_log')
        .select('id, action, reasoning, decision_source, success, created_at')
        .eq('agent_config_id', config.id)
        .order('created_at', { ascending: false })
        .limit(20);

      recentDecisions = decisions || [];
    }

    return NextResponse.json({
      config: config || null,
      profile: profile || null,
      recent_decisions: recentDecisions,
    });
  } catch (error) {
    console.error('Config GET error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createAuthServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    // Check if user already has a config
    const { data: existing } = await supabase
      .from('agent_configs')
      .select('id')
      .eq('user_id', user.id)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({ error: 'Config already exists. Use PUT to update.' }, { status: 400 });
    }

    const { data: config, error } = await supabase
      .from('agent_configs')
      .insert({
        user_id: user.id,
        agent_name: body.agent_name,
        personality_preset: body.personality_preset || 'explorer',
        strategy_exploration: body.strategy_exploration ?? 50,
        strategy_trading: body.strategy_trading ?? 50,
        strategy_aggression: body.strategy_aggression ?? 50,
        strategy_social: body.strategy_social ?? 50,
        custom_instructions: body.custom_instructions || '',
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, config });
  } catch (error) {
    console.error('Config POST error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createAuthServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    const { data: config, error } = await supabase
      .from('agent_configs')
      .update({
        agent_name: body.agent_name,
        personality_preset: body.personality_preset || 'explorer',
        strategy_exploration: body.strategy_exploration ?? 50,
        strategy_trading: body.strategy_trading ?? 50,
        strategy_aggression: body.strategy_aggression ?? 50,
        strategy_social: body.strategy_social ?? 50,
        custom_instructions: body.custom_instructions || '',
      })
      .eq('user_id', user.id)
      .eq('id', body.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, config });
  } catch (error) {
    console.error('Config PUT error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
