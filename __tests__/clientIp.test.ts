// @vitest-environment node
import { getClientIp, trustedProxyHops } from '../lib/clientIp'

const SOCKET = '203.0.113.9'

const headers = (xff?: string) =>
  new Headers(xff === undefined ? {} : { 'x-forwarded-for': xff })

describe('trustedProxyHops', () => {
  it.each([
    [undefined, 0],
    ['', 0],
    ['   ', 0],
    ['0', 0],
    ['1', 1],
    [' 2 ', 2],
    ['-1', 0],
    ['1.5', 0],
    ['abc', 0],
  ])('parses %j as %i', (raw, expected) => {
    expect(trustedProxyHops(raw)).toBe(expected)
  })
})

describe('getClientIp', () => {
  it('ignores X-Forwarded-For when no proxy hops are trusted', () => {
    // A client can send any value here; with 0 hops it must have no effect.
    expect(getClientIp(headers('198.51.100.1'), SOCKET, 0)).toBe(SOCKET)
    expect(getClientIp(headers('1.1.1.1, 2.2.2.2'), SOCKET, 0)).toBe(SOCKET)
  })

  it('returns the socket address when there is no forwarded chain', () => {
    expect(getClientIp(headers(), SOCKET, 1)).toBe(SOCKET)
  })

  it('falls back to "unknown" when there is no socket address either', () => {
    expect(getClientIp(headers(), undefined, 0)).toBe('unknown')
  })

  it('takes the rightmost entry with one trusted hop', () => {
    // The client prepends a spoofed address; the proxy appends the real one.
    expect(getClientIp(headers('6.6.6.6, 198.51.100.4'), SOCKET, 1)).toBe(
      '198.51.100.4'
    )
  })

  it('ignores every client-supplied entry left of the trusted hop', () => {
    expect(
      getClientIp(headers('1.1.1.1, 2.2.2.2, 3.3.3.3, 198.51.100.4'), SOCKET, 1)
    ).toBe('198.51.100.4')
  })

  it('counts N entries from the right with N trusted hops', () => {
    // spoofed, real client, edge proxy
    expect(
      getClientIp(headers('6.6.6.6, 198.51.100.4, 10.0.0.2'), SOCKET, 2)
    ).toBe('198.51.100.4')
  })

  it('falls back to the socket when the chain is shorter than the hops', () => {
    expect(getClientIp(headers('198.51.100.4'), SOCKET, 2)).toBe(SOCKET)
  })

  it('falls back to the socket when the trusted entry is not an IP', () => {
    expect(getClientIp(headers('198.51.100.4, not-an-ip'), SOCKET, 1)).toBe(
      SOCKET
    )
    expect(getClientIp(headers('198.51.100.4:8080'), SOCKET, 1)).toBe(SOCKET)
  })

  it('accepts IPv6 entries at the trusted position', () => {
    expect(getClientIp(headers('6.6.6.6, 2001:db8::1'), SOCKET, 1)).toBe(
      '2001:db8::1'
    )
  })

  it('ignores an empty trailing entry', () => {
    expect(getClientIp(headers('6.6.6.6, 198.51.100.4, '), SOCKET, 1)).toBe(
      SOCKET
    )
  })
})
