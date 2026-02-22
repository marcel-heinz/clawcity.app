import { NextRequest, NextResponse } from 'next/server';
import { authenticateAgent } from '@/lib/auth';
import {
  buildAvatarLabLinkUrl,
  generateAvatarLabSecret,
  hashAvatarLabSecret,
  parseAvatarLabTtlMinutes,
} from '@/lib/avatar-lab-operator-auth';
import {
  AVATAR_LAB_LINK_RATE_LIMIT,
  checkRateLimit,
  getClientIdentifier,
  rateLimitHeaders,
} from '@/lib/rate-limit';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';

interface LinkRequestBody {
  ttl_minutes?: number;
}

export async function POST(request: NextRequest) {
  const rateLimit = await checkRateLimit(request, AVATAR_LAB_LINK_RATE_LIMIT);
  if (!rateLimit.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'Too many avatar lab link requests. Please try again later.',
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
      {
        success: false,
        error: 'Database not configured',
      },
      {
        status: 503,
        headers: rateLimitHeaders(rateLimit),
      }
    );
  }

  const auth = await authenticateAgent(request);
  if (!auth.success || !auth.agent) {
    return NextResponse.json(
      { success: false, error: auth.error || 'Unauthorized' },
      {
        status: 401,
        headers: rateLimitHeaders(rateLimit),
      }
    );
  }

  let body: LinkRequestBody = {};
  try {
    body = (await request.json()) as LinkRequestBody;
  } catch {
    body = {};
  }

  const ttlMinutes = parseAvatarLabTtlMinutes(body.ttl_minutes);
  const now = Date.now();
  const expiresAt = new Date(now + ttlMinutes * 60_000).toISOString();
  const token = generateAvatarLabSecret();
  const tokenHash = hashAvatarLabSecret(token);

  try {
    const supabase = createServerClient();
    const agentId = auth.agent.id;

    // Keep only one active issuance link at a time for clarity.
    await supabase
      .from('agent_avatar_lab_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('agent_id', agentId)
      .is('consumed_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString());

    const { error: insertError } = await supabase
      .from('agent_avatar_lab_links')
      .insert({
        agent_id: agentId,
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_ip: getClientIdentifier(request),
      });

    if (insertError) {
      console.error('Avatar lab link creation failed:', insertError);
      return NextResponse.json(
        { success: false, error: 'Failed to create avatar lab link' },
        {
          status: 500,
          headers: rateLimitHeaders(rateLimit),
        }
      );
    }

    const url = buildAvatarLabLinkUrl(request, token);

    return NextResponse.json(
      {
        success: true,
        data: {
          url,
          expires_at: expiresAt,
          expires_in_seconds: Math.floor((new Date(expiresAt).getTime() - now) / 1000),
          ttl_minutes: ttlMinutes,
          agent: {
            id: auth.agent.id,
            name: auth.agent.name,
          },
        },
      },
      {
        headers: rateLimitHeaders(rateLimit),
      }
    );
  } catch (error) {
    console.error('Avatar lab link API error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate avatar lab link' },
      {
        status: 500,
        headers: rateLimitHeaders(rateLimit),
      }
    );
  }
}
