import { describe, expect, it } from 'vitest'
import robots from '../app/robots'

describe('robots.txt', () => {
  it('allows the landing page and blocks per-user app routes', () => {
    const { rules } = robots()
    const rule = Array.isArray(rules) ? rules[0] : rules
    expect(rule.userAgent).toBe('*')
    expect(rule.allow).toBe('/')
    expect(rule.disallow).toEqual(
      expect.arrayContaining(['/api/', '/dashboard', '/contracts', '/settings'])
    )
  })
})
