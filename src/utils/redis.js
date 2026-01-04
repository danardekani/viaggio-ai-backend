// ============================================================================
// REDIS CACHE UTILITY
// ============================================================================

import Redis from 'ioredis';
import { logger } from './logger.js';

let redis = null;

/**
 * Get Redis client (creates connection on first call)
 */
export function getRedis() {
  if (!redis && process.env.REDIS_URL) {
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      lazyConnect: true,
    });

    redis.on('connect', () => logger.info('Redis connected'));
    redis.on('error', err => logger.error('Redis error:', err.message));
  }
  return redis;
}

/**
 * Get cached value
 */
export async function cacheGet(key) {
  const client = getRedis();
  if (!client) return null;

  try {
    const value = await client.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    logger.warn(`Redis GET error for ${key}:`, error.message);
    return null;
  }
}

/**
 * Set cached value with TTL
 */
export async function cacheSet(key, value, ttlSeconds = 3600) {
  const client = getRedis();
  if (!client) return false;

  try {
    await client.setex(key, ttlSeconds, JSON.stringify(value));
    return true;
  } catch (error) {
    logger.warn(`Redis SET error for ${key}:`, error.message);
    return false;
  }
}

/**
 * Delete cached value
 */
export async function cacheDelete(key) {
  const client = getRedis();
  if (!client) return false;

  try {
    await client.del(key);
    return true;
  } catch (error) {
    logger.warn(`Redis DEL error for ${key}:`, error.message);
    return false;
  }
}

/**
 * Check if Redis is available
 */
export function isRedisAvailable() {
  return !!process.env.REDIS_URL;
}
