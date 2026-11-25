'use client'

import { useState, useRef, useEffect, useMemo, useId } from 'react'
import { useRouter } from 'next/navigation'
import { AlertPayload, AlertRule, Network, WatchedContract, WebhookFormat, parseAlertRule } from '@/types'
import { suggestWebhookFormat } from '@/lib/webhookFormat'
import WebhookFormatField from '@/components/WebhookFormatField'
import {
  AlertPayload,
  AlertRule,
  Network,
  WatchedContract,
  parseAlertRule,
} from '@/types'
import {
  isValidContractId,
  normalizeContractId,
  nonContractAddressHint,
  validateWebhookUrl,
  webhookUrlMessage,
} from '@/lib/stellar'
import { syncSaveContract } from '@/lib/contractSync'
import { getContracts } from '@/lib/storage'
import {
  buildTestWebhookPayload,
  describeRule,
  TEST_CONTRACT_ID,
} from '@/lib/api'
import {
  sendTestWebhook,
  type TestWebhookResult,
} from '@/lib/api'
import WebhookTestButton from '@/components/WebhookTestButton'
import WebhookHeadersField from '@/components/WebhookHeadersField'
import WebhookTestButton from '@/components/WebhookTestButton'
import { generateWebhookSecret } from '@/lib/webhookSignature'
import { generateId } from '@/lib/id'
import { MAX_LABEL_LENGTH } from '@/lib/importSchema'
import CopyButton from '@/components/CopyButton'
import ContractVerification, {
  type CheckState,
} from '@/components/ContractVerification'
import { useFreighterConnection } from '@/lib/useFreighterConnection'
import { useNetworkMismatchWarning } from '@/lib/useNetworkMismatchWarning'
import RuleBuilder from '@/components/RuleBuilder'
import FieldMessage from '@/components/FieldMessage'
import FreighterConnect from '@/components/FreighterConnect'
import { useToast } from '@/components/ToastProvider'

interface FormErrors {
  label?: string
  contract_id?: string
  webhook_url?: string
  rules?: string
  wallet?: string
  network?: string
}

