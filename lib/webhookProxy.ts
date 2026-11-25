import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import type { LookupFunction } from 'node:net'
import { classifyHost, classifyIp, isIpLiteral } from '@/lib/ipRanges'
import { MAX_BODY_SNIPPET_BYTES, sanitizeBodySnippet } from '@/lib/bodySnippet'

/**
 * Server-only helpers for the test-webhook proxy (#259, #261).
 */

/** The target resolves to (or is) a non-public address. */
export class BlockedAddressError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockedAddressError'
  }
}

/** Error named 'TimeoutError', the name the route maps to HTTP 504. */
export function timeoutError(
  message = 'Webhook request timed out'
): Error & { name: 'TimeoutError' } {
  const err = new Error(message) as Error & { name: 'TimeoutError' }
  err.name = 'TimeoutError'
  return err
}

/**
 * A signal that aborts when any of `signals` does. Uses AbortSignal.any where
 * available (Node 20.3+) and falls back to manual wiring on older runtimes.
 */
export function anySignal(signals: (AbortSignal | undefined)[]): AbortSignal {
  const list = signals.filter((s): s is AbortSignal => Boolean(s))
  if (list.length === 1) return list[0]
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(list)
  const controller = new AbortController()
  for (const signal of list) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), {
      once: true,
    })
  }
  return controller.signal
}

/**
 * Resolve every address of `hostname`; reject if any is not public.
 *
 * `dns.lookup` runs on the libuv thread pool and cannot be cancelled, so when
 * `signal` aborts (e.g. the request deadline passes) this stops waiting and
 * rejects with a TimeoutError; the late answer is ignored.
 */
export function resolvePublicAddresses(
  hostname: string,
  signal?: AbortSignal
): Promise<dns.LookupAddress[]> {
  if (signal?.aborted) {
    return Promise.reject(timeoutError('Webhook host lookup timed out'))
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      reject(timeoutError('Webhook host lookup timed out'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      if (err) return reject(err)
      if (!addresses.length)
        return reject(new Error(`${hostname} did not resolve`))
      const blocked = addresses.find((a) => classifyIp(a.address) !== 'public')
      if (blocked) {
        return reject(
          new BlockedAddressError(
            `${hostname} resolves to a non-public address (${blocked.address})`
          )
        )
      }
      resolve(addresses)
    })
  })
}

/** Hand `addresses` to a socket lookup callback, honouring `family`/`all`. */
function answerLookup(
  hostname: string,
  addresses: dns.LookupAddress[],
  options: { family?: number | string; all?: boolean },
  callback: Parameters<LookupFunction>[2]
) {
  const family =
    options.family === 4 || options.family === 6 ? options.family : 0
  const list = family ? addresses.filter((a) => a.family === family) : addresses
  if (!list.length) {
    const err = Object.assign(
      new Error(`${hostname} has no IPv${family} address`),
      { code: 'ENOTFOUND' }
    )
    return callback(err, '', 4)
  }
  if (options.all) callback(null, list)
  else callback(null, list[0].address, list[0].family)
}

/**
 * `lookup` hook for the outgoing socket: the connection only ever uses
 * addresses vetted in this same lookup, so a DNS-rebinding answer between the
 * up-front check and the connect cannot reach a private address.
 */
export const vettedLookup = ((hostname, options, callback) => {
  resolvePublicAddresses(hostname).then(
    (addresses) => answerLookup(hostname, addresses, options, callback),
    (err) => callback(err, '', 4)
  )
}) as LookupFunction

/**
 * `lookup` hook that serves only `addresses`, already vetted by
 * resolvePublicAddresses, so the name is not resolved a second time: the
 * socket connects to exactly the addresses that were checked, and a slow
 * resolver cannot add a second unbounded wait.
 */
export function pinnedLookup(addresses: dns.LookupAddress[]): LookupFunction {
  const vetted = addresses.filter((a) => classifyIp(a.address) === 'public')
  return ((hostname, options, callback) => {
    if (vetted.length !== addresses.length || !vetted.length) {
      return callback(
        new BlockedAddressError(
          `${hostname} has no vetted public address to connect to`
        ),
        '',
        4
      )
    }
    answerLookup(hostname, vetted, options, callback)
  }) as LookupFunction
}

export interface DeliveryResult {
  status: number
  /** Location header of a 3xx response; redirects are never followed. */
  location: string | null
  /** Sanitised first bytes of a text response body (max 1 KB), else null. */
  bodySnippet: string | null
}

/** Longest redirect target echoed back to the dashboard. */
export const MAX_REDIRECT_TARGET_LENGTH = 2048

/**
 * The target of a receiver's redirect, reduced to origin and path, for
 * telling the user where their webhook URL moved (#399). A relative
 * `Location` is resolved against the URL that was called. Query string,
 * fragment and credentials are dropped (they may carry tokens), as is any
 * non-http(s) or over-long target. Returns null when nothing safe is left.
 */
