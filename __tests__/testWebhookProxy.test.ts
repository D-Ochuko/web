// @vitest-environment node
import { vi } from 'vitest'

vi.mock('node:dns', () => ({
  default: {
    lookup: (
      host: string,
      _opts: unknown,
      cb: (
        err: Error | null,
        addresses: { address: string; family: number }[]
      ) => void
    ) => {
      const match = host.match(/^(\d+\.\d+\.\d+\.\d+)\.nip\.io$/)
      cb(null, [{ address: match ? match[1] : '93.184.216.34', family: 4 }])
    },
  },
}))

vi.mock('@/lib/webhookProxy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/webhookProxy')>()),
  deliverWebhook: vi.fn(async () => ({
    status: 200,
    location: null,
    bodySnippet: null,
  })),
}))

import type { NextRequest } from 'next/server'
import { POST } from '@/app/api/test-webhook/route'
import { deliverWebhook } from '@/lib/webhookProxy'
import { buildTestWebhookPayload } from '@/lib/api'
import { formatWebhookBody } from '@/lib/webhookFormat'
import { SIGNATURE_HEADER, signWebhookPayload } from '@/lib/webhookSignature'

const CID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4'
let ipCounter = 0

/** `ip` is the socket address (NextRequest.ip), not a forwarded header. */
function request(
  body: unknown,
  headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' },
  ip = `203.0.113.${++ipCounter}`
) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    headers: new Headers(headers),
    ip,
    text: async () => text,
  } as unknown as NextRequest
}

const testBody = (
  overrides: Partial<Parameters<typeof buildTestWebhookPayload>[0]> = {}
) =>
  JSON.stringify(
    buildTestWebhookPayload({
      contractId: CID,
      network: 'testnet',
      ...overrides,
    })
  )

const valid = {
  url: 'https://hooks.example.com/x',
  body: testBody(),
}

beforeEach(() => vi.mocked(deliverWebhook).mockClear())

