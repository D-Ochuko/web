/**
 * Fixed-window rate limiting for server routes (server-only).
 *
 * The limiter asks a RateLimitStore for the hit count of a key in the window
 * that contains `now`. The default store is in-memory and per process, so each
 * serverless function or app instance keeps its own counts and a client can
 * get `limit` requests per instance. To enforce one limit across instances,
 * implement RateLimitStore over a shared store (for example Upstash Redis
 * with INCR and PEXPIRE on the key) and pass it to createRateLimiter.
 * See docs/rate-limiting.md.
 */

export interface RateLimitWindow {
  /** Hits recorded for the key in this window, including the current one. */
  count: number
  /** Unix ms at which the window opened. */
  windowStart: number
}

export interface RateLimitStore {
  /**
   * Records one hit for `key` in the fixed window containing `now` and returns
   * that window. The store owns expiry; it may drop windows older than
   * `windowMs`. Implementations must make the increment atomic when several
   * instances share the store.
   */
  hit(key: string, windowMs: number, now: number): Promise<RateLimitWindow>
}

export interface RateLimitDecision {
  allowed: boolean
  /** Milliseconds until the current window ends; meaningful when not allowed. */
  retryAfterMs: number
}

/** Upper bound on tracked keys before expired windows are swept. */
const MAX_TRACKED_KEYS = 10_000

/** Per-process store. Counts are lost on restart and not shared. */
export function createMemoryRateLimitStore(): RateLimitStore {
  const windows = new Map<string, { start: number; count: number }>()
  return {
    async hit(key, windowMs, now) {
      if (windows.size > MAX_TRACKED_KEYS) {
        windows.forEach((w, k) => {
          if (now - w.start >= windowMs) windows.delete(k)
        })
      }
      let w = windows.get(key)
      if (!w || now - w.start >= windowMs) {
        w = { start: now, count: 0 }
        windows.set(key, w)
      }
      w.count += 1
      return { count: w.count, windowStart: w.start }
    },
  }
}

/**
 * Allows `limit` requests per `windowMs` for each key. Pass a shared store to
 * enforce the limit across instances; the default is per process.
 */
export function createRateLimiter(
  limit: number,
  windowMs: number,
  store: RateLimitStore = createMemoryRateLimitStore()
) {
  return async (key: string, now = Date.now()): Promise<RateLimitDecision> => {
    const { count, windowStart } = await store.hit(key, windowMs, now)
    return {
      allowed: count <= limit,
      retryAfterMs: windowStart + windowMs - now,
    }
  }
}
