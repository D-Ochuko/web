'use client'

import { useEffect, useState } from 'react'
import { contractExists, type ContractLookupStatus } from '@/lib/contractExists'
import { isValidContractId } from '@/lib/stellar'
import type { Network } from '@/types'

export type CheckState = 'idle' | 'checking' | ContractLookupStatus

interface ContractVerificationProps {
  network: Network
  contractId: string
  className?: string
  /** Current check state, owned by the parent so it can gate saving. */
  status: CheckState
  /** Optional reason reported by the lookup when it could not verify. */
  reason?: string | null
  /** Ledger until which the contract instance is live, when known. */
  liveUntilLedgerSeq?: number | null
  /** Whether the user has acknowledged a "not found" result. */
  overridden: boolean
  onOverrideChange: (overridden: boolean) => void
  /** Called with every result of the debounced deployment check. */
  onStatusChange: (
    status: CheckState,
    reason?: string | null,
    liveUntilLedgerSeq?: number | null
  ) => void
}

/** Re-check after this long without typing, to avoid a request per keystroke. */
const DEBOUNCE_MS = 600

/**
 * Checks that the entered contract is actually deployed on the selected
 * network, so a valid-looking ID from another network (or one that was never
 * deployed) does not silently produce zero alerts.
 *
 * A definitive "not found" is a warning with an override, never a hard block,
 * and an unreachable RPC is reported without blocking the form.
 */
export default function ContractVerification({
  network,
  contractId,
  className = '',
  status,
  reason = null,
  liveUntilLedgerSeq = null,
  overridden,
  onOverrideChange,
  onStatusChange,
}: ContractVerificationProps) {
  const id = contractId.trim()
  const checkable = isValidContractId(id)
  const state = status
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    onOverrideChange(false)
    if (!checkable) {
      onStatusChange('idle', null)
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      onStatusChange('checking', null)
      const result = await contractExists(network, id, {
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      onStatusChange(
        result.status,
        result.reason ?? null,
        result.liveUntilLedgerSeq ?? null
      )
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // onOverrideChange/onStatusChange are expected to be stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, network, checkable, attempt])

  if (!checkable) return null

  if (state === 'idle') return null

  if (state === 'checking') {
    return (
      <p
        role="status"
        className={`flex items-center gap-2 text-xs text-zinc-500 ${className}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-700 animate-pulse" />
        Checking deployment on {network}…
      </p>
    )
  }

  if (state === 'found') {
    return (
      <p className={`text-xs text-emerald-400 ${className}`}>
        Contract found on {network}
        {liveUntilLedgerSeq != null
          ? ` (live until ledger ${liveUntilLedgerSeq})`
          : ''}
        .
      </p>
    )
  }

  if (state === 'archived') {
    return (
      <p role="status" className={`text-xs text-amber-400 ${className}`}>
        Contract found on {network}, but its storage has expired (TTL
        {liveUntilLedgerSeq != null
          ? ` ended at ledger ${liveUntilLedgerSeq}`
          : ' lapsed'}
        ) and it is archived. It must be restored before it can be invoked.
        Saving is not blocked.
      </p>
    )
  }

  if (state === 'unavailable') {
    return (
      <p className={`text-xs text-zinc-500 ${className}`}>
        Could not verify the deployment on {network}
        {reason ? ` (${reason})` : ''}. Saving is not blocked.{' '}
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          className="underline text-zinc-400 hover:text-zinc-200"
        >
          Retry check
        </button>
      </p>
    )
  }

  if (state === 'invalid') {
    return (
      <p role="alert" className={`text-xs text-red-400 ${className}`}>
        This is not a valid contract ID{reason ? ` (${reason})` : ''}.
      </p>
    )
  }

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <p role="alert" className="text-xs text-amber-400">
        Contract not found on {network}. It may be deployed on another network,
        or the address may be wrong — alerts for it would never fire.
      </p>
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <input
          type="checkbox"
          checked={overridden}
          onChange={(e) => onOverrideChange(e.target.checked)}
          className="accent-indigo-600"
        />
        I know this contract is deployed on {network} — save anyway
      </label>
    </div>
  )
}
