function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  supabaseUrl: requireEnv('SUPABASE_URL'),
  supabaseServiceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  redisUrl: requireEnv('UPSTASH_REDIS_REST_URL'),
  redisToken: requireEnv('UPSTASH_REDIS_REST_TOKEN'),
  openrouterApiKey: requireEnv('OPENROUTER_API_KEY'),
  clawcityApiUrl: process.env.CLAWCITY_API_URL || 'https://clawcity.app',
  workerId: process.env.WORKER_ID || `worker-${process.pid}`,
  encryptionSecret: requireEnv('AGENT_KEY_ENCRYPTION_SECRET'),

  // Tick settings
  tickIntervalMs: 10_000, // 10 seconds main loop
  starterTickMs: 5 * 60_000, // 5 minutes
  proTickMs: 2 * 60_000, // 2 minutes
  maxConcurrentTicks: 10,

  // Health check
  healthPort: parseInt(process.env.PORT || '8080', 10),
};
