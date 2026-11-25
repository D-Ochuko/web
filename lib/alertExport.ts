/**
 * Alert History JSON and CSV Export (#460)
 */
export interface AlertExportRecord {
  id: string
  contractId: string
  network: string
  topic: string
  timestamp: string
  status: string
}

export function exportAlertsAsJson(alerts: AlertExportRecord[]): string {
  return JSON.stringify(alerts, null, 2)
}

export function exportAlertsAsCsv(alerts: AlertExportRecord[]): string {
  const headers = [
    'id',
    'contractId',
    'network',
    'topic',
    'timestamp',
    'status',
  ]
  const rows = alerts.map((a) =>
    [a.id, a.contractId, a.network, a.topic, a.timestamp, a.status]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  )
  return [headers.join(','), ...rows].join('\n')
}
