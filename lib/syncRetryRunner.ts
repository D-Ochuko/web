import { isApiConfigured } from "./api";

export interface SyncRetryQueueItem {
  id: string;
  nextAttemptAt: number;
  [key: string]: unknown;
}

const QUEUE_STORAGE_KEY = "syncRetryQueue";

let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let visibilityHandler: (() => void) | null = null;
let storageHandler: ((event: StorageEvent) => void) | null = null;

function readQueue(): SyncRetryQueueItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SyncRetryQueueItem[]) : [];
  } catch {
    return [];
  }
}

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function isHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function runDueRetries(): void {
  const now = Date.now();
  const queue = readQueue();
  const due = queue.filter((item) => item.nextAttemptAt <= now);
  if (due.length > 0 && typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("sync-retry-due", { detail: { items: due } }),
    );
  }
}

function scheduleNext(): void {
  clearTimer();

  if (!isApiConfigured() || isHidden()) return;

  const queue = readQueue();
  if (queue.length === 0) return;

  const earliest = queue.reduce(
    (min, item) => (item.nextAttemptAt < min ? item.nextAttemptAt : min),
    queue[0].nextAttemptAt,
  );

  const delay = Math.max(0, earliest - Date.now());
  timer = setTimeout(() => {
    timer = null;
    runDueRetries();
    scheduleNext();
  }, delay);
}

export function startSyncRetries(): void {
  if (started) return;
  if (typeof window === "undefined") return;
  if (!isApiConfigured()) return;

  started = true;

  storageHandler = (event: StorageEvent) => {
    if (event.key === QUEUE_STORAGE_KEY || event.key === null) {
      scheduleNext();
    }
  };
  window.addEventListener("storage", storageHandler);

  visibilityHandler = () => {
    if (isHidden()) {
      clearTimer();
    } else {
      scheduleNext();
    }
  };
  document.addEventListener("visibilitychange", visibilityHandler);

  scheduleNext();
}

export function stopSyncRetries(): void {
  started = false;
  clearTimer();

  if (typeof window !== "undefined" && storageHandler) {
    window.removeEventListener("storage", storageHandler);
  }
  storageHandler = null;

  if (typeof document !== "undefined" && visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
  }
  visibilityHandler = null;
}

export function notifySyncRetryQueueChanged(): void {
  if (!started) return;
  scheduleNext();
}
