import { vi } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import ContractDetailPage from '@/app/contracts/[id]/page'
import type { WatchedContract } from '@/types'

const SECRET = 'whsec_detail_copy_check'

const contract: WatchedContract = {
  id: 'c-secret',
  label: 'Secret Contract',
  contract_id: 'CDSO4GGZH7KBUQYKOIQDCMCFSRYEPOVDUX7Z4IB5TWNTLT2GDRKDQOYR',
  network: 'testnet',
  rules: [{ type: 'AnyTransaction' }],
  webhook_url: 'https://example.com/webhook',
  webhook_secret: SECRET,
  created_at: 1_700_000_000_000,
  updated_at: 1_700_000_000_000,
} as WatchedContract

let current: WatchedContract = contract

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/lib/storage', () => ({
  getContract: () => current,
  getContracts: () => [current],
  getAlerts: () => [],
  deleteAlertsByNetwork: vi.fn(),
  saveContract: vi.fn().mockReturnValue(true),
  deleteContract: vi.fn(),
}))

vi.mock('@/lib/contractSync', () => ({
  syncSaveContract: vi.fn().mockResolvedValue({ ok: true, localSaved: true }),
  syncDeleteContract: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('@/lib/useAnalytics', () => ({
  useAnalytics: () => ({ trackEvent: vi.fn() }),
}))

vi.mock('@/components/ToastProvider', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

vi.mock('@/hooks/useAlertSync', () => ({
  useAlertSync: () => ({
    live: false,
    lastSync: null,
    enabled: false,
    syncNow: vi.fn(),
  }),
}))

vi.mock('@/components/WebhookLog', () => ({ default: () => null }))
vi.mock('@/components/WebhookTestButton', () => ({ default: () => null }))

async function openEditDetails() {
  render(<ContractDetailPage params={{ id: contract.id }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Metadata' }))
  // The dialog renders through a portal-free Modal; scope queries to it.
  return screen.getByRole('dialog')
}

describe('ContractDetailPage webhook secret copy (#405)', () => {
  beforeEach(() => {
    current = contract
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('copies the saved secret and announces success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const dialog = await openEditDetails()
    const copy = within(dialog).getByRole('button', {
      name: 'Copy webhook secret',
    })
    expect(copy).toBeEnabled()

    await act(async () => {
      fireEvent.click(copy)
    })

    expect(writeText).toHaveBeenCalledWith(SECRET)
    expect(within(dialog).getByRole('status')).toHaveTextContent('Copied!')
  })

  it('reports a failed copy instead of failing silently', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })
    document.execCommand = vi.fn().mockReturnValue(false)

    const dialog = await openEditDetails()
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole('button', { name: 'Copy webhook secret' })
      )
    })

    expect(within(dialog).getByRole('status')).toHaveTextContent('Copy failed')
  })

  it('disables copy when the contract has no secret', async () => {
    current = { ...contract, webhook_secret: undefined } as WatchedContract
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const dialog = await openEditDetails()
    const copy = within(dialog).getByRole('button', {
      name: 'Copy webhook secret',
    })
    expect(copy).toBeDisabled()

    fireEvent.click(copy)
    expect(writeText).not.toHaveBeenCalled()
  })
})
