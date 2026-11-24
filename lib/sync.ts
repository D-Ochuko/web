import { SyncQueueItem, SyncResult } from './types';

const inFlight = new Set<string>();
const LEADER_LOCK_NAME = 'sync-retry-runner-leader';
const LEADER_CHANNEL_NAME = 'sync-retry-runner-leader';

/**
 * Runs `fn` only if this tab currently holds the leader lock.
 * Uses `navigator.locks` when available, falling back to a BroadcastChannel
 * based election so that only a single tab replays the sync queue at a time.
 */
async function withLeaderLock<T>(fn: () => Promise<T>): Promise<T | null> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks) {
    return navigator.locks.request(
      LEADER_LOCK_NAME,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          return null;
        }
        return fn();
      },
    );
  }

  return withBroadcastChannelLeader(fn);
}

/**
 * Fallback leader election for browsers without `navigator.locks`.
 * The first tab to claim the channel name becomes leader; other tabs skip.
 */
async function withBroadcastChannelLeader<T>(fn: () => Promise<T>): Promise<T | null> {
  if (typeof BroadcastChannel === 'undefined') {
    return fn();
  }

  const channel = new BroadcastChannel(LEADER_CHANNEL_NAME);
  let isLeader = true;

  const onMessage = (event: MessageEvent) => {
    if (event.data === 'leader-claim') {
      isLeader = false;
    }
  };

  channel.addEventListener('message', onMessage);
  channel.postMessage('leader-claim');

  // Give other tabs a tick to respond before deciding leadership.
  await new Promise((resolve) => setTimeout(resolve, 0));

  try {
    if (!isLeader) {
      return null;
    }
    return await fn();
  } finally {
    channel.removeEventListener('message', onMessage);
    channel.close();
  }
}

/**
 * Replays pending sync queue items. Only the elected leader tab performs the
 * replay, and the per-tab `inFlight` guard prevents overlapping runs within a
 * single tab.
 */
export async function retryPendingSyncs(
  getPending: () => Promise<SyncQueueItem[]>,
  send: (item: SyncQueueItem) => Promise<SyncResult>,
): Promise<void> {
  await withLeaderLock(async () => {
    const pending = await getPending();

    for (const item of pending) {
      if (inFlight.has(item.id)) {
        continue;
      }

      inFlight.add(item.id);
      try {
        await send(item);
      } finally {
        inFlight.delete(item.id);
      }
    }
  });
}
