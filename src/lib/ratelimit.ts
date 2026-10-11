import type { Deps } from "./deps";
import { utcTs } from "./db";

/**
 * Fixed-window rate limiter backed by PostgreSQL, so it holds across multiple
 * app instances and the worker. Returns true if the action is allowed.
 */
export async function rateLimit(deps: Pick<Deps, "db" | "now">, key: string, limit: number, windowMs: number): Promise<boolean> {
  const nowMs = deps.now().getTime();
  const windowStart = new Date(nowMs - (nowMs % windowMs));
  const rows = await deps.db.$queryRaw<{ count: number }[]>`
    INSERT INTO rate_limit_buckets (key, "windowStart", count) VALUES (${key}, ${utcTs(windowStart)}, 1)
    ON CONFLICT (key, "windowStart") DO UPDATE SET count = rate_limit_buckets.count + 1
    RETURNING count`;
  return (rows[0]?.count ?? 0) <= limit;
}

export async function pruneRateLimits(deps: Pick<Deps, "db" | "now">, olderThanMs = 60 * 60_000): Promise<void> {
  await deps.db.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(deps.now().getTime() - olderThanMs) } } });
}
