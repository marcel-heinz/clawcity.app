import { getRedis } from './redis-client';
import { config } from '../config';

const LOCK_TTL_SECONDS = 60; // Lock expires after 60s (safety net)

export async function acquireLock(agentConfigId: string): Promise<boolean> {
  const redis = getRedis();
  const lockKey = `lock:agent:${agentConfigId}`;
  const result = await redis.set(lockKey, config.workerId, {
    nx: true,
    ex: LOCK_TTL_SECONDS,
  });
  return result === 'OK';
}

export async function releaseLock(agentConfigId: string): Promise<void> {
  const redis = getRedis();
  const lockKey = `lock:agent:${agentConfigId}`;
  // Only release if we own the lock
  const owner = await redis.get(lockKey);
  if (owner === config.workerId) {
    await redis.del(lockKey);
  }
}
