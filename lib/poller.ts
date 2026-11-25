export type PollerOptions<T> = {
  intervalMs: number;
  fetch: () => Promise<T>;
  onData: (data: T) => void;
  onError?: (error: unknown) => void;
  maxBackoffMs?: number;
};

export type Poller<T> = {
  start: () => void;
  stop: () => void;
  pollNow: () => void;
  getFailures: () => number;
  getNextAllowedAt: () => number;
};

const DEFAULT_MAX_BACKOFF_MS = 5 * 60 * 1000;

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return null;
}

export function createPoller<T>(options: PollerOptions<T>): Poller<T> {
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let failures = 0;
  let nextAllowedAt = 0;
  let inFlight = false;

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(delayMs: number) {
    clearTimer();
    if (!running) return;
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, Math.max(0, delayMs));
  }

  function backoffDelay(): number {
    if (failures <= 0) return options.intervalMs;
    const exp = Math.min(maxBackoffMs, options.intervalMs * 2 ** (failures - 1));
    return exp;
  }

  async function run() {
    if (inFlight) return;
    const now = Date.now();
    if (now < nextAllowedAt) {
      schedule(nextAllowedAt - now);
      return;
    }
    inFlight = true;
    try {
      const data = await options.fetch();
      failures = 0;
      nextAllowedAt = 0;
      options.onData(data);
      schedule(options.intervalMs);
    } catch (error) {
      failures += 1;
      const retryAfterMs = extractRetryAfterMs(error);
      const delay = retryAfterMs ?? backoffDelay();
      nextAllowedAt = Date.now() + delay;
      options.onError?.(error);
      schedule(delay);
    } finally {
      inFlight = false;
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      void run();
    },
    stop() {
      running = false;
      clearTimer();
    },
    pollNow() {
      // Trigger an immediate poll without resetting failure count or the
      // earliest-allowed time. If we are still inside a backoff / Retry-After
      // window, run() will reschedule instead of firing.
      if (!running) {
        running = true;
      }
      clearTimer();
      void run();
    },
    getFailures() {
      return failures;
    },
    getNextAllowedAt() {
      return nextAllowedAt;
    },
  };
}

function extractRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const maybe = error as {
    retryAfter?: string | number | null;
    headers?: { get?: (name: string) => string | null } | Record<string, string>;
    response?: { headers?: { get?: (name: string) => string | null } };
  };
  if (maybe.retryAfter != null) {
    if (typeof maybe.retryAfter === "number") {
      return Math.max(0, maybe.retryAfter * 1000);
    }
    return parseRetryAfterMs(maybe.retryAfter);
  }
  const headers = maybe.response?.headers ?? maybe.headers;
  if (headers && typeof (headers as { get?: unknown }).get === "function") {
    return parseRetryAfterMs((headers as { get: (n: string) => string | null }).get("retry-after"));
  }
  if (headers && typeof headers === "object") {
    const record = headers as Record<string, string>;
    const value = record["retry-after"] ?? record["Retry-After"];
    return parseRetryAfterMs(value ?? null);
  }
  return null;
}
