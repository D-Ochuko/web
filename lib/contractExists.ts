import { Address, xdr } from '@stellar/stellar-sdk'
import { isValidContractId, sorobanRpcUrl } from '@/lib/stellar'
import type { Network } from '@/types'

/**
 * Base64 `LedgerKey` XDR of a contract's instance entry: persistent contract
 * data keyed by `ScVal::LedgerKeyContractInstance`. Soroban RPC's
 * `getLedgerEntries` only accepts keys in this form. A contract that exists
 * on the target network has an entry under this key.
 */
export function contractInstanceLedgerKey(contractId: string): string {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    })
  ).toXDR('base64')
}

/** Default Soroban RPC timeout, in milliseconds. */
const CONTRACT_LOOKUP_TIMEOUT_MS = 8000

export type ContractLookupStatus =
  'found' | 'archived' | 'not_found' | 'invalid' | 'unavailable'

export interface ContractLookupResult {
  status: ContractLookupStatus
  /** Ledger sequence until which the instance entry is live (TTL expiry). */
  liveUntilLedgerSeq?: number
  /** Why the RPC could not be reached or answered with an error. */
  reason?: string
}

export interface ContractExistsOptions {
  /** Caller-owned signal, combined with the timeout. */
  signal?: AbortSignal
  timeoutMs?: number
}

/** Body of the Soroban RPC `getLedgerEntries` request for a contract instance. */
export function getLedgerEntriesRequest(contractId: string, id = 1): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'getLedgerEntries',
    params: {
      keys: [contractInstanceLedgerKey(contractId)],
    },
  })
}

/**
 * Checks whether a contract is deployed on the given network by asking that
 * network's Soroban RPC (from `SOROBAN_RPC_URLS` via `sorobanRpcUrl`) for its
 * contract instance ledger entry.
 *
 * An entry whose `liveUntilLedgerSeq` is behind `latestLedger` has expired
 * (TTL lapsed) and is reported as `archived`: the contract exists but must be
 * restored before it can be invoked. An entry that was already evicted from the
 * live ledger is indistinguishable from a missing one via `getLedgerEntries`
 * alone, so it still reads as `not_found`.
 *
 * Malformed IDs return `invalid` without calling the RPC.
 *
 * Returns `not_found` only when the RPC answered authoritatively with no
 * entry. RPC errors, timeouts and unparsable answers return `unavailable`, so
 * a flaky endpoint never blocks the user from saving a contract.
 */
export async function contractExists(
  network: Network,
  contractId: string,
  { signal, timeoutMs = CONTRACT_LOOKUP_TIMEOUT_MS }: ContractExistsOptions = {}
): Promise<ContractLookupResult> {
  const id = contractId.trim()
  if (!isValidContractId(id))
    return { status: 'invalid', reason: 'Malformed contract ID' }

  const controller = new AbortController()
  const onCallerAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onCallerAbort, { once: true })
  }
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(sorobanRpcUrl(network), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: getLedgerEntriesRequest(id),
      signal: controller.signal,
    })

    if (!res.ok) {
      return { status: 'unavailable', reason: `HTTP ${res.status}` }
    }

    const body = (await res.json()) as {
      result?: {
        entries?: { liveUntilLedgerSeq?: number }[]
        latestLedger?: number
      }
      error?: { message?: string } | string
    }

    if (body.error) {
      const reason =
        typeof body.error === 'string'
          ? body.error
          : (body.error.message ?? 'RPC error')
      return { status: 'unavailable', reason }
    }

    const entries = body.result?.entries
    if (!Array.isArray(entries)) {
      return { status: 'unavailable', reason: 'Unexpected RPC response' }
    }

    if (entries.length === 0) return { status: 'not_found' }

    const liveUntilLedgerSeq = entries[0]?.liveUntilLedgerSeq
    const latestLedger = body.result?.latestLedger
    if (
      typeof liveUntilLedgerSeq === 'number' &&
      typeof latestLedger === 'number' &&
      liveUntilLedgerSeq < latestLedger
    ) {
      return { status: 'archived', liveUntilLedgerSeq }
    }
    return typeof liveUntilLedgerSeq === 'number'
      ? { status: 'found', liveUntilLedgerSeq }
      : { status: 'found' }
  } catch (error) {
    const name = (error as { name?: string })?.name
    if (name === 'AbortError') {
      return signal?.aborted
        ? { status: 'unavailable', reason: 'Request cancelled' }
        : { status: 'unavailable', reason: 'RPC timed out' }
    }
    return {
      status: 'unavailable',
      reason: error instanceof Error ? error.message : 'RPC error',
    }
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onCallerAbort)
  }
}

/**
 * True when a deployment check result should stop a save: only an
 * authoritative `not_found` that the user has not overridden. `unavailable`,
 * `archived` and `invalid` never block here (format errors are validated
 * separately).
 */
export function deploymentBlocksSave(
  status: string,
  overridden: boolean
): boolean {
  return status === 'not_found' && !overridden
}