describe('POST /api/test-webhook', () => {
  it('forwards a dashboard-built body and its signature verbatim', async () => {
    const body = testBody({
      rule: { type: 'FunctionCalled', function_name: 'swap' },
    })
    const signature = await signWebhookPayload('whsec_browser_only', body)
    const res = await POST(request({ url: valid.url, body, signature }))
    expect(res.status).toBe(200)
    const [url, sent, headers] = vi.mocked(deliverWebhook).mock.calls[0]
    expect(String(url)).toBe(valid.url)
    expect(sent).toBe(body)
    expect(headers[SIGNATURE_HEADER]).toBe(signature)
  })

  describe('timestamp window (#401)', () => {
    const MIN = 60_000

    it.each([
      ['six minutes old', -6 * MIN],
      ['six minutes ahead', 6 * MIN],
      ['years ahead', 3 * 365 * 24 * 60 * MIN],
      ['from 1970', -Date.now() + 42],
    ])('refuses a payload %s', async (_label, offset) => {
      const res = await POST(
        request({
          ...valid,
          body: testBody({ timestamp: Date.now() + offset }),
        })
      )
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/server time/)
      expect(deliverWebhook).not.toHaveBeenCalled()
    })

    it.each([
      ['four minutes old', -4 * MIN],
      ['four minutes ahead', 4 * MIN],
    ])('accepts a payload %s', async (_label, offset) => {
      const res = await POST(
        request({
          ...valid,
          body: testBody({ timestamp: Date.now() + offset }),
        })
      )
      expect(res.status).toBe(200)
    })

    it('refuses a fresh body whose signature t= is stale', async () => {
      const body = testBody()
      const t = Math.floor(Date.now() / 1000) - 10 * 60
      const signature = await signWebhookPayload('whsec_x', body, t)
      const res = await POST(request({ url: valid.url, body, signature }))
      expect(res.status).toBe(400)
      expect(deliverWebhook).not.toHaveBeenCalled()
    })

    it('refuses a signature t= dated in the future', async () => {
      const body = testBody()
      const t = Math.floor(Date.now() / 1000) + 10 * 60
      const signature = await signWebhookPayload('whsec_x', body, t)
      const res = await POST(request({ url: valid.url, body, signature }))
      expect(res.status).toBe(400)
    })

    it('refuses the legacy sha256= signature format', async () => {
      const res = await POST(
        request({ ...valid, signature: `sha256=${'a'.repeat(64)}` })
      )
      expect(res.status).toBe(400)
      expect(deliverWebhook).not.toHaveBeenCalled()
    })
  it.each([
    ['the legacy sha256= form', `sha256=${'a'.repeat(64)}`],
    ['a missing timestamp', `v1=${'a'.repeat(64)}`],
    ['a non-numeric timestamp', `t=abc,v1=${'a'.repeat(64)}`],
    ['a truncated MAC', `t=1700000000,v1=${'a'.repeat(62)}`],
    ['a non-hex MAC', `t=1700000000,v1=${'z'.repeat(64)}`],
    ['no v1 entry', 't=1700000000'],
  ])('rejects a signature with %s', async (_label, signature) => {
    const res = await POST(request({ ...valid, signature }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Invalid signature' })
    expect(deliverWebhook).not.toHaveBeenCalled()
  })

  it('accepts a timestamped signature with extra v1 entries', async () => {
    const signature = await signWebhookPayload('whsec_rotated', valid.body)
    const withExtra = `${signature},v1=${'b'.repeat(64)}`
    const res = await POST(request({ ...valid, signature: withExtra }))
    expect(res.status).toBe(200)
    const [, , headers] = vi.mocked(deliverWebhook).mock.calls[0]
    expect(headers[SIGNATURE_HEADER]).toBe(withExtra)
  })

  it('sends no signature header when the browser sent none', async () => {
    await POST(request(valid))
    const [, , headers] = vi.mocked(deliverWebhook).mock.calls[0]
    expect(headers).not.toHaveProperty(SIGNATURE_HEADER)
  })

  it('rejects a request that carries the signing secret', async () => {
    const res = await POST(request({ ...valid, secret: 'whsec_leaked' }))
    expect(res.status).toBe(400)
    expect(deliverWebhook).not.toHaveBeenCalled()
  })

  it('never logs the request body', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(
      (method) => vi.spyOn(console, method).mockImplementation(() => {})
    )
    try {
      await POST(request({ ...valid, signature: `sha256=${'a'.repeat(64)}` }))
      await POST(request({ ...valid, body: '{"spam":true}' }))
      for (const spy of spies) {
        for (const call of spy.mock.calls) {
          expect(JSON.stringify(call)).not.toMatch(/is_test|spam|sha256=/)
        }
      }
    } finally {
      spies.forEach((spy) => spy.mockRestore())
    }
  })

  it.each([
    ['arbitrary JSON', '{"spam":true}'],
    [
      'a non-test payload',
      testBody().replace('"is_test":true', '"is_test":false'),
    ],
    [
      'a payload with extra fields',
      JSON.stringify({ ...JSON.parse(testBody()), extra: 'x' }),
    ],
    [
      'a tampered horizon link',
      JSON.stringify({
        ...JSON.parse(testBody()),
        horizon_link: 'https://evil.example/tx',
      }),
    ],
    ['an invalid contract', testBody({ contractId: 'CNOPE' })],
  ])('refuses to relay %s', async (_label, body) => {
    const res = await POST(request({ ...valid, body }))
    expect(res.status).toBe(400)
    expect(deliverWebhook).not.toHaveBeenCalled()
  })

  it.each([
    [{ 'sec-fetch-site': 'cross-site' }],
    [{ origin: 'https://evil.example', host: 'dashboard.example' }],
    [{}],
  ])('rejects cross-origin or origin-less requests %j', async (headers) => {
    const res = await POST(request(valid, headers))
    expect(res.status).toBe(403)
    expect(deliverWebhook).not.toHaveBeenCalled()
  })

  it('returns the receiver duration and body snippet', async () => {
    vi.mocked(deliverWebhook).mockResolvedValueOnce({
      status: 500,
      location: null,
      bodySnippet: 'Internal Server Error',
    })
    const res = await POST(request(valid))
    const body = await res.json()
    expect(body).toMatchObject({
      status: 500,
      ok: false,
      bodySnippet: 'Internal Server Error',
    })
    expect(typeof body.durationMs).toBe('number')
  })

  it('accepts a matching Origin when Sec-Fetch-Site is absent', async () => {
    const res = await POST(
      request(valid, {
        origin: 'https://dashboard.example',
        host: 'dashboard.example',
      })
    )
    expect(res.status).toBe(200)
  })

  it('rate-limits to 10 requests per minute per IP', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      statuses.push(
        (await POST(request(valid, undefined, '198.51.100.7'))).status
      )
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true)
    const limited = await POST(request(valid, undefined, '198.51.100.7'))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/)
  })

  describe('rate-limit client IP', () => {
    const sameOrigin = { 'sec-fetch-site': 'same-origin' }

    afterEach(() => vi.unstubAllEnvs())

    it('ignores a spoofed X-Forwarded-For when no hops are trusted', async () => {
      const statuses: number[] = []
      for (let i = 0; i < 11; i++) {
        const res = await POST(
          request(
            valid,
            { ...sameOrigin, 'x-forwarded-for': `10.30.0.${i}` },
            '192.0.2.10'
          )
        )
        statuses.push(res.status)
      }
      expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true)
      expect(statuses[10]).toBe(429)
    })

    it('keys the limit on the trusted hop when TRUSTED_PROXY_HOPS=1', async () => {
      vi.stubEnv('TRUSTED_PROXY_HOPS', '1')
      const statuses: number[] = []
      for (let i = 0; i < 11; i++) {
        // Each request claims a new spoofed client on the left; the proxy
        // appended the real client (192.0.2.20) on the right.
        const res = await POST(
          request(
            valid,
            { ...sameOrigin, 'x-forwarded-for': `10.40.0.${i}, 192.0.2.20` },
            '10.0.0.1'
          )
        )
        statuses.push(res.status)
      }
      expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true)
      expect(statuses[10]).toBe(429)
    })

    it('gives distinct real clients behind the proxy separate windows', async () => {
      vi.stubEnv('TRUSTED_PROXY_HOPS', '1')
      const from = (client: string) =>
        request(
          valid,
          { ...sameOrigin, 'x-forwarded-for': `6.6.6.6, ${client}` },
          '10.0.0.1'
        )
      for (let i = 0; i < 10; i++) {
        expect((await POST(from('192.0.2.30'))).status).toBe(200)
      }
      expect((await POST(from('192.0.2.30'))).status).toBe(429)
      expect((await POST(from('192.0.2.31'))).status).toBe(200)
    })
  })

  it('caps the body size', async () => {
    const res = await POST(request({ ...valid, padding: 'x'.repeat(9000) }))
    expect(res.status).toBe(413)
  })

  it.each([
    [{ url: valid.url }],
    [{ ...valid, signature: 'sha256=nothex' }],
    [{ ...valid, signature: 42 }],
    [{ ...valid, url: 42 }],
    ['not json'],
  ])('rejects invalid input %j', async (body) => {
    expect((await POST(request(body))).status).toBe(400)
  })

  it.each([
    'http://127.0.0.1.nip.io/hook',
    'http://10.0.0.5.nip.io/hook',
    'http://169.254.169.254.nip.io/latest/meta-data/',
    'http://[::1]/hook',
    'http://[::ffff:127.0.0.1]/hook',
    'http://100.64.0.1/hook',
  ])('blocks %s', async (url) => {
    const res = await POST(request({ ...valid, url }))
    expect(res.status).toBe(403)
    expect(deliverWebhook).not.toHaveBeenCalled()
  })
})

