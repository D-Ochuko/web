/**
 * Alert Read/Unread State Management (#458)
 */
export function getReadAlertIds(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem('txwatch:read_alerts')
    return new Set(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

export function markAlertAsRead(alertId: string): void {
  if (typeof window === 'undefined') return
  const set = getReadAlertIds()
  set.add(alertId)
  localStorage.setItem('txwatch:read_alerts', JSON.stringify(Array.from(set)))
}

export function markAllAlertsAsRead(alertIds: string[]): void {
  if (typeof window === 'undefined') return
  const set = getReadAlertIds()
  for (const id of alertIds) set.add(id)
  localStorage.setItem('txwatch:read_alerts', JSON.stringify(Array.from(set)))
}
