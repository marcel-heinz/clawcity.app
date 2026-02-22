import { NextRequest, NextResponse } from 'next/server';
import {
  AVATAR_LAB_SESSION_TTL_SECONDS,
  clearAvatarLabSessionCookie,
  generateAvatarLabSecret,
  getAvatarLabSessionCookie,
  hashAvatarLabSecret,
  setAvatarLabSessionCookie,
} from '@/lib/avatar-lab-operator-auth';
import {
  AVATAR_LAB_SESSION_RATE_LIMIT,
  checkRateLimit,
  getClientIdentifier,
  rateLimitHeaders,
} from '@/lib/rate-limit';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';

interface ExchangeRequestBody {
  token?: string;
}

interface AvatarLabLinkRow {
  id: string;
  agent_id: string;
  expires_at: string;
  consumed_at?: string | null;
  revoked_at?: string | null;
}

export async function POST(request: NextRequest) {
  const rateLimit = await checkRateLimit(request, AVATAR_LAB_SESSION_RATE_LIMIT);
  if (!rateLimit.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'Too many avatar lab link exchange attempts. Please try again later.',
        retryAfter: Math.ceil((rateLimit.retryAfterMs || 60_000) / 1000),
      },
      {
        status: 429,
        headers: rateLimitHeaders(rateLimit),
      }
    );
  }

  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { success: false, error: 'Database not configured' },
      {
        status: 503,
        headers: rateLimitHeaders(rateLimit),
      }
    );
  }

  let body: ExchangeRequestBody;
  try {
    body = (await request.json()) as ExchangeRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      {
        status: 400,
        headers: rateLimitHeaders(rateLimit),
      }
    );
  }

  const token = (body.token || '').trim();
  if (!token) {
    return NextResponse.json(
      { success: false, error: 'Link token is required' },
      {
        status: 400,
        headers: rateLimitHeaders(rateLimit),
      }
    );
  }

  try {
    const supabase = createServerClient();
    const tokenHash = hashAvatarLabSecret(token);

    const { data: linkRow, error: linkError } = await supabase
      .from('agent_avatar_lab_links')
      .select('id, agent_id, expires_at, consumed_at, revoked_at')
      .eq('token_hash', tokenHash)
      .single();

    if (linkError || !linkRow) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired avatar lab link' },
        {
          status: 401,
          headers: rateLimitHeaders(rateLimit),
        }
      );
    }

    const link = linkRow as AvatarLabLinkRow;
    if (link.revoked_at || link.consumed_at || new Date(link.expires_at).getTime() <= Date.now()) {
      return NextResponse.json(
        { success: false, error: 'Avatar lab link is no longer valid' },
        {
          status: 401,
          headers: rateLimitHeaders(rateLimit),
        }
      );
    }

    const consumeTimestamp = new Date().toISOString();
    const { data: consumedRows, error: consumeError } = await supabase
      .from('agent_avatar_lab_links')
      .update({ consumed_at: consumeTimestamp })
      .eq('id', link.id)
      .is('consumed_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('id')
      .limit(1);

    if (consumeError || !consumedRows || consumedRows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Avatar lab link is already used or expired' },
        {
          status: 401,
          headers: rateLimitHeaders(rateLimit),
        }
      );
    }

    const sessionSecret = generateAvatarLabSecret();
    const sessionHash = hashAvatarLabSecret(sessionSecret);
    const sessionExpiresAt = new Date(Date.now() + AVATAR_LAB_SESSION_TTL_SECONDS * 1000).toISOString();

    const { error: sessionInsertError } = await supabase
      .from('agent_avatar_lab_sessions')
      .insert({
        agent_id: link.agent_id,
        session_hash: sessionHash,
        expires_at: sessionExpiresAt,
        created_ip: getClientIdentifier(request),
        last_seen_at: new Date().toISOString(),
      });

    if (sessionInsertError) {
      console.error('Avatar lab session insert failed:', sessionInsertError);
      return NextResponse.json(
        { success: false, error: 'Failed to create avatar lab session' },
        {
          status: 500,
          headers: rateLimitHeaders(rateLimit),
        }
      );
    }

    const { data: agentRow } = await supabase
      .from('agents')
      .select('id, name')
      .eq('id', link.agent_id)
      .single();

    const response = NextResponse.json(
      {
        success: true,
        data: {
          authenticated: true,
          session_expires_at: sessionExpiresAt,
          agent: agentRow
            ? {
                id: agentRow.id,
                name: agentRow.name,
              }
            : {
                id: link.agent_id,
                name: 'Unknown Agent',
              },
          next_path: '/avatar-lab',
        },
      },
      { headers: rateLimitHeaders(rateLimit) }
    );

    setAvatarLabSessionCookie(response, sessionSecret);
    return response;
  } catch (error) {
    console.error('Avatar lab session exchange error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to exchange avatar lab link' },
      {
        status: 500,
        headers: rateLimitHeaders(rateLimit),
      }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const response = NextResponse.json({
    success: true,
    message: 'Avatar lab session closed',
  });

  clearAvatarLabSessionCookie(response);

  if (!isSupabaseConfigured) {
    return response;
  }

  const cookie = getAvatarLabSessionCookie(request);
  if (!cookie) {
    return response;
  }

  try {
    const supabase = createServerClient();
    await supabase
      .from('agent_avatar_lab_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('session_hash', hashAvatarLabSecret(cookie))
      .is('revoked_at', null);
  } catch (error) {
    console.error('Avatar lab session revoke failed:', error);
  }

  return response;
}
