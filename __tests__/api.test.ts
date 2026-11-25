import { vi } from 'vitest'
import {
  apiFetch,
  buildTestWebhookPayload,
  describeRule,
  isApiConfigured,
  joinUrl,
  parseCanonicalTestPayload,
  removeContract,
  sendTestWebhook,
  TEST_PAYLOAD_MAX_SKEW_MS,
  TEST_TX_HASH,
} from '@/lib/api'
import { horizonUrl } from '@/lib/stellar'
import { signWebhookPayload } from '@/lib/webhookSignature'
import { fetchAlerts } from '@/lib/alerts/alertSource'
import type { AlertRule } from '@/types'

global.fetch = vi.fn()

describe('apiFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches successfully and merges headers', async () => {
    const mockData = { id: 1 }
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify(mockData)),
    })

    const result = await apiFetch('/test', {
      headers: { 'X-Custom': 'value' },
    })

    // apiFetch passes a Headers instance; objectContaining cannot see into one,
    // so assert on the merged header values directly.
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/test'),
      expect.objectContaining({ headers: expect.any(Headers) })
    )
    const init = (global.fetch as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0][1] as RequestInit
    const sent = init.headers as Headers
    expect(sent.get('X-Custom')).toBe('value')
    expect(sent.has('Content-Type')).toBe(false)
    expect(sent.get('X-Custom')).toBe('value')
    expect(result).toEqual(mockData)
  })

  it('throws error on non-OK response with text', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Bad request'),
    })

    await expect(apiFetch('/test')).rejects.toThrow('Bad request')
  })

  it('throws error on non-OK response without text', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve(''),
    })

    await expect(apiFetch('/test')).rejects.toThrow('HTTP 500')
  })

  it('extracts a string message from a nested error object', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      text: () =>
        Promise.resolve(
          JSON.stringify({ error: { code: 'x', message: 'y' } })
        ),
    })

    await expect(apiFetch('/test')).rejects.toThrow('y')
  })

  it('extracts a string message from errors[0].message', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 422,
      text: () =>
        Promise.resolve(
          JSON.stringify({ errors: [{ message: 'first error' }] })
        ),
    })

    await expect(apiFetch('/test')).rejects.toThrow('first error')
  })

  it('extracts the RFC 7807 detail field', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            type: 'about:blank',
            title: 'Bad Request',
            detail: 'The request was malformed',
          })
        ),
    })

    await expect(apiFetch('/test')).rejects.toThrow('The request was malformed')
  })

  it('throws an ApiError when a successful response is not JSON', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: () => Promise.resolve('<!DOCTYPE html><html></html>'),
    })

    await expect(apiFetch('/test')).rejects.toThrow(
      'API returned non-JSON response'
    )
  })
})

describe('fetchAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('drops alerts whose contract_id or network do not match the request', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const matching = {
      id: 'a1',
      contract_id: 'CAAAA',
      network: 'testnet',
      rule_triggered: 'AnyTransaction',
      transaction_hash: TEST_TX_HASH,
      timestamp: 1700000000000,
    }
    const wrongContract = {
      ...matching,
      id: 'a2',
      contract_id: 'CBBBB',
    }
    const wrongNetwork = {
      ...matching,
      id: 'a3',
      network: 'mainnet',
    }
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [matching, wrongContract, wrongNetwork],
    })

    try {
      const alerts = await fetchAlerts('CAAAA', 'testnet')

      expect(alerts.map((a) => a.id)).toEqual(['a1'])
      expect(warn).toHaveBeenCalled()
      const message = warn.mock.calls.map((c) => String(c[0])).join(' ')
      expect(message).toContain('2')
    } finally {
      warn.mockRestore()
    }
  })
})

