import type { AlertPayload } from '@/types'
import { NOTIFICATIONS_KEY } from '@/lib/storageKeys'
import { getRuleMeta } from '@/lib/rules'
import { formatAmount } from '@/lib/format'

export const NOTIFY_THROTTLE_MS = 10000

interface ContractNotificationState {
  lastNotifiedAt: number
  queuedAlerts: AlertPayload[]
  contractLabel: string
  contractPath: string
  timer: ReturnType<typeof setTimeout> | null
}

const notificationStateByContract = new Map<string, ContractNotificationState>()
let navigateToContract: ((path: string) => void) | null = null

export function registerNotificationNavigation(
  navigate: (path: string) => void
): () => void {
  navigateToContract = navigate
  return () => {
    if (navigateToContract === navigate) navigateToContract = null
  }
}

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function notificationsEnabled(): boolean {
  if (!notificationsSupported() || Notification.permission !== 'granted')
    return false
  try {
    return localStorage.getItem(NOTIFICATIONS_KEY) === '1'
  } catch {
    return false
  }
}

/** Opt in: requests permission, and stores the preference only if granted. */
export async function enableNotifications(): Promise<boolean> {
  if (!notificationsSupported()) return false
  const permission =
    Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission
  const ok = permission === 'granted'
  try {
    localStorage.setItem(NOTIFICATIONS_KEY, ok ? '1' : '0')
  } catch {}
  return ok
}

export function disableNotifications(): void {
  try {
    localStorage.setItem(NOTIFICATIONS_KEY, '0')
  } catch {}
}

function ruleLabel(ruleType: string): string {
  try {
    return getRuleMeta(ruleType).label
  } catch {
    return ruleType
  }
}

function describeAlert(alert: AlertPayload): string {
  const parts: string[] = [ruleLabel(alert.rule_triggered)]
  if (alert.amount !== undefined && alert.amount !== null) {
    parts.push(formatAmount(alert.amount))
  }
  if (alert.function_name) {
    parts.push(alert.function_name)
  }
  return parts.join(' · ')
}

function showNotification(
  alerts: AlertPayload[],
  contractLabel: string,
  contractPath: string,
  network?: string
): void {
  const isMainnet = !network || network === 'mainnet'
  const networkPrefix = isMainnet ? '' : `[${network}] `
  const title =
    alerts.length === 1
      ? `${networkPrefix}New alert: ${contractLabel}`
      : `${networkPrefix}${alerts.length} new alerts: ${contractLabel}`
  const body =
    alerts.length === 1
      ? describeAlert(alerts[0])
      : `${alerts.length} transactions matched your rules`
  const n = new Notification(title, { body, tag: `txwatch:${contractPath}` })
  n.onclick = () => {
    window.focus()
    navigateToContract?.(contractPath)
  }
}

function flushQueuedAlerts(contractPath: string): void {
  const state = notificationStateByContract.get(contractPath)
  if (!state) return

  state.timer = null
  if (state.queuedAlerts.length === 0) return
  if (!notificationsEnabled()) {
    state.queuedAlerts = []
    return
  }

  const queued = state.queuedAlerts
  state.queuedAlerts = []
  state.lastNotifiedAt = Date.now()
  showNotification(queued, state.contractLabel, state.contractPath)
}

/** Notify per contract, delivering throttled alerts together after the cooldown. */
export function notifyNewAlerts(
  alerts: AlertPayload[],
  contractLabel: string,
  contractPath: string,
  now: number = Date.now(),
  network?: string
): boolean {
  if (alerts.length === 0 || !notificationsEnabled()) return false

  const state = notificationStateByContract.get(contractPath)
  if (!state || now - state.lastNotifiedAt >= NOTIFY_THROTTLE_MS) {
    const queuedAlerts = state?.queuedAlerts ?? []
    if (state?.timer) clearTimeout(state.timer)
    showNotification(
      [...queuedAlerts, ...alerts],
      contractLabel,
      contractPath,
      network
    )
    notificationStateByContract.set(contractPath, {
      lastNotifiedAt: now,
      queuedAlerts: [],
      contractLabel,
      contractPath,
      timer: null,
    })
    return true
  }

  state.queuedAlerts.push(...alerts)
  state.contractLabel = contractLabel
  if (!state.timer) {
    const remaining = Math.max(
      0,
      NOTIFY_THROTTLE_MS - (now - state.lastNotifiedAt)
    )
    state.timer = setTimeout(() => flushQueuedAlerts(contractPath), remaining)
  }
  return false
}

/** Test helper. */
export function resetNotificationThrottle(): void {
  for (const state of notificationStateByContract.values()) {
    if (state.timer) clearTimeout(state.timer)
  }
  notificationStateByContract.clear()
  navigateToContract = null
}
