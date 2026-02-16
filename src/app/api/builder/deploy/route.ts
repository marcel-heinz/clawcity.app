import { NextRequest, NextResponse } from 'next/server';
import { createAuthServerClient } from '@/lib/supabase-auth-server';
import { createServerClient } from '@/lib/supabase';
import { generateApiKey, hashToken } from '@/lib/game-logic';
import { WORLD_SIZE, STARTING_GOLD, STARTING_FOOD } from '@/lib/types';
import { provisionAgent, deprovisionAgent, updateAgent, isOpenClawConfigured } from '@/lib/openclaw';
import { generateSoulMarkdown } from '@/lib/agent-soul';
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
    let plainApiKey: string | null = null;

    // Create agent in the game if not already linked
    if (!agentId) {
      const apiKey = generateApiKey();
      plainApiKey = apiKey;
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

      await supabase
        .from('agent_context')
        .upsert({
          agent_id: agentId,
          mode: 'tournament',
          world_id: null,
          switched_at: new Date().toISOString(),
        });

      // Encrypt the API key for OpenClaw provisioning
      const encryptionKey = process.env.AGENT_KEY_ENCRYPTION_SECRET;
      if (!encryptionKey) {
        return NextResponse.json({ error: 'Server configuration error: encryption key not set' }, { status: 500 });
      }
      if (encryptionKey.length < 32) {
        return NextResponse.json({ error: 'Server configuration error: encryption key too short' }, { status: 500 });
      }
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

    // Provision OpenClaw agent
    if (!isOpenClawConfigured()) {
      return NextResponse.json({ error: 'OpenClaw gateway is not configured. Deployment is unavailable.' }, { status: 503 });
    }

    // For existing agents, we need to decrypt the API key for OpenClaw
    if (!plainApiKey && config.agent_api_key_encrypted) {
      const encryptionKey = process.env.AGENT_KEY_ENCRYPTION_SECRET;
      if (encryptionKey) {
        try {
          const [ivHex, encryptedHex] = config.agent_api_key_encrypted.split(':');
          const ivBuf = Buffer.from(ivHex, 'hex');
          const decipher = crypto.createDecipheriv(
            'aes-256-cbc',
            Buffer.from(encryptionKey.padEnd(32).slice(0, 32)),
            ivBuf
          );
          let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
          decrypted += decipher.final('utf8');
          plainApiKey = decrypted;
        } catch (e) {
          console.error('Failed to decrypt API key for OpenClaw:', e);
        }
      }
    }

    if (!plainApiKey) {
      return NextResponse.json({ error: 'Failed to resolve agent API key for provisioning' }, { status: 500 });
    }

    const soulMd =
      typeof config.soul_md === 'string' && config.soul_md.trim()
        ? config.soul_md
        : generateSoulMarkdown(
            config.agent_name,
            config.personality_preset,
            config.custom_instructions
          );

    const openclawResult = await provisionAgent({
      agentId: config_id, // Use config ID as the OpenClaw agent ID
      agentName: config.agent_name,
      apiKey: plainApiKey,
      personalityPreset: config.personality_preset || 'explorer',
      strategyExploration: config.strategy_exploration ?? 50,
      strategyTrading: config.strategy_trading ?? 50,
      strategyAggression: config.strategy_aggression ?? 50,
      strategySocial: config.strategy_social ?? 50,
      customInstructions: config.custom_instructions || '',
      soulMd,
      autoModeEnabled: config.auto_mode_enabled !== false,
      preferredMode: config.preferred_mode === 'open_world' ? 'open_world' : 'tournament',
      preferredWorldId: config.preferred_world_id || null,
    });

    if (!openclawResult.success) {
      console.error('OpenClaw provisioning failed:', openclawResult.error, openclawResult.details);
      return NextResponse.json({ error: 'OpenClaw provisioning failed: ' + (openclawResult.error || 'unknown error') }, { status: 502 });
    }

    // Activate
    await supabase
      .from('agent_configs')
      .update({
        is_active: true,
        engine: 'openclaw',
      })
      .eq('id', config_id);

    return NextResponse.json({
      success: true,
      agent_id: agentId,
      engine: 'openclaw',
    });
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

    const { data: config, error: configError } = await supabase
      .from('agent_configs')
      .select('id, user_id, is_active')
      .eq('id', config_id)
      .eq('user_id', user.id)
      .single();

    if (configError || !config) {
      return NextResponse.json({ error: 'Config not found' }, { status: 404 });
    }

    if (!isOpenClawConfigured()) {
      if (config.is_active) {
        return NextResponse.json(
          {
            success: false,
            stopped: false,
            verified_not_configured: false,
            hard_stop_confirmed: false,
            drain_verified: false,
            aborted_requests: 0,
            error: 'OpenClaw gateway not configured for runtime stop verification',
            details: 'runtime_unavailable',
          },
          { status: 503 }
        );
      }
      return NextResponse.json({
        success: true,
        stopped: true,
        verified_not_configured: true,
        hard_stop_confirmed: true,
        drain_verified: true,
        aborted_requests: 0,
        details: null,
      });
    }

    const stopResult = await deprovisionAgent(config_id);
    const verifiedNotConfigured = stopResult.verified_not_configured === true;
    const hardStopConfirmed = stopResult.hard_stop_confirmed === true;
    const drainVerified = stopResult.drain_verified === true;
    if (!stopResult.success || !verifiedNotConfigured || !hardStopConfirmed || !drainVerified) {
      console.error('OpenClaw deprovision failed:', stopResult.error, stopResult.details, {
        verified_not_configured: stopResult.verified_not_configured,
        hard_stop_confirmed: stopResult.hard_stop_confirmed,
        drain_verified: stopResult.drain_verified,
        aborted_requests: stopResult.aborted_requests,
      });
      return NextResponse.json(
        {
          success: false,
          stopped: false,
          verified_not_configured: verifiedNotConfigured,
          hard_stop_confirmed: hardStopConfirmed,
          drain_verified: drainVerified,
          error: stopResult.error || 'Failed to verify runtime stop',
          details: stopResult.details || stopResult.message || null,
          in_flight_at_stop: stopResult.in_flight_at_stop ?? null,
          aborted_requests: stopResult.aborted_requests ?? null,
        },
        { status: 502 }
      );
    }

    const { error: deactivateError } = await supabase
      .from('agent_configs')
      .update({ is_active: false })
      .eq('id', config_id)
      .eq('user_id', user.id);
    if (deactivateError) {
      console.error('Failed to persist stopped state:', deactivateError);
      return NextResponse.json(
        {
          success: false,
          stopped: false,
          verified_not_configured: true,
          hard_stop_confirmed: true,
          drain_verified: true,
          aborted_requests: stopResult.aborted_requests ?? null,
          error: 'Runtime stopped but failed to persist agent inactive state',
          details: deactivateError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      stopped: true,
      verified_not_configured: true,
      hard_stop_confirmed: true,
      drain_verified: true,
      details: stopResult.message || null,
      in_flight_at_stop: stopResult.in_flight_at_stop ?? false,
      aborted_requests: stopResult.aborted_requests ?? 0,
    });
  } catch (error) {
    console.error('Stop error:', error);
    return NextResponse.json({ error: 'Failed to stop agent' }, { status: 500 });
  }
}

