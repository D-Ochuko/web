// @vitest-environment node
import { vi } from 'vitest'

vi.mock('node:dns', () => ({
  default: {
    lookup: (
      _host: string,
      _opts: unknown,
      cb: (
        err: Error | null,
        addresses: { address: string; family: number }[]
      ) => void
    ) => cb(null, [{ address: '93.184.216.34', family: 4 }]),
  },
}))

vi.mock('@/lib/webhookProxy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/webhookProxy')>()),
  deliverWebhook: vi.fn(),
}))

import type { NextRequest } from 'next/server'
import { POST } from '@/app/api/test-webhook/route'
import { deliverWebhook } from '@/lib/webhookProxy'
import { buildTestWebhookPayload } from '@/lib/api'

const CID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4'
let ip = 0

const request = (url: string) => {
  const text = JSON.stringify({
    url,
    body: JSON.stringify(
      buildTestWebhookPayload({ contractId: CID, network: 'testnet' })
    ),
  })
  return {
    headers: new Headers({
      'sec-fetch-site': 'same-origin',
      'x-forwarded-for': `192.0.2.${++ip}`,
    }),
    text: async () => text,
  } as unknown as NextRequest
}

const deliver = vi.mocked(deliverWebhook)
const redirect = (status: number, location: string | null) =>
  deliver.mockResolvedValueOnce({ status, location, bodySnippet: null })

beforeEach(() => deliver.mockReset())

describe('POST /api/test-webhook redirects (#399)', () => {
  it('reports where an http receiver redirects to', async () => {
    redirect(301, 'https://hooks.example.com/x')
    const body = await (
      await POST(request('http://hooks.example.com/x'))
    ).json()
    expect(body).toMatchObject({
      status: 301,
      ok: false,
      location: 'https://hooks.example.com/x',
    })
    expect(deliver).toHaveBeenCalledTimes(1)
  })

  it('resolves a relative Location against the called URL', async () => {
    redirect(308, '/x/')
    const body = await (
      await POST(request('https://hooks.example.com/x'))
    ).json()
    expect(body.location).toBe('https://hooks.example.com/x/')
  })

  it('drops the query, fragment and credentials of the target', async () => {
    redirect(302, 'https://user:pw@moved.example/hook?token=s3cret#frag')
    const body = await (
      await POST(request('https://hooks.example.com/x'))
    ).json()
    expect(body.location).toBe('https://moved.example/hook')
    expect(JSON.stringify(body)).not.toMatch(/s3cret|pw@|frag/)
  })

  it('only reports the target, never follows it, for internal hosts', async () => {
    redirect(302, 'http://169.254.169.254/latest/meta-data/')
    const body = await (
      await POST(request('https://hooks.example.com/x'))
    ).json()
    expect(deliver).toHaveBeenCalledTimes(1)
    expect(String(deliver.mock.calls[0][0])).toBe('https://hooks.example.com/x')
    expect(body.ok).toBe(false)
  })

  it.each([
    ['a non-http scheme', 'javascript:alert(1)'],
    ['an empty header', '   '],
    ['no header', null],
  ])('omits the location for %s', async (_label, location) => {
    redirect(302, location)
    const body = await (
      await POST(request('https://hooks.example.com/x'))
    ).json()
    expect(body).not.toHaveProperty('location')
  })

  it('ignores a Location sent with a non-redirect status', async () => {
    redirect(201, 'https://hooks.example.com/created/1')
    const body = await (
      await POST(request('https://hooks.example.com/x'))
    ).json()
    expect(body).toMatchObject({ status: 201, ok: true })
    expect(body).not.toHaveProperty('location')
  })
})

describe('POST /api/test-webhook delivery errors (#402)', () => {
  const fail = (code: string | undefined, message: string) =>
    deliver.mockRejectedValueOnce(
      Object.assign(new Error(message), code ? { code } : {})
    )

  it.each([
    ['ECONNREFUSED', 'connect ECONNREFUSED 203.0.113.5:443', /refused/],
    ['ECONNRESET', 'read ECONNRESET 203.0.113.5:443', /closed/],
    ['ENOTFOUND', 'getaddrinfo ENOTFOUND 203.0.113.5', /resolve/],
    ['CERT_HAS_EXPIRED', 'certificate has expired for 203.0.113.5', /TLS/],
    [undefined, 'internal failure at 203.0.113.5', /Failed to deliver/],
  ])(
    'maps %s to a fixed message without internals',
    async (code, message, expected) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        fail(code, message)
        const res = await POST(request('https://hooks.example.com/x'))
        const body = await res.json()
        expect(res.status).toBe(502)
        expect(body).toMatchObject({ status: 502, ok: false })
        expect(body.error).toMatch(expected)
        expect(JSON.stringify(body)).not.toContain('203.0.113.5')
        // Details are logged server-side, without the payload.
        expect(warn).toHaveBeenCalledTimes(1)
        const logged = JSON.stringify(warn.mock.calls[0])
        expect(logged).toContain('203.0.113.5')
        expect(logged).toContain('hooks.example.com')
        expect(logged).not.toMatch(/is_test|contract_id/)
      } finally {
        warn.mockRestore()
      }
    }
  )

  it('still reports a timeout as 504', async () => {
    deliver.mockRejectedValueOnce(
      Object.assign(new Error('Webhook request timed out'), {
        name: 'TimeoutError',
      })
    )
    const res = await POST(request('https://hooks.example.com/x'))
    expect(res.status).toBe(504)
    expect((await res.json()).error).toBe('Webhook request timed out')
  })
})
