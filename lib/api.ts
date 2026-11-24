import { horizonUrl, isValidContractId } from '@/lib/stellar'
import { SIGNATURE_HEADER, signWebhookPayload } from './webhookSignature'
import { sanitizeBodySnippet } from './bodySnippet'
import { getAuthorizationHeader, notifyAuthRequired } from './apiAuth'
import type { AlertPayload, AlertRule, Network } from '@/types'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

/**
 * Whether the app is running in API mode, i.e. a backend API URL is
 * configured. Single source of truth for API-mode detection.
 */
export function isApiConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_API_URL)
}

/** Default request timeout for apiFetch, in milliseconds. */
export const API_TIMEOUT_MS = 15000

/** Join a base URL and a path with exactly one slash between them. */
export function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  if (!base) return path
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

/** Non-2xx response from apiFetch, carrying the status and any Retry-After hint. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Parsed Retry-After header in milliseconds, when present. */
    readonly retryAfterMs?: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(
  value: string | null,
  now = Date.now()
): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (value.trim() !== '' && Number.isFinite(seconds))
    return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - now)
}

/**
 * Extract a human-readable message from a parsed error body. Handles plain
 * `message`/`error` strings, nested `error.message`, `errors[0].message`, and
 * RFC 7807 `detail`. Returns `undefined` when no string message is found.
 */
export function extractErrorMessage(body: unknown): string | undefined {
  if (typeof body === 'string') return body || undefined
  if (!body || typeof body !== 'object') return undefined
  const obj = body as Record<string, unknown>
  if (typeof obj.message === 'string' && obj.message) return obj.message
  if (typeof obj.error === 'string' && obj.error) return obj.error
  if (obj.error && typeof obj.error === 'object') {
    const nested = (obj.error as Record<string, unknown>).message
    if (typeof nested === 'string' && nested) return nested
  }
  if (Array.isArray(obj.errors)) {
    const first = obj.errors[0]
    if (first && typeof first === 'object') {
      const nested = (first as Record<string, unknown>).message
      if (typeof nested === 'string' && nested) return nested
    } else if (typeof first === 'string' && first) {
      return first
    }
  }
  if (typeof obj.detail === 'string' && obj.detail) return obj.detail
  return undefined
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit & { timeoutMs?: number }
): Promise<T> {
  const { timeoutMs = API_TIMEOUT_MS, ...init } = options ?? {}
  const headers = new Headers(init.headers)
  if (init.body != null && !headers.has('content-type')) {
    headers.set('Content-Type', 'application/json')
  }
  // Credentials go only to the core (relative paths), never to absolute URLs.
  if (!/^https?:\/\//i.test(path) && !headers.has('authorization')) {
    const authorization = await getAuthorizationHeader()
    if (authorization) headers.set('Authorization', authorization)
  }

  // Combine the caller's signal (if any) with a timeout signal.
  const controller = new AbortController()
  const onCallerAbort = () => controller.abort()
  if (init.signal) {
    if (init.signal.aborted) controller.abort()
    else init.signal.addEventListener('abort', onCallerAbort, { once: true })
  }
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(joinUrl(BASE_URL, path), {
      ...init,
      headers,
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text()
      let message = `HTTP ${res.status}`
      if (text) {
        try {
          const body = JSON.parse(text)
          message = extractErrorMessage(body) ?? text
        } catch {
          message = text
        }
      }
      if (res.status === 401) notifyAuthRequired()
      throw new ApiError(
        message,
        res.status,
        parseRetryAfter(res.headers?.get('retry-after') ?? null)
      )
    }

    if (res.status === 204) return undefined as T
    const contentType = res.headers?.get('content-type') ?? ''
    if (!/\bapplication\/(?:[\w.+-]*\+)?json\b/i.test(contentType)) {
      throw new ApiError('API returned non-JSON response', res.status)
    }
    const text = await res.text()
    if (!text) return undefined as T
    return JSON.parse(text) as T
  } catch (error) {
    if (
      (error as { name?: string })?.name === 'AbortError' &&
      !init.signal?.aborted
    ) {
      throw new Error('Request timed out')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
    init.signal?.removeEventListener('abort', onCallerAbort)
  }
}

/**
 * Cheap authenticated endpoint used by the Settings "Test connection" action
 * to validate the currently stored API key. Resolves on success and throws an
 * `ApiError` (e.g. 401) when the key is missing or rejected.
 */
export async function testApiConnection(): Promise<void> {
  await apiFetch<unknown>('/auth/me', { timeoutMs: 8000 })
}

/** Result of a test webhook delivery: the HTTP status and whether it succeeded. */
export interface TestWebhookResult {
  /** The receiver's HTTP status (not the proxy's). */
  status: number
  ok: boolean
  /** Round-trip time to the receiver, in milliseconds. */
  durationMs?: number
  /** Sanitised first bytes (max 1 KB) of a text response body. */
  bodySnippet?: string | null
  /** Why the delivery could not be made (e.g. blocked URL, timeout). */
  error?: string
}

/**
 * Syntactically valid but non-existent transaction hash (64 lowercase hex
 * chars) used for simulated alerts, so receivers that parse the hash do not
 * reject the payload before they can branch on the rule.
 */
export const TEST_TX_HASH = 'ab'.repeat(32)

/** Valid placeholder contract (all-zero hash) for tests sent before a contract ID is entered. */
export const TEST_CONTRACT_ID =
  'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4'

/** Human-readable label for a rule, used in the test-payload rule picker. */
export function describeRule(rule: AlertRule): string {
  switch (rule.type) {
    case 'LargeTransfer':
      return `${rule.type} (over ${rule.threshold_xlm} XLM)`
    case 'FunctionCalled':
      return `${rule.type} (${rule.function_name.trim()})`
    case 'AdminFunctionCalled':
      return `${rule.type} (${rule.function_names.join(', ')})`
    default:
      return rule.type
  }
}

export interface BuildTestWebhookPayloadOptions {
  contractId: string
  network?: Network
  /** Configured rule to simulate. Defaults to `AnyTransaction`. */
  rule?: AlertRule
  label?: string
  /** Overridable for deterministic previews/tests; defaults to now. */
  timestamp?: number
  /** Overridable for deterministic previews/tests; defaults to `TEST_TX_HASH`. */
  transactionHash?: string
}

/**
 * Builds the JSON body sent to a webhook receiver for a test delivery.
 *
 * The payload mirrors a real alert for the simulated rule: `rule_triggered`
 * follows the rule, rule-specific fields (`function_name`, `amount`) are
 * filled in from its configuration, and `horizon_link` points at the network's
 * Horizon with the same hash carried in `transaction_hash`, so a receiver can
 * parse the link. `is_test: true` marks the delivery as simulated.
 */
export function buildTestWebhookPayload({
  contractId,
  network = 'testnet',
  rule,
  label = 'Test Alert',
  timestamp = Date.now(),
  transactionHash = TEST_TX_HASH,
}: BuildTestWebhookPayloadOptions): AlertPayload {
  const triggered = rule?.type ?? 'AnyTransaction'
  const payload: AlertPayload = {
    contract_id: contractId,
    transaction_hash: transactionHash,
    event_type: triggered,
    rule_triggered: triggered,
    timestamp,
    horizon_link: `${horizonUrl(network)}/transactions/${transactionHash}`,
    is_test: true,
    label,
  }
  if (rule?.type === 'LargeTransfer') {
    payload.amount = rule.threshold_xlm
  } else if (rule?.type === 'FunctionCalled') {
    payload.function_name = rule.function_name.trim()
  } else if (rule?.type === 'AdminFunctionCalled') {
    payload.function_name = rule.function_names[0]?.trim()
  }
  return payload
}

/**
 * Minimal shape of a queued sync retry. The runner only needs the scheduled
 * attempt time to decide when to wake up; the actual retry execution is
 * handled elsewhere.
 */
export interface SyncRetryEntry {
  nextAttemptAt: number
}

/** localStorage key holding the pending sync-retry queue. */
export const SYNC_RETRY_QUEUE_KEY = 'sync-retry-queue'

/** Read the pending sync-retry queue from localStorage, tolerating bad data. */
export function readSyncRetryQueue(): SyncRetryEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(SYNC_RETRY_QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is SyncRetryEntry =>
        entry != null && typeof entry.nextAttemptAt === 'number'
    )
  } catch {
    return []
  }
}

