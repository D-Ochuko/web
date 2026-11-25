'use client'

import { WEBHOOK_FORMAT_LABELS } from '@/lib/webhookFormat'
import { WEBHOOK_FORMATS, type WebhookFormat } from '@/types'

export interface WebhookFormatFieldProps {
  /** Element id for the select, so its label can point at it. */
  id: string
  format: WebhookFormat
  /** Format suggested from the webhook URL's host (see suggestWebhookFormat). */
  suggestedFormat: WebhookFormat
  onChange: (format: WebhookFormat) => void
}

/**
 * Picks the body shape deliveries use (#409). When the suggestion differs from
 * the current choice it is offered as a one-click option.
 */
export default function WebhookFormatField({
  id,
  format,
  suggestedFormat,
  onChange,
}: WebhookFormatFieldProps) {
  const hintId = `${id}-hint`
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-zinc-300">
        Payload format
      </label>
      <select
        id={id}
        value={format}
        onChange={(e) => onChange(e.target.value as WebhookFormat)}
        aria-describedby={hintId}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500"
      >
        {WEBHOOK_FORMATS.map((option) => (
          <option key={option} value={option}>
            {WEBHOOK_FORMAT_LABELS[option]}
          </option>
        ))}
      </select>
      <p id={hintId} className="text-xs text-zinc-500">
        {format === 'json'
          ? 'Sends the raw alert JSON.'
          : `Sends a ${WEBHOOK_FORMAT_LABELS[format]} message with a text summary of the alert.`}
        {suggestedFormat !== format && (
          <>
            {' '}
            Suggested for this URL: {
              WEBHOOK_FORMAT_LABELS[suggestedFormat]
            }.{' '}
            <button
              type="button"
              onClick={() => onChange(suggestedFormat)}
              className="text-indigo-400 underline hover:text-indigo-300"
            >
              Use {WEBHOOK_FORMAT_LABELS[suggestedFormat]}
            </button>
          </>
        )}
      </p>
    </div>
  )
}
