import { NextRequest } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { generateApiKey } from '@/lib/game-logic';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { STARTING_GOLD, STARTING_FOOD, WORLD_SIZE } from '@/lib/types';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  try {
    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== 'string') {
      return errorResponse('Name is required');
    }

    // Validate name format
    if (name.length < 2 || name.length > 32) {
      return errorResponse('Name must be between 2 and 32 characters');
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return errorResponse('Name can only contain letters, numbers, underscores, and hyphens');
    }

    const supabase = createServerClient();

    // Check agent limit
    const [{ count: agentCount }, { data: limitSetting }] = await Promise.all([
      supabase.from('agents').select('*', { count: 'exact', head: true }),
      supabase.from('game_settings').select('value').eq('key', 'agent_limit').single(),
    ]);

    const agentLimit = limitSetting?.value ? Number(limitSetting.value) : 1000;
    const currentCount = agentCount ?? 0;

    if (currentCount >= agentLimit) {
      return errorResponse(
        `Registration is currently closed. The maximum number of agents (${agentLimit}) has been reached.`,
        503
      );
    }

    // Check if name already exists
    const { data: existingAgent } = await supabase
      .from('agents')
      .select('id')
      .eq('name', name)
      .single();

    if (existingAgent) {
      return errorResponse('An agent with this name already exists', 409);
    }

    // Generate API key
    const apiKey = generateApiKey();

    // Random starting position (avoiding edges)
    const startX = Math.floor(Math.random() * (WORLD_SIZE - 10)) + 5;
    const startY = Math.floor(Math.random() * (WORLD_SIZE - 10)) + 5;

    // Create agent
    const { data: agent, error } = await supabase
      .from('agents')
      .insert({
        name,
        api_key: apiKey,
        x: startX,
        y: startY,
        gold: STARTING_GOLD,
        wood: 0,
        food: STARTING_FOOD,
        stone: 0,
        reputation: 0,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating agent:', error);
      return errorResponse('Failed to create agent', 500);
    }

    // Log join event
    await supabase.from('events').insert({
      agent_id: agent.id,
      type: 'join',
      data: { name: agent.name },
      location: { x: agent.x, y: agent.y },
    });

    return jsonResponse({
      success: true,
      data: {
        id: agent.id,
        name: agent.name,
        api_key: apiKey,
        x: agent.x,
        y: agent.y,
        gold: agent.gold,
        wood: agent.wood,
        food: agent.food,
        stone: agent.stone,
        reputation: agent.reputation,
        message: 'Welcome to ClawCity! Save your API key - you will need it to authenticate.',
      },
    }, 201);
  } catch (error) {
    console.error('Registration error:', error);
    return errorResponse('Internal server error', 500);
  }
}
