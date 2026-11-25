import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@stellar/freighter-api', () => ({
  getAddress: vi.fn(),
  getNetworkDetails: vi.fn(),
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  signTransaction: vi.fn(),
}))

import * as freighterApi from '@stellar/freighter-api'
import { connectFreighter, FreighterUnavailableError } from '../lib/freighter'

const api = vi.mocked(freighterApi)

const KEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

describe('connectFreighter after the user approves the connection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    api.isConnected.mockResolvedValue({ isConnected: true } as never)
    api.requestAccess.mockResolvedValue({ address: KEY } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetAllMocks()
  })

  it('returns the session with network null when getNetworkDetails is slow', async () => {
    // Never settles: the 2.5 s probe timeout is the only thing that ends it.
    api.getNetworkDetails.mockReturnValue(new Promise(() => {}) as never)

    const result = connectFreighter()
    await vi.advanceTimersByTimeAsync(3000)

    await expect(result).resolves.toEqual({
      publicKey: KEY,
      network: null,
      networkPassphrase: null,
    })
  })

  it('does not report "not installed" when getNetworkDetails errors', async () => {
    api.getNetworkDetails.mockResolvedValue({
      network: '',
      networkPassphrase: '',
      error: { code: -1, message: 'boom' },
    } as never)

    const result = connectFreighter()
    await vi.runAllTimersAsync()

    await expect(result).resolves.toMatchObject({
      publicKey: KEY,
      network: null,
    })
    await expect(result).resolves.not.toBeInstanceOf(FreighterUnavailableError)
  })

  it('still returns the network when getNetworkDetails answers', async () => {
    api.getNetworkDetails.mockResolvedValue({
      network: 'TESTNET',
      networkPassphrase: 'Test SDF Network ; September 2015',
    } as never)

    const result = connectFreighter()
    await vi.runAllTimersAsync()

    await expect(result).resolves.toEqual({
      publicKey: KEY,
      network: 'TESTNET',
      networkPassphrase: 'Test SDF Network ; September 2015',
    })
  })

  it('still reports an unavailable extension when it is not reachable before approval', async () => {
    api.isConnected.mockResolvedValue({
      isConnected: false,
      error: { code: -1, message: 'Extension not detected' },
    } as never)

    const result = connectFreighter()
    const assertion = expect(result).rejects.toBeInstanceOf(
      FreighterUnavailableError
    )
    await vi.runAllTimersAsync()

    await assertion
  })
})
