import { isApiConfigured } from './api';

export interface SyncQueueItem {
  id: string;
  nextAttemptAt: number;
  [key: string]: unknown;
}

const QUEUE_STORAGE_KEY = 'syncQueue';

function readQueue(): SyncQueueItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SyncQueueItem[]) : [];
  } catch {
    return [];
  }
}

/**
 * Return the current pending sync queue. Used by the offline banner to show
 * how many changes are waiting to sync.
 */
export function getSyncQueue(): SyncQueueItem[] {
  return readQueue();
}

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let onDue: (() => void) | null = null;

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function scheduleNext(): void {
  clearTimer();
  if (!started) return;
  if (typeof document !== 'undefined' && document.hidden) return;

  const queue = readQueue();
  if (queue.length === 0) return;

  const now = Date.now();
  const earliest = queue.reduce(
    (min, item) => (item.nextAttemptAt < min ? item.nextAttemptAt : min),
    queue[0].nextAttemptAt,
  );
  const delay = Math.max(0, earliest - now);

  timer = setTimeout(() => {
    timer = null;
    if (onDue) onDue();
    scheduleNext();
  }, delay);
}

function handleVisibilityChange(): void {
  if (typeof document === 'undefined') return;
  if (document.hidden) {
    clearTimer();
  } else {
    scheduleNext();
  }
}

function handleStorage(event: StorageEvent): void {
  if (event.key === QUEUE_STORAGE_KEY || event.key === null) {
    scheduleNext();
  }
}

/**
 * Start the sync retry runner. Skips entirely when no API is configured.
 * Schedules a single timer for the earliest `nextAttemptAt` and re-arms on
 * queue changes and tab visibility changes.
 */
export function startSyncRetries(callback?: () => void): void {
  if (typeof window === 'undefined') return;
  if (!isApiConfigured()) return;
  if (started) return;

  started = true;
  onDue = callback ?? null;

  window.addEventListener('storage', handleStorage);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  scheduleNext();
}

/**
 * Re-arm the timer after a queue mutation performed in this tab.
 */
export function notifySyncQueueChanged(): void {
  if (!started) return;
  scheduleNext();
}

export function stopSyncRetries(): void {
  if (!started) return;
  started = false;
  onDue = null;
  clearTimer();
  if (typeof window !== 'undefined') {
    window.removeEventListener('storage', handleStorage);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }
}
