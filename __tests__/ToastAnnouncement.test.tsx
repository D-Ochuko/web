import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Toast from '@/components/Toast'

describe('Toast screen reader announcements', () => {
  it('announces success toasts politely', () => {
    render(<Toast message="Saved" type="success" />)
    const toast = screen.getByRole('status')
    expect(toast).toHaveAttribute('aria-live', 'polite')
    expect(toast).toHaveAttribute('aria-atomic', 'true')
  })

  it('announces error toasts assertively', () => {
    render(<Toast message="Could not save" type="error" />)
    const toast = screen.getByRole('status')
    expect(toast).toHaveAttribute('aria-live', 'assertive')
    expect(toast).toHaveAttribute('aria-atomic', 'true')
  })
})
