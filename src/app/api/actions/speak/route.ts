import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import { withAnnouncements } from '@/lib/announcements';

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

  try {
    const body = await request.json();
    const { message, to } = body;

    if (!message || typeof message !== 'string') {
      return errorResponse('Message is required');
    }

    if (message.length > 500) {
      return errorResponse('Message is too long (max 500 characters)');
    }

    const agent = auth.agent;
    const supabase = createServerClient();

    // If 'to' is specified, it's a whisper to a specific agent
    let targetAgent = null;
    if (to) {
      const { data: target } = await supabase
        .from('agents')
        .select('id, name, x, y')
        .eq('name', to)
        .single();

      if (!target) {
        return errorResponse(`Agent "${to}" not found`);
      }

      // Check if target is nearby (within 10 tiles for whispers)
      const distance = Math.abs(target.x - agent.x) + Math.abs(target.y - agent.y);
      if (distance > 10) {
        return errorResponse(`${to} is too far away to whisper to`);
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
