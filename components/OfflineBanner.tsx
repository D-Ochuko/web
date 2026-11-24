'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSyncQueue } from '@/lib/syncQueue';
import { runSyncRetry } from '@/lib/syncRetryRunner';

export default function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(true);
  const [queueCount, setQueueCount] = useState(0);
  const [retrying, setRetrying] = useState(false);

  const refreshQueue = useCallback(() => {
    try {
      const queue = getSyncQueue();
      setQueueCount(Array.isArray(queue) ? queue.length : 0);
    } catch {
      setQueueCount(0);
    }
  }, []);

  useEffect(() => {
    if (typeof navigator !== 'undefined') {
      setIsOnline(navigator.onLine);
    }
    refreshQueue();

    const handleOnline = () => {
      setIsOnline(true);
      refreshQueue();
    };
    const handleOffline = () => {
      setIsOnline(false);
      refreshQueue();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('sync-queue-changed', refreshQueue);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('sync-queue-changed', refreshQueue);
    };
  }, [refreshQueue]);

  const handleRetryAll = useCallback(async () => {
    setRetrying(true);
    try {
      await runSyncRetry();
    } finally {
      refreshQueue();
      setRetrying(false);
    }
  }, [refreshQueue]);

  const showBanner = !isOnline || queueCount > 0;

  if (!showBanner) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900"
    >
      <span>
        {!isOnline ? 'You are offline. ' : ''}
        {queueCount > 0
          ? `${queueCount} change${queueCount === 1 ? '' : 's'} waiting to sync`
          : 'Changes will sync when you are back online.'}
      </span>
      {queueCount > 0 && (
        <button
          type="button"
          onClick={handleRetryAll}
          disabled={retrying}
          className="rounded border border-amber-400 bg-amber-200 px-3 py-1 font-medium hover:bg-amber-300 disabled:opacity-60"
        >
          {retrying ? 'Retrying…' : 'Retry all'}
        </button>
      )}
    </div>
  );
}
