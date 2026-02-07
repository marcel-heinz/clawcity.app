import { NextRequest, NextResponse } from 'next/server';
import { createAuthServerClient } from '@/lib/supabase-auth-server';
import { createServerClient } from '@/lib/supabase';
import { generateApiKey, hashToken } from '@/lib/game-logic';
import { WORLD_SIZE, STARTING_GOLD, STARTING_FOOD } from '@/lib/types';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const authSupabase = await createAuthServerClient();
    const { data: { user } } = await authSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { config_id } = await request.json();
    if (!config_id) {
      return NextResponse.json({ error: 'Missing config_id' }, { status: 400 });
    }

    // Use service role client for full access
    const supabase = createServerClient();

    // Verify ownership and get config
    const { data: config } = await supabase
      .from('agent_configs')
      .select('*')
      .eq('id', config_id)
      .eq('user_id', user.id)
      .single();

    if (!config) {
      return NextResponse.json({ error: 'Config not found' }, { status: 404 });
    }

    // Check tier
    const { data: profile } = await supabase
      .from('users')
      .select('tier, max_agents')
      .eq('id', user.id)
      .single();

    if (!profile || profile.tier === 'free') {
      return NextResponse.json({ error: 'Upgrade required to deploy an agent' }, { status: 403 });
    }

    // Check active agent count
    const { count } = await supabase
      .from('agent_configs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_active', true);

    if ((count || 0) >= profile.max_agents) {
      return NextResponse.json({ error: 'Max active agents reached for your tier' }, { status: 403 });
    }

    let agentId = config.agent_id;

    // Create agent in the game if not already linked
    if (!agentId) {
      const apiKey = generateApiKey();
      const apiKeyHash = hashToken(apiKey);
      const startX = Math.floor(Math.random() * WORLD_SIZE);
      const startY = Math.floor(Math.random() * WORLD_SIZE);

      const { data: agent, error: agentError } = await supabase
        .from('agents')
        .insert({
          name: config.agent_name,
          api_key: '', // Don't store plaintext
          api_key_hash: apiKeyHash,
          x: startX,
          y: startY,
          gold: STARTING_GOLD,
          food: STARTING_FOOD,
          wood: 0,
          stone: 0,
          reputation: 0,
        })
        .select('id')
        .single();

      if (agentError) {
        return NextResponse.json({ error: 'Failed to create agent: ' + agentError.message }, { status: 500 });
      }

      agentId = agent.id;

      // Encrypt the API key for the worker
      const encryptionKey = process.env.AGENT_KEY_ENCRYPTION_SECRET || 'default-dev-key-change-in-prod!!';
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(encryptionKey.padEnd(32).slice(0, 32)), iv);
      let encrypted = cipher.update(apiKey, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const encryptedKey = iv.toString('hex') + ':' + encrypted;

      await supabase
        .from('agent_configs')
        .update({
          agent_id: agentId,
          agent_api_key_encrypted: encryptedKey,
        })
        .eq('id', config_id);

      // Also insert into agents_realtime
      await supabase
        .from('agents_realtime')
        .upsert({
          id: agentId,
          name: config.agent_name,
          x: startX,
          y: startY,
          gold: STARTING_GOLD,
          food: STARTING_FOOD,
          wood: 0,
          stone: 0,
          reputation: 0,
        });
    }

    // Activate
    await supabase
      .from('agent_configs')
      .update({ is_active: true })
      .eq('id', config_id);

    return NextResponse.json({ success: true, agent_id: agentId });
  } catch (error) {
    console.error('Deploy error:', error);
    return NextResponse.json({ error: 'Deployment failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authSupabase = await createAuthServerClient();
    const { data: { user } } = await authSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { config_id } = await request.json();
    if (!config_id) {
      return NextResponse.json({ error: 'Missing config_id' }, { status: 400 });
    }

    const supabase = createServerClient();

    await supabase
      .from('agent_configs')
      .update({ is_active: false })
      .eq('id', config_id)
      .eq('user_id', user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Stop error:', error);
    return NextResponse.json({ error: 'Failed to stop agent' }, { status: 500 });
  }
}
