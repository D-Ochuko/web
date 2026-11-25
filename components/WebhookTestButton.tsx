'use client'

import { useEffect, useRef, useState } from 'react'
import { sendTestWebhook } from '@/lib/api'
import { validateWebhookUrl } from '@/lib/stellar'
import type { AlertRule, Network, WebhookFormat } from '@/types'

type TestStatus = 'idle' | 'sending' | 'ok' | 'error'

/** HTTP statuses the proxy uses when it blocks a request before delivery. */
const PROXY_BLOCK_STATUSES = new Set([403, 429])

/**
 * Builds the failure message for a rejected test delivery, preferring the
 * proxy's explanation over the bare HTTP status.
 */
function buildFailureMessage(res: {
  status: number
  error?: string
}): string {
  const reason = res.error?.trim()
  if (!reason) {
    return `Delivery failed with HTTP status ${res.status}.`
  }
  if (PROXY_BLOCK_STATUSES.has(res.status)) {
    return `Blocked by TxWatch: ${reason}`
  }
  return `Receiver answered HTTP ${res.status}: ${reason}`
/**
 * Message for a failed delivery. A 3xx is never followed by the proxy, so
 * when the receiver says where it moved, point the user at that URL (#399).
 */
export function failureMessage(res: {
  status: number
  location?: string
  error?: string
}): string {
  // The proxy's fixed message (e.g. "The receiver refused the connection")
  // says more than the status of a delivery that never reached a receiver.
  if (res.error) return `${res.error}.`
  const base = `Delivery failed with HTTP status ${res.status}.`
  if (res.status >= 300 && res.status < 400 && res.location) {
    return `${base} Receiver redirects to ${res.location} — update the webhook URL.`
  }
  return base
}

interface WebhookTestButtonProps {
  /** Receiver URL to deliver the test payload to. */
  url: string
  /** Contract, network and rule the rule-aware test payload simulates. */
  contractId: string
  network: Network
  rule?: AlertRule
  /** Signing secret. Used in the browser only; never sent to the server. */
  secret?: string
  /** Custom headers of the contract; only allow-listed names are sent. */
  headers?: Record<string, string>
  /** Body shape the receiver expects. Absent = JSON. */
  format?: WebhookFormat
  disabled?: boolean
  className?: string
}

/**
 * Sends a signed, rule-aware test payload to a webhook URL and reports the
 * receiver's response. Shared by the Add Contract form and the Contract
 * Detail page, so both send the same payload through the same proxy.
 */
export default function WebhookTestButton({
  url,
  contractId,
  network,
  rule,
  secret,
  headers,
  format,
  disabled = false,
  className = '',
}: WebhookTestButtonProps) {
  const [status, setStatus] = useState<TestStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  async function handleTest() {
    const target = url.trim()
    if (!target) {
      setStatus('error')
      setMessage('Enter a webhook URL first.')
      return
    }
    const check = validateWebhookUrl(target, network)
    if (!check.valid) {
      setStatus('error')
      setMessage(check.message ?? 'Enter a valid webhook URL.')
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('sending')
    setMessage(null)

    try {
      const res = await sendTestWebhook(target, {
        contractId: contractId.trim(),
        network,
        rule,
        secret: secret?.trim() || undefined,
        headers,
        format,
        signalOrTimeoutMs: controller.signal,
      })
      if (controller.signal.aborted) return
      if (res.ok) {
        setStatus('ok')
        setMessage(`Test webhook delivered (HTTP ${res.status}).`)
      } else {
        setStatus('error')
        setMessage(buildFailureMessage(res))
        setMessage(failureMessage(res))
      }
    } catch (err) {
      if (controller.signal.aborted) return
      setStatus('error')
      setMessage(
        err instanceof Error ? err.message : 'Failed to send test webhook.'
      )
    }
  }

  return (
    <div className={`space-y-1.5 ${className}`}>
      <button
        type="button"
        onClick={handleTest}
        disabled={disabled || status === 'sending'}
        className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-200 text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
      >
        {status === 'sending' ? 'Testing…' : 'Test Webhook'}
      </button>
      {message && (
        <p
          role="status"
          className={`text-xs break-words ${status === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}
        >
          {message}
        </p>
      )}
    </div>
  )
}