describe('buildTestWebhookPayload', () => {
  it('simulates the chosen AdminFunctionCalled function when allowed (#447)', () => {
    const rule: AlertRule = {
      type: 'AdminFunctionCalled',
      function_names: ['set_admin', 'upgrade'],
    }
    const base = { contractId: 'CBCDEF', rule, timestamp: 1 }
    expect(
      buildTestWebhookPayload({ ...base, functionName: 'upgrade' })
        .function_name
    ).toBe('upgrade')
    expect(
      buildTestWebhookPayload({ ...base, functionName: 'evil' }).function_name
    ).toBe('set_admin')
    expect(buildTestWebhookPayload(base).function_name).toBe('set_admin')
  })

  it('defaults to AnyTransaction with a well-formed hash and horizon link', () => {
    const payload = buildTestWebhookPayload({
      contractId: 'CBCDEF',
      timestamp: 1700000000000,
    })

    expect(payload).toEqual({
      label: 'Test Alert',
      contract_id: 'CBCDEF',
      network: 'testnet',
      rule_triggered: 'AnyTransaction',
      transaction_hash: TEST_TX_HASH,
      timestamp: 1700000000000,
      horizon_link: `https://horizon-testnet.stellar.org/transactions/${TEST_TX_HASH}`,
      is_test: true,
    })
    // 64 lowercase hex chars, so hash-parsing receivers accept it.
    expect(payload.transaction_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(payload.horizon_link).toContain(payload.transaction_hash)
  })

  it('mirrors the rule type and function_name for FunctionCalled', () => {
    const payload = buildTestWebhookPayload({
      contractId: 'CBCDEF',
      network: 'mainnet',
      rule: { type: 'FunctionCalled', function_name: 'transfer' },
    })

    expect(payload.rule_triggered).toBe('FunctionCalled')
    expect(payload.function_name).toBe('transfer')
    expect(payload.amount).toBeUndefined()
    expect(payload.horizon_link).toBe(
      `${horizonUrl('mainnet')}/transactions/${payload.transaction_hash}`
    )
  })

  it('uses the first admin function for AdminFunctionCalled', () => {
    const payload = buildTestWebhookPayload({
      contractId: 'CBCDEF',
      rule: {
        type: 'AdminFunctionCalled',
        function_names: ['set_admin', 'upgrade'],
      },
    })

    expect(payload.rule_triggered).toBe('AdminFunctionCalled')
    expect(payload.function_name).toBe('set_admin')
  })

  it('carries the threshold as amount for LargeTransfer', () => {
    const payload = buildTestWebhookPayload({
      contractId: 'CBCDEF',
      rule: { type: 'LargeTransfer', threshold_xlm: 500 },
    })

    expect(payload.rule_triggered).toBe('LargeTransfer')
    expect(payload.amount).toBe(500)
    expect(payload.function_name).toBeUndefined()
  })
})

describe('describeRule', () => {
  it('labels each rule variant with its configuration', () => {
    expect(describeRule({ type: 'AnyTransaction' })).toBe('AnyTransaction')
    expect(describeRule({ type: 'TransactionFailed' })).toBe(
      'TransactionFailed'
    )
    expect(describeRule({ type: 'LargeTransfer', threshold_xlm: 100 })).toBe(
      'LargeTransfer (over 100 XLM)'
    )
    expect(
      describeRule({ type: 'FunctionCalled', function_name: ' mint ' })
    ).toBe('FunctionCalled (mint)')
    expect(
      describeRule({
        type: 'AdminFunctionCalled',
        function_names: ['set_admin'],
      })
    ).toBe('AdminFunctionCalled (set_admin)')
  })
})

describe('sendTestWebhook', () => {
  const sentPayload = (): Record<string, unknown> => {
    const call = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]
    return JSON.parse((call[1] as RequestInit).body as string)
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('signs in the browser and never sends the secret to the proxy', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 204, ok: true }),
      })
      const secret = 'whsec_super_secret_value'

      const result = await sendTestWebhook('https://example.com/hook', {
        contractId: 'CBCDEF',
        secret,
      })

      const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>)
        .mock.calls[0]
      expect(url).toBe('/api/test-webhook')
      const raw = (init as RequestInit).body as string
      expect(raw).not.toContain(secret)
      const sent = JSON.parse(raw)
      expect(sent).not.toHaveProperty('secret')
      expect(sent.url).toBe('https://example.com/hook')
      expect(sent.signature).toBe(await signWebhookPayload(secret, sent.body))
      expect(JSON.parse(sent.body)).toMatchObject({
        contract_id: 'CBCDEF',
        is_test: true,
      })
      // The receiver's status comes from the proxy's JSON, not its HTTP code.
      expect(result).toMatchObject({ status: 204, ok: true })
      expect(result).not.toHaveProperty('location')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('sends a Slack body with its alert and only allow-listed headers via the proxy', async () => {
  it('passes the redirect target reported by the proxy through', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 200, ok: true }),
      })

      await sendTestWebhook('https://hooks.slack.com/services/T/B/X', {
        contractId: 'CBCDEF',
        format: 'slack',
        headers: { Authorization: 'Bearer test-token', Host: 'evil.example' },
      })

      const [, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>)
        .mock.calls[0]
      const sent = JSON.parse((init as RequestInit).body as string)
      expect(sent.format).toBe('slack')
      expect(sent.payload).toMatchObject({
        contract_id: 'CBCDEF',
        is_test: true,
      })
      expect(Object.keys(JSON.parse(sent.body))).toEqual(['text'])
      expect(sent.headers).toEqual({ Authorization: 'Bearer test-token' })
        json: async () => ({
          status: 301,
          ok: false,
          location: 'https://example.com/hook/',
        }),
      })
      const result = await sendTestWebhook('https://example.com/hook', {
        contractId: 'CBCDEF',
      })
      expect(result).toMatchObject({
        status: 301,
        ok: false,
        location: 'https://example.com/hook/',
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('ignores a non-string location from the proxy', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 302, ok: false, location: 42 }),
      })
      const result = await sendTestWebhook('https://example.com/hook', {
        contractId: 'CBCDEF',
      })
      expect(result).not.toHaveProperty('location')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('sends the rule-aware payload for the selected rule', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
    })

    await sendTestWebhook('https://example.com/webhook', {
      contractId: 'CBCDEF',
      rule: { type: 'FunctionCalled', function_name: 'transfer' },
    })

    expect(sentPayload()).toMatchObject({
      label: 'Test Alert',
      contract_id: 'CBCDEF',
      network: 'testnet',
      rule_triggered: 'FunctionCalled',
      function_name: 'transfer',
      is_test: true,
    })
    expect(sentPayload().transaction_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(sentPayload().horizon_link).toContain(
      `/transactions/${sentPayload().transaction_hash}`
    )
  })

  it('sends a pre-built payload verbatim', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
    })

    const payload = buildTestWebhookPayload({
      contractId: 'CBCDEF',
      timestamp: 42,
    })
    await sendTestWebhook('https://example.com/webhook', { payload })

    expect(sentPayload()).toEqual(payload)
  })

  it('throws error on webhook failure', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
    })

    // A non-2xx is reported as a result rather than thrown, so the caller can
    // surface the actual status code (see app/contracts/new/page.tsx).
    const result = await sendTestWebhook('https://example.com/webhook', {
      contractId: 'CBCDEF',
    })
    expect(result).toMatchObject({ status: 404, ok: false })
    expect(typeof result.error).toBe('string')
  })
})

