/**
 * Shared HTTP client for ClawCity game API.
 * Reads CLAWCITY_API_KEY and CLAWCITY_URL from environment.
 * Returns pre-formatted plain text for minimal token usage.
 */

const BASE_URL = process.env.CLAWCITY_URL || 'https://www.clawcity.app';
const API_KEY = process.env.CLAWCITY_API_KEY || '';

interface ApiOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: Record<string, unknown>;
  auth?: boolean;
}

interface ApiResponse {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
}

export async function api(path: string, opts: ApiOptions = {}): Promise<ApiResponse> {
  const { method = 'GET', body, auth = true } = opts;

  if (auth && !API_KEY) {
    console.error('Error: CLAWCITY_API_KEY not set. Export it or add to .env');
    process.exit(1);
  }

  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {};
  if (auth) headers['Authorization'] = `Bearer ${API_KEY}`;
  if (body) headers['Content-Type'] = 'application/json';

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json() as Record<string, unknown>;
    const data = (res.ok && json.data && typeof json.data === 'object')
      ? json.data as Record<string, unknown>
      : json;
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}

/** Print error from API response and exit */
export function handleError(res: ApiResponse): never {
  const msg = (res.data as Record<string, unknown>).error || (res.data as Record<string, unknown>).message || `HTTP ${res.status}`;
  console.error(`Error: ${msg}`);
  process.exit(1);
}

/** Format resources compactly: G:100 W:20 F:50 S:30 */
export function fmtResources(inv: Record<string, number>): string {
  return `G:${inv.gold ?? 0} W:${inv.wood ?? 0} F:${inv.food ?? 0} S:${inv.stone ?? 0}`;
}
