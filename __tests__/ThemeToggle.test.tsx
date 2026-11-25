import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import ThemeToggle, { THEME_STORAGE_KEY } from '@/components/ThemeToggle'

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.className = 'dark'
  })

  it('starts in the dark theme', () => {
    render(<ThemeToggle />)
    expect(document.documentElement).toHaveClass('dark')
    expect(
      screen.getByRole('button', { name: 'Switch to light theme' })
    ).toBeInTheDocument()
  })

  it('switches to light, updates the root class and persists the choice', () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }))
    expect(document.documentElement).toHaveClass('light')
    expect(document.documentElement).not.toHaveClass('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(
      screen.getByRole('button', { name: 'Switch to dark theme' })
    ).toBeInTheDocument()
  })

  it('restores a stored light theme on mount', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    render(<ThemeToggle />)
    expect(document.documentElement).toHaveClass('light')
  })
})
