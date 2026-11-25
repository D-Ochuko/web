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
import type { Metadata, Viewport } from 'next'
import './globals.css'
import Link from 'next/link'
import FreighterConnect from '@/components/FreighterConnect'
import WalletStatusBadge from '@/components/WalletStatusBadge'
import MobileNav from '@/components/MobileNav'
import NavLink from '@/components/NavLink'
import AlertPruner from '@/components/AlertPruner'
import StorageBootstrap from '@/components/StorageBootstrap'
import ThemeToggle from '@/components/ThemeToggle'
import NotificationNavigationRegistrar from '@/components/NotificationNavigationRegistrar'
import AuthRequiredPrompt from '@/components/AuthRequiredPrompt'
import SyncRetryRunner from '@/components/SyncRetryRunner'
import AlertSyncRunner from '@/components/AlertSyncRunner'
import { ToastProvider } from '@/components/ToastProvider'
import { links } from '@/lib/links'

export const metadata: Metadata = {
  title: {
    default: 'TxWatch — Soroban Contract Monitoring',
    template: '%s — TxWatch',
  },
  description: 'Real-time monitoring and alerts for Soroban smart contracts',
  openGraph: {
    type: 'website',
    siteName: 'TxWatch',
    title: 'TxWatch — Soroban Contract Monitoring',
    description: 'Real-time monitoring and alerts for Soroban smart contracts',
  },
  robots: { index: true, follow: true },
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
    <html lang="en" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100">
        <ToastProvider>
          <StorageBootstrap />
          <NotificationNavigationRegistrar />
          <AuthRequiredPrompt />
          <SyncRetryRunner />
          <AlertSyncRunner />
          <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
              <Link
                href="/"
                className="flex items-center gap-2 font-bold text-lg tracking-tight"
              >
                <span className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-xs font-black">
                  TX
                </span>
                <span className="text-zinc-100">TxWatch</span>
              </Link>

              <nav className="hidden sm:flex items-center gap-6 text-sm">
                <NavLink href="/dashboard" exact>
                  Dashboard
                </NavLink>
                <NavLink href="/contracts">Contracts</NavLink>
                <NavLink href="/settings" exact>
                  Settings
                </NavLink>
                <a
                  href={links.org}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-400 hover:text-zinc-100 transition-colors"
                >
                  GitHub
                </a>
              </nav>

              <div className="hidden sm:flex items-center gap-3">
                <ThemeToggle />
                <WalletStatusBadge />
                <FreighterConnect />
              </div>
              <MobileNav />
            </div>
          </header>

          <AlertPruner />
          <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
            {children}
          </main>
        </ToastProvider>
      </body>
    </html>
  )
}
