import type { AlertPayload, WebhookFormat } from '@/types'

/**
 * Payload formats for webhook deliveries (#409). `json` sends the raw
 * AlertPayload. Slack and Discord need a `text` or `content` body, so the same
 * alert is rendered as a plain-text summary in those shapes.
 */

export const WEBHOOK_FORMAT_LABELS: Record<WebhookFormat, string> = {
  json: 'JSON',
  slack: 'Slack',
  discord: 'Discord',
}

const SLACK_HOSTS = ['hooks.slack.com']
const DISCORD_HOSTS = [
  'discord.com',
  'discordapp.com',
  'canary.discord.com',
  'ptb.discord.com',
]

/**
 * Suggests a payload format from the URL's host. Unknown hosts and unparsable
 * URLs get `json`. The suggestion is a hint: the user can always override it.
 */
export function suggestWebhookFormat(url: string): WebhookFormat {
  let host: string
  try {
    host = new URL(url.trim()).hostname.toLowerCase()
  } catch {
    return 'json'
  }
  if (SLACK_HOSTS.includes(host)) return 'slack'
  if (DISCORD_HOSTS.includes(host)) return 'discord'
  return 'json'
}

/** Plain-text summary of a test alert, used as Slack `text` or Discord `content`. */
export function summarizeAlert(payload: AlertPayload): string {
  const lines = [
    `TxWatch test alert: ${payload.rule_triggered}`,
    `Contract: ${payload.label} (${payload.contract_id})`,
    `Network: ${payload.network}`,
    `Transaction: ${payload.transaction_hash}`,
  ]
  if (payload.function_name) lines.push(`Function: ${payload.function_name}`)
  if (payload.amount !== undefined) lines.push(`Amount: ${payload.amount} XLM`)
  lines.push(`Horizon: ${payload.horizon_link}`)
  return lines.join('\n')
}

/**
 * The exact body a receiver gets for a test alert in `format`. Deterministic,
 * so the browser's signature and the proxy's allow-list check agree byte for
 * byte.
 */
export function formatWebhookBody(
  payload: AlertPayload,
  format: WebhookFormat
): string {
  switch (format) {
    case 'slack':
      return JSON.stringify({ text: summarizeAlert(payload) })
    case 'discord':
      return JSON.stringify({ content: summarizeAlert(payload) })
    default:
      return JSON.stringify(payload)
  }
}