export function redirectTarget(
  location: string | null | undefined,
  base: URL
): string | null {
  const raw = location?.trim()
  if (!raw) return null
  let target: URL
  try {
    target = new URL(raw, base)
  } catch {
    return null
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null
  const value = `${target.origin}${target.pathname}`
  return value.length > MAX_REDIRECT_TARGET_LENGTH ? null : value
}

export interface DeliverWebhookOptions {
  /**
   * Addresses already vetted by resolvePublicAddresses for `url.hostname`.
   * When given, the socket connects to these instead of resolving again.
   */
  addresses?: dns.LookupAddress[]
  /** Caller deadline (e.g. one shared with the DNS pre-check). */
  signal?: AbortSignal
}

/**
 * POST `body` to `url`, connecting only to vetted public addresses and never
 * following redirects. Rejects with an Error named 'TimeoutError' once
 * `timeoutMs` has passed (or `options.signal` aborts), whichever phase the
 * request is in: DNS, connect, TLS, waiting for headers or reading the body.
 * This is an absolute deadline, not an idle timeout, so a receiver that
 * trickles one byte at a time cannot hold the request open.
 */
export function deliverWebhook(
  url: URL,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
  options: DeliverWebhookOptions = {}
): Promise<DeliveryResult> {
  if (isIpLiteral(url.hostname) && classifyHost(url.hostname) !== 'public') {
    return Promise.reject(
      new BlockedAddressError('Private and loopback target URLs are blocked')
    )
  }
  const deadline = anySignal([AbortSignal.timeout(timeoutMs), options.signal])
  if (deadline.aborted) return Promise.reject(timeoutError())

  const client = url.protocol === 'https:' ? https : http
  const lookup = options.addresses
    ? pinnedLookup(options.addresses)
    : vettedLookup
  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      deadline.removeEventListener('abort', onDeadline)
      fn()
    }
    const req = client.request(
      url,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': String(Buffer.byteLength(body)),
        },
        lookup,
        // One fresh connection per delivery: a pooled keep-alive socket would
        // skip this request's vetted lookup and skew the reported duration.
        agent: false,
      },
      (res) => {
        // Read just enough of the body for a snippet (one byte past the limit
        // marks it as truncated), then stop downloading.
        const chunks: Buffer[] = []
        let received = 0
        const finish = () =>
          settle(() =>
            resolve({
              status: res.statusCode ?? 0,
              location: res.headers.location ?? null,
              bodySnippet: sanitizeBodySnippet(
                Buffer.concat(chunks),
                res.headers['content-type']
              ),
            })
          )
        res.on('data', (chunk: Buffer) => {
          if (settled) return
          chunks.push(chunk)
          received += chunk.length
          if (received > MAX_BODY_SNIPPET_BYTES) {
            finish()
            res.destroy()
          }
        })
        res.on('end', finish)
        // A response cut short by the deadline is a timeout, not a delivery.
        res.on('close', () => (deadline.aborted ? undefined : finish()))
        res.on('error', () => (deadline.aborted ? undefined : finish()))
      }
    )
    function onDeadline() {
      const err = timeoutError()
      settle(() => reject(err))
      req.destroy(err)
    }
    deadline.addEventListener('abort', onDeadline, { once: true })
    req.on('error', (err) => settle(() => reject(err)))
    req.end(body)
  })
}

/** Generic message for a failure that is not one of the known codes. */
export const GENERIC_DELIVERY_ERROR = 'Failed to deliver webhook'

/** Node network/TLS error codes and the fixed message shown for each. */
const DELIVERY_ERROR_MESSAGES: Record<string, string> = {
  ECONNREFUSED: 'The receiver refused the connection',
  ECONNRESET: 'The receiver closed the connection unexpectedly',
  EPIPE: 'The receiver closed the connection unexpectedly',
  ECONNABORTED: 'The receiver closed the connection unexpectedly',
  ENOTFOUND: 'Could not resolve the webhook host',
  EAI_AGAIN: 'Could not resolve the webhook host',
  EAI_NONAME: 'Could not resolve the webhook host',
  EHOSTUNREACH: 'The receiver is unreachable',
  ENETUNREACH: 'The receiver is unreachable',
  ETIMEDOUT: 'Connecting to the receiver timed out',
  HPE_INVALID_CONSTANT: 'The receiver sent an invalid HTTP response',
  HPE_INVALID_STATUS: 'The receiver sent an invalid HTTP response',
  HPE_HEADER_OVERFLOW: 'The receiver sent an invalid HTTP response',
}

const TLS_ERROR_MESSAGE = "The receiver's TLS certificate could not be verified"

/** OpenSSL/Node codes that mean the receiver's certificate was rejected. */
const TLS_ERROR_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
])

export interface DescribedDeliveryError {
  /** Fixed, user-safe message; never contains addresses or internals. */
  message: string
  /** The error's code, if any, for server-side logs only. */
  code: string | null
}

/**
 * Maps a failed delivery to a fixed user-facing message (#402). Node error
 * messages such as `connect ECONNREFUSED 203.0.113.5:443` reveal resolved
 * addresses and server internals, so only the code is inspected and the
 * message itself is never returned to the caller.
 */
export function describeDeliveryError(error: unknown): DescribedDeliveryError {
  const raw = (error as { code?: unknown } | null | undefined)?.code
  const code = typeof raw === 'string' && raw ? raw : null
  if (!code) return { message: GENERIC_DELIVERY_ERROR, code }
  const known = DELIVERY_ERROR_MESSAGES[code]
  if (known) return { message: known, code }
  if (
    code.startsWith('CERT_') ||
    code.startsWith('ERR_TLS_') ||
    code.startsWith('ERR_SSL_') ||
    TLS_ERROR_CODES.has(code)
  ) {
    return { message: TLS_ERROR_MESSAGE, code }
  }
  return { message: GENERIC_DELIVERY_ERROR, code }
}

/**
 * Fixed-window per-key rate limiter (in memory, per server instance).
 */
export function createRateLimiter(limit: number, windowMs: number) {
  const windows = new Map<string, { start: number; count: number }>()
  return (
    key: string,
    now = Date.now()
  ): { allowed: boolean; retryAfterMs: number } => {
    if (windows.size > 10000) {
      windows.forEach((w, k) => {
        if (now - w.start >= windowMs) windows.delete(k)
      })
    }
    let w = windows.get(key)
    if (!w || now - w.start >= windowMs) {
      w = { start: now, count: 0 }
      windows.set(key, w)
    }
    w.count += 1
    return { allowed: w.count <= limit, retryAfterMs: w.start + windowMs - now }
  }
}
