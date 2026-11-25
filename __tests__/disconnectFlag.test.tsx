import { vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@stellar/freighter-api', () => ({
  getAddress: vi.fn(),
  getNetworkDetails: vi.fn(),
  isConnected: vi.fn(),
  requestAccess: vi.fn(),
  signTransaction: vi.fn(),
  // A plain class, so vi.resetAllMocks() cannot wipe its behaviour.
  WatchWalletChanges: class {
    watch() {}
    stop() {}
  },
}))

import * as freighterApi from '@stellar/freighter-api'
import FreighterConnect from '@/components/FreighterConnect'
import { connectFreighter, readFreighterConnection } from '@/lib/freighter'
import {
  USER_DISCONNECTED_KEY,
  clearUserDisconnected,
  isUserDisconnected,
  setUserDisconnected,
} from '@/lib/disconnectFlag'

const api = vi.mocked(freighterApi)

const KEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const NETWORK = {
  network: 'TESTNET',
  networkUrl: 'https://horizon-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
}

function mockApprovedSite() {
  api.isConnected.mockResolvedValue({ isConnected: true } as never)
  api.getAddress.mockResolvedValue({ address: KEY } as never)
  api.getNetworkDetails.mockResolvedValue(NETWORK as never)
  api.requestAccess.mockResolvedValue({ address: KEY } as never)
}

beforeEach(() => {
  localStorage.clear()
  vi.resetAllMocks()
  mockApprovedSite()
})

describe('user disconnected flag', () => {
  it('stores a marker, not the public key, and can be cleared', () => {
    expect(isUserDisconnected()).toBe(false)
    setUserDisconnected()
    expect(isUserDisconnected()).toBe(true)
    expect(localStorage.getItem(USER_DISCONNECTED_KEY)).not.toContain(KEY)
    clearUserDisconnected()
    expect(isUserDisconnected()).toBe(false)
  })

  it('skips the auto-probe while set, so a reload does not reconnect', async () => {
    setUserDisconnected()

    await expect(readFreighterConnection()).resolves.toEqual({
      publicKey: null,
      network: null,
      networkPassphrase: null,
    })
    expect(api.isConnected).not.toHaveBeenCalled()
    expect(api.getAddress).not.toHaveBeenCalled()
  })

  it('probes normally when the flag is not set', async () => {
    const result = await readFreighterConnection()
    expect(result?.publicKey).toBe(KEY)
  })

  it('is cleared by an explicit Connect', async () => {
    setUserDisconnected()

    await connectFreighter()

    expect(isUserDisconnected()).toBe(false)
    await expect(readFreighterConnection()).resolves.toMatchObject({
      publicKey: KEY,
    })
  })

  it('is set by the Disconnect button, which also explains how to revoke access', async () => {
    render(<FreighterConnect />)

    // The site is already approved, so the mount probe connects straight away.
    fireEvent.click(await screen.findByText('Disconnect'))

    await waitFor(() => expect(isUserDisconnected()).toBe(true))
    expect(
      await screen.findByTestId('freighter-revoke-hint')
    ).toHaveTextContent(/Freighter/)
  })
})
