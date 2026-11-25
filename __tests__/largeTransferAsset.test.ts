import { parseAlertRule } from '@/types'
import { formatRuleSummary } from '@/lib/format'
import { describeRule } from '@/lib/api'

describe('token-denominated LargeTransfer (#443)', () => {
  it('parses optional asset and decimals', () => {
    expect(
      parseAlertRule({
        type: 'LargeTransfer',
        threshold_xlm: 10000,
        asset: 'USDC',
        decimals: 7,
      })
    ).toEqual({
      type: 'LargeTransfer',
      threshold_xlm: 10000,
      asset: 'USDC',
      decimals: 7,
    })
  })
  it('stays backward compatible without asset', () => {
    expect(parseAlertRule({ type: 'LargeTransfer', threshold_xlm: 5 })).toEqual(
      {
        type: 'LargeTransfer',
        threshold_xlm: 5,
      }
    )
  })
  it('rejects invalid asset or decimals', () => {
    expect(
      parseAlertRule({ type: 'LargeTransfer', threshold_xlm: 5, asset: '' })
    ).toBeNull()
    expect(
      parseAlertRule({ type: 'LargeTransfer', threshold_xlm: 5, decimals: 40 })
    ).toBeNull()
  })
  it('shows the asset label in summaries', () => {
    const rule = {
      type: 'LargeTransfer' as const,
      threshold_xlm: 10000,
      asset: 'USDC',
    }
    expect(formatRuleSummary(rule)).toBe('> 10,000 USDC')
    expect(describeRule(rule)).toContain('USDC')
    expect(formatRuleSummary({ type: 'LargeTransfer', threshold_xlm: 1 })).toBe(
      '> 1 XLM'
    )
  })
})
