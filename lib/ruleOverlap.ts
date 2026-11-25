import type { AlertRule } from '@/types'

function functionNames(rule: AlertRule): string[] {
  switch (rule.type) {
    case 'FunctionCalled':
      return [rule.function_name.trim()]
    case 'AdminFunctionCalled':
      return rule.function_names.map((n) => n.trim())
    default:
      return []
  }
}

/**
 * Finds an existing enabled rule that would fire for the same transactions as
 * `newRule` (#446): `AnyTransaction` overlaps with every rule, and
 * `FunctionCalled` / `AdminFunctionCalled` overlap when they share a function
 * name. Exact duplicates are handled separately by the caller.
 * `ignoreIndex` skips the rule currently being edited.
 */
export function findOverlappingRule(
  newRule: AlertRule,
  existing: AlertRule[],
  ignoreIndex: number | null = null
): AlertRule | undefined {
  const newNames = functionNames(newRule)
  return existing.find((rule, index) => {
    if (index === ignoreIndex || rule.enabled === false) return false
    if (rule.type === 'AnyTransaction' || newRule.type === 'AnyTransaction')
      return true
    const names = functionNames(rule)
    return newNames.some((n) => names.includes(n))
  })
}
