import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';
import { withAnnouncements } from '@/lib/announcements';
import {
  gameplayTableName,
  resolveAgentForContext,
  resolveGameplayContext,
} from '@/lib/game-context';

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

    const supabase = createServerClient();
    const context = await resolveGameplayContext(auth.agent.id);
    const agent = await resolveAgentForContext(auth.agent, context);
    const eventsTable = gameplayTableName('events', context);

    const addWorld = <T extends Record<string, unknown>>(payload: T): T | (T & { world_id: string }) => {
      if (context.mode === 'open_world' && context.world_id) {
        return { world_id: context.world_id, ...payload };
      }
      return payload;
    };

    // If 'to' is specified, it's a whisper to a specific agent
    let targetAgent: { id: string; name: string; x: number; y: number } | null = null;
    if (to) {
      const { data: namedTarget } = await supabase
        .from('agents')
        .select('id, name')
        .eq('name', to)
        .single();

      if (!namedTarget) {
        return errorResponse(`Agent "${to}" not found`);
      }

      if (context.mode === 'open_world' && context.world_id) {
        const { data: state } = await supabase
          .from('open_world_agent_state')
          .select('x, y')
          .eq('world_id', context.world_id)
          .eq('agent_id', namedTarget.id)
          .single();

        if (!state) {
          return errorResponse(`Agent "${to}" is not in this open world`);
        }

        targetAgent = { id: namedTarget.id, name: namedTarget.name, x: state.x, y: state.y };
      } else {
        const { data: target } = await supabase
          .from('agents')
          .select('x, y')
          .eq('id', namedTarget.id)
          .single();

        if (!target) {
          return errorResponse(`Agent "${to}" not found`);
        }

        targetAgent = { id: namedTarget.id, name: namedTarget.name, x: target.x, y: target.y };
      }

      // Check if target is nearby (within 10 tiles for whispers)
      const distance = Math.abs(targetAgent.x - agent.x) + Math.abs(targetAgent.y - agent.y);
      if (distance > 10) {
        return errorResponse(`${to} is too far away to whisper to`);
      }
    }

    // Log speak event
    await supabase.from(eventsTable).insert(
      addWorld({
        agent_id: agent.id,
        type: 'speak',
        data: {
          message,
          is_whisper: !!targetAgent,
          target_id: targetAgent?.id,
          target_name: targetAgent?.name,
        },
        location: { x: agent.x, y: agent.y },
      })
    );

    const responseMessage = targetAgent
      ? `You whispered to ${targetAgent.name}: "${message}"`
      : `You said: "${message}"`;

    // Include any new announcements in the response
    const responseData = await withAnnouncements(agent, {
      message: responseMessage,
      type: targetAgent ? 'whisper' : 'speak',
      position: { x: agent.x, y: agent.y },
      context,
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
