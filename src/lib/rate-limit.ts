import { NextRequest } from 'next/server';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store for rate limiting
// Note: In production with multiple instances, use Redis or similar
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Clean up every minute

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  limit: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Prefix for the rate limit key (e.g., 'admin-login', 'register') */
  keyPrefix: string;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs?: number;
}

/**
 * Get the client identifier from a request
 * Uses X-Forwarded-For header (for proxies) or falls back to a hash of headers
 */
export function getClientIdentifier(request: NextRequest): string {
  // Try to get real IP from common proxy headers
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    // x-forwarded-for can be a comma-separated list, take the first one
    return forwarded.split(',')[0].trim();
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Fallback: use a combination of headers as identifier
  // This is less reliable but better than nothing
  const userAgent = request.headers.get('user-agent') || '';
  const acceptLanguage = request.headers.get('accept-language') || '';
  return `fallback-${hashString(userAgent + acceptLanguage)}`;
}

/**
 * Simple string hash for fallback client identification
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Check and apply rate limiting for a request
 */
export function checkRateLimit(
  request: NextRequest,
  config: RateLimitConfig
): RateLimitResult {
  const clientId = getClientIdentifier(request);
  const key = `${config.keyPrefix}:${clientId}`;
  const now = Date.now();

  let entry = rateLimitStore.get(key);

  // Create new entry if doesn't exist or window has passed
  if (!entry || entry.resetAt < now) {
    entry = {
      count: 0,
      resetAt: now + config.windowMs,
    };
    rateLimitStore.set(key, entry);
  }

  // Increment count
  entry.count++;

  // Check if over limit
  if (entry.count > config.limit) {
    return {
      success: false,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfterMs: entry.resetAt - now,
    };
  }

  return {
    success: true,
    remaining: config.limit - entry.count,
    resetAt: entry.resetAt,
  };
}

/**
 * Create rate limit headers for response
 */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(result.resetAt / 1000).toString(),
  };

  if (!result.success && result.retryAfterMs) {
    headers['Retry-After'] = Math.ceil(result.retryAfterMs / 1000).toString();
  }

  return headers;
}

// Pre-configured rate limiters for common use cases

/** Rate limit for admin login attempts: 5 attempts per minute */
export const ADMIN_LOGIN_RATE_LIMIT: RateLimitConfig = {
  limit: 5,
  windowMs: 60 * 1000, // 1 minute
  keyPrefix: 'admin-login',
};

/** Rate limit for agent registration: 10 registrations per hour per IP */
export const REGISTRATION_RATE_LIMIT: RateLimitConfig = {
  limit: 10,
  windowMs: 60 * 60 * 1000, // 1 hour
  keyPrefix: 'register',
};

/** Rate limit for feedback submissions: 5 per hour per IP */
export const FEEDBACK_RATE_LIMIT: RateLimitConfig = {
  limit: 5,
  windowMs: 60 * 60 * 1000, // 1 hour
  keyPrefix: 'feedback',
};

/** Rate limit for game actions: 60 per minute (1 per second average) */
export const GAME_ACTION_RATE_LIMIT: RateLimitConfig = {
  limit: 60,
  windowMs: 60 * 1000, // 1 minute
  keyPrefix: 'game-action',
};
