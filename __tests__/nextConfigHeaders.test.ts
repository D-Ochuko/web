import { afterEach, describe, expect, it, vi } from 'vitest'
import nextConfig from '../next.config.mjs'

// #534: baseline security headers are declared once in next.config.mjs. These
// tests keep them from being dropped by accident.
async function headerMap(): Promise<Map<string, string>> {
  const rules = await nextConfig.headers()
  const all = rules.flatMap((rule: { headers: { key: string; value: string }[] }) => rule.headers)
  return new Map(all.map((h: { key: string; value: string }) => [h.key, h.value]))
}

describe('next.config security headers', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('applies headers to every route', async () => {
    const rules = await nextConfig.headers()
    expect(rules.some((rule: { source: string }) => rule.source === '/(.*)')).toBe(true)
  })

  it('sets the baseline hardening headers', async () => {
    const headers = await headerMap()
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(headers.get('X-Frame-Options')).toBe('DENY')
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(headers.get('Permissions-Policy')).toContain('camera=()')
    expect(headers.get('Permissions-Policy')).toContain('microphone=()')
  })

  it('sets a Content-Security-Policy that restricts the default source', async () => {
    const csp = (await headerMap()).get('Content-Security-Policy')
    expect(csp).toBeDefined()
    expect(csp).toMatch(/default-src 'self'/)
    expect(csp).toMatch(/frame-src 'self' https:\/\/connect\.freighter\.app/)
  })
})
