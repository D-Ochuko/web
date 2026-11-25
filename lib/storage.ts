import {
  WatchedContract,
  AlertPayload,
  AlertRule,
  Network,
  parseAlertRule,
} from '@/types'
import { HORIZON_URLS } from './stellar'
import { safeParseStorage, storageLogger } from './storageLogger'
import {
  CONTRACTS_KEY,
  ALERTS_KEY,
  STORAGE_VERSION_KEY,
  RETENTION_KEY,
  ALERT_CAP_KEY,
  TXWATCH_KEYS,
} from './storageKeys'

const CURRENT_STORAGE_VERSION = 2
const STORAGE_EVENT = 'txwatch:storage'

function getStorage(): Storage | undefined {
  if (typeof window !== 'undefined') return window.localStorage
  return (globalThis as unknown as { localStorage?: Storage }).localStorage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidContract(value: unknown): value is WatchedContract {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.contract_id === 'string' &&
    typeof value.network === 'string'
  )
}

function isValidAlert(value: unknown): value is AlertPayload {
  return (
    isRecord(value) &&
    typeof value.contract_id === 'string' &&
    typeof value.timestamp === 'number'
  )
}

function isValidEntry(key: string, value: unknown): boolean {
  if (key === CONTRACTS_KEY) return isValidContract(value)
  if (key === ALERTS_KEY) return isValidAlert(value)
  return true
}

function load<T>(key: string): T[] {
  const storage = getStorage()
  if (!storage) return []
  const parsed = safeParseStorage<unknown>(key, [])
  if (!Array.isArray(parsed)) {
    storageLogger.warn('storage: non-array value, resetting to []', {
      key,
      value: parsed,
    })
    return []
  }
  const valid = parsed.filter((entry) => isValidEntry(key, entry))
  if (valid.length < parsed.length) {
    storageLogger.warn('storage: dropped malformed entries', {
      key,
      dropped: parsed.length - valid.length,
    })
  }
  return valid as T[]
}

const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024
const MAX_ALERTS_PER_CONTRACT = 500
export const MAX_RULES_PER_CONTRACT = 20
const DEFAULT_RETENTION_DAYS = 90
const ALERTS_PRUNED_EVENT = 'txwatch:alerts-pruned'

export interface AlertPruneResult {
  prunedCount: number
  oldestPrunedTimestamp: number | null
}

const NO_PRUNE: AlertPruneResult = { prunedCount: 0, oldestPrunedTimestamp: null }

function notifyAlertsPruned(result: AlertPruneResult) {
  if (result.prunedCount <= 0) return
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<AlertPruneResult>(ALERTS_PRUNED_EVENT, { detail: result })
  )
}

function computePruneResult(
  original: AlertPayload[],
  kept: AlertPayload[]
): AlertPruneResult {
  if (kept.length >= original.length) return NO_PRUNE
  const keptSet = new Set(kept)
  let prunedCount = 0
  let oldestPrunedTimestamp: number | null = null
  for (const alert of original) {
    if (keptSet.has(alert)) continue
    prunedCount++
    if (
      oldestPrunedTimestamp === null ||
      alert.timestamp < oldestPrunedTimestamp
    ) {
      oldestPrunedTimestamp = alert.timestamp
    }
  }
  return { prunedCount, oldestPrunedTimestamp }
}
=======

export function getMaxAlertsPerContract(): number {
  return getAlertCap()
}

export function setMaxAlertsPerContract(cap: number): void {
  const storage = getStorage()
  if (!storage || !Number.isFinite(cap) || cap < 1) return
  storage.setItem(ALERT_CAP_KEY, String(Math.floor(cap)))
}

export function getRetentionDays(): number {
  const raw = Number(getStorage()?.getItem(RETENTION_KEY))
  return Number.isFinite(raw) && raw >= 1
    ? Math.floor(raw)
    : DEFAULT_RETENTION_DAYS
}

