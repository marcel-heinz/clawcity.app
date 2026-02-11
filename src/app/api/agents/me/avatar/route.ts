import { NextRequest } from 'next/server';
import { authenticateAgent, jsonResponse, errorResponse } from '@/lib/auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveAvatar, validateAvatarUpdate } from '@/lib/avatar';
import { checkRateLimit, GAME_ACTION_RATE_LIMIT } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  const auth = await authenticateAgent(request);
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  const resolved = resolveAvatar(auth.agent.name, auth.agent.avatar);
  return jsonResponse({
    success: true,
    data: {
      avatar: resolved,
      is_default: !auth.agent.avatar || Object.keys(auth.agent.avatar).length === 0,
    },
  });
}

export async function PUT(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return errorResponse('Database not configured', 503);
  }

  const rateLimit = await checkRateLimit(request, GAME_ACTION_RATE_LIMIT);
  if (!rateLimit.success) {
    return errorResponse('Rate limited. Try again later.', 429);
  }

  const auth = await authenticateAgent(request);
  if (!auth.success || !auth.agent) {
    return errorResponse(auth.error || 'Unauthorized', 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  // Handle reset: empty object clears custom avatar
  if (Object.keys(body).length === 0) {
    const supabase = createServerClient();
    const { error } = await supabase
      .from('agents')
      .update({ avatar: {} })
      .eq('id', auth.agent.id);

    if (error) {
      console.error('Avatar reset error:', error);
      return errorResponse('Failed to reset avatar', 500);
    }

    return jsonResponse({
      success: true,
      data: {
        avatar: resolveAvatar(auth.agent.name),
        is_default: true,
      },
    });
  }

  // Validate color fields
  const validationError = validateAvatarUpdate(body);
  if (validationError) {
    return errorResponse(validationError, 400);
  }

  // Merge with existing avatar (partial update)
  const currentAvatar = auth.agent.avatar || {};
  const updatedAvatar = { ...currentAvatar, ...body };

  const supabase = createServerClient();
  const { error } = await supabase
    .from('agents')
    .update({ avatar: updatedAvatar })
    .eq('id', auth.agent.id);

  if (error) {
    console.error('Avatar update error:', error);
    return errorResponse('Failed to update avatar', 500);
  }

  return jsonResponse({
    success: true,
    data: {
      avatar: resolveAvatar(auth.agent.name, updatedAvatar),
      is_default: false,
    },
  });
}
