import { Command } from 'commander';
import { NON_ADMIN_ENDPOINTS } from '../lib/endpoints.js';
import { requestApi, type AuthProfile, type HttpMethod } from '../lib/api.js';

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parsePairs(entries: string[], separator: '=' | ':'): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const entry of entries) {
    const idx = entry.indexOf(separator);
    if (idx <= 0) {
      console.error(`Error: Invalid pair "${entry}". Expected key${separator}value.`);
      process.exit(1);
    }
    const key = entry.slice(0, idx).trim();
    const value = entry.slice(idx + 1).trim();
    if (!key) {
      console.error(`Error: Invalid pair "${entry}". Key cannot be empty.`);
      process.exit(1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function pathToRegex(path: string): RegExp {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const dynamic = escaped.replace(/\\\[.+?\\\]/g, '[^/]+');
  return new RegExp(`^${dynamic}$`);
}

function normalizePath(path: string): string {
  if (!path.startsWith('/')) return `/${path}`;
  return path;
}

function isRestrictedPath(path: string): boolean {
  return (
    path.startsWith('/api/builder/') ||
    path.startsWith('/api/billing/') ||
    path === '/api/user/profile'
  );
}

function resolveDefaultProfile(method: HttpMethod, path: string): AuthProfile {
  const normalized = normalizePath(path).split('?')[0];
  const endpoint = NON_ADMIN_ENDPOINTS.find((entry) => {
    if (entry.method !== method) return false;
    return pathToRegex(entry.path).test(normalized);
  });
  return endpoint?.profile || 'agent';
}

function parseMethod(value: string): HttpMethod {
  const method = value.toUpperCase();
  if (method !== 'GET' && method !== 'POST' && method !== 'PUT' && method !== 'PATCH' && method !== 'DELETE') {
    console.error(`Error: Unsupported method "${value}". Use GET|POST|PUT|PATCH|DELETE.`);
    process.exit(1);
  }
  return method;
}

function parseProfile(value: string): AuthProfile {
  const profile = value.toLowerCase();
  if (profile !== 'agent' && profile !== 'cron' && profile !== 'none') {
    console.error(`Error: Invalid profile "${value}". Use agent|cron|none.`);
    process.exit(1);
  }
  return profile as AuthProfile;
}

export function registerApiCommands(program: Command) {
  const apiCmd = program
    .command('api')
    .description('Generic non-admin API access and endpoint discovery');

  apiCmd
    .command('list')
    .description('List all known non-admin API endpoints')
    .option('-m, --method <method>', 'Filter by method')
    .option('-p, --profile <profile>', 'Filter by auth profile: agent|cron|none')
    .action((opts: { method?: string; profile?: string }) => {
      const methodFilter = opts.method ? parseMethod(opts.method) : null;
      const profileFilter = opts.profile ? parseProfile(opts.profile) : null;

      const entries = NON_ADMIN_ENDPOINTS
        .filter((entry) => !methodFilter || entry.method === methodFilter)
        .filter((entry) => !profileFilter || entry.profile === profileFilter)
        .sort((a, b) => {
          if (a.path === b.path) return a.method.localeCompare(b.method);
          return a.path.localeCompare(b.path);
        });

      if (entries.length === 0) {
        console.log('No endpoints matched filters.');
        return;
      }

      for (const entry of entries) {
        console.log(`${entry.method.padEnd(6)} ${entry.path.padEnd(36)} [${entry.profile}] ${entry.description}`);
      }
      console.log(`\nTotal: ${entries.length}`);
    });

  apiCmd
    .command('request <method> <path>')
    .description('Call any API path with optional query/body/headers')
    .option('-q, --query <k=v>', 'Query parameter, repeatable', collect, [])
    .option('-j, --json <json>', 'JSON request body')
    .option('-H, --header <K:V>', 'Custom header, repeatable', collect, [])
    .option('--profile <profile>', 'Auth profile: agent|cron|none')
    .option('--raw', 'Print raw response body as text')
    .action(async (methodArg: string, pathArg: string, opts: {
      query: string[];
      json?: string;
      header: string[];
      profile?: string;
      raw?: boolean;
    }) => {
      const method = parseMethod(methodArg);
      const path = normalizePath(pathArg);
      if (isRestrictedPath(path.split('?')[0])) {
        console.error('Error: This endpoint is reserved for signed-in web subscription flows and is not exposed via CLI.');
        process.exit(1);
      }
      const headers = parsePairs(opts.header || [], ':');
      const query = parsePairs(opts.query || [], '=');
      const profile = opts.profile ? parseProfile(opts.profile) : resolveDefaultProfile(method, path);

      let body: unknown;
      if (opts.json !== undefined) {
        try {
          body = JSON.parse(opts.json) as unknown;
        } catch (error) {
          console.error(`Error: Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`);
          process.exit(1);
        }
      }

      const response = await requestApi(path, {
        method,
        profile,
        headers,
        query,
        body,
      });

      if (opts.raw) {
        process.stdout.write(response.text + (response.text.endsWith('\n') ? '' : '\n'));
      } else if (response.json !== undefined) {
        console.log(JSON.stringify(response.json, null, 2));
      } else {
        console.log(response.text);
      }

      if (!response.ok) {
        process.exit(1);
      }
    });
}
