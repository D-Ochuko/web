'use client'

import { useFreighter } from '@/lib/useFreighter'

/**
 * Thin compatibility wrapper around the canonical wallet hook.
 *
 * Historically this hook duplicated the connection probe and wallet-event
 * subscription logic, which risked drifting out of sync with the rest of the
 * app (issue #522). It now simply derives its state from `useFreighter` so all
 * consumers share a single source of truth for connection state.
 */
export function useFreighterConnection() {
  const { isConnected, publicKey, network, loading } = useFreighter()

  return { isConnected, publicKey, network, loading }
}
