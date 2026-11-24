'use client'

import { useEffect, useState } from 'react'
import ContractImportExport from '@/components/ContractImportExport'
import RetentionSetting from '@/components/RetentionSetting'
import ApiKeySetting from '@/components/ApiKeySetting'
import { exportAllStorageData, clearTxWatchStorage } from '@/lib/storageKeys'
import { getApiKey, setApiKey, clearApiKey, isRemembered, setRemembered, testConnection } from '@/lib/api'

export default function SettingsPage() {
  const [apiKey, setApiKeyState] = useState('')
  const [remember, setRemember] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    setApiKeyState(getApiKey() ?? '')
    setRemember(isRemembered())
  }, [])

  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(false), 3000)
    return () => clearTimeout(timer)
  }, [saved])

  const handleApiKeyChange = (value: string) => {
    setApiKeyState(value)
    setSaved(false)
    setTestResult(null)
  }

  const handleRememberChange = (value: boolean) => {
    setRemember(value)
    setRemembered(value)
    setSaved(false)
  }

  const handleSaveKey = () => {
    setApiKey(apiKey.trim())
    setSaved(true)
    setTestResult(null)
  }

  const handleClearKey = () => {
    clearApiKey()
    setApiKeyState('')
    setSaved(false)
    setTestResult(null)
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testConnection(apiKey.trim())
      setTestResult(result)
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : 'Connection failed' })
    } finally {
      setTesting(false)
    }
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
        <h2 className="text-lg font-semibold">API Key</h2>
        <div className="space-y-3">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => handleApiKeyChange(e.target.value)}
            placeholder="Enter your API key"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => handleRememberChange(e.target.checked)}
              className="mt-1"
            />
            <span>
              Remember on this device
              <span className="block text-xs text-amber-700">
                Warning: the key will be stored in localStorage and persists across tabs and browser restarts. Only enable this on a trusted device.
              </span>
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSaveKey}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Save key
            </button>
            <button
              type="button"
              onClick={handleClearKey}
              className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Clear key
            </button>
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testing || !apiKey.trim()}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            {saved && <span className="text-sm text-green-700">Saved.</span>}
          </div>
          {testResult && (
            <p className={`text-sm ${testResult.ok ? 'text-green-700' : 'text-red-700'}`}>
              {testResult.message}
            </p>
          )}
        </div>
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
