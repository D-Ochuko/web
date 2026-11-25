// @vitest-environment node
import { vi } from 'vitest'

const answers: Record<string, { address: string; family: number }[]> = {}
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
      const list = answers[host]
      if (!list)
        cb(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }), [])
      else cb(null, list)
    },
  },
}))

import {
  BlockedAddressError,
  deliverWebhook,
  describeDeliveryError,
  GENERIC_DELIVERY_ERROR,
  redirectTarget,
  resolvePublicAddresses,
  vettedLookup,
} from '../webhookProxy'
import {
  createRateLimiter,
  type RateLimitStore,
  type RateLimitWindow,
} from '../rateLimit'

const lookup = (host: string, options: { all?: boolean; family?: number }) =>
  new Promise<{ err: Error | null; address: unknown }>((resolve) =>
    vettedLookup(host, options, (err, address) => resolve({ err, address }))
  )

beforeEach(() => {
  for (const k of Object.keys(answers)) delete answers[k]
  answers['127.0.0.1.nip.io'] = [{ address: '127.0.0.1', family: 4 }]
  answers['10.0.0.5.nip.io'] = [{ address: '10.0.0.5', family: 4 }]
  answers['mixed.example'] = [
    { address: '93.184.216.34', family: 4 },
    { address: '::1', family: 6 },
  ]
  answers['public.example'] = [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1::1', family: 6 },
  ]
})

describe('resolvePublicAddresses', () => {
  it.each(['127.0.0.1.nip.io', '10.0.0.5.nip.io', 'mixed.example'])(
    'rejects %s because it resolves to a non-public address',
    async (host) => {
      await expect(resolvePublicAddresses(host)).rejects.toBeInstanceOf(
        BlockedAddressError
      )
    }
  )

  it('returns every address of a public name', async () => {
    expect(await resolvePublicAddresses('public.example')).toHaveLength(2)
  })
})

describe('vettedLookup', () => {
  it('only hands vetted addresses to the socket', async () => {
    expect(await lookup('public.example', { all: true })).toEqual({
      err: null,
      address: answers['public.example'],
    })
    expect(await lookup('public.example', { family: 6 })).toEqual({
      err: null,
      address: '2606:2800:220:1::1',
    })
  })

  it('refuses a name that rebinds to a private address at connect time', async () => {
    answers['rebind.example'] = [{ address: '93.184.216.34', family: 4 }]
    expect((await lookup('rebind.example', { all: true })).err).toBeNull()
    answers['rebind.example'] = [{ address: '169.254.169.254', family: 4 }]
    expect((await lookup('rebind.example', { all: true })).err).toBeInstanceOf(
      BlockedAddressError
    )
  })
})

describe('deliverWebhook', () => {
  it('never connects to a nip.io-style name that resolves to loopback', async () => {
    await expect(
      deliverWebhook(new URL('http://127.0.0.1.nip.io:1/hook'), '{}', {}, 1000)
    ).rejects.toBeInstanceOf(BlockedAddressError)
  })

  it('refuses private IP literals', async () => {
    await expect(
      deliverWebhook(
        new URL('http://[::ffff:127.0.0.1]:1/hook'),
        '{}',
        {},
        1000
      )
    ).rejects.toBeInstanceOf(BlockedAddressError)
  })
})

