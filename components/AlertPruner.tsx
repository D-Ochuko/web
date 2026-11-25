'use client'

import { useEffect } from 'react'
import { pruneOldAlerts } from '@/lib/storage'
import { useToast } from '@/components/ToastProvider'

/** Prunes expired alerts once on app start, independent of contract edits. */
export default function AlertPruner() {
  const { showToast } = useToast()

  useEffect(() => {
    const result = pruneOldAlerts()
    if (result && typeof result === 'object' && 'count' in result && result.count > 0) {
      showToast({
        type: 'warning',
        message: `Removed ${result.count} old alert${result.count === 1 ? '' : 's'} to free up storage space.`,
      })
    }
  }, [showToast])

  useEffect(() => {
    const handlePruned = (event: Event) => {
      const detail = (event as CustomEvent<{ count?: number }>).detail
      const count = detail?.count ?? 0
      if (count > 0) {
        showToast({
          type: 'warning',
          message: `Removed ${count} old alert${count === 1 ? '' : 's'} to free up storage space.`,
        })
      }
    }

    window.addEventListener('txwatch:alerts-pruned', handlePruned)
    return () => {
      window.removeEventListener('txwatch:alerts-pruned', handlePruned)
    }
  }, [showToast])

  return null
}