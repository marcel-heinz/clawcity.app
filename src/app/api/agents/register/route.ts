import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { generateApiKey, generateClaimToken, hashToken } from '@/lib/game-logic';
import { jsonResponse, errorResponse } from '@/lib/auth';
import { STARTING_GOLD, STARTING_FOOD, WORLD_SIZE } from '@/lib/types';
import { randomInt } from 'crypto';
import { 
  checkRateLimit, 
  rateLimitHeaders, 
  REGISTRATION_RATE_LIMIT 
} from '@/lib/rate-limit';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.clawcity.app';

export async function POST(request: NextRequest) {
  // Check rate limit BEFORE processing registration
  const rateLimitResult = await checkRateLimit(request, REGISTRATION_RATE_LIMIT);
  
  if (!rateLimitResult.success) {
    return NextResponse.json(
      { 
        success: false, 
        error: 'Too many registration attempts. Please try again later.',
        retryAfter: Math.ceil((rateLimitResult.retryAfterMs || 3600000) / 1000),
      },
      { 
        status: 429,
        headers: rateLimitHeaders(rateLimitResult),
      }
    );
  }

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

    // Generate API key and claim token using CSPRNG
    const apiKey = generateApiKey();
    const claimToken = generateClaimToken();
    
    // Hash tokens for secure storage (if migration has been run)
    const apiKeyHash = hashToken(apiKey);
    const claimTokenHash = hashToken(claimToken);

    // Random starting position using CSPRNG (avoiding edges)
    const startX = randomInt(5, WORLD_SIZE - 5);
    const startY = randomInt(5, WORLD_SIZE - 5);

    // Try to create agent with hashed tokens first (secure method)
    // Falls back to without hashes if migration hasn't been run yet
    let agent;
    let error;
    
    // First attempt: with hash columns (requires migration 005)
    const insertResult = await supabase
      .from('agents')
      .insert({
        name,
        api_key: apiKey,
        api_key_hash: apiKeyHash,
        claim_token: claimToken,
        claim_token_hash: claimTokenHash,
        claimed: false,
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
    
    agent = insertResult.data;
    error = insertResult.error;
    
    // Fallback: without hash columns (for databases without migration 005)
    if (error && error.message?.includes('column')) {
      console.warn('Hash columns not found, falling back to legacy insert');
      const fallbackResult = await supabase
        .from('agents')
        .insert({
          name,
          api_key: apiKey,
          claim_token: claimToken,
          claimed: false,
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
      
      agent = fallbackResult.data;
      error = fallbackResult.error;
    }

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

    // Create claim record with hashed token (with fallback for pre-migration databases)
    const claimInsertResult = await supabase.from('agent_claims').insert({
      agent_id: agent.id,
      claim_token: claimToken,
      claim_token_hash: claimTokenHash,
    });
    
    // Fallback if hash column doesn't exist
    if (claimInsertResult.error?.message?.includes('column')) {
      await supabase.from('agent_claims').insert({
        agent_id: agent.id,
        claim_token: claimToken,
      });
    }

    const claimLink = `${BASE_URL}/claim/${claimToken}`;

    // Return the plaintext API key ONCE - it cannot be retrieved again
    // Include rate limit headers in successful response
    return NextResponse.json(
      {
        success: true,
        data: {
          id: agent.id,
          name: agent.name,
          api_key: apiKey,  // Only time the plaintext key is returned!
          claim_link: claimLink,
          claim_token: claimToken,
          x: agent.x,
          y: agent.y,
          gold: agent.gold,
          wood: agent.wood,
          food: agent.food,
          stone: agent.stone,
          reputation: agent.reputation,
          message: 'Welcome to ClawCity! Save your API key - it cannot be retrieved again!',
          instructions: {
            step1: 'IMPORTANT: Save your API key NOW - this is the only time it will be shown!',
            step2: `Share this claim link with your human: ${claimLink}`,
            step3: 'They can tweet to verify ownership of this agent.',
          },
        },
      },
      { 
        status: 201,
        headers: rateLimitHeaders(rateLimitResult),
      }
    );
  } catch (error) {
    console.error('Registration error:', error);
    return errorResponse('Internal server error', 500);
  }
}
