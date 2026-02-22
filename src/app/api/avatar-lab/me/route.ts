import { NextRequest, NextResponse } from 'next/server';
import {
  authenticateAvatarLabSession,
  clearAvatarLabSessionCookie,
} from '@/lib/avatar-lab-operator-auth';
import { AVATAR_LAB_MODELS, resolveAvatarLabConfig } from '@/lib/avatar-lab';

function unauthorizedWithCookieClear(error: string, status = 401): NextResponse {
  const response = NextResponse.json({ success: false, error }, { status });
  clearAvatarLabSessionCookie(response);
  return response;
}

export async function GET(request: NextRequest) {
  const auth = await authenticateAvatarLabSession(request);
  if (!auth.success) {
    if (auth.status === 401) {
      return unauthorizedWithCookieClear(auth.error, auth.status);
    }
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const { session } = auth;
  return NextResponse.json({
    success: true,
    data: {
      agent: {
        id: session.agentId,
        name: session.agentName,
      },
      avatar: session.avatar,
      avatar_lab: resolveAvatarLabConfig(session.agentName, session.avatar),
      models: AVATAR_LAB_MODELS,
      session_expires_at: session.expiresAt,
    },
  });
}
