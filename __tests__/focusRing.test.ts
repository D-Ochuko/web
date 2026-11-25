import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8')

describe('global keyboard focus ring (#537)', () => {
  it('declares a visible outline for focus-visible on interactive elements', () => {
    let outline: string | undefined
    let selector = ''
    postcss.parse(css).walkRules((rule) => {
      if (!rule.selector.includes(':focus-visible')) return
      rule.walkDecls('outline', (decl) => {
        outline = decl.value
        selector = rule.selector
      })
    })
    expect(outline).toMatch(/^2px solid /)
    for (const element of ['a', 'button', 'input', 'select', 'textarea']) {
      expect(selector).toContain(element)
    }
  })
})