describe('createRateLimiter', () => {
  it('allows `limit` requests per window per key', async () => {
    const limit = createRateLimiter(2, 60000)
    expect((await limit('a', 0)).allowed).toBe(true)
    expect((await limit('a', 1)).allowed).toBe(true)
    expect(await limit('a', 2)).toEqual({ allowed: false, retryAfterMs: 59998 })
    expect((await limit('b', 2)).allowed).toBe(true)
    expect((await limit('a', 60000)).allowed).toBe(true)
  })

  it('delegates counting to a pluggable store', async () => {
    // A store shared by two limiter instances, as in a multi-instance deploy.
    const counts = new Map<string, RateLimitWindow>()
    const shared: RateLimitStore = {
      async hit(key, windowMs, now) {
        const w = counts.get(key)
        if (!w || now - w.windowStart >= windowMs) {
          const fresh = { count: 1, windowStart: now }
          counts.set(key, fresh)
          return fresh
        }
        w.count += 1
        return { ...w }
      },
    }
    const instanceA = createRateLimiter(2, 60000, shared)
    const instanceB = createRateLimiter(2, 60000, shared)
    expect((await instanceA('ip', 0)).allowed).toBe(true)
    expect((await instanceB('ip', 1)).allowed).toBe(true)
    expect((await instanceA('ip', 2)).allowed).toBe(false)
  })
})

describe('redirectTarget', () => {
  const base = new URL('http://hooks.example.com/x')

  it.each([
    ['https://hooks.example.com/x', 'https://hooks.example.com/x'],
    ['/x/', 'http://hooks.example.com/x/'],
    ['https://a:b@moved.example/p?q=1#f', 'https://moved.example/p'],
  ])('reduces %s to origin and path', (location, expected) => {
    expect(redirectTarget(location, base)).toBe(expected)
  })

  it.each([
    null,
    undefined,
    '',
    '  ',
    'javascript:alert(1)',
    'ftp://x.example/',
  ])('returns null for %j', (location) => {
    expect(redirectTarget(location, base)).toBeNull()
  })

  it('returns null for an over-long target', () => {
    expect(
      redirectTarget(`https://x.example/${'a'.repeat(3000)}`, base)
    ).toBeNull()
  })
})

describe('describeDeliveryError', () => {
  const nodeError = (code: string, message: string) =>
    Object.assign(new Error(message), { code })

  it.each([
    ['ECONNREFUSED', 'connect ECONNREFUSED 203.0.113.5:443', /refused/],
    ['ECONNRESET', 'read ECONNRESET', /closed the connection/],
    ['EPIPE', 'write EPIPE', /closed the connection/],
    ['ENOTFOUND', 'getaddrinfo ENOTFOUND internal.corp', /resolve/],
    ['EAI_AGAIN', 'getaddrinfo EAI_AGAIN internal.corp', /resolve/],
    ['EHOSTUNREACH', 'connect EHOSTUNREACH 203.0.113.5:443', /unreachable/],
    ['ETIMEDOUT', 'connect ETIMEDOUT 203.0.113.5:443', /timed out/],
    ['CERT_HAS_EXPIRED', 'certificate has expired', /TLS certificate/],
    [
      'ERR_TLS_CERT_ALTNAME_INVALID',
      "Hostname/IP does not match certificate's altnames: IP: 203.0.113.5",
      /TLS certificate/,
    ],
    [
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'self-signed certificate',
      /TLS certificate/,
    ],
    [
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'unable to verify the first certificate',
      /TLS certificate/,
    ],
    [
      'ERR_SSL_WRONG_VERSION_NUMBER',
      'ssl3_get_record:wrong version number',
      /TLS certificate/,
    ],
  ])('maps %s to a fixed message', (code, message, expected) => {
    const described = describeDeliveryError(nodeError(code, message))
    expect(described.code).toBe(code)
    expect(described.message).toMatch(expected)
    expect(described.message).not.toContain('203.0.113.5')
    expect(described.message).not.toContain(message)
  })

  it.each([
    ['an unknown code', nodeError('EWHATEVER', 'secret detail 10.0.0.1')],
    ['an error without a code', new Error('internal 10.0.0.1')],
    ['a non-error', 'boom 10.0.0.1'],
    ['null', null],
    ['undefined', undefined],
  ])('falls back to the generic message for %s', (_label, error) => {
    const described = describeDeliveryError(error)
    expect(described.message).toBe(GENERIC_DELIVERY_ERROR)
    expect(described.message).not.toMatch(/10\.0\.0\.1/)
  })
})
