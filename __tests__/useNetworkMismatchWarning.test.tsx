import { vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useNetworkMismatchWarning } from '@/lib/useNetworkMismatchWarning'
import { networkMismatchWarning, mapFreighterNetwork } from '@/lib/freighter'
import type { Network } from '@/types'

const FREIGHTER_NETWORK_BY_CHAIN: Record<Network, string> = {
  mainnet: 'PUBLIC',
  testnet: 'TESTNET',
  futurenet: 'FUTURENET',
}

function warningText(walletNetwork: string, chain: Network) {
  return `Freighter is on ${walletNetwork} but this app is set to ${chain} (${FREIGHTER_NETWORK_BY_CHAIN[chain]}). Switch networks in the Freighter extension.`
}

const mockIsConnected = vi.fn()
const mockGetAddress = vi.fn()
const mockGetNetworkDetails = vi.fn()

vi.mock('@stellar/freighter-api', () => ({
  isConnected: (...args: unknown[]) => mockIsConnected(...args),
  getAddress: (...args: unknown[]) => mockGetAddress(...args),
  getNetworkDetails: (...args: unknown[]) => mockGetNetworkDetails(...args),
}))

function mockWallet(network: string) {
  mockIsConnected.mockResolvedValue({ isConnected: true })
  mockGetAddress.mockResolvedValue({ address: 'GABC' })
  mockGetNetworkDetails.mockResolvedValue({ network, networkPassphrase: '' })
}

describe('networkMismatchWarning', () => {
  it('returns null when the wallet matches and the canonical text otherwise', () => {
    expect(networkMismatchWarning('TESTNET', 'testnet')).toBeNull()
    expect(networkMismatchWarning('PUBLIC', 'mainnet')).toBeNull()
    expect(networkMismatchWarning('FUTURENET', 'futurenet')).toBeNull()
    expect(networkMismatchWarning('PUBLIC', 'testnet')).toBe(
      warningText('PUBLIC', 'testnet')
    )
    expect(networkMismatchWarning('TESTNET', 'mainnet')).toBe(
      warningText('TESTNET', 'mainnet')
    )
  })

  it('covers every network in both directions', () => {
    const chains = Object.keys(FREIGHTER_NETWORK_BY_CHAIN) as Network[]
    for (const chain of chains) {
      const wallet = FREIGHTER_NETWORK_BY_CHAIN[chain]
      expect(mapFreighterNetwork(wallet)).toBe(chain)
      expect(networkMismatchWarning(wallet, chain)).toBeNull()
      for (const other of chains) {
        if (other === chain) continue
        expect(networkMismatchWarning(wallet, other)).toBe(
          warningText(wallet, other)
        )
      }
    }
  })
})

describe('useNetworkMismatchWarning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('warns on the initial mount when the wallet network differs', async () => {
    mockWallet('PUBLIC')

    const { result } = renderHook(() =>
      useNetworkMismatchWarning('testnet', true)
    )

    await waitFor(() =>
      expect(result.current.networkWarning).toBe(
        warningText('PUBLIC', 'testnet')
      )
    )
  })

  it('stays quiet on mount when the networks match', async () => {
    mockWallet('TESTNET')

    const { result } = renderHook(() =>
      useNetworkMismatchWarning('testnet', true)
    )

    await waitFor(() => expect(mockGetNetworkDetails).toHaveBeenCalled())
    expect(result.current.networkWarning).toBeNull()
  })

  it('re-checks when the selected network changes', async () => {
    mockWallet('TESTNET')

    const { result, rerender } = renderHook(
      ({ network }: { network: 'testnet' | 'mainnet' }) =>
        useNetworkMismatchWarning(network, true),
      { initialProps: { network: 'testnet' as const } }
    )

    await waitFor(() => expect(result.current.networkWarning).toBeNull())

    rerender({ network: 'mainnet' })

    await waitFor(() =>
      expect(result.current.networkWarning).toBe(
        warningText('TESTNET', 'mainnet')
      )
    )
  })

  it('warns after the wallet connects, without waiting for a network change', async () => {
    // No extension yet: the page renders the Connect button and has no wallet
    // network to compare against.
    const { result, rerender } = renderHook(
      ({ connected }: { connected: boolean }) =>
        useNetworkMismatchWarning('testnet', connected),
      { initialProps: { connected: false } }
    )

    expect(result.current.networkWarning).toBeNull()

    mockWallet('PUBLIC')
    rerender({ connected: true })

    await waitFor(() =>
      expect(result.current.networkWarning).toBe(
        warningText('PUBLIC', 'testnet')
      )
    )
  })

  it('checks immediately when asked, e.g. from the connect handler', async () => {
    const { result } = renderHook(() =>
      useNetworkMismatchWarning('testnet', true)
    )
    expect(result.current.networkWarning).toBeNull()

    mockWallet('PUBLIC')
    await result.current.checkNetworkMismatch()

    await waitFor(() =>
      expect(result.current.networkWarning).toBe(
        warningText('PUBLIC', 'testnet')
      )
    )
  })

  it('clears the warning when the wallet disconnects', async () => {
    mockWallet('PUBLIC')

    const { result } = renderHook(() =>
      useNetworkMismatchWarning('testnet', true)
    )
    await waitFor(() => expect(result.current.networkWarning).not.toBeNull())

    result.current.clearNetworkWarning()

    expect(result.current.networkWarning).toBeNull()
  })

  it('clears the warning when getNetworkDetails rejects (locked or disconnected wallet)', async () => {
    mockWallet('PUBLIC')

    const { result, rerender } = renderHook(
      ({ network }: { network: 'testnet' | 'mainnet' }) =>
        useNetworkMismatchWarning(network, true),
      { initialProps: { network: 'testnet' as const } }
    )
    await waitFor(() => expect(result.current.networkWarning).not.toBeNull())

    mockGetNetworkDetails.mockRejectedValue(new Error('locked'))
    rerender({ network: 'mainnet' })

    await waitFor(() => expect(result.current.networkWarning).toBeNull())
  })
})
