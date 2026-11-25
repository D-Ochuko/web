import { isIP } from 'node:net'

/**
 * Client address for rate limiting (server-only).
 *
 * X-Forwarded-For is set by the client unless a proxy overwrites it, so it is
 * read only when the deployment declares how many proxies sit in front of the
 * app (TRUSTED_PROXY_HOPS). Each trusted proxy appends the address it received
 * the request from, so with N trusted hops the client is the entry N places
 * from the right. Entries further left were supplied by the client and are
 * ignored. With no trusted hops, the header is ignored entirely and the socket
 * address is used.
 */

/**
 * Parses TRUSTED_PROXY_HOPS. Unset, empty or invalid values give 0, which
 * trusts no forwarding headers.
 */
export function trustedProxyHops(
  raw: string | undefined = process.env.TRUSTED_PROXY_HOPS
): number {
  const trimmed = raw?.trim() ?? ''
  if (trimmed === '') return 0
  const hops = Number(trimmed)
  return Number.isInteger(hops) && hops >= 0 ? hops : 0
}

/**
 * Returns the client IP for rate limiting. `socketIp` is the connection's
 * address (NextRequest.ip); it is used when the forwarded chain is absent,
 * too short, or does not hold a valid IP at the trusted position.
 */
export function getClientIp(
  headers: Pick<Headers, 'get'>,
  socketIp: string | undefined,
  hops: number
): string {
  if (hops > 0) {
    const chain = (headers.get('x-forwarded-for') ?? '')
      .split(',')
      .map((entry) => entry.trim())
    const candidate = chain.length >= hops ? chain[chain.length - hops] : ''
    if (candidate && isIP(candidate)) return candidate
  }
  return socketIp || 'unknown'
}
