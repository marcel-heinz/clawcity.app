import { Redis } from '@upstash/redis';
import { config } from '../config';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis({
      url: config.redisUrl,
      token: config.redisToken,
    });
  }
  return redis;
}
