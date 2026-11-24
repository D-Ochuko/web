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