export default function NewContractPage() {
  const router = useRouter()
  const { showToast } = useToast()
  const { isConnected } = useFreighterConnection()

  const [mismatchAcknowledged, setMismatchAcknowledged] = useState(false)

  const [label, setLabel] = useState('')
  const [labelWarning, setLabelWarning] = useState<string | null>(null)
  const [contractId, setContractId] = useState('')
  const [network, setNetwork] = useState<Network>('testnet')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [webhookHeaders, setWebhookHeaders] = useState<Record<string, string>>({})
  const [webhookFormat, setWebhookFormat] = useState<WebhookFormat>('json')
  // Until the user picks a format, the URL's suggestion is applied automatically.
  const [formatTouched, setFormatTouched] = useState(false)
  const [webhookUrlWarning, setWebhookUrlWarning] = useState<string | null>(null)
  const [webhookUrlWarning, setWebhookUrlWarning] = useState<string | null>(
    null
  )
  const [rules, setRules] = useState<AlertRule[]>([])

  const [errors, setErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)
  const [verificationStatus, setVerificationStatus] =
    useState<CheckState>('idle')
  const [verificationReason, setVerificationReason] = useState<string | null>(
    null
  )
  const [verificationLiveUntil, setVerificationLiveUntil] = useState<
    number | null
  >(null)
  const [verificationOverridden, setVerificationOverridden] = useState(false)
  const [prefillNotice, setPrefillNotice] = useState<string | null>(null)
  const [showDiscardModal, setShowDiscardModal] = useState(false)

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Test payload state
  const [testRuleIndex, setTestRuleIndex] = useState(0)
  const [testFunctionName, setTestFunctionName] = useState('')
  const [showPayloadPreview, setShowPayloadPreview] = useState(false)

  // Draft Restoration State
  const [draftExists, setDraftExists] = useState(false)
  const DRAFT_KEY = 'txwatch_new_contract_draft'
  const DRAFT_NETWORKS: string[] = ['mainnet', 'testnet', 'futurenet']

  // Warns on mount, on network change, and after connecting, not only when the
  // network <select> changes.
  const { networkWarning, networkUnavailable, checkNetworkMismatch, clearNetworkWarning } =
    useNetworkMismatchWarning(network, isConnected)

  const hasNetworkMismatch = Boolean(networkWarning)

  const labelId = useId()
  const labelErrorId = useId()
  const contractIdFieldId = useId()
  const contractIdErrorId = useId()
  const contractIdHintId = useId()
  const networkId = useId()
  const networkErrorId = useId()
  const webhookUrlId = useId()
  const webhookUrlErrorId = useId()
  const webhookUrlHintId = useId()
  const webhookSecretId = useId()
  const webhookSecretHintId = useId()
  const rulesId = useId()
  const rulesErrorId = useId()
  const walletErrorId = useId()

  // A valid account/muxed address pasted by mistake gets a specific hint.
  const addressHint = useMemo(
    () => nonContractAddressHint(contractId),
    [contractId]
  )

  const isDirty = Boolean(
    label.trim() ||
    contractId.trim() ||
    webhookUrl.trim() ||
    webhookSecret.trim() ||
    rules.length > 0
  )

  useEffect(() => {
    if (sessionStorage.getItem(DRAFT_KEY) && !isDirty) {
      setDraftExists(true)
    }
  }, [isDirty])

  useEffect(() => {
    if (isDirty && !saving) {
      const timer = setTimeout(() => {
        sessionStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            label,
            contract_id: contractId,
            network,
            webhook_url: webhookUrl,
            rules,
          })
        )
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [label, contractId, network, webhookUrl, rules, isDirty, saving])

  function restoreDraft() {
    try {
      const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY)!)
      if (typeof draft !== 'object' || draft === null)
        throw new Error('invalid draft')
      const draftNetwork = draft.network ?? 'testnet'
      if (!DRAFT_NETWORKS.includes(draftNetwork))
        throw new Error('invalid network')
      const rawRules: unknown = draft.rules ?? []
      if (!Array.isArray(rawRules)) throw new Error('invalid rules')
      const parsedRules = rawRules.map(parseAlertRule)
      if (parsedRules.some((r) => r === null)) throw new Error('invalid rule')
      setLabel(typeof draft.label === 'string' ? draft.label : '')
      setContractId(
        typeof draft.contract_id === 'string' ? draft.contract_id : ''
      )
      setNetwork(draftNetwork)
      setWebhookUrl(
        typeof draft.webhook_url === 'string' ? draft.webhook_url : ''
      )
      setRules(parsedRules as AlertRule[])
    } catch {
      sessionStorage.removeItem(DRAFT_KEY)
      setPrefillNotice(
        'The saved draft was out of date or invalid and has been discarded.'
      )
    }
    setDraftExists(false)
  }

  function discardDraft() {
    sessionStorage.removeItem(DRAFT_KEY)
    setDraftExists(false)
    setLabel('')
    setContractId('')
    setWebhookUrl('')
    setRules([])
    setErrors({})
  }

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty && !saving) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty, saving])

  function navigateBack() {
    if (
      typeof window !== 'undefined' &&
      window.history.length > 1 &&
      document.referrer &&
      document.referrer.includes(window.location.host)
    ) {
      router.back()
    } else {
      router.push('/contracts')
    }
  }

  function handleCancel() {
    if (isDirty) {
      setShowDiscardModal(true)
    } else {
      navigateBack()
    }
  }

  const testRule: AlertRule | undefined =
    rules[testRuleIndex] ?? (rules.length > 0 ? rules[0] : undefined)

  // Until a valid contract ID is entered, tests use a placeholder contract.
  const testContractId = isValidContractId(contractId.trim())
    ? contractId.trim()
    : TEST_CONTRACT_ID

  const testPayload = useMemo<AlertPayload>(
    () =>
      buildTestWebhookPayload({
        contractId: testContractId,
        network,
        rule: testRule,
        functionName: testFunctionName,
      }),
    [testContractId, network, testRule, testFunctionName]
  )

  const labelInputRef = useRef<HTMLInputElement>(null)
  const contractIdInputRef = useRef<HTMLInputElement>(null)
  const webhookUrlInputRef = useRef<HTMLInputElement>(null)
  const rulesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let raw: string | null = null
    try {
      raw = sessionStorage.getItem('txwatch_duplicate_contract')
      if (raw) sessionStorage.removeItem('txwatch_duplicate_contract')
    } catch {
      return
    }
    if (!raw) return
    try {
      const data = JSON.parse(raw) as {
        label?: string
        webhook_url?: string
        rules?: AlertRule[]
      }
      if (typeof data.label === 'string') setLabel(data.label)
      if (typeof data.webhook_url === 'string') setWebhookUrl(data.webhook_url)
      if (Array.isArray(data.rules)) {
        const validRules: AlertRule[] = []
        let dropped = 0
        for (const raw of data.rules) {
          const parsed = parseAlertRule(raw)
          if (parsed) {
            validRules.push(parsed)
          } else {
            dropped += 1
          }
        }
        setRules(validRules)
        if (dropped > 0) {
          setPrefillNotice(
            `Skipped ${dropped} invalid rule${dropped === 1 ? '' : 's'} from the duplicated contract.`
          )
        }
      }
    } catch {
      // ignore malformed pre-fill data
    }
  }, [])

  useEffect(() => {
    if (!isConnected) {
      setMismatchAcknowledged(false)
    }
  }, [isConnected])

  function handleWalletConnect() {
    setErrors((prev) => ({ ...prev, wallet: undefined }))
    // The wallet's network is only knowable once it is connected.
    void checkNetworkMismatch()
  }

  function handleWalletDisconnect() {
    clearNetworkWarning()
  }

  function validate(): FormErrors {
    const e: FormErrors = {}
    const trimmedLabel = label.trim()
    const trimmedContractId = contractId.trim()
    const trimmedWebhookUrl = webhookUrl.trim()

    if (!trimmedLabel) {
      e.label = 'Label is required'
    } else if (trimmedLabel.length > MAX_LABEL_LENGTH) {
      e.label = `Label must be ${MAX_LABEL_LENGTH} characters or less`
    }

    if (!trimmedContractId) {
      e.contract_id = 'Contract ID is required'
    } else if (!isValidContractId(trimmedContractId)) {
      e.contract_id =
        nonContractAddressHint(trimmedContractId) ??
        'Must be a valid Soroban contract address (starts with C, 56 chars)'
    } else {
      const isDuplicate = getContracts().some(
        (c) => c.contract_id === trimmedContractId && c.network === network
      )
      if (isDuplicate) {
        e.contract_id = `This contract is already registered on ${network}`
      }
    }

    if (!trimmedWebhookUrl) {
      e.webhook_url = 'Webhook URL is required'
    } else {
      const result = validateWebhookUrl(trimmedWebhookUrl, network)
      if (!result.valid) {
        e.webhook_url = result.message ?? 'Enter a valid webhook URL'
      }
    }

    if (rules.length === 0) {
      e.rules = 'Add at least one alert rule'
    }

    if (hasNetworkMismatch && !mismatchAcknowledged) {
      e.network =
        'Please acknowledge that your wallet is on a different network before saving'
    }
    return e
  }

  // Derived from validate() so the Save button's enabled state and the
  // save-time validation can never disagree (#523): any rule added to
  // validate() is automatically enforced here too.
  function isFormValid(): boolean {
    return Object.keys(validate()).length === 0
  }

  function handleContractIdBlur() {
    const norm = normalizeContractId(contractId)
    let updatedId = contractId.trim()
    let targetNetwork = network
    if (norm.contractId && norm.contractId !== contractId) {
      updatedId = norm.contractId
      setContractId(updatedId)
    }
    if (norm.network && norm.network !== network) {
      targetNetwork = norm.network
      setNetwork(targetNetwork)
    }
  }

  function handleContractIdPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text')
    if (!pasted) return
    const norm = normalizeContractId(pasted)
    if (norm.contractId) {
      e.preventDefault()
      setContractId(norm.contractId)
      setErrors((prev) => ({ ...prev, contract_id: undefined }))
      let targetNetwork = network
      if (norm.network && norm.network !== network) {
        targetNetwork = norm.network
        setNetwork(targetNetwork)
      }
    }
  }

  async function handleSave(event?: React.FormEvent) {
    event?.preventDefault()
    const e = validate()
    if (Object.keys(e).length > 0) {
      setErrors(e)
      if (e.label) {
        labelInputRef.current?.focus()
      } else if (e.contract_id) {
        contractIdInputRef.current?.focus()
      } else if (e.webhook_url) {
        webhookUrlInputRef.current?.focus()
      } else if (e.rules) {
        rulesRef.current?.scrollIntoView({ behavior: 'smooth' })
      }
      return
    }

    if (!isConnected) {
      setErrors({ wallet: 'Connect your Freighter wallet to save contracts' })
      return
    }

    // Block saving only on an authoritative not_found result without an
    // override. 'unavailable' (RPC error/timeout) never blocks.
    if (verificationStatus === 'not_found' && !verificationOverridden) {
      return
    }

    setSaving(true)
    const contract: WatchedContract = {
      id: generateId(),
      label: label.trim(),
      contract_id: contractId.trim(),
      network,
      rules,
      webhook_url: webhookUrl.trim(),
      webhook_secret: webhookSecret.trim() || undefined,
      webhook_headers:
        Object.keys(webhookHeaders).length > 0 ? webhookHeaders : undefined,
      webhook_format: webhookFormat === 'json' ? undefined : webhookFormat,
      created_at: Date.now(),
      updated_at: Date.now(),
      enabled: true,
    }
    const result = await syncSaveContract(contract, true)
    if (!result.localSaved) {
      setSaving(false)
      showToast(
        'Could not save contract: browser storage is full or conflict occurred.',
        'error'
      )
      return
    }

    sessionStorage.removeItem(DRAFT_KEY)

    // Consumed by ContractsClient to highlight the newly created contract in
    // the list. Keep this key in sync with that reader.
    try {
      sessionStorage.setItem('txwatch_last_created_contract', contract.id)
    } catch {
      // ignore
    }

    showToast(`Contract "${contract.label}" saved successfully!`, 'success')
    // Clear any pending navigation from a previous save before scheduling a
    // new one, so stale timeouts can't fire.
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null
      router.push(`/contracts/${contract.id}`)
    }, 1500)

    if (!result.ok) showToast(result.error || 'API Sync Error', 'error')
  }

  return (
    <>
      {showDiscardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
            <h3 className="text-base font-semibold text-zinc-100">
              Discard unsaved changes?
            </h3>
            <p className="text-sm text-zinc-400">
              Your contract configuration will be lost.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowDiscardModal(false)}
                className="px-3 py-1.5 rounded-lg border border-zinc-700 text-sm text-zinc-300 hover:text-zinc-100 transition-colors"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDiscardModal(false)
                  navigateBack()
                }}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-sm font-medium text-white transition-colors"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto space-y-8">
        {draftExists && (
          <div className="p-4 mb-4 bg-indigo-500/10 border border-indigo-500/30 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <span className="text-sm text-indigo-200">
              You have an unsaved draft from a previous session.
            </span>
            <div className="flex gap-2">
              <button
                onClick={restoreDraft}
                className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 rounded text-white transition-colors"
              >
                Restore draft
              </button>
              <button
                onClick={discardDraft}
                className="px-3 py-1.5 text-sm border border-zinc-700 hover:bg-zinc-800 rounded text-zinc-300 transition-colors"
              >
                Start fresh
              </button>
            </div>
          </div>
        )}

        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Add Contract</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Register a Soroban contract to monitor
          </p>
        </div>

        <form onSubmit={handleSave} noValidate className="space-y-5">
          {prefillNotice && (
            <div
              className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300"
              data-testid="prefill-notice"
            >
              {prefillNotice}
            </div>
          )}
          {/* Label */}
          <div>
            <label
              htmlFor={labelId}
              className="block text-sm font-medium text-zinc-300 mb-1.5"
            >
              Label
            </label>
            <input
              ref={labelInputRef}
              id={labelId}
              type="text"
              placeholder="e.g. My DEX Contract"
              value={label}
              onChange={(e) => {
                const val = e.target.value
                setLabel(val)
                setErrors((prev) => ({ ...prev, label: undefined }))
                const trimmed = val.trim().toLowerCase()
                if (
                  trimmed &&
                  getContracts().some(
                    (c) => c.label.trim().toLowerCase() === trimmed
                  )
                ) {
                  setLabelWarning('A contract with this label already exists')
                } else {
                  setLabelWarning(null)
                }
              }}
              maxLength={MAX_LABEL_LENGTH}
              aria-invalid={Boolean(errors.label)}
              aria-describedby={errors.label ? labelErrorId : undefined}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <div className="flex justify-between items-start mt-1">
              <div>
                {errors.label && (
                  <FieldMessage kind="error" id={labelErrorId}>
                    {errors.label}
                  </FieldMessage>
                )}
                {labelWarning && !errors.label && (
                  <FieldMessage kind="warning">{labelWarning}</FieldMessage>
                )}
              </div>
              <p className="text-xs text-zinc-500">
                {label.length}/{MAX_LABEL_LENGTH}
              </p>
            </div>
          </div>

          {/* Contract ID */}
          <div>
            <label
              htmlFor={contractIdFieldId}
              className="block text-sm font-medium text-zinc-300 mb-1.5"
            >
              Contract ID
            </label>
            <input
              ref={contractIdInputRef}
              id={contractIdFieldId}
              type="text"
              autoComplete="off"
              placeholder="CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
              value={contractId}
              onChange={(e) => {
                setContractId(e.target.value)
                setErrors((prev) => ({ ...prev, contract_id: undefined }))
              }}
              onBlur={handleContractIdBlur}
              onPaste={handleContractIdPaste}
              aria-invalid={Boolean(errors.contract_id)}
              aria-describedby={
                errors.contract_id ? contractIdErrorId : contractIdHintId
              }
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors font-mono"
            />
            {addressHint && !errors.contract_id ? (
              <FieldMessage
                kind="warning"
                id={contractIdHintId}
                data-testid="contract-id-address-hint"
                className="mt-1"
              >
                {addressHint}
              </FieldMessage>
            ) : (
              <p id={contractIdHintId} className="text-xs text-zinc-500 mt-1">
                Starts with C, 56 characters.
              </p>
            )}
            {errors.contract_id && (
              <FieldMessage
                kind="error"
                id={contractIdErrorId}
                className="mt-1"
              >
                {errors.contract_id}
              </FieldMessage>
            )}
            <ContractVerification
              network={network}
              contractId={contractId}
              className="mt-1"
              status={verificationStatus}
              reason={verificationReason}
              liveUntilLedgerSeq={verificationLiveUntil}
              onStatusChange={(status, reason, liveUntil) => {
                setVerificationStatus(status)
                setVerificationReason(reason ?? null)
                setVerificationLiveUntil(liveUntil ?? null)
              }}
              overridden={verificationOverridden}
              onOverrideChange={setVerificationOverridden}
            />
            {verificationStatus === 'not_found' && !verificationOverridden && (
              <FieldMessage
                kind="warning"
                data-testid="verification-blocking"
                className="mt-1"
              >
                {verificationReason || `Contract not found on ${network}`}. Tick
                the override above to save anyway.
              </FieldMessage>
            )}
          </div>

          {/* Network */}
          <div>
            <label
              htmlFor={networkId}
              className="block text-sm font-medium text-zinc-300 mb-1.5"
            >
              Network
            </label>
            <select
              id={networkId}
              value={network}
              onChange={(e) => {
                const n = e.target.value as Network
                setNetwork(n)
                setErrors((prev) => ({ ...prev, network: undefined }))
                void checkNetworkMismatch(n)
              }}
              aria-invalid={Boolean(errors.network)}
              aria-describedby={errors.network ? networkErrorId : undefined}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
            >
              <option value="testnet">Testnet</option>
              <option value="mainnet">Mainnet</option>
              <option value="futurenet">Futurenet</option>
            </select>
            {networkWarning && <p className="text-xs text-amber-400 mt-1">{networkWarning}</p>}
            {networkUnavailable && (
              <p className="text-xs text-red-400 mt-1" data-testid="network-unavailable">
                Could not verify your wallet&apos;s network. Make sure Freighter is unlocked and
                connected, then try again.
              </p>
            {networkWarning && (
              <FieldMessage kind="warning" className="mt-1">
                {networkWarning}
              </FieldMessage>
            )}
            {hasNetworkMismatch && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="acknowledge-mismatch"
                  checked={mismatchAcknowledged}
                  onChange={(e) => {
                    setMismatchAcknowledged(e.target.checked)
                    if (e.target.checked) {
                      setErrors((prev) => ({ ...prev, network: undefined }))
                    }
                  }}
                  className="rounded border-zinc-700 bg-zinc-900 text-indigo-600 focus:ring-indigo-500"
                />
                <label
                  htmlFor="acknowledge-mismatch"
                  className="text-xs text-zinc-300"
                >
                  I understand this contract is on a different network than my
                  connected wallet
                </label>
              </div>
            )}
            {errors.network && (
              <FieldMessage kind="error" id={networkErrorId} className="mt-1">
                {errors.network}
              </FieldMessage>
            )}
          </div>

          {/* Webhook URL */}
          <div>
            <label
              htmlFor={webhookUrlId}
              className="block text-sm font-medium text-zinc-300 mb-1.5"
            >
              Webhook URL
            </label>
            <input
              ref={webhookUrlInputRef}
              id={webhookUrlId}
              type="text"
              inputMode="url"
              placeholder="https://example.com/webhook"
              value={webhookUrl}
              onChange={(e) => {
                const val = e.target.value
                setWebhookUrl(val)
                if (!formatTouched) setWebhookFormat(suggestWebhookFormat(val))
                setErrors((prev) => ({ ...prev, webhook_url: undefined }))
                const trimmed = val.trim()
                if (!trimmed) {
                  setWebhookUrlWarning(null)
                  return
                }
                const result = validateWebhookUrl(trimmed, network)
                setWebhookUrlWarning(
                  result.warning ? webhookUrlMessage(result.code) : null
                )
              }}
              aria-invalid={Boolean(errors.webhook_url)}
              aria-describedby={
                errors.webhook_url ? webhookUrlErrorId : webhookUrlHintId
              }
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <p id={webhookUrlHintId} className="text-xs text-zinc-500 mt-1">
              Must be an https:// URL; credentials and private addresses are
              rejected.
            </p>
            {errors.webhook_url && (
              <FieldMessage
                kind="error"
                id={webhookUrlErrorId}
                className="mt-1"
              >
                {errors.webhook_url}
              </FieldMessage>
            )}
            {webhookUrlWarning && !errors.webhook_url && (
              <div className="mt-1 flex items-start justify-between gap-2 text-xs text-amber-400">
                <p>{webhookUrlWarning}</p>
                <button
                  type="button"
                  onClick={() => setWebhookUrlWarning(null)}
                  className="text-amber-300 hover:text-amber-200 transition-colors"
                  aria-label="Dismiss warning"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>

          {/* Payload format (#409) */}
          <WebhookFormatField
            id="new-contract-format"
            format={webhookFormat}
            suggestedFormat={suggestWebhookFormat(webhookUrl)}
            onChange={(next) => {
              setFormatTouched(true)
              setWebhookFormat(next)
            }}
          />

          {/* Webhook Signing Secret */}
          <div>
            <label
              htmlFor={webhookSecretId}
              className="block text-sm font-medium text-zinc-300 mb-1.5"
            >
              Webhook Signing Secret
            </label>
            <div className="flex gap-2">
              <input
                id={webhookSecretId}
                type="password"
                autoComplete="off"
                placeholder="Optional — used to sign deliveries"
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                aria-describedby={webhookSecretHintId}
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors font-mono"
              />
              <button
                type="button"
                onClick={() => setWebhookSecret(generateWebhookSecret())}
                className="px-3 py-2 rounded-lg border border-zinc-700 text-xs text-zinc-300 hover:text-zinc-100 transition-colors"
              >
                Generate
              </button>
              <CopyButton text={webhookSecret} />
            </div>
            <p id={webhookSecretHintId} className="text-xs text-zinc-500 mt-1">
              Deliveries are signed with this secret; it is never included in
              CSV exports.
            </p>
          </div>

          {/* Custom Webhook Headers (#408) */}
          <WebhookHeadersField
            idPrefix="new-contract"
            headers={webhookHeaders}
            onChange={setWebhookHeaders}
          />

          {/* Rules */}
          <div ref={rulesRef}>
            <span
              id={rulesId}
              className="block text-sm font-medium text-zinc-300 mb-1.5"
            >
              Alert Rules
            </span>
            <RuleBuilder rules={rules} onChange={setRules} />
            {errors.rules && (
              <FieldMessage kind="error" id={rulesErrorId} className="mt-1">
                {errors.rules}
              </FieldMessage>
            )}
          </div>

          {/* Test Payload Rule Selection and Preview (#24) */}
          {webhookUrl && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-300">
                  Simulate Rule in Test Payload
                </span>
                <button
                  type="button"
                  onClick={() => setShowPayloadPreview(!showPayloadPreview)}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  {showPayloadPreview ? 'Hide Preview' : 'Preview JSON'}
                </button>
              </div>
              {rules.length > 0 ? (
                <select
                  value={testRuleIndex}
                  onChange={(e) => {
                    setTestRuleIndex(Number(e.target.value))
                    setTestFunctionName('')
                  }}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200"
                >
                  {rules.map((r, idx) => (
                    <option key={idx} value={idx}>
                      Rule #{idx + 1}: {describeRule(r)}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-zinc-500">
                  Defaulting to AnyTransaction test payload
                </p>
              )}
              {testRule?.type === 'AdminFunctionCalled' &&
                testRule.function_names.length > 1 && (
                  <select
                    aria-label="Admin function to simulate"
                    value={
                      testRule.function_names.includes(testFunctionName)
                        ? testFunctionName
                        : testRule.function_names[0]
                    }
                    onChange={(e) => setTestFunctionName(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-zinc-200"
                  >
                    {testRule.function_names.map((fn) => (
                      <option key={fn} value={fn}>
                        Function: {fn}
                      </option>
                    ))}
                  </select>
                )}
              {showPayloadPreview && (
                <pre className="mt-2 p-2 rounded bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-300 overflow-x-auto">
                  {JSON.stringify(testPayload, null, 2)}
                </pre>
              )}
            </div>
          )}

          {/* Wallet */}
          {!isConnected && (
            <div>
              <FreighterConnect
                onConnect={handleWalletConnect}
                onDisconnect={handleWalletDisconnect}
              />
              {errors.wallet && (
                <FieldMessage kind="error" id={walletErrorId} className="mt-1">
                  {errors.wallet}
                </FieldMessage>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving || !isFormValid()}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
            >
              {saving ? 'Saving…' : 'Save Contract'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-2.5 rounded-lg border border-zinc-700 hover:border-zinc-500 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
          </div>

          <WebhookTestButton
            url={webhookUrl}
            contractId={testContractId}
            network={network}
            rule={testRule}
            secret={webhookSecret}
            headers={webhookHeaders}
            format={webhookFormat}
          />
        </form>
      </div>
    </>
  )
}
