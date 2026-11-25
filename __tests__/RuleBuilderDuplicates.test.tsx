import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RuleBuilder from '../components/RuleBuilder'
import type { AlertRule } from '@/types'

function chooseType(type: string) {
  fireEvent.change(screen.getByLabelText(/rule type/i), {
    target: { value: type },
  })
}

function addRule() {
  fireEvent.click(screen.getByRole('button', { name: /add rule/i }))
}

describe('RuleBuilder duplicate detection per rule type (#530)', () => {
  it('rejects a LargeTransfer rule with the same threshold', () => {
    const onChange = vi.fn()
    const rules: AlertRule[] = [{ type: 'LargeTransfer', threshold_xlm: 100 }]
    render(<RuleBuilder rules={rules} onChange={onChange} />)
    chooseType('LargeTransfer')
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '100' } })
    addRule()
    expect(screen.getByText(/this rule already exists/i)).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('accepts a LargeTransfer rule with a different threshold', () => {
    const onChange = vi.fn()
    const rules: AlertRule[] = [{ type: 'LargeTransfer', threshold_xlm: 100 }]
    render(<RuleBuilder rules={rules} onChange={onChange} />)
    chooseType('LargeTransfer')
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '250' } })
    addRule()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toHaveLength(2)
  })

  it('rejects a FunctionCalled rule with the same function name', () => {
    const onChange = vi.fn()
    const rules: AlertRule[] = [{ type: 'FunctionCalled', function_name: 'mint' }]
    render(<RuleBuilder rules={rules} onChange={onChange} />)
    chooseType('FunctionCalled')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'mint' } })
    addRule()
    expect(screen.getByText(/this rule already exists/i)).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('treats admin function lists as duplicates regardless of order', () => {
    const onChange = vi.fn()
    const rules: AlertRule[] = [
      { type: 'AdminFunctionCalled', function_names: ['set_admin', 'upgrade'] },
    ]
    render(<RuleBuilder rules={rules} onChange={onChange} />)
    chooseType('AdminFunctionCalled')
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'upgrade, set_admin' },
    })
    addRule()
    expect(screen.getByText(/this rule already exists/i)).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not mix up different rule types that share a name', () => {
    const onChange = vi.fn()
    const rules: AlertRule[] = [{ type: 'FunctionCalled', function_name: 'upgrade' }]
    render(<RuleBuilder rules={rules} onChange={onChange} />)
    chooseType('AdminFunctionCalled')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'upgrade' } })
    addRule()
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe('RuleBuilder in-place mutation safety (#530)', () => {
  it('does not mutate the caller rules array or sibling rules when adding', () => {
    const rules: AlertRule[] = [
      { type: 'AdminFunctionCalled', function_names: ['upgrade', 'set_admin'] },
      { type: 'FunctionCalled', function_name: 'mint' },
    ]
    const snapshot = JSON.parse(JSON.stringify(rules))
    const onChange = vi.fn()
    render(<RuleBuilder rules={rules} onChange={onChange} />)
    chooseType('AdminFunctionCalled')
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'pause, unpause' },
    })
    addRule()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(rules).toEqual(snapshot)
    // The new function_names are sorted on a copy, not on the typed array.
    expect(onChange.mock.calls[0][0][2]).toEqual({
      type: 'AdminFunctionCalled',
      function_names: ['pause', 'unpause'],
    })
  })

  it('editing one rule leaves its siblings untouched', () => {
    const rules: AlertRule[] = [
      { type: 'FunctionCalled', function_name: 'mint' },
      { type: 'FunctionCalled', function_name: 'burn' },
    ]
    const snapshot = JSON.parse(JSON.stringify(rules))
    const onChange = vi.fn()
    render(<RuleBuilder rules={rules} onChange={onChange} />)
    fireEvent.click(screen.getAllByRole('button', { name: /edit/i })[0])
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'transfer' } })
    fireEvent.click(screen.getByRole('button', { name: /(save|update)/i }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const updated = onChange.mock.calls[0][0] as AlertRule[]
    expect(updated[0]).toEqual({ type: 'FunctionCalled', function_name: 'transfer' })
    expect(updated[1]).toEqual(rules[1])
    expect(rules).toEqual(snapshot)
  })
})
