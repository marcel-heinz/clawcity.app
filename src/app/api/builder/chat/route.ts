import { NextRequest, NextResponse } from 'next/server';
import { createAuthServerClient } from '@/lib/supabase-auth-server';
import { chatWithAgent, isOpenClawConfigured } from '@/lib/openclaw';

export async function POST(request: NextRequest) {
  try {
    if (!isOpenClawConfigured()) {
      return NextResponse.json(
        { error: 'OpenClaw gateway not configured' },
        { status: 503 }
      );
    }

    const authSupabase = await createAuthServerClient();
    const { data: { user } } = await authSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { message } = await request.json();
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Missing message' }, { status: 400 });
    }

    // Get user's active agent config
    const { data: config } = await authSupabase
      .from('agent_configs')
      .select('id, agent_name, is_active')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!config) {
      return NextResponse.json(
        { error: 'No active agent. Deploy your agent first.' },
        { status: 400 }
      );
    }

    // Send message to OpenClaw agent
    const response = await chatWithAgent(config.id, [
      { role: 'user', content: message },
    ]);

    if (response.error) {
      return NextResponse.json(
        {
          error: response.error,
          details: response.details || null,
        },
        {
          status:
            typeof response.status === 'number' && response.status >= 400
              ? response.status
              : 502,
        }
      );
    }

    const assistantMessage = response.choices?.[0]?.message?.content || 'No response from agent.';

    return NextResponse.json({
      success: true,
      response: assistantMessage,
      agentName: config.agent_name,
    });
  } catch (error) {
    console.error('Chat error:', error);
    return NextResponse.json({ error: 'Chat failed' }, { status: 500 });
  }
}
