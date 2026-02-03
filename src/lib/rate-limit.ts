import { NextRequest } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// ============================================
// UPSTASH REDIS RATE LIMITER
// ============================================

// Check if Upstash is configured
const isUpstashConfigured = !!(
  process.env.UPSTASH_REDIS_REST_URL && 
  process.env.UPSTASH_REDIS_REST_TOKEN
);

// Create Redis client if configured
const redis = isUpstashConfigured 
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;

// Create Upstash rate limiters for different use cases
const gameActionLimiter = redis 
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(60, '1 m'), // 60 requests per minute
      analytics: true,
      prefix: 'ratelimit:game-action',
    })
  : null;

const adminLoginLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, '1 m'), // 5 attempts per minute
      analytics: true,
      prefix: 'ratelimit:admin-login',
    })
  : null;

const registrationLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, '1 h'), // 10 per hour
      analytics: true,
      prefix: 'ratelimit:register',
    })
  : null;

const feedbackLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, '1 h'), // 5 per hour
      analytics: true,
      prefix: 'ratelimit:feedback',
    })
  : null;

// ============================================
// FALLBACK IN-MEMORY RATE LIMITER
// ============================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store for rate limiting (fallback when Upstash not configured)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically (only for in-memory fallback)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetAt < now) {
        rateLimitStore.delete(key);
      }
    }
  }, 60000); // Clean up every minute
}

// ============================================
// TYPES AND CONFIG
// ============================================

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

// ============================================
// HELPER FUNCTIONS
// ============================================

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
 * In-memory rate limit check (fallback)
 */
function checkRateLimitInMemory(
  clientId: string,
  config: RateLimitConfig
): RateLimitResult {
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

// ============================================
// MAIN RATE LIMIT FUNCTION
// ============================================

/**
 * Check and apply rate limiting for a request
 * Uses Upstash Redis if configured, falls back to in-memory otherwise
 */
export async function checkRateLimit(
  request: NextRequest,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const clientId = getClientIdentifier(request);

  // Use Upstash if configured
  if (isUpstashConfigured) {
    let limiter: Ratelimit | null = null;
    
    // Select the appropriate limiter based on keyPrefix
    switch (config.keyPrefix) {
      case 'game-action':
        limiter = gameActionLimiter;
        break;
      case 'admin-login':
        limiter = adminLoginLimiter;
        break;
      case 'register':
        limiter = registrationLimiter;
        break;
      case 'feedback':
        limiter = feedbackLimiter;
        break;
      default:
        // For unknown prefixes, use game action limiter as default
        limiter = gameActionLimiter;
    }

    if (limiter) {
      try {
        const result = await limiter.limit(clientId);
        
        return {
          success: result.success,
          remaining: result.remaining,
          resetAt: result.reset,
          retryAfterMs: result.success ? undefined : (result.reset - Date.now()),
        };
      } catch (error) {
        console.error('Upstash rate limit error, falling back to in-memory:', error);
        // Fall back to in-memory on error
        return checkRateLimitInMemory(clientId, config);
      }
    }
  }

  // Fallback to in-memory rate limiting
  return checkRateLimitInMemory(clientId, config);
}

/**
 * Synchronous rate limit check (for backwards compatibility)
 * Note: This only works with in-memory storage, not Upstash
 * @deprecated Use checkRateLimit (async) instead for Upstash support
 */
export function checkRateLimitSync(
  request: NextRequest,
  config: RateLimitConfig
): RateLimitResult {
  const clientId = getClientIdentifier(request);
  return checkRateLimitInMemory(clientId, config);
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

// ============================================
// PRE-CONFIGURED RATE LIMIT CONFIGS
// ============================================

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

/** Rate limit for game actions: 500 per minute (supports 150ms move cooldown for flight-sim feel) */
export const GAME_ACTION_RATE_LIMIT: RateLimitConfig = {
  limit: 500,
  windowMs: 60 * 1000, // 1 minute
  keyPrefix: 'game-action',
};

// ============================================
// UTILITY: Check if Upstash is configured
// ============================================

export function isRateLimitRedisEnabled(): boolean {
  return isUpstashConfigured;
}
