import { NextRequest } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';

const COOKIE_NAME = 'admin_session';

export function getSessionToken(): string {
  const password = process.env.ADMIN_DASHBOARD_PASSWORD;
  if (!password) {
    throw new Error('ADMIN_DASHBOARD_PASSWORD not configured');
  }
  // Create a hash of the password to use as session token
  return createHash('sha256').update(password + '_session').digest('hex');
}

export function verifyPassword(input: string): boolean {
  const password = process.env.ADMIN_DASHBOARD_PASSWORD;
  if (!password) return false;
  const inputBuf = Buffer.from(input);
  const passwordBuf = Buffer.from(password);
  if (inputBuf.length !== passwordBuf.length) return false;
  return timingSafeEqual(inputBuf, passwordBuf);
}

export function verifyAdminSession(request: NextRequest): boolean {
  const sessionCookie = request.cookies.get(COOKIE_NAME);
  if (!sessionCookie) return false;
  
  try {
    const expectedToken = getSessionToken();
    const cookieBuf = Buffer.from(sessionCookie.value);
    const expectedBuf = Buffer.from(expectedToken);
    if (cookieBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(cookieBuf, expectedBuf);
  } catch {
    return false;
  }
}

export function isAdminConfigured(): boolean {
  return !!process.env.ADMIN_DASHBOARD_PASSWORD;
}

export { COOKIE_NAME };
