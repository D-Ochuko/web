'use client';

import { useEffect, useRef, useState } from 'react';
import { isApiConfigured } from '@/lib/api';
import { getQueue } from '@/lib/syncQueue';
import { runSyncRetries } from '@/lib/syncRetry';

const QUEUE_STORAGE_KEY = 'sync-queue';

function getEarliestNextAttemptAt(): number | null {
  const queue = getQueue();
  if (!queue || queue.length === 0) return null;
  let earliest: number | null = null;
  for (const item of queue) {
    const next = item?.nextAttemptAt;
    if (typeof next !== 'number') continue;
    if (earliest === null || next < earliest) earliest = next;
  }
  return earliest;
}

export function SyncRetryRunner() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visible, setVisible] = useState(
    typeof document === 'undefined' ? true : !document.hidden
  );

  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!isApiConfigured()) return;
    if (!visible) return;

    let cancelled = false;

    const clearTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const schedule = () => {
      clearTimer();
      if (cancelled) return;
      const earliest = getEarliestNextAttemptAt();
      if (earliest === null) return;
      const delay = Math.max(0, earliest - Date.now());
      timerRef.current = setTimeout(async () => {
        timerRef.current = null;
        if (cancelled) return;
        try {
          await runSyncRetries();
        } finally {
          schedule();
        }
      }, delay);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === QUEUE_STORAGE_KEY) {
        schedule();
      }
    };

    window.addEventListener('storage', onStorage);
    schedule();

    return () => {
      cancelled = true;
      clearTimer();
      window.removeEventListener('storage', onStorage);
    };
  }, [visible]);

  return null;
}

export function OfflineBanner() {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const refreshCount = () => {
      const queue = getQueue();
      setPendingCount(queue ? queue.length : 0);
    };

    const onOnline = () => {
      setOnline(true);
      refreshCount();
    };
    const onOffline = () => {
      setOnline(false);
      refreshCount();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === QUEUE_STORAGE_KEY) {
        refreshCount();
      }
    };

    refreshCount();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const handleRetryAll = async () => {
    setRetrying(true);
    try {
      await runSyncRetries();
    } finally {
      const queue = getQueue();
      setPendingCount(queue ? queue.length : 0);
      setRetrying(false);
    }
  };

  if (online && pendingCount === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.75rem',
        padding: '0.5rem 1rem',
        background: online ? '#fef3c7' : '#fee2e2',
        color: '#111827',
        fontSize: '0.875rem',
      }}
    >
      <span>
        {online ? 'Back online' : 'You are offline'}
        {pendingCount > 0
          ? ` — ${pendingCount} change${pendingCount === 1 ? '' : 's'} waiting to sync`
          : ''}
      </span>
      {pendingCount > 0 && (
        <button
          type="button"
          onClick={handleRetryAll}
          disabled={retrying}
          style={{
            padding: '0.25rem 0.75rem',
            borderRadius: '0.375rem',
            border: '1px solid #111827',
            background: 'transparent',
            color: '#111827',
            cursor: retrying ? 'default' : 'pointer',
            fontSize: '0.8125rem',
          }}
        >
          {retrying ? 'Retrying…' : 'Retry all'}
        </button>
      )}
    </div>
  );
}
