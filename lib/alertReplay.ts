/**
 * Historical Alert Webhook Replay (#464)
 */
export async function replayHistoricalAlert(
  alertId: string,
  webhookUrl: string,
  payload: Record<string, unknown>
) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-TxWatch-Replay': 'true',
      'X-TxWatch-Alert-ID': alertId,
    },
    body: JSON.stringify(payload),
  })
  return { success: response.ok, status: response.status }
}
