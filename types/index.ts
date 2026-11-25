import { isValidFunctionName } from '@/lib/soroban'
import { validateThresholdNumber } from '@/lib/formatAmount'

export type Network = 'mainnet' | 'testnet' | 'futurenet'

export type AlertRuleType =
  | 'LargeTransfer'
  | 'AdminFunctionCalled'
  | 'AnyTransaction'
  | 'FunctionCalled'
  | 'TransactionFailed'

const ALERT_RULE_TYPES: readonly AlertRuleType[] = [
  'LargeTransfer',
  'AdminFunctionCalled',
  'AnyTransaction',
  'FunctionCalled',
  'TransactionFailed',
]

/** Outcome of a webhook delivery, as reported by the core when it is known. */
export const DELIVERY_STATUSES = ['success', 'failed', 'pending'] as const
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

/** Parses an untrusted delivery status. Unknown or missing values yield undefined. */
export function parseDeliveryStatus(
  value: unknown
): DeliveryStatus | undefined {
  return typeof value === 'string' &&
    (DELIVERY_STATUSES as readonly string[]).includes(value)
    ? (value as DeliveryStatus)
    : undefined
}

/** Body shape a receiver expects. `json` is the raw AlertPayload. */
export const WEBHOOK_FORMATS = ['json', 'slack', 'discord'] as const
export type WebhookFormat = (typeof WEBHOOK_FORMATS)[number]

export function isWebhookFormat(value: unknown): value is WebhookFormat {
  return (
    typeof value === 'string' &&
    (WEBHOOK_FORMATS as readonly string[]).includes(value)
  )
}

export function isAlertRuleType(value: unknown): value is AlertRuleType {
  return (
    typeof value === 'string' &&
    (ALERT_RULE_TYPES as readonly string[]).includes(value)
  )
}

/** Fields shared by every rule variant. `enabled` defaults to true when absent. */
interface AlertRuleBase {
  enabled?: boolean
}

/** Mirrors the `AlertRule` enum in tx-watch-core. */
export type AlertRule =
  | (AlertRuleBase & {
      type: 'LargeTransfer'
      /** Threshold in whole units of `asset` (XLM when `asset` is absent). */
      threshold_xlm: number
      /** Optional asset code (e.g. USDC) or token contract ID; absent means XLM. */
      asset?: string
      /** Optional decimals of the asset's smallest unit (e.g. 7 for XLM/USDC SACs). */
      decimals?: number
    })
  | (AlertRuleBase & { type: 'AdminFunctionCalled'; function_names: string[] })
  | (AlertRuleBase & { type: 'FunctionCalled'; function_name: string })
  | (AlertRuleBase & { type: 'AnyTransaction' })
  | (AlertRuleBase & { type: 'TransactionFailed' })

/** Display label for a LargeTransfer rule's asset ("XLM" when unset). */
export function largeTransferAssetLabel(rule: { asset?: string }): string {
  const asset = rule.asset?.trim()
  if (!asset) return 'XLM'
  return asset.length > 12 ? `${asset.slice(0, 4)}...${asset.slice(-4)}` : asset
}

export function isRuleEnabled(rule: AlertRule): boolean {
  return rule.enabled !== false
}

/**
 * Validates untrusted data (e.g. from storage or an import file) as an AlertRule.
 * Returns the narrowed rule with only the fields valid for its type, or null.
 */
export function parseAlertRule(value: unknown): AlertRule | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  if (!isAlertRuleType(r.type)) return null
  const base: AlertRuleBase =
    typeof r.enabled === 'boolean' ? { enabled: r.enabled } : {}
  switch (r.type) {
    case 'LargeTransfer':
      if (
        typeof r.threshold_xlm !== 'number' ||
        validateThresholdNumber(r.threshold_xlm) !== null
      )
        return null
      if (
        r.asset !== undefined &&
        (typeof r.asset !== 'string' || !r.asset.trim())
      )
        return null
      if (
        r.decimals !== undefined &&
        (typeof r.decimals !== 'number' ||
          !Number.isInteger(r.decimals) ||
          r.decimals < 0 ||
          r.decimals > 18)
      )
        return null
      return {
        ...base,
        type: r.type,
        threshold_xlm: r.threshold_xlm,
        ...(r.asset !== undefined ? { asset: (r.asset as string).trim() } : {}),
        ...(r.decimals !== undefined ? { decimals: r.decimals as number } : {}),
      }
    case 'AdminFunctionCalled': {
      if (
        !Array.isArray(r.function_names) ||
        !r.function_names.every((n) => typeof n === 'string')
      )
        return null
      const names = (r.function_names as string[]).map((n) => n.trim())
      if (!names.every((n) => isValidFunctionName(n))) return null
      return { ...base, type: r.type, function_names: names }
    }
    case 'FunctionCalled': {
      if (typeof r.function_name !== 'string') return null
      const name = r.function_name.trim()
      if (!isValidFunctionName(name)) return null
      return { ...base, type: r.type, function_name: name }
    }
    default:
      return { ...base, type: r.type }
  }
}

/**
 * Validates an untrusted webhook signing secret (e.g. from storage or an
 * import file). Returns the trimmed secret, or undefined when absent/invalid.
 */
export function parseWebhookSecret(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const secret = value.trim()
  return secret.length > 0 ? secret : undefined
}

/**
 * Validates an untrusted previous webhook signing secret (e.g. from storage or
 * an import file). Returns the trimmed secret, or undefined when absent/invalid.
 */
export function parseWebhookSecretPrevious(
  value: unknown,
): string | undefined {
  return parseWebhookSecret(value)
}

/**
 * Validates an untrusted expiry timestamp (epoch ms) for the previous webhook
 * signing secret. Returns the timestamp, or undefined when absent/invalid.
 */
export function parseWebhookSecretPreviousExpiresAt(
  value: unknown,
): number | undefined {
  if (typeof value !== 'number' || !isFinite(value) || value <= 0) {
    return undefined
  }
  return value
}

export interface WatchedContract {
  id: string
  label: string
  contract_id: string
  network: Network
  rules: AlertRule[]
  webhook_url: string
  /** Optional signing secret used to sign webhook deliveries. */
  webhook_secret?: string
  /**
   * Extra headers sent with each delivery, e.g. an Authorization token. Values
   * are credentials. Assumed core field, see docs/MOCK_API_STRATEGY.md.
   */
  webhook_headers?: Record<string, string>
  /** Body shape for deliveries. Absent = `json`. Assumed core field, see docs/MOCK_API_STRATEGY.md. */
  webhook_format?: WebhookFormat
   * Previous signing secret, kept during the rotation grace period so
   * deliveries are signed with both secrets (two `v1=` entries).
   */
  webhook_secret_previous?: string
  /**
   * Expiry (epoch ms) of the rotation grace period. Once passed, the previous
   * secret is no longer used for signing and can be discarded.
   */
  webhook_secret_previous_expires_at?: number
  /** Whether this contract is actively watched. Absent = true. */
  enabled?: boolean
  created_at: number
  updated_at: number
}

export interface AlertPayload {
  label: string
  contract_id: string
  network: string
  rule_triggered: string
  transaction_hash: string
  function_name?: string
  amount?: number
  timestamp: number
  horizon_link: string
  /** Set on simulated (test) deliveries so receivers can tell them from real
   *  alerts. Mirrored by the `is_test` field of tx-watch-core's payload. */
  is_test?: boolean
  /** Delivery outcome. Assumed core field, see docs/MOCK_API_STRATEGY.md.
   *  Absent means unknown: never treat a missing value as a success. */
  delivery_status?: DeliveryStatus
}
