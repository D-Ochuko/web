'use client'

import { useCallback, useEffect, useState } from 'react'
import { WatchWalletChanges } from '@stellar/freighter-api'
import { readFreighterConnection } from '@/lib/freighter'
import {
  broadcastWalletChange,
  subscribeWallet,
  type WalletChangePayload,
} from '@/lib/walletEvents'
  broadcastWalletChangeIfChanged,
  subscribeWallet,
} from '@/lib/walletEvents'
import { isUserDisconnected } from '@/lib/disconnectFlag'

/** Follow-up probes after the first one finds the extension unreachable. */
const LATE_DETECTION_DELAYS_MS = [1000, 2000, 4000]

/**
 * Single app-level watcher shared by every wallet-aware component.
 *
 * `WatchWalletChanges` is instantiated once and reference counted, so the
 * underlying extension polling runs at most once per app and is torn down when
 * the last consumer unmounts.
 */
let watcher: WatchWalletChanges | null = null
let watcherRefCount = 0
let lastAddress: string | null = null
let lastNetwork: string | null = null

function acquireWalletWatcher(): () => void {
  if (!watcher) {
    const instance = new WatchWalletChanges(5000)
    instance.watch((result) => {
      const address = result?.address ?? null
      const network = result?.network ?? null
      const networkPassphrase = result?.networkPassphrase ?? null
      if (address === lastAddress && network === lastNetwork) return
      lastAddress = address
      lastNetwork = network
      broadcastWalletChange({ address, network, networkPassphrase })
      // Do not undo an in-app disconnect while the site is still approved.
      if (address && isUserDisconnected()) return
      broadcastWalletChange(address)
    })
    watcher = instance
  }
  watcherRefCount += 1

  let released = false
  return () => {
    if (released) return
    released = true
    watcherRefCount -= 1
    if (watcherRefCount <= 0 && watcher) {
      watcher.stop()
      watcher = null
      watcherRefCount = 0
    }
  }
}

/**
 * Mount the shared wallet watcher for the lifetime of the calling component.
 * Safe to call from any number of components; only one watcher ever runs.
 */
export function useWalletWatcher(): void {
  useEffect(() => acquireWalletWatcher(), [])
}

export interface WalletState {
  /** Connected public key, or null while disconnected. Single source of truth. */
  publicKey: string | null
  /** Active Freighter network, or null while unknown/disconnected. */
  network: string | null
  /** Passphrase of the active Freighter network, or null while unknown. */
  networkPassphrase: string | null
  /** Freighter network id, e.g. `"TESTNET"`. */
  network: string | null
  /** True once the initial Freighter connection probe has settled. */
  initialized: boolean
  /** Set the wallet state everywhere, including this instance. */
  publish: (
    publicKey: string | null,
    network?: string | null,
    networkPassphrase?: string | null,
  ) => void
}

/**
 * Shared wallet state for every wallet-aware component.
 *
 * This is the single source of truth for the connected wallet public key.
 * Nothing is persisted to localStorage or window — legacy values left by older
 * builds are cleared by lib/walletEvents.ts on module load and on every
 * broadcast. Connecting or disconnecting from one component updates all others
 * via the `txwatch:wallet` event bus.
 */
export function useWalletState(): WalletState {
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [network, setNetwork] = useState<string | null>(null)
  const [networkPassphrase, setNetworkPassphrase] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)

  const publish = useCallback(
    (
      next: string | null,
      nextNetwork: string | null = null,
      nextNetworkPassphrase: string | null = null,
    ) => {
      setPublicKey(next)
      setNetwork(nextNetwork)
      setNetworkPassphrase(nextNetworkPassphrase)
      broadcastWalletChange({
        address: next,
        network: nextNetwork,
        networkPassphrase: nextNetworkPassphrase,
      })
    },
    [],
  )

  // One shared watcher for the whole app; no per-instance polling.
  useWalletWatcher()

  useEffect(() => {
    let cancelled = false

    async function probe() {
      let connection: Awaited<ReturnType<typeof readFreighterConnection>> = null
      try {
        const connection = await readFreighterConnection()
        if (!connection?.publicKey || cancelled) return
        publish(
          connection.publicKey,
          connection.network ?? null,
          connection.networkPassphrase ?? null,
        )
        connection = await readFreighterConnection()
      } catch {
        // Extension refused to answer; stay in the disconnected state.
      }
      if (cancelled) return
      if (connection?.publicKey) {
        setPublicKey(connection.publicKey)
        setNetwork(connection.network ?? null)
        broadcastWalletChangeIfChanged(connection.publicKey)
      }
      setInitialized(true)

      // The extension can inject its API after the first probe on a slow
      // machine. `null` means "not reachable" (as opposed to a reachable but
      // locked wallet), so keep checking for a short window in the background
      // instead of leaving the user on a false "not connected" state (#527).
      for (const delay of LATE_DETECTION_DELAYS_MS) {
        if (connection) return
        await new Promise((resolve) => setTimeout(resolve, delay))
        if (cancelled) return
        try {
          connection = await readFreighterConnection()
        } catch {
          connection = null
        }
        if (cancelled) return
        if (connection?.publicKey) {
          setPublicKey(connection.publicKey)
          setNetwork(connection.network ?? null)
          broadcastWalletChangeIfChanged(connection.publicKey)
        }
      }
    }

    probe()

    return () => {
      cancelled = true
    }
  }, [publish])

  // `subscribeWallet` returns its own unsubscribe, which is exactly the
  // cleanup this effect needs.
  useEffect(
    () =>
      subscribeWallet((payload: WalletChangePayload) => {
        setPublicKey(payload.address)
        setNetwork(payload.network)
        setNetworkPassphrase(payload.networkPassphrase)
      }),
    [],
  )

  return { publicKey, network, networkPassphrase, initialized, publish }
  return { publicKey, network, initialized, publish }
}