describe('isApiConfigured', () => {
  it('reflects whether NEXT_PUBLIC_API_URL is set', () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '')
    expect(isApiConfigured()).toBe(false)
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.com')
    expect(isApiConfigured()).toBe(true)
    vi.unstubAllEnvs()
  })
})

describe('parseCanonicalTestPayload timestamp window (#401)', () => {
  const NOW = 1_700_000_000_000
  const body = (timestamp: number) =>
    JSON.stringify(
      buildTestWebhookPayload({
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        timestamp,
      })
    )

  it('accepts a payload within five minutes of now', () => {
    expect(parseCanonicalTestPayload(body(NOW), { now: NOW })).not.toBeNull()
    expect(
      parseCanonicalTestPayload(body(NOW - TEST_PAYLOAD_MAX_SKEW_MS), {
        now: NOW,
      })
    ).not.toBeNull()
    expect(
      parseCanonicalTestPayload(body(NOW + TEST_PAYLOAD_MAX_SKEW_MS), {
        now: NOW,
      })
    ).not.toBeNull()
  })
})

describe('joinUrl', () => {
  it('joins base and path without duplicate slashes', () => {
    expect(joinUrl('https://api.example.com/', '/contracts')).toBe(
      'https://api.example.com/contracts'
    )
    expect(joinUrl('https://api.example.com', 'contracts')).toBe(
      'https://api.example.com/contracts'
    )
  })
})

describe('removeContract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends a DELETE request to the contract endpoint', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 204,
      headers: new Headers(),
      text: () => Promise.resolve(''),
    })

    await removeContract('CBCDEF')

    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0]
    expect(url).toContain('/contracts/CBCDEF')
    expect((init as RequestInit).method).toBe('DELETE')
  it.each([
    ['just past the window', NOW - TEST_PAYLOAD_MAX_SKEW_MS - 1],
    ['just ahead of the window', NOW + TEST_PAYLOAD_MAX_SKEW_MS + 1],
    ['a year ahead', NOW + 365 * 24 * 3600 * 1000],
    ['the epoch', 0],
  ])('rejects a payload %s', (_label, timestamp) => {
    expect(parseCanonicalTestPayload(body(timestamp), { now: NOW })).toBeNull()
  })

  it('honours a custom window', () => {
    expect(
      parseCanonicalTestPayload(body(NOW - 2000), { now: NOW, maxSkewMs: 1000 })
    ).toBeNull()
  })
})
