'use client'

import { useEffect, useState } from 'react'
import ContractImportExport from '@/components/ContractImportExport'
import RetentionSetting from '@/components/RetentionSetting'
import ApiKeySetting from '@/components/ApiKeySetting'
import NotificationToggle from '@/components/NotificationToggle'
import { exportAllStorageData, clearTxWatchStorage } from '@/lib/storageKeys'
import {
  getWebhookSecretPreviousExpiry,
  finishWebhookSecretRotation,
} from '@/lib/webhookSecrets'

export default function SettingsPage() {
  const [previousSecretExpiry, setPreviousSecretExpiry] = useState<number | null>(null)

  useEffect(() => {
    setPreviousSecretExpiry(getWebhookSecretPreviousExpiry())
  }, [])

  const handleFinishRotation = () => {
    finishWebhookSecretRotation()
    setPreviousSecretExpiry(null)
  }

  const handleExport = () => {
    exportAllStorageData()
  }

  const handleReset = () => {
    const confirmed = window.confirm(
      'This will remove all TxWatch data (contracts, alerts, preferences) from this browser. ' +
        'Other apps on this origin will not be affected. Continue?'
    )
    if (!confirmed) return
    clearTxWatchStorage()
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      <ContractImportExport />
      <RetentionSetting />
      <ApiKeySetting />
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Webhook Secret Rotation</h2>
        {previousSecretExpiry !== null ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              The previous webhook secret is still accepted until{' '}
              <span className="font-medium">
                {new Date(previousSecretExpiry).toLocaleString()}
              </span>
              . Deliveries are signed with both secrets during this grace window.
            </p>
            <button
              type="button"
              onClick={handleFinishRotation}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Finish rotation
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-700">
            No rotation in progress. Rotating the webhook secret keeps the previous secret
            valid for a 24-hour grace period so receivers can be redeployed.
          </p>
        )}
        <h2 className="text-lg font-semibold">Notifications</h2>
        <NotificationToggle />
      </section>
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Data Management</h2>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleExport}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Download backup
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Reset app data
          </button>
        </div>
      </section>
    </div>
  )
}
