/**
 * Alert polling helper.
 *
 * Foreground tabs poll at the normal interval. When the tab is hidden we keep
 * polling at a slower interval so browser notifications can still fire while
 * the user is looking elsewhere. Only a single leader tab performs background
 * polling (see #43) to avoid duplicate notifications across tabs.
 *
 * Remaining limit: polling cannot run when the browser is fully closed. Web
 * Push is tracked as a follow-up for that case.
 */

export const FOREGROUND_INTERVAL_MS = 30_000;
export const BACKGROUND_INTERVAL_MS = 120_000;

const LEADER_LOCK_NAME = 'alert-polling-leader';

export interface StartAlertPollingOptions {
  /** Poll callback. */
  poll: () => void | Promise<void>;
  /** Whether browser notifications are enabled; background polling requires this. */
  notificationsEnabled: boolean;
  /** Foreground interval in ms (defaults to FOREGROUND_INTERVAL_MS). */
  foregroundIntervalMs?: number;
  /** Background interval in ms (defaults to BACKGROUND_INTERVAL_MS). */
  backgroundIntervalMs?: number;
}

/**
 * Starts alert polling and returns a cleanup function.
 *
 * - Visible tab: polls at the foreground interval.
 * - Hidden tab with notifications enabled: polls at the slower background
 *   interval, but only in the leader tab.
 * - Hidden tab without notifications: pauses polling.
 */
export function startAlertPolling({
  poll,
  notificationsEnabled,
  foregroundIntervalMs = FOREGROUND_INTERVAL_MS,
  backgroundIntervalMs = BACKGROUND_INTERVAL_MS,
}: StartAlertPollingOptions): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let isLeader = false;
  let releaseLeader: (() => void) | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const runPoll = () => {
    if (stopped) return;
    void poll();
  };

  const acquireLeadership = () => {
    if (isLeader || typeof navigator === 'undefined') return;
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (!locks || typeof locks.request !== 'function') {
      // No Web Locks support: fall back to polling in every hidden tab.
      isLeader = true;
      return;
    }
    void locks
      .request(LEADER_LOCK_NAME, { ifAvailable: true }, (lock) => {
        if (!lock || stopped) return undefined;
        isLeader = true;
        schedule();
        return new Promise<void>((resolve) => {
          releaseLeader = resolve;
        });
      })
      .catch(() => {
        // Lock request failed; leave background polling disabled.
      });
  };

  const releaseLeadership = () => {
    isLeader = false;
    if (releaseLeader) {
      releaseLeader();
      releaseLeader = null;
    }
  };

  const schedule = () => {
    clearTimer();
    if (stopped) return;

    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';

    if (!hidden) {
      timer = setInterval(runPoll, foregroundIntervalMs);
      return;
    }

    if (!notificationsEnabled) {
      // Notifications disabled: no reason to poll while hidden.
      return;
    }

    if (!isLeader) {
      acquireLeadership();
      return;
    }

    timer = setInterval(runPoll, backgroundIntervalMs);
  };

  const handleVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      releaseLeadership();
    }
    schedule();
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  schedule();

  return () => {
    stopped = true;
    clearTimer();
    releaseLeadership();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
  };
}
