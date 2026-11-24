import { vi } from 'vitest'
import {
  apiFetch,
  buildTestWebhookPayload,
  describeRule,
  isApiConfigured,
  joinUrl,
  removeContract,
  sendTestWebhook,
  TEST_TX_HASH,
} from '@/lib/api'
import { horizonUrl } from '@/lib/stellar'
import { signWebhookPayload } from '@/lib/webhookSignature'
import { fetchAlerts } from '@/lib/alerts/alertSource'

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
      expect(result).toEqual({ status: 204, ok: true })
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
  })
})