export function setRetentionDays(days: number) {
  const storage = getStorage()
  if (!storage || !Number.isFinite(days) || days < 1) return
  setTrackedItem(storage, RETENTION_KEY, String(Math.floor(days)))
  pruneOldAlerts()
}

function getAlertCap(): number {
  const raw = Number(getStorage()?.getItem(ALERT_CAP_KEY))
  return Number.isFinite(raw) && raw >= 1
    ? Math.floor(raw)
    : MAX_ALERTS_PER_CONTRACT
}

// #508: the estimate used to walk every localStorage key on each save. It is
// now cached and adjusted by the size delta of each tracked write. The cache is
// dropped when another tab writes (`storage` event), when TxWatch data is
// cleared, and whenever the number of keys no longer matches what was counted
// (for example after `localStorage.clear()`).
let cachedStorageSize: number | null = null
let cachedStorageLength = -1

function entrySize(key: string, value: string): number {
  return (key.length + value.length) * 2
}

function invalidateStorageSize() {
  cachedStorageSize = null
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', invalidateStorageSize)
}

function getStorageSize(): number {
  const storage = getStorage()
  if (!storage) return 0
  if (cachedStorageSize !== null && cachedStorageLength === storage.length) {
    return cachedStorageSize
  }
  let size = 0
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (!key) continue
    const value = storage.getItem(key)
    if (value !== null) {
      size += (value.length + key.length) * 2
      size += entrySize(key, value)
    }
  }
  cachedStorageSize = size
  cachedStorageLength = storage.length
  return size
}

export function pruneOldAlerts(): AlertPruneResult {
// Like `storage.setItem` (it throws the same way) but keeps the size cache in
// step with the write instead of forcing a full recount.
function setTrackedItem(storage: Storage, key: string, value: string) {
  const previous = storage.getItem(key)
  storage.setItem(key, value)
  if (cachedStorageSize !== null) {
    cachedStorageSize +=
      entrySize(key, value) - (previous !== null ? entrySize(key, previous) : 0)
    cachedStorageLength = storage.length
  }
}

export function pruneOldAlerts() {
  const storage = getStorage()
  if (!storage) return NO_PRUNE
  const cutoff = Date.now() - getRetentionDays() * 24 * 60 * 60 * 1000
  const alerts = load<AlertPayload>(ALERTS_KEY)
  const withinRetention = alerts.filter((a) => a.timestamp >= cutoff)
  const pruned = capAlertsPerContract(withinRetention)
  const result = computePruneResult(alerts, pruned)
  if (result.prunedCount > 0) {
    try {
      setTrackedItem(storage, ALERTS_KEY, JSON.stringify(pruned))
    } catch {
      // best effort
    }
    notifyAlertsPruned(result)
  }
  return result
}

function trimAlertsToRetention(): AlertPruneResult {
  const storage = getStorage()
  if (!storage) return NO_PRUNE
  const alerts = load<AlertPayload>(ALERTS_KEY)
  const cutoff = Date.now() - getRetentionDays() * 24 * 60 * 60 * 1000
  const withinRetention = alerts.filter((a) => a.timestamp >= cutoff)
  const trimmed = capAlertsPerContract(withinRetention)
  const result = computePruneResult(alerts, trimmed)
  if (result.prunedCount > 0) {
    try {
      setTrackedItem(storage, ALERTS_KEY, JSON.stringify(trimmed))
    } catch {
      // best effort
    }
    notifyAlertsPruned(result)
  }
  return result
}

function isQuotaError(err: unknown): boolean {
  const e = err as { name?: string; code?: number } | null
  return (
    !!e &&
    (e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e.code === 22 ||
      e.code === 1014)
  )
}

function writeItem(storage: Storage, key: string, value: string): boolean {
  try {
    setTrackedItem(storage, key, value)
    return true
  } catch (err) {
    if (!isQuotaError(err)) return false
  }
  trimAlertsToRetention()
  try {
    setTrackedItem(storage, key, value)
    return true
  } catch {
    return false
  }
}

function writeItemWithPrune(
  storage: Storage,
  key: string,
  value: string
): { ok: boolean; prune: AlertPruneResult } {
  try {
    storage.setItem(key, value)
    return { ok: true, prune: NO_PRUNE }
  } catch (err) {
    if (!isQuotaError(err)) return { ok: false, prune: NO_PRUNE }
  }
  const prune = trimAlertsToRetention()
  try {
    storage.setItem(key, value)
    return { ok: true, prune }
  } catch {
    return { ok: false, prune }
  }
}

function notifyChange(key: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(STORAGE_EVENT, { detail: { key } }))
}

