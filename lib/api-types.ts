// AUTO-GENERATED from docs/openapi.yaml by scripts/generate-api-types.mjs.
// Do not edit by hand. Run `npm run gen:api-types` after changing the spec.
//
// These types mirror the tx-watch-core REST contract consumed by
// lib/contractsApi.ts and lib/alertSource.ts (#481).
/* eslint-disable */

export type Network = 'mainnet' | 'testnet' | 'futurenet'

export type AlertRuleType =
  | 'LargeTransfer'
  | 'AdminFunctionCalled'
  | 'AnyTransaction'
  | 'FunctionCalled'
  | 'TransactionFailed'

export type AlertRule = {
  type: AlertRuleType
  enabled?: boolean
  threshold_xlm?: number
  function_name?: string
  function_names?: string[]
}

export type WatchedContract = {
  id: string
  label: string
  contract_id: string
  network: Network
  rules: AlertRule[]
  webhook_url: string
  webhook_secret?: string
  enabled?: boolean
  created_at: number
  updated_at: number
}

export type AlertEnvelope = {
  alerts: AlertPayload[]
}

export type AlertPayload = {
  label: string
  contract_id: string
  network: string
  rule_triggered: AlertRuleType
  transaction_hash: string
  function_name?: string
  amount?: number
  timestamp: number
  horizon_link: string
  is_test?: boolean
}

export type ErrorBody = {
  message?: string
  error?: string
}

export type ApiSchemas = {
  Network: Network
  AlertRuleType: AlertRuleType
  AlertRule: AlertRule
  WatchedContract: WatchedContract
  AlertEnvelope: AlertEnvelope
  AlertPayload: AlertPayload
  ErrorBody: ErrorBody
}
