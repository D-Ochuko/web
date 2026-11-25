'use client'

import { useEffect, useState } from 'react'
import { isApiConfigured, startAlertPolling } from '@/lib/alertSource'
import type { AlertPayload, Network } from '@/types'

export interface AlertSyncState {
  /** True while the last sync succeeded. */
  live: boolean
  /** Epoch ms of the last successful sync. */
  lastSync: number | null
  enabled: boolean
  /** Force an immediate poll cycle */
  syncNow: () => void
}

/**
 * Poll tx-watch-core for a contract's alerts while mounted. No-op when
 * NEXT_PUBLIC_API_URL is unset (localStorage-only mode).
 *
 * Alerts are keyed by (contractId, network) so the same contract ID
 * registered on different networks does not mix alert history.
 *
 * When `contractEnabled` is false the poller is stopped entirely so a paused
 * contract is not polled and does not fire notifications; it restarts when the
 * contract is resumed.
 */
export function useAlertSync(
  contractId: string | undefined,
  network: Network | string | undefined,
  onNew?: (fresh: AlertPayload[]) => void,
  contractEnabled: boolean = true
): AlertSyncState {
  const [state, setState] = useState<Omit<AlertSyncState, 'syncNow'>>({
    live: false,
    lastSync: null,
    enabled: false,
  })
  const [pollTrigger, setPollTrigger] = useState(0)

  const syncNow = () => setPollTrigger(p => p + 1)

  useEffect(() => {
    if (!contractId || !network || !isApiConfigured() || !contractEnabled) {
      setState((s) => ({ ...s, enabled: false }))
      return
    }
    setState((s) => ({ ...s, enabled: true }))
    return startAlertPolling(contractId, network, {
      onSync: (fresh, at) => {
        setState({ live: true, lastSync: at, enabled: true })
        if (fresh.length) onNew?.(fresh)
      },
      onError: () => setState((s) => ({ ...s, live: false })),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId, network, pollTrigger, contractEnabled])

  return { ...state, syncNow }
}

/**
 * Poll tx-watch-core for every enabled contract while mounted. This is the
 * app-level runner (mounted once in the layout) so alerts sync and browser
 * notifications fire regardless of which page is open. No-op when
 * NEXT_PUBLIC_API_URL is unset (localStorage-only mode).
 *
 * Alerts are keyed by (contractId, network) so the same contract ID
 * registered on different networks does not mix alert history.
 */
export function useAlertSyncAll(
  contracts: Array<{ id: string; network: Network | string }>,
  onNew?: (fresh: AlertPayload[], contractId: string, network: Network | string) => void
): AlertSyncState {
  const [state, setState] = useState<Omit<AlertSyncState, 'syncNow'>>({
    live: false,
    lastSync: null,
    enabled: false,
  })
  const [pollTrigger, setPollTrigger] = useState(0)

  const syncNow = () => setPollTrigger(p => p + 1)

  // Stable key so the effect only re-runs when the set of contracts changes.
  const contractsKey = contracts
    .map((c) => `${c.id}:${c.network}`)
    .sort()
    .join('|')

  useEffect(() => {
    if (!isApiConfigured() || !contracts.length) return
    setState((s) => ({ ...s, enabled: true }))

    const cleanups = contracts.map(({ id, network }) =>
      startAlertPolling(id, network, {
        onSync: (fresh, at) => {
          setState({ live: true, lastSync: at, enabled: true })
          if (fresh.length) onNew?.(fresh, id, network)
        },
        onError: () => setState((s) => ({ ...s, live: false })),
      })
    )

    return () => cleanups.forEach((stop) => stop())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractsKey, pollTrigger])

  return { ...state, syncNow }
}

/**
 * Recompute a derived value (e.g. today's alert count) whenever the window
 * regains focus or the local day rolls over at midnight, so the Dashboard
 * stays fresh without a reload.
 */
export function useDailyRefresh(recompute: () => void): void {
  useEffect(() => {
    const onFocus = () => recompute()
    window.addEventListener('focus', onFocus)

    let timer: ReturnType<typeof setTimeout>
    const scheduleMidnight = () => {
      const now = new Date()
      const midnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        0,
        0
      )
      timer = setTimeout(() => {
        recompute()
        scheduleMidnight()
      }, midnight.getTime() - now.getTime())
    }
    scheduleMidnight()

    return () => {
      window.removeEventListener('focus', onFocus)
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
