import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateAvatarLabSession,
  clearAvatarLabSessionCookie,
} from '@/lib/avatar-lab-operator-auth';
import {
  resolveAvatarLabConfig,
  sanitizeAvatarLabPatch,
  validateAvatarLabConfigInput,
} from '@/lib/avatar-lab';
import { createServerClient } from '@/lib/supabase';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function unauthorizedWithCookieClear(error: string): NextResponse {
  const response = NextResponse.json({ success: false, error }, { status: 401 });
  clearAvatarLabSessionCookie(response);
  return response;
}

export async function PATCH(request: NextRequest) {
  const auth = await authenticateAvatarLabSession(request);
  if (!auth.success) {
    if (auth.status === 401) {
      return unauthorizedWithCookieClear(auth.error);
    }
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  let body: Record<string, unknown>;
  try {
    body = asRecord(await request.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const avatarPatch = asRecord(body.avatar ?? body);
  if (Object.keys(avatarPatch).length === 0) {
    return NextResponse.json({ success: false, error: 'Avatar patch payload is required' }, { status: 400 });
  }

  const validationError = validateAvatarLabConfigInput(avatarPatch);
  if (validationError) {
    return NextResponse.json({ success: false, error: validationError }, { status: 400 });
  }

  const currentAvatar = asRecord(auth.session.avatar);
  const nextAvatarInput: Record<string, unknown> = {
    ...currentAvatar,
    ...avatarPatch,
  };

  if ('skin_data_url' in avatarPatch) {
    const raw = avatarPatch.skin_data_url;
    if (raw === null || raw === '') {
      delete nextAvatarInput.skin_data_url;
      delete nextAvatarInput.skin_url;
    }
  }

  if ('skin_url' in avatarPatch) {
    const raw = avatarPatch.skin_url;
    if (raw === null || raw === '') {
      delete nextAvatarInput.skin_data_url;
      delete nextAvatarInput.skin_url;
    }
  }

  const normalized = sanitizeAvatarLabPatch(auth.session.agentName, nextAvatarInput);

  try {
    const supabase = createServerClient();
    const { error } = await supabase
      .from('agents')
      .update({ avatar: normalized })
      .eq('id', auth.session.agentId);

    if (error) {
      console.error('Avatar lab me/avatar update failed:', error);
      return NextResponse.json({ success: false, error: 'Failed to save avatar changes' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        agent: {
          id: auth.session.agentId,
          name: auth.session.agentName,
        },
        avatar: normalized,
        avatar_lab: resolveAvatarLabConfig(auth.session.agentName, normalized),
      },
    });
  } catch (error) {
    console.error('Avatar lab me/avatar route error:', error);
    return NextResponse.json({ success: false, error: 'Failed to save avatar changes' }, { status: 500 });
  }
}
