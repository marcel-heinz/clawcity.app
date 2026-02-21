import { NextRequest, NextResponse } from 'next/server';
import { isAdminConfigured, verifyAdminSession } from '@/lib/admin-auth';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import {
  AVATAR_LAB_MODELS,
  resolveAvatarLabConfig,
  sanitizeAvatarLabPatch,
  validateAvatarLabConfigInput,
} from '@/lib/avatar-lab';

interface AvatarLabAgentRow {
  id: string;
  name: string;
  x: number;
  y: number;
  last_active: string;
  avatar?: Record<string, unknown> | null;
}

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
}

function adminUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'Admin dashboard not configured' },
    { status: 503 }
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeSearch(value: string): string {
  return value.replace(/[%_]/g, '').trim();
}

export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) return adminUnavailableResponse();
  if (!verifyAdminSession(request)) return unauthorizedResponse();

  if (!isSupabaseConfigured) {
    return NextResponse.json({
      success: true,
      data: { agents: [], models: AVATAR_LAB_MODELS },
    });
  }

  const supabase = createServerClient();
  const rawSearch = request.nextUrl.searchParams.get('search') ?? '';
  const search = normalizeSearch(rawSearch);

  let query = supabase
    .from('agents')
    .select('id, name, x, y, last_active, avatar')
    .order('last_active', { ascending: false })
    .limit(300);

  if (search) {
    query = query.ilike('name', `%${search}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Avatar lab: failed to load agents', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load avatar lab agents' },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as AvatarLabAgentRow[];
  const agents = rows.map((agent) => ({
    id: agent.id,
    name: agent.name,
    x: agent.x,
    y: agent.y,
    last_active: agent.last_active,
    avatar: agent.avatar ?? {},
    avatar_lab: resolveAvatarLabConfig(agent.name, agent.avatar),
  }));

  return NextResponse.json({
    success: true,
    data: {
      agents,
      models: AVATAR_LAB_MODELS,
    },
  });
}

export async function PATCH(request: NextRequest) {
  if (!isAdminConfigured()) return adminUnavailableResponse();
  if (!verifyAdminSession(request)) return unauthorizedResponse();

  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { success: false, error: 'Database not configured' },
      { status: 503 }
    );
  }

  try {
    const body = (await request.json()) as {
      agentId?: string;
      avatar?: Record<string, unknown>;
    };

    if (!body.agentId || typeof body.agentId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'agentId is required' },
        { status: 400 }
      );
    }
    if (!body.avatar || typeof body.avatar !== 'object' || Array.isArray(body.avatar)) {
      return NextResponse.json(
        { success: false, error: 'avatar object is required' },
        { status: 400 }
      );
    }

    const validationError = validateAvatarLabConfigInput(body.avatar);
    if (validationError) {
      return NextResponse.json(
        { success: false, error: validationError },
        { status: 400 }
      );
    }

    const supabase = createServerClient();
    const { data: agentRow, error: agentError } = await supabase
      .from('agents')
      .select('id, name, avatar')
      .eq('id', body.agentId)
      .single();

    if (agentError || !agentRow) {
      return NextResponse.json(
        { success: false, error: 'Agent not found' },
        { status: 404 }
      );
    }

    const currentAvatar = asRecord(agentRow.avatar);
    const nextAvatarInput: Record<string, unknown> = {
      ...currentAvatar,
      ...body.avatar,
    };

    if ('skin_data_url' in body.avatar) {
      const rawSkin = body.avatar.skin_data_url;
      if (rawSkin === null || rawSkin === '') {
        delete nextAvatarInput.skin_data_url;
      }
    }

    const normalized = sanitizeAvatarLabPatch(agentRow.name, nextAvatarInput);

    const { error: updateError } = await supabase
      .from('agents')
      .update({ avatar: normalized })
      .eq('id', body.agentId);

    if (updateError) {
      console.error('Avatar lab: failed to update agent avatar', updateError);
      return NextResponse.json(
        { success: false, error: 'Failed to update avatar' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        agent: {
          id: agentRow.id,
          name: agentRow.name,
          avatar: normalized,
          avatar_lab: resolveAvatarLabConfig(agentRow.name, normalized),
        },
      },
    });
  } catch (error) {
    console.error('Avatar lab: PATCH error', error);
    return NextResponse.json(
      { success: false, error: 'Invalid request payload' },
      { status: 400 }
    );
  }
}
