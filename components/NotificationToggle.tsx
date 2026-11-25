'use client'

import { useEffect, useState } from 'react'
import {
  disableNotifications,
  enableNotifications,
  notificationsEnabled,
  notificationsSupported,
} from '@/lib/notifications'

export default function NotificationToggle() {
  const [supported, setSupported] = useState(false)
  const [on, setOn] = useState(false)
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    let mounted = true
    let permissionStatus: PermissionStatus | undefined

    function syncPermission() {
      const available = notificationsSupported()
      setSupported(available)
      setOn(notificationsEnabled())
      setDenied(available && Notification.permission === 'denied')
    }

    syncPermission()
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'notifications' as PermissionName })
        .then((status) => {
          if (!mounted) return
          permissionStatus = status
          permissionStatus.addEventListener('change', syncPermission)
          syncPermission()
        })
        .catch(() => {})
    }

    return () => {
      mounted = false
      permissionStatus?.removeEventListener('change', syncPermission)
    }
  }, [])

  if (!supported) return null

  async function toggle() {
    if (denied) return
    if (on) {
      disableNotifications()
      setOn(false)
      return
    }
    const ok = await enableNotifications()
    setOn(ok)
    setDenied(!ok)
  }

  return (
    <div className="flex flex-col gap-1 text-sm text-zinc-300">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={on}
          onChange={toggle}
          disabled={denied}
        />
        Browser notifications for new alerts
      </label>
      {denied && (
        <p className="text-xs text-red-400">
          Notifications are blocked. To re-enable them, open your browser
          settings for this site and allow notifications, then reload the page.
        </p>
      )}
    </div>
  )
}
