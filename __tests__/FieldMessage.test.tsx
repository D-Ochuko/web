import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import FieldMessage from '@/components/FieldMessage'

describe('FieldMessage', () => {
  it('announces errors with role="alert" and a non-colour icon', () => {
    render(<FieldMessage kind="error">Label is required</FieldMessage>)
    const message = screen.getByRole('alert')
    expect(message).toHaveTextContent('Label is required')
    expect(message).toHaveClass('text-red-400')
    expect(message.querySelector('[aria-hidden="true"]')).toHaveTextContent('✕')
  })

  it('announces warnings with role="status" and a non-colour icon', () => {
    render(<FieldMessage kind="warning">Network mismatch</FieldMessage>)
    const message = screen.getByRole('status')
    expect(message).toHaveClass('text-amber-400')
    expect(message.querySelector('[aria-hidden="true"]')).toHaveTextContent('⚠')
  })

  it('passes id and extra classes through', () => {
    render(
      <FieldMessage kind="error" id="err" className="mt-1">
        Bad
      </FieldMessage>
    )
    const message = screen.getByRole('alert')
    expect(message).toHaveAttribute('id', 'err')
    expect(message).toHaveClass('mt-1')
  })
})
