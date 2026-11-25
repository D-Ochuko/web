import { SIGNATURE_HEADER } from './webhookSignature'

/**
 * Custom headers a contract may send with its webhook deliveries (#408).
 *
 * Header values are credentials (for example an Authorization token), so they
 * are masked in the UI and left out of CSV exports, the same as the signing
 * secret.
 */

/** Most custom headers a single contract may carry. */
export const WEBHOOK_HEADERS_MAX_COUNT = 5

/** Longest accepted header value, in characters. */
export const WEBHOOK_HEADER_VALUE_MAX_LENGTH = 512

/**
 * Header names that test deliveries may send through the server proxy. Other
 * custom headers are kept on the contract but not forwarded by the proxy, so
 * the proxy is never a general header relay.
 */
export const TEST_DELIVERY_HEADER_ALLOWLIST: readonly string[] = [
  'authorization',
  'x-api-key',
  'x-auth-token',
  'x-webhook-token',
]

const TOKEN_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/**
 * Hop-by-hop headers (RFC 9110 section 7.6.1), plus headers the delivery sets
 * itself. A contract may not override these.
 */
const RESERVED_HEADER_NAMES = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'content-type',
  SIGNATURE_HEADER.toLowerCase(),
])

/** True for a well-formed, non-reserved header name. */
export function isValidWebhookHeaderName(name: string): boolean {
  return (
    TOKEN_PATTERN.test(name) && !RESERVED_HEADER_NAMES.has(name.toLowerCase())
  )
}

/** True for a non-empty value within the length limit with no control characters. */
export function isValidWebhookHeaderValue(value: string): boolean {
  return (
    value.trim().length > 0 &&
    value.trim().length <= WEBHOOK_HEADER_VALUE_MAX_LENGTH &&
    !CONTROL_CHARACTERS.test(value)
  )
}

/**
 * Validates untrusted header data from storage, an import file or a form.
 * Returns the trimmed map, `{}` when absent, or `null` when anything is invalid
 * (bad name, reserved name, duplicate name, bad value, or too many headers).
 */
export function parseWebhookHeaders(
  value: unknown
): Record<string, string> | null {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > WEBHOOK_HEADERS_MAX_COUNT) return null

  const result: Record<string, string> = {}
  const seen = new Set<string>()
  for (const [rawName, rawValue] of entries) {
    const name = rawName.trim()
    if (typeof rawValue !== 'string') return null
    if (
      !isValidWebhookHeaderName(name) ||
      !isValidWebhookHeaderValue(rawValue)
    ) {
      return null
    }
    const key = name.toLowerCase()
    if (seen.has(key)) return null
    seen.add(key)
    result[name] = rawValue.trim()
  }
  return result
}

/**
 * Masks a header value for display. The length is not revealed: the output is
 * always the same run of dots, with the last four characters shown only for
 * values longer than eight characters.
 */
export function maskWebhookHeaderValue(value: string): string {
  const trimmed = value.trim()
  const visible = trimmed.length > 8 ? trimmed.slice(-4) : ''
  return `${'•'.repeat(8)}${visible}`
}

/**
 * The subset of a contract's headers a test delivery may send: allow-listed
 * names (case-insensitive) with valid values. Anything else is dropped.
 */
export function selectTestDeliveryHeaders(
  headers: unknown
): Record<string, string> {
  const selected: Record<string, string> = {}
  if (
    typeof headers !== 'object' ||
    headers === null ||
    Array.isArray(headers)
  ) {
    return selected
  }
  for (const [name, value] of Object.entries(
    headers as Record<string, unknown>
  )) {
    if (
      TEST_DELIVERY_HEADER_ALLOWLIST.includes(name.toLowerCase()) &&
      typeof value === 'string' &&
      isValidWebhookHeaderValue(value)
    ) {
      selected[name] = value.trim()
    }
  }
  return selected
}
