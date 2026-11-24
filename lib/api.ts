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
  const payload: AlertPayload = {
    label,
    contract_id: contractId,
    network,
    rule_triggered: rule?.type ?? 'AnyTransaction',
    transaction_hash: transactionHash,
    timestamp,
    horizon_link: `${horizonUrl(network)}/transactions/${transactionHash}`,
    is_test: true,
  }

  // Rule-specific fields match the variant tx-watch-core emits for that rule.
  switch (rule?.type) {
    case 'LargeTransfer':
      payload.amount = rule.threshold_xlm
      break
    case 'FunctionCalled':
      payload.function_name = rule.function_name.trim()
      break
    case 'AdminFunctionCalled':
      payload.function_name = rule.function_names[0]?.trim()
      break
    default:
      break
  }

  return payload
}

/**
 * The rule a test payload simulates, recovered from its rule-specific fields,
 * so the proxy can rebuild the same payload server-side (#261).
 */
export function ruleFromPayload(payload: AlertPayload): AlertRule | undefined {
  switch (payload.rule_triggered) {
    case 'LargeTransfer':
      return { type: 'LargeTransfer', threshold_xlm: payload.amount ?? 0 }
    case 'FunctionCalled':
      return {
        type: 'FunctionCalled',
        function_name: payload.function_name ?? '',
      }
    case 'AdminFunctionCalled':
      return {
        type: 'AdminFunctionCalled',
        function_names: [payload.function_name ?? ''],
      }
    case 'AnyTransaction':
    case 'TransactionFailed':
      return { type: payload.rule_triggered }
    default:
      return undefined
  }
}

const TEST_PAYLOAD_NETWORKS: Network[] = ['mainnet', 'testnet', 'futurenet']
const MAX_TEST_LABEL_LENGTH = 100

/** JSON with object keys sorted, so

/* … truncated 7597 chars — edit only what you need near the top … */
