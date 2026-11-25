'use client'

import { useRef, useState } from 'react'
import {
  TEST_DELIVERY_HEADER_ALLOWLIST,
  WEBHOOK_HEADERS_MAX_COUNT,
  isValidWebhookHeaderName,
  isValidWebhookHeaderValue,
} from '@/lib/webhookHeaders'

interface HeaderRow {
  key: number
  name: string
  value: string
}

export interface WebhookHeadersFieldProps {
  /** Prefix for element ids, so several fields can share a page. */
  idPrefix: string
  /** Current headers. Read once on mount; the parent re-keys to reset. */
  headers: Record<string, string>
  /** Receives only rows with a valid name and value. */
  onChange: (headers: Record<string, string>) => void
}

/** Turns the editable rows into the map that is saved; invalid rows are skipped. */
function rowsToHeaders(rows: HeaderRow[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const row of rows) {
    const name = row.name.trim()
    if (
      isValidWebhookHeaderName(name) &&
      isValidWebhookHeaderValue(row.value)
    ) {
      result[name] = row.value.trim()
    }
  }
  return result
}

function rowError(row: HeaderRow): string | null {
  const name = row.name.trim()
  if (!name && !row.value) return null
  if (!name) return 'Enter a header name'
  if (!isValidWebhookHeaderName(name)) {
    return 'Use letters, digits and hyphens; reserved headers such as Host are not allowed'
  }
  if (!isValidWebhookHeaderValue(row.value)) {
    return 'Enter a value of up to 512 characters with no line breaks'
  }
  return null
}

/**
 * Editor for a contract's custom webhook headers (#408). Values are entered
 * in password fields so they are masked on screen.
 */
export default function WebhookHeadersField({
  idPrefix,
  headers,
  onChange,
}: WebhookHeadersFieldProps) {
  const [rows, setRows] = useState<HeaderRow[]>(() =>
    Object.entries(headers).map(([name, value], index) => ({
      key: index,
      name,
      value,
    }))
  )
  const nextKey = useRef(rows.length)

  function update(next: HeaderRow[]) {
    setRows(next)
    onChange(rowsToHeaders(next))
  }

  function addRow() {
    update([...rows, { key: nextKey.current++, name: '', value: '' }])
  }

  function removeRow(key: number) {
    update(rows.filter((row) => row.key !== key))
  }

  function editRow(key: number, field: 'name' | 'value', text: string) {
    update(
      rows.map((row) => (row.key === key ? { ...row, [field]: text } : row))
    )
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-zinc-300">
        Custom headers
      </legend>
      <p className="text-xs text-zinc-500">
        Sent with each delivery, for receivers that need an Authorization or
        API-key header. Values are masked here and left out of CSV exports. They
        are stored in this browser with the contract, like the signing secret.
        Test deliveries send only{' '}
        {TEST_DELIVERY_HEADER_ALLOWLIST.map((name) => titleCase(name)).join(
          ', '
        )}
        .
      </p>

      {rows.map((row, index) => {
        const error = rowError(row)
        const nameId = `${idPrefix}-header-${row.key}-name`
        const valueId = `${idPrefix}-header-${row.key}-value`
        const errorId = `${idPrefix}-header-${row.key}-error`
        return (
          <div key={row.key} className="space-y-1">
            <div className="flex flex-wrap gap-2">
              <label htmlFor={nameId} className="sr-only">
                Header {index + 1} name
              </label>
              <input
                id={nameId}
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="Authorization"
                value={row.name}
                onChange={(e) => editRow(row.key, 'name', e.target.value)}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                className="min-w-[8rem] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 focus:outline-none focus:border-indigo-500"
              />
              <label htmlFor={valueId} className="sr-only">
                Header {index + 1} value
              </label>
              <input
                id={valueId}
                type="password"
                autoComplete="off"
                placeholder="Value"
                value={row.value}
                onChange={(e) => editRow(row.key, 'value', e.target.value)}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                className="min-w-[8rem] flex-[2] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={() => removeRow(row.key)}
                aria-label={`Remove header ${index + 1}`}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:text-zinc-100 transition-colors"
              >
                Remove
              </button>
            </div>
            {error && (
              <p id={errorId} role="alert" className="text-xs text-red-400">
                {error}
              </p>
            )}
          </div>
        )
      })}

      {rows.length < WEBHOOK_HEADERS_MAX_COUNT ? (
        <button
          type="button"
          onClick={addRow}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 transition-colors"
        >
          Add header
        </button>
      ) : (
        <p className="text-xs text-zinc-500">
          Up to {WEBHOOK_HEADERS_MAX_COUNT} headers per contract.
        </p>
      )}
    </fieldset>
  )
}

function titleCase(name: string): string {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('-')
}
