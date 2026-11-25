'use client'

import { useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'

export const THEME_STORAGE_KEY = 'txwatch_theme'

function readStoredTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'light'
      ? 'light'
      : 'dark'
  } catch {
    return 'dark'
  }
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.classList.toggle('light', theme === 'light')
}

// #536: the app stays dark by default; this flips the root class between
// `dark` and `light`. The light palette lives in app/globals.css.
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    const stored = readStoredTheme()
    setTheme(stored)
    applyTheme(stored)
  }, [])

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    applyTheme(next)
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // best effort: the choice just will not persist
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:text-zinc-100 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-400"
    >
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}
