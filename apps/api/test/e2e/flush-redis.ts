import { Redis } from "ioredis";

/**
 * Rate-limit counters live in the same real Redis instance across every e2e
 * file in this suite. Flush before each file's app starts so one file's
 * request volume can't push another file's rate-limit assertions off.
 */
export async function flushRateLimitState(): Promise<void> {
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  const keys = await redis.keys("ratelimit:*");
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
}