function save<T>(key: string, data: T[]): boolean {
  const ok = saveInternal(key, data)
  if (ok) notifyChange(key)
  return ok
}

function saveInternal<T>(key: string, data: T[]): boolean {
  const storage = getStorage()
  if (!storage) return false

  if (key === ALERTS_KEY) {
    const size = getStorageSize()
    if (size > STORAGE_QUOTA_BYTES * 0.9) {
      const original = data as unknown as AlertPayload[]
      const cutoff = Date.now() - getRetentionDays() * 24 * 60 * 60 * 1000
      const withinRetention = original.filter((a) => a.timestamp >= cutoff)
      const capped = capAlertsPerContract(withinRetention)
      const prune = computePruneResult(original, capped)
      data = capped as unknown as T[]
      if (prune.prunedCount > 0) notifyAlertsPruned(prune)
    }
    return writeItem(storage, key, JSON.stringify(data))
  }

  const { ok, prune } = writeItemWithPrune(storage, key, JSON.stringify(data))

  const size = getStorageSize()
  if (size > STORAGE_QUOTA_BYTES * 0.9) {
    trimAlertsToRetention()
  }
  return ok
}

function getStorageVersion(): number {
  const storage = getStorage()
  if (!storage) return CURRENT_STORAGE_VERSION
  const parsed = parseInt(storage.getItem(STORAGE_VERSION_KEY) ?? '0', 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function setStorageVersion(version: number) {
  const storage = getStorage()
  if (!storage) return
  setTrackedItem(storage, STORAGE_VERSION_KEY, version.toString())
}

export function migrateStorage(migrations: Record<number, () => void>) {
  const currentVersion = getStorageVersion()
  for (let v = currentVersion + 1; v <= CURRENT_STORAGE_VERSION; v++) {
    if (migrations[v]) {
      migrations[v]()
    }
  }
  setStorageVersion(CURRENT_STORAGE_VERSION)
}

export function migrateContractsToV2() {
  const contracts = getContracts()
  const migrated = contracts.map((c) => ({
    ...c,
    enabled: c.enabled ?? true,
  }))
  save(CONTRACTS_KEY, migrated)
}

export function getContracts(): WatchedContract[] {
  return load<WatchedContract>(CONTRACTS_KEY).map((c) => ({
    ...c,
    rules: Array.isArray(c.rules)
      ? c.rules.map(parseAlertRule).filter((r): r is AlertRule => r !== null)
      : [],
  }))
}

export function getContract(id: string): WatchedContract | undefined {
  return getContracts().find((c) => c.id === id)
}

export const WEBHOOK_SECRET_GRACE_MS = 24 * 60 * 60 * 1000

// Returns the previous webhook secret while it is still inside its grace
// window. Expired secrets are ignored (and treated as absent).
export function getPreviousWebhookSecret(
  contract: WatchedContract | undefined
): string | undefined {
  if (!contract || !contract.webhook_secret_previous) return undefined
  const expiresAt = contract.webhook_secret_previous_expires_at
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
    return undefined
  }
  if (Date.now() >= expiresAt) return undefined
  return contract.webhook_secret_previous
}

// Returns the grace-window expiry for the previous secret, or undefined when
// there is no active previous secret.
export function getWebhookSecretGraceExpiry(
  contract: WatchedContract | undefined
): number | undefined {
  if (!getPreviousWebhookSecret(contract)) return undefined
  return contract?.webhook_secret_previous_expires_at
}

// Rotates a contract's webhook secret: the current secret becomes the previous
// secret (valid for WEBHOOK_SECRET_GRACE_MS) and the new secret takes over.
export function rotateWebhookSecret(
  contractId: string,
  newSecret: string,
  graceMs: number = WEBHOOK_SECRET_GRACE_MS
): boolean {
  const contract = getContract(contractId)
  if (!contract) return false
  const now = Date.now()
  const updated: WatchedContract = {
    ...contract,
    webhook_secret: newSecret,
    webhook_secret_previous: contract.webhook_secret,
    webhook_secret_previous_expires_at: now + graceMs,
  }
  return saveContract(updated)
}

// Ends the grace period early by dropping the previous secret.
export function finishWebhookSecretRotation(contractId: string): boolean {
  const contract = getContract(contractId)
  if (!contract) return false
  const updated: WatchedContract = {
    ...contract,
    webhook_secret_previous: undefined,
    webhook_secret_previous_expires_at: undefined,
  }
  return saveContract(updated)
}

export function getNetworkDistribution(): Record<Network, number> {
  return getContracts().reduce(
    (counts, contract) => {
      counts[contract.network] = (counts[contract.network] ?? 0) + 1
      return counts
    },
    {} as Record<Network, number>
  )
}

function getContractByIdAndNetwork(
  contractId: string,
  network: string
): WatchedContract | undefined {
  return getContracts().find(
    (c) => c.contract_id === contractId && c.network === network
  )
}

export class DuplicateContractError extends Error {
  constructor(contractId: string, network: string) {
    super(`Contract ${contractId} is already registered on ${network}`)
    this.name = 'DuplicateContractError'
  }
}

export class MaxRulesPerContractError extends Error {
  constructor(contractId: string, count: number, max: number) {
    super(
      `Contract ${contractId} has ${count} rules — maximum of ${max} rules per contract is allowed. Remove some rules before adding more.`
    )
    this.name = 'MaxRulesPerContractError'
  }
}

export function addContract(contract: WatchedContract) {
  if (getContractByIdAndNetwork(contract.contract_id, contract.network)) {
    throw new DuplicateContractError(contract.contract_id, contract.network)
  }
  saveContract(contract)
}

export function replaceContracts(list: WatchedContract[]): boolean {
  const normalized = list.map((c) => ({ ...c, enabled: c.enabled ?? true }))

  // Reject duplicates within the incoming list (e.g. import/restore with
  // the same contract_id+network appearing more than once).
  const seen = new Set<string>()
  for (const c of normalized) {
    const key = `${c.contract_id}::${c.network}`
    if (seen.has(key)) {
      throw new DuplicateContractError(c.contract_id, c.network)
    }
    seen.add(key)
  }

  return save(CONTRACTS_KEY, normalized)
}

export function saveContract(contract: WatchedContract): boolean {
  const contracts = getContracts()

  const duplicate = contracts.find(
    (c) =>
      c.contract_id === contract.contract_id &&
      c.network === contract.network &&
      c.id !== contract.id
  )
  if (duplicate) {
    throw new DuplicateContractError(contract.contract_id, contract.network)
  }

  if (Array.isArray(contract.rules) && contract.rules.length > MAX_RULES_PER_CONTRACT) {
    throw new MaxRulesPerContractError(contract.id, contract.rules.length, MAX_RULES_PER_CONTRACT)
  }

  const updated = { ...contract, enabled: contract.enabled ?? true, updated_at: Date.now() }
  const updated = {
    ...contract,
    enabled: contract.enabled ?? true,
    updated_at: Date.now(),
  }
  const index = contracts.findIndex((c) => c.id === contract.id)
  if (index === -1) {
    return save(CONTRACTS_KEY, [...contracts, updated])
  }
  const next = contracts.slice()
  next[index] = updated
  return save(CONTRACTS_KEY, next)
}

export function deleteContract(id: string) {
  const contract = getContract(id)
  save(
    CONTRACTS_KEY,
    getContracts().filter((c) => c.id !== id)
  )
  if (contract) {
    deleteAlerts(contract.contract_id)
  }
}

function deleteAlerts(contractId: string) {
  const alerts = load<AlertPayload>(ALERTS_KEY)
  save(
    ALERTS_KEY,
    alerts.filter((a) => a.contract_id !== contractId)
  )
}

export function deleteAlertsByNetwork(contractId: string, network: string) {
  const alerts = load<AlertPayload>(ALERTS_KEY)
  save(
    ALERTS_KEY,
    alerts.filter(
      (a) => !(a.contract_id === contractId && a.network === network)
    )
  )
}

// Persists a full alert list (used by the import flow to restore a backup).
export function replaceAlerts(alerts: AlertPayload[]): boolean {
  const valid = alerts.filter((a) => isValidAlert(a))
  return save(ALERTS_KEY, valid)
}

// Rewrites `contract_id` on every alert matching `oldContractId` so alert history
// survives when an imported contract is re-keyed under a new id.
export function rekeyAlerts(
  oldContractId: string,
  newContractId: string
): boolean {
  if (oldContractId === newContractId) return true
  const alerts = load<AlertPayload>(ALERTS_KEY)
  let changed = false
  const next = alerts.map((a) => {
    if (a.contract_id !== oldContractId) return a
    changed = true
    return { ...a, contract_id: newContractId }
  })
  if (!changed) return true
  return save(ALERTS_KEY, next)
}

export function deleteAlert(alertId: string) {
  const alerts = load<AlertPayload & { id?: string }>(ALERTS_KEY)
  save(
    ALERTS_KEY,
    alerts.filter((a) => a.id !== alertId)
  )
}

export function getAllAlerts(): AlertPayload[] {
  return load<AlertPayload>(ALERTS_KEY).sort(
    (a, b) => b.timestamp - a.timestamp
  )
}

export function getAlerts(contractId?: string): AlertPayload[] {
  const all = load<AlertPayload>(ALERTS_KEY)
  const filtered = contractId
    ? all.filter((a) => a.contract_id === contractId)
    : all
  return filtered.sort((a, b) => b.timestamp - a.timestamp)
}

export function getLatestAlert(contractId: string): AlertPayload | undefined {
  return getAlerts(contractId)[0]
}

export function seedMockAlerts(
  contractId: string,
  network: Network,
  count = 5
): void {
  const now = Date.now()
  for (let index = count - 1; index >= 0; index--) {
    const sequence = index + 1
    const hash = Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('')
    addAlert({
      label: `Mock Alert ${sequence}`,
      contract_id: contractId,
      network,
      rule_triggered: 'AnyTransaction',
      transaction_hash: hash,
      amount: 10 + index * 5,
      timestamp: now - index * 15 * 60 * 1000,
      horizon_link: `${HORIZON_URLS[network]}/transactions/${hash}`,
    })
  }
}

export function exportAllStorageData(): Record<string, string> {
  const storage = getStorage()
  const data: Record<string, string> = {}
  if (!storage) return data
  for (const key of TXWATCH_KEYS) {
    const value = storage.getItem(key)
    if (value !== null) data[key] = value
  }
  return data
}

export function clearTxWatchStorage(keys: string[] = TXWATCH_KEYS): void {
  const targets = keys.filter((key) => TXWATCH_KEYS.includes(key))
  invalidateStorageSize()
  const stores: Storage[] = []
  if (typeof window !== 'undefined') {
    stores.push(window.localStorage, window.sessionStorage)
  } else {
    const g = globalThis as unknown as {
      localStorage?: Storage
      sessionStorage?: Storage
    }
    if (g.localStorage) stores.push(g.localStorage)
    if (g.sessionStorage) stores.push(g.sessionStorage)
  }
  for (const storage of stores) {
    for (const key of targets) {
      try {
        storage.removeItem(key)
      } catch {
        // best effort
      }
    }
  }
}

export function addAlert(
  alert: AlertPayload | (AlertPayload & { contractId?: string; id?: string })
) {
  const normalizedAlert = {
    ...alert,
    contract_id:
      alert.contract_id ?? (alert as { contractId?: string }).contractId,
  }
  const key = `${normalizedAlert.contract_id}::${normalizedAlert.network ?? ''}`
  const cap = getMaxAlertsPerContract()

  const existing = load<AlertPayload>(ALERTS_KEY)
  const sameContract = existing.filter(
    (a) => `${a.contract_id}::${a.network ?? ''}` === key
  )

  // Only trim the overflowing contract group instead of rebuilding counts
  // over every alert on each call.
  if (sameContract.length >= cap) {
    const others = existing.filter(
      (a) => `${a.contract_id}::${a.network ?? ''}` !== key
    )
    const newest = sameContract
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, cap - 1)
    save(ALERTS_KEY, [...others, ...newest, normalizedAlert])
  } else {
    save(ALERTS_KEY, [...existing, normalizedAlert])
  }
  return normalizedAlert
}

