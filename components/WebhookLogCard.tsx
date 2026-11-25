'use client'

import React, { useCallback, useState } from 'react'
import { formatAmount } from '@/lib/formatAmount'
import { truncateId } from '@/lib/stellar'
import { formatDateTime } from '@/lib/format'
import { explorerContractUrl, explorerTxUrl } from '@/lib/explorer'
import Modal from '@/components/Modal'
import {
  AlertPayload,
  DeliveryStatus,
  Network,
  parseDeliveryStatus,
} from '@/types'

export interface WebhookEntry {
import { truncateId, explorerTxUrl } from '@/lib/stellar'
import { formatDateTime } from '@/lib/format'
import { explorerContractUrl } from '@/lib/explorer'
import Modal from '@/components/Modal'
import { AlertPayload, Network } from '@/types'

export interface WebhookEntry {
  id: string;
  timestamp: string;
  event: string;
  contractAddress?: string;
  status: 'success' | 'failed' | 'pending';
  amount?: string;
  asset?: string;
  txHash?: string;
  payload?: Record<string, unknown>;
  isTest?: boolean;
  id: string
  timestamp: string
  event: string
  contractAddress?: string
  /** Delivery outcome. Absent when the source does not report one. */
  status?: DeliveryStatus
  status: 'success' | 'failed' | 'pending'
  amount?: string
  asset?: string
  txHash?: string
  payload?: Record<string, unknown>
}

export interface WebhookLogCardProps {
  alert?: AlertPayload
  entry?: WebhookEntry
  network?: Network | string
  onClick?: () => void
}

const STATUS_STYLES: Record<DeliveryStatus, string> = {
const STATUS_STYLES: Record<WebhookEntry['status'], string> = {
  success:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  pending:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
}

function normalizeEntry(props: WebhookLogCardProps): WebhookEntry {
  if (props.entry) return props.entry
  if (props.alert) {
    const a = props.alert
    return {
      id: a.transaction_hash,
      timestamp: new Date(a.timestamp).toISOString(),
      event: a.rule_triggered,
      contractAddress: a.contract_id,
      status: parseDeliveryStatus(a.delivery_status),
      amount: a.amount !== undefined ? String(a.amount) : undefined,
      asset: 'XLM',
      txHash: a.transaction_hash,
      payload: a as unknown as Record<string, unknown>,
      isTest: a.is_test === true,
    };
    }
  }
  return {
    id: '',
    timestamp: new Date().toISOString(),
    event: 'Unknown',
    status: 'success',
  }
}

export function WebhookLogCard({
  alert,
  entry,
  network = 'mainnet',
  onClick,
}: WebhookLogCardProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const data = normalizeEntry({ alert, entry });
  const payload = data.payload ?? data;
  const json = JSON.stringify(payload, null, 2);
  const isTest =
    data.isTest === true ||
    alert?.is_test === true ||
    (data.payload as Record<string, unknown> | undefined)?.is_test === true;
  const data = normalizeEntry({ alert, entry })
  const payload = data.payload ?? data
  const json = JSON.stringify(payload, null, 2)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  const handleClick = useCallback(() => {
    if (onClick) {
      onClick()
    } else {
      open()
    }
  }, [onClick, open])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleClick()
      }
    },
    [handleClick]
  )

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }, [json])

  const txHref = data.txHash ? explorerTxUrl(network, data.txHash) : null
  const explorerHref =
    txHref ??
    (data.contractAddress
      ? explorerContractUrl(network, data.contractAddress)
      : null)
      : null) ??
    undefined

  return (
    <>
      <article
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className="rounded-lg border border-border bg-card p-4 shadow-sm space-y-3 cursor-pointer transition-colors hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`Webhook event ${data.event} at ${data.timestamp}. Open details.`}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="flex items-center gap-2 font-medium text-sm text-foreground break-all">
            {data.event}
            {isTest && (
              <span
                className="shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-800 dark:bg-purple-900/30 dark:text-purple-400"
                aria-label="Test delivery"
              >
                Test
              </span>
            )}
          </span>
          {data.status && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[data.status]}`}
            >
              {data.status}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span aria-label="Time" title={formatDateTime(data.timestamp)}>
            {formatDateTime(data.timestamp)}
          <span
            aria-label="Time"
            title={formatDateTime(new Date(data.timestamp).getTime())}
          >
            {formatDateTime(new Date(data.timestamp).getTime())}
          </span>
        </div>

        {data.contractAddress && (
          <div className="text-xs">
            <span className="text-muted-foreground">Contract: </span>
            <span className="font-mono break-all text-foreground">
              {truncateId(data.contractAddress, 6)}
            </span>
          </div>
        )}

        {data.amount && (
          <div className="text-xs">
            <span className="text-muted-foreground">Amount: </span>
            <span className="font-medium text-foreground">
              {formatAmount(data.amount)} {data.asset ?? ''}
            </span>
          </div>
        )}

        {data.txHash && (
          <div className="text-xs">
            <span className="text-muted-foreground">Tx: </span>
            {txHref ? (
              <a
                href={txHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="font-mono text-primary hover:underline break-all"
                aria-label={`View transaction ${data.txHash} on Stellar Explorer`}
              >
                {truncateId(data.txHash)}
              </a>
            ) : (
              <span className="font-mono break-all">
                {truncateId(data.txHash)}
              </span>
            )}
            <a
              href={explorerTxUrl(network, data.txHash) ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="font-mono text-primary hover:underline break-all"
              aria-label={`View transaction ${data.txHash} on Stellar Explorer`}
            >
              {truncateId(data.txHash)}
            </a>
          </div>
        )}
      </article>

      <Modal open={isOpen} onClose={close} title="Alert Detail">
        <div className="space-y-4">
          <pre className="whitespace-pre-wrap break-all rounded-md bg-zinc-800 p-3 text-xs font-mono text-zinc-200 max-h-96 overflow-y-auto">
            {json}
          </pre>

          <div className="flex items-center gap-2 pt-2 border-t border-zinc-800">
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 focus:outline-none"
            >
              {copied ? 'Copied!' : 'Copy JSON'}
            </button>
            <a
              href={explorerHref}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-indigo-400 hover:bg-zinc-800 focus:outline-none"
            >
              Open in explorer
            </a>
          </div>
        </div>
      </Modal>
    </>
  )
}

export default WebhookLogCard
