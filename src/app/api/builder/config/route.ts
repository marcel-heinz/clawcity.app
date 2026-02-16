import { NextRequest, NextResponse } from 'next/server';
import { createAuthServerClient } from '@/lib/supabase-auth-server';
import { generateSoulMarkdown } from '@/lib/agent-soul';

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
      .select('tier, max_agents, monthly_credit_limit, credits_used, llm_calls_used, autoplay_calls_used, credits_cycle_end')
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

    const normalizedConfig = config
      ? {
          ...config,
          auto_mode_enabled: config.auto_mode_enabled !== false,
          soul_md:
            typeof config.soul_md === 'string' && config.soul_md.trim()
              ? config.soul_md
              : generateSoulMarkdown(
                  config.agent_name,
                  config.personality_preset,
                  config.custom_instructions
                ),
        }
      : null;

    const normalizedProfile = profile
      ? {
          ...profile,
          monthly_credit_limit: Number(profile.monthly_credit_limit || 0),
          credits_used: Number(profile.credits_used || 0),
          llm_calls_used: Number(profile.llm_calls_used || 0),
          autoplay_calls_used: Number(profile.autoplay_calls_used || 0),
        }
      : null;

    return NextResponse.json({
      config: normalizedConfig,
      profile: normalizedProfile,
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
    const soulMd =
      typeof body.soul_md === 'string' && body.soul_md.trim()
        ? body.soul_md
        : generateSoulMarkdown(
            body.agent_name || '',
            body.personality_preset,
            body.custom_instructions
          );

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
        soul_md: soulMd,
        auto_mode_enabled: body.auto_mode_enabled !== false,
        preferred_mode: body.preferred_mode === 'open_world' ? 'open_world' : 'tournament',
        preferred_world_id: typeof body.preferred_world_id === 'string' ? body.preferred_world_id : null,
        builder_version: 2,
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
    const soulMd =
      typeof body.soul_md === 'string' && body.soul_md.trim()
        ? body.soul_md
        : generateSoulMarkdown(
            body.agent_name || '',
            body.personality_preset,
            body.custom_instructions
          );

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
        soul_md: soulMd,
        auto_mode_enabled: body.auto_mode_enabled !== false,
        preferred_mode: body.preferred_mode === 'open_world' ? 'open_world' : 'tournament',
        preferred_world_id: typeof body.preferred_world_id === 'string' ? body.preferred_world_id : null,
        builder_version: 2,
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