function capAlertsPerContract(alerts: AlertPayload[]): AlertPayload[] {
  const cap = getAlertCap()
  const groups = new Map<string, AlertPayload[]>()
  for (const alert of alerts) {
    const key = `${alert.contract_id}::${alert.network ?? ''}`
    const group = groups.get(key)
    if (group) group.push(alert)
    else groups.set(key, [alert])
  }

  const kept = new Set<AlertPayload>()
  for (const group of groups.values()) {
    if (group.length <= cap) {
      for (const alert of group) kept.add(alert)
      continue
    }
    const newest = group
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, cap)
    for (const alert of newest) kept.add(alert)
  }

  return alerts.filter((alert) => kept.has(alert))
}

// Subscribes to changes for a given storage key. Fires for same-tab writes
// (via the `txwatch:storage` CustomEvent dispatched by notifyChange) and for
// cross-tab writes (via the native `storage` event). Returns an unsubscribe fn.
function subscribeToKey(key: string, cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const handleCustom = (event: Event) => {
    const detail = (event as CustomEvent<{ key?: string }>).detail
    if (!detail || detail.key === key) cb()
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) cb()
  }

  window.addEventListener(STORAGE_EVENT, handleCustom as EventListener)
  window.addEventListener('storage', handleStorage)

  return () => {
    window.removeEventListener(STORAGE_EVENT, handleCustom as EventListener)
    window.removeEventListener('storage', handleStorage)
  }
}

export function onAlertsChange(cb: () => void): () => void {
  return subscribeToKey(ALERTS_KEY, cb)
}

export function onContractsChange(cb: () => void): () => void {
  return subscribeToKey(CONTRACTS_KEY, cb)
}

// Subscribes to alert-pruning notifications. Fires whenever retention or quota
// trimming drops alerts so the UI can surface a toast/banner. Returns an
// unsubscribe fn.
export function onAlertsPruned(
  cb: (result: AlertPruneResult) => void
): () => void {
  if (typeof window === 'undefined') return () => {}

  const handle = (event: Event) => {
    const detail = (event as CustomEvent<AlertPruneResult>).detail
    if (!detail) return
    cb(detail)
  }

  window.addEventListener(ALERTS_PRUNED_EVENT, handle as EventListener)
  return () => {
    window.removeEventListener(ALERTS_PRUNED_EVENT, handle as EventListener)
  }
}

// Counts alerts recorded since local midnight across all contracts.
export function getTodayAlertCount(): number {
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const startOfDay = midnight.getTime()
  return load<AlertPayload>(ALERTS_KEY).filter((a) => a.timestamp >= startOfDay)
    .length
}
