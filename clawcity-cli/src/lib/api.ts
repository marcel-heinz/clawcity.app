/**
 * Shared HTTP client for ClawCity game API.
 * Supports multi-profile auth:
 * - agent   -> Authorization: Bearer CLAWCITY_API_KEY
 * - session -> Cookie: CLAWCITY_SESSION_COOKIE
 * - cron    -> Authorization: Bearer CLAWCITY_CRON_SECRET
 * - none    -> no auth header
 */

const BASE_URL = process.env.CLAWCITY_URL || 'https://www.clawcity.app';
const API_KEY = process.env.CLAWCITY_API_KEY || '';
const SESSION_COOKIE = process.env.CLAWCITY_SESSION_COOKIE || '';
const CRON_SECRET = process.env.CLAWCITY_CRON_SECRET || '';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type AuthProfile = 'agent' | 'session' | 'cron' | 'none';

interface ApiOptions {
  method?: HttpMethod;
  body?: unknown;
  auth?: boolean; // backwards-compatible alias: auth=false => profile=none
  profile?: AuthProfile;
  query?: Record<string, string | number | boolean | null | undefined>;
  headers?: Record<string, string>;
}

interface RawRequestResponse {
  ok: boolean;
  status: number;
  text: string;
  json?: unknown;
}

interface ApiResponse {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
}

function ensureCredentialOrExit(profile: AuthProfile, headers: Record<string, string>) {
  const hasAuthHeader = Object.keys(headers).some((key) => key.toLowerCase() === 'authorization');
  const hasCookieHeader = Object.keys(headers).some((key) => key.toLowerCase() === 'cookie');

  if (profile === 'agent' && !API_KEY && !hasAuthHeader) {
    console.error('Error: CLAWCITY_API_KEY not set. Export it or use --profile none with custom headers.');
    process.exit(1);
  }
  if (profile === 'session' && !SESSION_COOKIE && !hasCookieHeader) {
    console.error('Error: CLAWCITY_SESSION_COOKIE not set. Export it or provide a Cookie header.');
    process.exit(1);
  }
  if (profile === 'cron' && !CRON_SECRET && !hasAuthHeader) {
    console.error('Error: CLAWCITY_CRON_SECRET not set. Export it or provide an Authorization header.');
    process.exit(1);
  }
}

function normalizeProfile(opts: ApiOptions): AuthProfile {
  if (opts.profile) return opts.profile;
  if (opts.auth === false) return 'none';
  return 'agent';
}

function appendQuery(url: URL, query?: ApiOptions['query']) {
  if (!query) return;
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
}

function toUrl(path: string): URL {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return new URL(path);
  }
  return new URL(path, BASE_URL);
}

function serializeBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  return JSON.stringify(body);
}

export async function requestApi(path: string, opts: ApiOptions = {}): Promise<RawRequestResponse> {
  const method = opts.method || 'GET';
  const profile = normalizeProfile(opts);
  const headers: Record<string, string> = { ...(opts.headers || {}) };

  if (profile === 'agent' && !headers.Authorization && API_KEY) {
    headers.Authorization = `Bearer ${API_KEY}`;
  }
  if (profile === 'session' && !headers.Cookie && SESSION_COOKIE) {
    headers.Cookie = SESSION_COOKIE;
  }
  if (profile === 'cron' && !headers.Authorization && CRON_SECRET) {
    headers.Authorization = `Bearer ${CRON_SECRET}`;
  }

  ensureCredentialOrExit(profile, headers);

  const bodyText = serializeBody(opts.body);
  if (bodyText !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }

  const url = toUrl(path);
  appendQuery(url, opts.query);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: bodyText,
    });

    const text = await res.text();
    let json: unknown;
    if (text) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = undefined;
      }
    }

    return {
      ok: res.ok,
      status: res.status,
      text,
      json,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}

export async function api(path: string, opts: ApiOptions = {}): Promise<ApiResponse> {
  const res = await requestApi(path, opts);

  if (res.json !== undefined && typeof res.json === 'object' && res.json !== null && !Array.isArray(res.json)) {
    const parsed = res.json as Record<string, unknown>;
    const data = (
      res.ok &&
      parsed.success !== false &&
      parsed.data &&
      typeof parsed.data === 'object' &&
      !Array.isArray(parsed.data)
    )
      ? parsed.data as Record<string, unknown>
      : parsed;
    return { ok: res.ok, status: res.status, data };
  }

  // Some endpoints intentionally return plain text (e.g. /api/agents/me/summary).
  const plainTextData: Record<string, unknown> = res.ok
    ? {
        summary: res.text,
        raw: res.text,
      }
    : {
        error: res.text || `HTTP ${res.status}`,
        raw: res.text,
      };
  return { ok: res.ok, status: res.status, data: plainTextData };
}

/** Print error from API response and exit */
export function handleError(res: ApiResponse): never {
  const msg = res.data.error || res.data.message || `HTTP ${res.status}`;
  console.error(`Error: ${String(msg)}`);
  process.exit(1);
}

/** Format resources compactly: G:100 W:20 F:50 S:30 */
export function fmtResources(inv: Record<string, number>): string {
  return `G:${inv.gold ?? 0} W:${inv.wood ?? 0} F:${inv.food ?? 0} S:${inv.stone ?? 0}`;
}