describe('POST /api/test-webhook formats and headers (#408, #409)', () => {
  const alertPayload = buildTestWebhookPayload({
    contractId: CID,
    network: 'testnet',
  })

  it('accepts a Slack body that renders from the alert it carries', async () => {
    const body = formatWebhookBody(alertPayload, 'slack')
    const res = await POST(
      request({
        url: 'https://hooks.slack.com/services/T/B/X',
        body,
        format: 'slack',
        payload: alertPayload,
      })
    )
    expect(res.status).toBe(200)
    const [, sent] = vi.mocked(deliverWebhook).mock.calls.at(-1)!
    expect(sent).toBe(body)
  })

  it('rejects a formatted body that does not match the alert', async () => {
    const res = await POST(
      request({
        url: 'https://hooks.slack.com/services/T/B/X',
        body: JSON.stringify({ text: 'anything the caller likes' }),
        format: 'slack',
        payload: alertPayload,
      })
    )
    expect(res.status).toBe(400)
  })

  it('rejects an unknown format', async () => {
    const res = await POST(
      request({
        url: valid.url,
        body: valid.body,
        format: 'teams',
        payload: alertPayload,
      })
    )
    expect(res.status).toBe(400)
  })

  it('forwards only allow-listed headers', async () => {
    const res = await POST(
      request({
        ...valid,
        headers: {
          Authorization: 'Bearer test-token',
          Host: 'evil.example',
          'X-Custom': 'not-allowed',
        },
      })
    )
    expect(res.status).toBe(200)
    const [, , headers] = vi.mocked(deliverWebhook).mock.calls.at(-1)!
    expect(headers.Authorization).toBe('Bearer test-token')
    expect(headers).not.toHaveProperty('Host')
    expect(headers).not.toHaveProperty('X-Custom')
    expect(headers['Content-Type']).toBe('application/json')
  })
})
