// @vitest-environment node
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { vi } from 'vitest'

/**
 * Deadline tests (#398) run against a real local server, so loopback is
 * treated as public here; the SSRF classification itself is covered in
 * webhookProxy.test.ts.
 */
vi.mock('@/lib/ipRanges', () => ({
  classifyIp: () => 'public',
  classifyHost: () => 'public',
  isIpLiteral: (host: string) => /^[\d.]+$|:/.test(host),
}))

const lookups: string[] = []
const hanging = new Set<string>()
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
      lookups.push(host)
      if (hanging.has(host)) return // never answers, like a stuck resolver
      cb(null, [{ address: '127.0.0.1', family: 4 }])
    },
  },
}))

import {
  deliverWebhook,
  pinnedLookup,
  resolvePublicAddresses,
} from '../webhookProxy'

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void

let server: http.Server
let port: number
let handler: Handler
const timers = new Set<NodeJS.Timeout>()

beforeAll(async () => {
  server = http.createServer((req, res) => handler(req, res))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise((r) => server.close(r))
})

beforeEach(() => {
  lookups.length = 0
  hanging.clear()
  handler = (_req, res) => res.end('ok')
})

afterEach(() => {
  // Timed-out requests are destroyed by deliverWebhook itself; idle
  // keep-alive sockets stay pooled for the next test.
  timers.forEach(clearInterval)
  timers.clear()
})

/** Sends one byte every `everyMs`, forever: never idle, never finished. */
const slowDrip =
  (everyMs: number): Handler =>
  (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    const t = setInterval(() => res.write('.'), everyMs)
    timers.add(t)
    res.on('close', () => clearInterval(t))
  }

const url = (host = '127.0.0.1') => new URL(`http://${host}:${port}/hook`)

describe('deliverWebhook absolute deadline', () => {
  it('times out a receiver that trickles bytes slower than the deadline', async () => {
    handler = slowDrip(40) // well under the idle threshold of an idle timer
    const started = Date.now()
    await expect(deliverWebhook(url(), '{}', {}, 300)).rejects.toMatchObject({
      name: 'TimeoutError',
    })
    const elapsed = Date.now() - started
    expect(elapsed).toBeGreaterThanOrEqual(250)
    expect(elapsed).toBeLessThan(2000)
  })

  it('times out a receiver that never sends headers', async () => {
    handler = () => {} // accept the request, never answer
    await expect(deliverWebhook(url(), '{}', {}, 200)).rejects.toMatchObject({
      name: 'TimeoutError',
    })
  })

  it('honours an already-running caller deadline', async () => {
    handler = slowDrip(40)
    const signal = AbortSignal.timeout(150)
    const started = Date.now()
    await expect(
      deliverWebhook(url(), '{}', {}, 10_000, { signal })
    ).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('rejects at once when the caller deadline has already passed', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      deliverWebhook(url(), '{}', {}, 10_000, { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'TimeoutError' })
  })

  it('still resolves a fast receiver with its status and snippet', async () => {
    handler = (_req, res) => {
      res.writeHead(201, { 'Content-Type': 'text/plain' })
      res.end('created')
    }
    await expect(deliverWebhook(url(), '{}', {}, 1000)).resolves.toEqual({
      status: 201,
      location: null,
      bodySnippet: 'created',
    })
  })
})

describe('vetted addresses are reused', () => {
  it('connects to the pinned addresses without a second lookup', async () => {
    const addresses = await resolvePublicAddresses('hooks.example')
    expect(lookups).toEqual(['hooks.example'])
    const res = await deliverWebhook(url('hooks.example'), '{}', {}, 1000, {
      addresses,
    })
    expect(res.status).toBe(200)
    expect(lookups).toEqual(['hooks.example'])
  })

  it('resolves at connect time when no addresses are passed', async () => {
    await deliverWebhook(url('hooks.example'), '{}', {}, 1000)
    expect(lookups).toEqual(['hooks.example'])
  })

  it('pinnedLookup filters by family and refuses an empty list', async () => {
    const lookup = pinnedLookup([{ address: '127.0.0.1', family: 4 }])
    const answer = (options: { family?: number; all?: boolean }) =>
      new Promise<{ err: Error | null; address: unknown }>((resolve) =>
        lookup('h', options, (err, address) => resolve({ err, address }))
      )
    expect(await answer({ family: 4 })).toEqual({
      err: null,
      address: '127.0.0.1',
    })
    expect((await answer({ family: 6 })).err).toMatchObject({
      code: 'ENOTFOUND',
    })
    const empty = pinnedLookup([])
    const err = await new Promise((resolve) =>
      empty('h', {}, (e) => resolve(e))
    )
    expect(err).toBeInstanceOf(Error)
  })
})

describe('resolvePublicAddresses deadline', () => {
  it('stops waiting for a resolver that never answers', async () => {
    hanging.add('stuck.example')
    const started = Date.now()
    await expect(
      resolvePublicAddresses('stuck.example', AbortSignal.timeout(100))
    ).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('rejects without a lookup when the deadline already passed', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      resolvePublicAddresses('hooks.example', controller.signal)
    ).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(lookups).toEqual([])
  })
})