// Update agent personality/strategy on OpenClaw when config changes
export async function PUT(request: NextRequest) {
  try {
    const authSupabase = await createAuthServerClient();
    const { data: { user } } = await authSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const configId = body.config_id;

    if (!configId) {
      return NextResponse.json({ error: 'Missing config_id' }, { status: 400 });
    }

    // Sync personality updates to OpenClaw
    if (isOpenClawConfigured() && body.is_active) {
      const soulMd =
        typeof body.soul_md === 'string' && body.soul_md.trim()
          ? body.soul_md
          : generateSoulMarkdown(
              body.agent_name || '',
              body.personality_preset,
              body.custom_instructions
            );

      await updateAgent(configId, {
        agentName: body.agent_name,
        personalityPreset: body.personality_preset,
        strategyExploration: body.strategy_exploration,
        strategyTrading: body.strategy_trading,
        strategyAggression: body.strategy_aggression,
        strategySocial: body.strategy_social,
        customInstructions: body.custom_instructions,
        soulMd,
        autoModeEnabled: body.auto_mode_enabled !== false,
        preferredMode: body.preferred_mode === 'open_world' ? 'open_world' : 'tournament',
        preferredWorldId: typeof body.preferred_world_id === 'string' ? body.preferred_world_id : null,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Deploy PUT error:', error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
