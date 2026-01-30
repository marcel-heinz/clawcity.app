import { NextRequest, NextResponse } from 'next/server';
import { 
  verifyPassword, 
  verifyAdminSession, 
  getSessionToken, 
  isAdminConfigured,
  COOKIE_NAME 
} from '@/lib/admin-auth';

const COOKIE_MAX_AGE = 60 * 60 * 24; // 24 hours

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

// POST - Login
export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { success: false, error: 'Admin dashboard not configured' },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const { password } = body;

    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Password is required' },
        { status: 400 }
      );
    }

    if (!verifyPassword(password)) {
      return NextResponse.json(
        { success: false, error: 'Invalid password' },
        { status: 401 }
      );
    }

    const sessionToken = getSessionToken();
    
    const response = NextResponse.json({
      success: true,
      message: 'Logged in successfully',
    });

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
export async function DELETE() {
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
