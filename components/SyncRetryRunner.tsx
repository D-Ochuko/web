'use client'

import { useEffect } from 'react'
import { startSyncRetries } from '@/lib/contractSync'

const LOCK_NAME = 'contract-sync-retry-leader'
const CHANNEL_NAME = 'contract-sync-retry-leader'

/**
 * Elects a single leader tab so only one tab replays the sync queue (#377).
 * Prefers `navigator.locks`; falls back to a `BroadcastChannel` heartbeat.
 * Returns a cleanup function that releases leadership.
 */
function electLeader(onBecomeLeader: () => void): () => void {
  if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks) {
    let released = false
    let release: (() => void) | null = null

    navigator.locks
      .request(LOCK_NAME, { mode: 'exclusive' }, () => {
        if (released) return
        onBecomeLeader()
        return new Promise<void>((resolve) => {
          release = resolve
        })
      })
      .catch(() => {
        /* lock request aborted on unmount */
      })

    return () => {
      released = true
      release?.()
    }
  }

  if (typeof BroadcastChannel === 'undefined') {
    // No coordination primitive available: run as before.
    onBecomeLeader()
    return () => {}
  }

  const channel = new BroadcastChannel(CHANNEL_NAME)
  const tabId = Math.random().toString(36).slice(2)
  let isLeader = false
  let lastLeaderSeen = 0

  const claim = () => {
    isLeader = true
    lastLeaderSeen = Date.now()
    channel.postMessage({ type: 'leader', tabId })
    onBecomeLeader()
  }

  channel.onmessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; tabId?: string } | null
    if (!data || data.tabId === tabId) return
    if (data.type === 'leader') {
      lastLeaderSeen = Date.now()
      isLeader = false
    } else if (data.type === 'probe' && isLeader) {
      lastLeaderSeen = Date.now()
      channel.postMessage({ type: 'leader', tabId })
    }
  }

  channel.postMessage({ type: 'probe' })
  const startTimer = setTimeout(() => {
    if (!isLeader && Date.now() - lastLeaderSeen > 250) claim()
  }, 300)

  const heartbeat = setInterval(() => {
    if (isLeader) {
      lastLeaderSeen = Date.now()
      channel.postMessage({ type: 'leader', tabId })
    } else if (Date.now() - lastLeaderSeen > 2000) {
      claim()
    }
  }, 1000)

  return () => {
    clearTimeout(startTimer)
    clearInterval(heartbeat)
    channel.close()
  }
}

/** Replays failed contract syncs on load, on reconnect and as backoff elapses (#253). */
export default function SyncRetryRunner() {
  useEffect(() => {
    let stop: (() => void) | null = null
    const release = electLeader(() => {
      stop = startSyncRetries()
    })
    return () => {
      stop?.()
      release()
    }
  }, [])
  return null
}
