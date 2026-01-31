import { NextRequest, NextResponse } from 'next/server';
import { 
  verifyPassword, 
  verifyAdminSession, 
  getSessionToken, 
  isAdminConfigured,
  COOKIE_NAME 
} from '@/lib/admin-auth';
import { 
  checkRateLimit, 
  rateLimitHeaders, 
  ADMIN_LOGIN_RATE_LIMIT,
  getClientIdentifier 
} from '@/lib/rate-limit';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';

const COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours

/**
 * Log admin authentication attempt to audit log
 */
async function logAuthAttempt(
  action: 'login_success' | 'login_failed' | 'login_rate_limited' | 'logout',
  request: NextRequest,
  details: Record<string, unknown> = {}
) {
  if (!isSupabaseConfigured) return;
  
  try {
    const supabase = createServerClient();
    await supabase.from('admin_audit_log').insert({
      action,
      details,
      ip_address: getClientIdentifier(request),
    });
  } catch (error) {
    console.error('Failed to log auth attempt:', error);
  }
}

// GET - Verify current session
export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { success: false, error: 'Admin dashboard not configured' },
      { status: 503 }
    );
  }

  const isAuthenticated = verifyAdminSession(request);
  
  return NextResponse.json({
    success: true,
    authenticated: isAuthenticated,
  });
}

// POST - Login (with rate limiting)
export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { success: false, error: 'Admin dashboard not configured' },
      { status: 503 }
    );
  }

  // Check rate limit BEFORE processing login
  const rateLimitResult = checkRateLimit(request, ADMIN_LOGIN_RATE_LIMIT);
  
  if (!rateLimitResult.success) {
    // Log rate-limited attempt
    await logAuthAttempt('login_rate_limited', request, {
      retryAfterMs: rateLimitResult.retryAfterMs,
    });
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Too many login attempts. Please try again later.',
        retryAfter: Math.ceil((rateLimitResult.retryAfterMs || 60000) / 1000),
      },
      { 
        status: 429,
        headers: rateLimitHeaders(rateLimitResult),
      }
    );
  }

  try {
    const body = await request.json();
    const { password } = body;

    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Password is required' },
        { 
          status: 400,
          headers: rateLimitHeaders(rateLimitResult),
        }
      );
    }

    if (!verifyPassword(password)) {
      // Log failed attempt
      await logAuthAttempt('login_failed', request);
      
      return NextResponse.json(
        { success: false, error: 'Invalid password' },
        { 
          status: 401,
          headers: rateLimitHeaders(rateLimitResult),
        }
      );
    }

    // Successful login
    await logAuthAttempt('login_success', request);

    const sessionToken = getSessionToken();
    
    const response = NextResponse.json(
      {
        success: true,
        message: 'Logged in successfully',
      },
      { headers: rateLimitHeaders(rateLimitResult) }
    );

    response.cookies.set(COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    });

    return response;
  } catch (error) {
    console.error('Admin login error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE - Logout
export async function DELETE(request: NextRequest) {
  // Log logout
  await logAuthAttempt('logout', request);
  
  const response = NextResponse.json({
    success: true,
    message: 'Logged out successfully',
  });

  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });

  return response;
}
