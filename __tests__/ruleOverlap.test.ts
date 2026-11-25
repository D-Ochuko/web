import { findOverlappingRule } from '@/lib/ruleOverlap'
import type { AlertRule } from '@/types'

const admin: AlertRule = {
  type: 'AdminFunctionCalled',
  function_names: ['set_admin', 'upgrade'],
}

describe('findOverlappingRule', () => {
  it('flags FunctionCalled sharing a name with AdminFunctionCalled', () => {
    expect(
      findOverlappingRule(
        { type: 'FunctionCalled', function_name: 'upgrade' },
        [admin]
      )
    ).toBe(admin)
  })
  it('does not flag unrelated function names', () => {
    expect(
      findOverlappingRule({ type: 'FunctionCalled', function_name: 'mint' }, [
        admin,
      ])
    ).toBeUndefined()
  })
  it('AnyTransaction overlaps with any rule, in both directions', () => {
    const any: AlertRule = { type: 'AnyTransaction' }
    expect(findOverlappingRule({ type: 'TransactionFailed' }, [any])).toBe(any)
    expect(findOverlappingRule(any, [admin])).toBe(admin)
  })
  it('ignores disabled rules and the edited index', () => {
    expect(
      findOverlappingRule({ type: 'AnyTransaction' }, [
        { ...admin, enabled: false },
      ])
    ).toBeUndefined()
    expect(
      findOverlappingRule({ type: 'AnyTransaction' }, [admin], 0)
    ).toBeUndefined()
  })
})
