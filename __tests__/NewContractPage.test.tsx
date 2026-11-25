import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// #528: direct component tests for the Add Contract page. Collaborators that
// reach the network, the wallet or router are mocked; the form logic is real.
const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  back: vi.fn(),
  showToast: vi.fn(),
  getContracts: vi.fn(),
  syncSaveContract: vi.fn(),
  sendTestWebhook: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, back: mocks.back }),
}))
vi.mock('@/components/ToastProvider', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))
vi.mock('@/lib/storage', () => ({ getContracts: mocks.getContracts }))
vi.mock('@/lib/contractSync', () => ({
  syncSaveContract: mocks.syncSaveContract,
}))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  sendTestWebhook: mocks.sendTestWebhook,
}))
vi.mock('@/lib/useFreighterConnection', () => ({
  useFreighterConnection: () => ({ isConnected: true }),
}))
vi.mock('@/lib/useNetworkMismatchWarning', () => ({
  useNetworkMismatchWarning: () => ({
    networkWarning: null,
    checkNetworkMismatch: vi.fn(),
    clearNetworkWarning: vi.fn(),
  }),
}))
vi.mock('@/components/ContractVerification', () => ({
  default: () => null,
}))
vi.mock('@/components/FreighterConnect', () => ({ default: () => null }))

import NewContractPage from '@/app/contracts/new/page'

const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4'
const WEBHOOK_URL = 'https://hooks.example.com/alerts'

function fillForm({
  label = 'My Contract',
  contractId = CONTRACT_ID,
  webhookUrl = WEBHOOK_URL,
  addRule = true,
} = {}) {
  fireEvent.change(screen.getByPlaceholderText(/e\.g\. My DEX Contract/i), {
    target: { value: label },
  })
  fireEvent.change(screen.getByLabelText(/^contract id$/i), {
    target: { value: contractId },
  })
  fireEvent.change(screen.getByPlaceholderText('https://example.com/webhook'), {
    target: { value: webhookUrl },
  })
  if (addRule)
    fireEvent.click(screen.getByRole('button', { name: /add rule/i }))
}

function submit(container: HTMLElement) {
  fireEvent.submit(container.querySelector('form') as HTMLFormElement)
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  mocks.getContracts.mockReturnValue([])
  mocks.syncSaveContract.mockResolvedValue({ ok: true, localSaved: true })
})

describe('NewContractPage validation', () => {
  it('rejects a contract ID that is not a valid Soroban contract address', () => {
    const { container } = render(<NewContractPage />)
    fillForm({ contractId: 'NOTAVALIDID' })
    submit(container)
    expect(
      screen.getByText(/must be a valid soroban contract address/i)
    ).toBeInTheDocument()
    expect(mocks.syncSaveContract).not.toHaveBeenCalled()
  })

  it('rejects a contract that is already registered on the selected network', () => {
    mocks.getContracts.mockReturnValue([
      { id: 'existing', contract_id: CONTRACT_ID, network: 'testnet' },
    ])
    const { container } = render(<NewContractPage />)
    fillForm()
    submit(container)
    expect(
      screen.getByText(/already registered on testnet/i)
    ).toBeInTheDocument()
    expect(mocks.syncSaveContract).not.toHaveBeenCalled()
  })

  it('disables Save until the form is valid', () => {
    render(<NewContractPage />)
    expect(
      screen.getByRole('button', { name: /save contract/i })
    ).toBeDisabled()
    fillForm()
    expect(screen.getByRole('button', { name: /save contract/i })).toBeEnabled()
  })
})

describe('NewContractPage webhook test', () => {
  it('reports a successful delivery', async () => {
    mocks.sendTestWebhook.mockResolvedValue({ status: 200, ok: true })
    render(<NewContractPage />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /test webhook/i }))
    expect(
      await screen.findByText(/test webhook delivered \(http 200\)/i)
    ).toBeInTheDocument()
  })

  it('reports a failed delivery with the receiver status', async () => {
    mocks.sendTestWebhook.mockResolvedValue({ status: 500, ok: false })
    render(<NewContractPage />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /test webhook/i }))
    expect(
      await screen.findByText(/delivery failed with http status 500/i)
    ).toBeInTheDocument()
  })

  it('reports a timeout', async () => {
    mocks.sendTestWebhook.mockRejectedValue(
      new Error('Webhook request timed out')
    )
    render(<NewContractPage />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: /test webhook/i }))
    expect(
      await screen.findByText(/webhook request timed out/i)
    ).toBeInTheDocument()
  })
})

describe('NewContractPage save flow', () => {
  it('saves the contract, shows a success toast and navigates to its page', async () => {
    const { container } = render(<NewContractPage />)
    fillForm()
    submit(container)

    await waitFor(() => expect(mocks.syncSaveContract).toHaveBeenCalledTimes(1))
    const saved = mocks.syncSaveContract.mock.calls[0][0]
    expect(saved).toMatchObject({
      label: 'My Contract',
      contract_id: CONTRACT_ID,
      network: 'testnet',
      webhook_url: WEBHOOK_URL,
    })
    expect(saved.rules).toHaveLength(1)
    expect(mocks.showToast).toHaveBeenCalledWith(
      expect.stringContaining('saved successfully'),
      'success'
    )
    await waitFor(
      () => expect(mocks.push).toHaveBeenCalledWith(`/contracts/${saved.id}`),
      { timeout: 3000 }
    )
  })

  it('stays on the page and shows an error toast when storage rejects the save', async () => {
    mocks.syncSaveContract.mockResolvedValue({ ok: false, localSaved: false })
    const { container } = render(<NewContractPage />)
    fillForm()
    submit(container)

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        expect.stringContaining('Could not save contract'),
        'error'
      )
    )
    expect(mocks.push).not.toHaveBeenCalled()
  })
})
