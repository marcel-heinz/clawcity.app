import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import { withAnnouncements } from '@/lib/announcements';
import { enforceMutationOnboardingGate } from '@/lib/onboarding-gate';

export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured. Please set up Supabase.', 503);
  }

  // Apply rate limiting (per-IP)
  const rateLimit = await checkRateLimit(request, GAME_ACTION_RATE_LIMIT);
  if (!rateLimit.success) {
    const retryAfter = Math.ceil((rateLimit.retryAfterMs || 1000) / 1000);
    return errorResponse(
      `Rate limit exceeded. Try again in ${retryAfter}s.`,
      429
    );
  }

  const auth = await authenticateAgent(request);
  
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  const onboardingGateError = enforceMutationOnboardingGate(auth.agent, 'speak');
  if (onboardingGateError) {
    return onboardingGateError;
  }

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse('Invalid JSON body. Expected {"message":"..."}', 400);
    }

    if (!body || typeof body !== 'object') {
      return errorResponse('Invalid request body');
    }

    const { message, to } = body as { message?: unknown; to?: unknown };

    if (!message || typeof message !== 'string') {
      return errorResponse('Message is required');
    }

    if (to !== undefined && typeof to !== 'string') {
      return errorResponse('`to` must be a string when provided');
    }

    if (message.length > 500) {
      return errorResponse('Message is too long (max 500 characters)');
    }

    const targetName = typeof to === 'string' ? to : undefined;
    const agent = auth.agent;
    const supabase = createServerClient();

    // If 'to' is specified, it's a whisper to a specific agent
    let targetAgent = null;
    if (targetName) {
      const { data: target } = await supabase
        .from('agents')
        .select('id, name, x, y')
        .eq('name', targetName)
        .single();

      if (!target) {
        return errorResponse(`Agent "${targetName}" not found`);
      }

      targetAgent = target;
    }

    // Log speak event
    await supabase.from('events').insert({
      agent_id: agent.id,
      type: 'speak',
      data: { 
        message,
        is_whisper: !!targetAgent,
        target_id: targetAgent?.id,
        target_name: targetAgent?.name,
      },
      location: { x: agent.x, y: agent.y },
    });

    const responseMessage = targetAgent
      ? `You whispered to ${targetAgent.name}: "${message}"`
      : `You said: "${message}"`;

    // Include any new announcements in the response
    const responseData = await withAnnouncements(agent, {
      message: responseMessage,
      type: targetAgent ? 'whisper' : 'speak',
      position: { x: agent.x, y: agent.y },
    });

    return jsonResponse({
      success: true,
      data: responseData,
    });
  } catch (error) {
    console.error('Speak error:', error);
    return errorResponse('Internal server error', 500);
  }
}
