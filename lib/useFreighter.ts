'use client'

import { useState, useEffect, useCallback } from 'react'
import { broadcastWalletChange, subscribeWallet } from '@/lib/walletEvents'
import { setUserDisconnected } from '@/lib/disconnectFlag'
import { connectFreighter, readFreighterConnection } from '@/lib/freighter'

export interface FreighterState {
  publicKey: string | null
  network: string | null
  loading: boolean
  error: string | null
}

export interface UseFreighterResult extends FreighterState {
  isConnected: boolean
  connect: () => Promise<void>
  disconnect: () => void
  initialize: () => Promise<void>
}

/**
 * Canonical wallet hook (issue #522).
 *
 * This is the single source of truth for Freighter connection state. It owns
 * the public key, network, loading/error flags, and keeps localStorage and the
 * `window.__freighterPublicKey` global in sync via `broadcastWalletChange`.
 *
 * `useFreighterConnection` and `useWallet` are thin wrappers around this hook
 * and must not duplicate probe/subscribe logic.
 */
export function useFreighter(): UseFreighterResult {
  const [state, setState] = useState<FreighterState>({
    publicKey: null,
    network: null,
    loading: false,
    error: null,
  })

  const initialize = useCallback(async () => {
    try {
      const connection = await readFreighterConnection()
      if (connection?.publicKey) {
        setState({
          publicKey: connection.publicKey,
          network: connection.network,
          loading: false,
          error: null,
        })
        return
      }
      setState((prev) => ({ ...prev, loading: false }))
    } catch {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: 'Failed to initialize Freighter',
      }))
    }
  }, [])

  useEffect(() => {
    initialize()
  }, [initialize])

  useEffect(
    () =>
      subscribeWallet((event) => {
        setState((prev) => ({
          ...prev,
          publicKey: event.publicKey,
          network: event.network ?? prev.network,
        }))
      }),
    []
  )

  const connect = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const session = await connectFreighter()
      setState({
        publicKey: session.publicKey,
        network: session.network,
        loading: false,
        error: null,
      })
      if (!session.network) {
        // Network details were slow or failed after approval: re-read them in
        // the background instead of failing the connection.
        void readFreighterConnection()
          .then((connection) => {
            if (connection?.network) {
              setState((prev) => ({ ...prev, network: connection.network }))
            }
          })
          .catch(() => {
            // Leave the network unknown.
          })
      }
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Connection rejected',
      }))
    }
  }, [])

  const disconnect = useCallback(() => {
    setUserDisconnected()
    broadcastWalletChange(null)
    setState({ publicKey: null, network: null, loading: false, error: null })
  }, [])

  return {
    ...state,
    isConnected: Boolean(state.publicKey),
    connect,
    disconnect,
    initialize,
  }
}
