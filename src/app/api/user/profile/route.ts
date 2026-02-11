import { NextResponse } from 'next/server';
import { createAuthServerClient } from '@/lib/supabase-auth-server';
import { createServerClient } from '@/lib/supabase';

export async function GET() {
  try {
    const authSupabase = await createAuthServerClient();
    const { data: { user } } = await authSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServerClient();

    // Fetch profile
    const { data: profile } = await supabase
      .from('users')
      .select('tier, max_decisions_per_day, decisions_used_today, stripe_subscription_id')
      .eq('id', user.id)
      .single();

    // Fetch active config
    const { data: config } = await supabase
      .from('agent_configs')
      .select('id, agent_name, is_active, agent_id, personality_preset, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Fetch agent data if linked
    let agent = null;
    if (config?.agent_id) {
      const { data: agentData } = await supabase
        .from('agents')
        .select('x, y, gold, wood, food, stone, reputation, last_active')
        .eq('id', config.agent_id)
        .single();
      agent = agentData;
    }

    return NextResponse.json({
      success: true,
      data: { profile, config, agent },
    });
  } catch (error) {
    console.error('Profile error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