/**
 * Starts the sync-retry runner. Returns a cleanup function that stops the
 * runner and removes all listeners/timers.
 *
 * Behaviour (issue #382):
 * - No-op when the API is not configured.
 * - Schedules a single timer for the earliest `nextAttemptAt` instead of
 *   polling on a fixed interval.
 * - Re-arms when the queue changes (storage events and a custom event).
 * - Pauses while the tab is hidden and resumes when it becomes visible.
 */
export function startSyncRetries(
  onRetry: (entry: SyncRetryEntry) => void = () => {}
): () => void {
  if (typeof window === 'undefined' || !isApiConfigured()) {
    return () => {}
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const runDue = () => {
    timer = null
    if (stopped || document.hidden) return
    const now = Date.now()
    const queue = readSyncRetryQueue()
    for (const entry of queue) {
      if (entry.nextAttemptAt <= now) onRetry(entry)
    }
    arm()
  }

  const arm = () => {
    clearTimer()
    if (stopped || document.hidden) return
    const queue = readSyncRetryQueue()
    if (queue.length === 0) return
    const earliest = queue.reduce(
      (min, entry) => Math.min(min, entry.nextAttemptAt),
      Number.POSITIVE_INFINITY
    )
    const delay = Math.max(0, earliest - Date.now())
    timer = setTimeout(runDue, delay)
  }

  const onVisibilityChange = () => {
    if (document.hidden) clearTimer()
    else arm()
  }

  const onQueueChange = () => arm()

  window.addEventListener('storage', onQueueChange)
  window.addEventListener('sync-retry-queue-changed', onQueueChange)
  document.addEventListener('visibilitychange', onVisibilityChange)

  arm()

  return () => {
    stopped = true
    clearTimer()
    window.removeEventListener('storage', onQueueChange)
    window.removeEventListener('sync-retry-queue-changed', onQueueChange)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}
