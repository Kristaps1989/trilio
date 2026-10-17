// Fixed-window in-memory rate limiter for the single-instance Phase 1
// deployment. Move to Redis (Upstash) when there is more than one replica;
// the interface stays the same.

export type RateLimiter = {
  /** True when the call is allowed; false when the key has exhausted its window. */
  allow(key: string, now?: number): boolean;
};

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = 0;
  return {
    allow(key, now = Date.now()) {
      if (now - lastSweep > windowMs) {
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
        lastSweep = now;
      }
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      if (entry.count >= limit) return false;
      entry.count++;
      return true;
    },
  };
}

/** Best-effort client address behind Railway's proxy; falls back to a shared bucket. */
export function clientKey(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  const ip = fwd?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return ip;
}
