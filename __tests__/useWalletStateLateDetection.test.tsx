import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@stellar/freighter-api', () => ({
  WatchWalletChanges: class {
    watch() {}
    stop() {}
  },
}))

vi.mock('@/lib/freighter', () => ({
  readFreighterConnection: vi.fn(),
}))

import { readFreighterConnection } from '@/lib/freighter'
import { useWalletState } from '@/hooks/useWalletState'

const mockedRead = vi.mocked(readFreighterConnection)
const KEY = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW'

// #527: a slow extension may inject its API after the first probe. The hook
// reports "initialized" right away but keeps looking for a short while.
describe('useWalletState late extension detection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockedRead.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('connects when the extension answers on a later probe', async () => {
    mockedRead.mockResolvedValueOnce(null).mockResolvedValueOnce({
      publicKey: KEY,
      network: 'TESTNET',
      networkPassphrase: 'x',
    })

    const { result } = renderHook(() => useWalletState())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.initialized).toBe(true)
    expect(result.current.publicKey).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(result.current.publicKey).toBe(KEY)
    expect(mockedRead).toHaveBeenCalledTimes(2)
  })

  it('stops probing once the extension is reachable but locked', async () => {
    mockedRead.mockResolvedValue({
      publicKey: null,
      network: null,
      networkPassphrase: null,
    })

    renderHook(() => useWalletState())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(mockedRead).toHaveBeenCalledTimes(1)
  })

  it('gives up after the retry window when the extension never appears', async () => {
    mockedRead.mockResolvedValue(null)

    const { result } = renderHook(() => useWalletState())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(result.current.publicKey).toBeNull()
    expect(mockedRead).toHaveBeenCalledTimes(4)
  })

  it('stops retrying after unmount', async () => {
    mockedRead.mockResolvedValue(null)

    const { unmount } = renderHook(() => useWalletState())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(mockedRead).toHaveBeenCalledTimes(1)
  })
})
