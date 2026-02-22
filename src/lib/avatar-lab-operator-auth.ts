import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { hashToken } from '@/lib/game-logic';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';

const DEFAULT_PUBLIC_BASE_URL = 'https://www.clawcity.app';

export const AVATAR_LAB_SESSION_COOKIE_NAME = 'avatar_lab_session';
export const AVATAR_LAB_LINK_TTL_MINUTES_DEFAULT = 30;
export const AVATAR_LAB_LINK_TTL_MINUTES_MIN = 5;
export const AVATAR_LAB_LINK_TTL_MINUTES_MAX = 24 * 60;
export const AVATAR_LAB_SESSION_TTL_SECONDS = 60 * 60 * 24;

interface AvatarLabSessionRow {
  id: string;
  agent_id: string;
  expires_at: string;
  revoked_at?: string | null;
}

interface AvatarLabAgentRow {
  id: string;
  name: string;
  avatar?: Record<string, unknown> | null;
}

export interface AvatarLabSessionContext {
  sessionId: string;
  agentId: string;
  agentName: string;
  avatar: Record<string, unknown>;
  expiresAt: string;
}

export type AvatarLabSessionAuthResult =
  | { success: true; session: AvatarLabSessionContext }
  | { success: false; status: number; error: string };

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function generateAvatarLabSecret(size = 32): string {
  return randomBytes(size).toString('base64url');
}

export function hashAvatarLabSecret(secret: string): string {
  return hashToken(secret);
}

export function parseAvatarLabTtlMinutes(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return AVATAR_LAB_LINK_TTL_MINUTES_DEFAULT;
  }

  const rounded = Math.round(input);
  return Math.max(
    AVATAR_LAB_LINK_TTL_MINUTES_MIN,
    Math.min(AVATAR_LAB_LINK_TTL_MINUTES_MAX, rounded)
  );
}

export function getAvatarLabBaseUrl(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL;
  if (configured && configured.trim().length > 0) {
    return configured.replace(/\/$/, '');
  }

  const origin = request.nextUrl.origin;
  if (origin && origin.length > 0) {
    return origin.replace(/\/$/, '');
  }

  return DEFAULT_PUBLIC_BASE_URL;
}

export function buildAvatarLabLinkUrl(request: NextRequest, token: string): string {
  const base = getAvatarLabBaseUrl(request);
  return `${base}/avatar-lab/${encodeURIComponent(token)}`;
}

export function setAvatarLabSessionCookie(
  response: NextResponse,
  sessionSecret: string,
  maxAgeSeconds = AVATAR_LAB_SESSION_TTL_SECONDS
): void {
  response.cookies.set(AVATAR_LAB_SESSION_COOKIE_NAME, sessionSecret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: maxAgeSeconds,
    path: '/',
  });
}

export function clearAvatarLabSessionCookie(response: NextResponse): void {
  response.cookies.set(AVATAR_LAB_SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
}

export function getAvatarLabSessionCookie(request: NextRequest): string | null {
  const raw = request.cookies.get(AVATAR_LAB_SESSION_COOKIE_NAME)?.value ?? '';
  const value = raw.trim();
  if (!value) return null;
  return value;
}

export async function authenticateAvatarLabSession(
  request: NextRequest
): Promise<AvatarLabSessionAuthResult> {
  if (!isSupabaseConfigured) {
    return { success: false, status: 503, error: 'Database not configured' };
  }

  const cookie = getAvatarLabSessionCookie(request);
  if (!cookie) {
    return { success: false, status: 401, error: 'Avatar lab session missing' };
  }

  try {
    const supabase = createServerClient();
    const sessionHash = hashAvatarLabSecret(cookie);

    const { data: sessionRow, error: sessionError } = await supabase
      .from('agent_avatar_lab_sessions')
      .select('id, agent_id, expires_at, revoked_at')
      .eq('session_hash', sessionHash)
      .single();

    if (sessionError || !sessionRow) {
      return { success: false, status: 401, error: 'Invalid avatar lab session' };
    }

    const session = sessionRow as AvatarLabSessionRow;

    if (session.revoked_at) {
      return { success: false, status: 401, error: 'Avatar lab session revoked' };
    }

    if (new Date(session.expires_at).getTime() <= Date.now()) {
      return { success: false, status: 401, error: 'Avatar lab session expired' };
    }

    const { data: agentRow, error: agentError } = await supabase
      .from('agents')
      .select('id, name, avatar')
      .eq('id', session.agent_id)
      .single();

    if (agentError || !agentRow) {
      return { success: false, status: 401, error: 'Agent not found for avatar lab session' };
    }

    void supabase
      .from('agent_avatar_lab_sessions')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', session.id);

    const agent = agentRow as AvatarLabAgentRow;

    return {
      success: true,
      session: {
        sessionId: session.id,
        agentId: agent.id,
        agentName: agent.name,
        avatar: asRecord(agent.avatar),
        expiresAt: session.expires_at,
      },
    };
  } catch (error) {
    console.error('Avatar lab session authentication error:', error);
    return { success: false, status: 500, error: 'Avatar lab authentication failed' };
  }
}
