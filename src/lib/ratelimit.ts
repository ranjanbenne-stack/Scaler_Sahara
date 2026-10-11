import type { Deps } from "./deps";

/**
 * Fixed-window rate limiter stored in the app's SQLite file.
 * Returns true if the action is allowed.
 */
export async function rateLimit(deps: Pick<Deps, "db" | "now">, key: string, limit: number, windowMs: number): Promise<boolean> {
  const nowMs = deps.now().getTime();
  const windowStart = new Date(nowMs - (nowMs % windowMs));
  const bucket = await deps.db.rateLimitBucket.upsert({
    where: { key_windowStart: { key, windowStart } },
    create: { key, windowStart, count: 1 },
    update: { count: { increment: 1 } },
  });
  return bucket.count <= limit;
}

export async function pruneRateLimits(deps: Pick<Deps, "db" | "now">, olderThanMs = 60 * 60_000): Promise<void> {
  await deps.db.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(deps.now().getTime() - olderThanMs) } } });
}
