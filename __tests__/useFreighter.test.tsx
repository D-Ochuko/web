import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// Mock the freighter API module before importing the hooks.
vi.mock('@stellar/freighter-api', () => {
  return {
    isConnected: vi.fn(),
    getPublicKey: vi.fn(),
    getNetwork: vi.fn(),
    requestAccess: vi.fn(),
    setAllowed: vi.fn(),
  }
})

// Mock the lib/freighter helpers so we can control their results.
vi.mock('../lib/freighter', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/freighter')>('../lib/freighter')
  return {
    ...actual,
    readFreighterConnection: vi.fn(),
    connectFreighter: vi.fn(),
  }
})

import {
  readFreighterConnection,
  connectFreighter,
  FreighterUnavailableError,
} from '../lib/freighter'
import { useFreighter } from '../lib/useFreighter'
import { useFreighterConnection } from '../lib/useFreighterConnection'
import { useWallet } from '../lib/useWallet'

const mockedRead = vi.mocked(readFreighterConnection)
const mockedConnect = vi.mocked(connectFreighter)

declare global {
  interface Window {
    __freighterPublicKey?: string | null
  }
}

describe('useFreighter', () => {
  let openSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  afterEach(() => {
    openSpy.mockRestore()
  })

  it('populates publicKey, network and isConnected from readFreighterConnection', async () => {
    mockedRead.mockResolvedValue({
      publicKey: 'GABC123',
      network: 'TESTNET',
      isConnected: true,
    })

    const { result } = renderHook(() => useFreighter())

    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.publicKey).toBe('GABC123')
    expect(result.current.network).toBe('TESTNET')
    expect(result.current.isConnected).toBe(true)
    expect(mockedRead).toHaveBeenCalledTimes(1)
  })

  it('reflects a disconnected state when readFreighterConnection reports no connection', async () => {
    mockedRead.mockResolvedValue({
      publicKey: null,
      network: null,
      isConnected: false,
    })

    const { result } = renderHook(() => useFreighter())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.publicKey).toBeNull()
    expect(result.current.network).toBeNull()
    expect(result.current.isConnected).toBe(false)
  })

  it('connect() updates state from connectFreighter', async () => {
    mockedRead.mockResolvedValue({
      publicKey: null,
      network: null,
      isConnected: false,
    })
    mockedConnect.mockResolvedValue({
      publicKey: 'GXYZ789',
      network: 'PUBLIC',
      isConnected: true,
    })

    const { result } = renderHook(() => useFreighter())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.connect()
    })

    expect(mockedConnect).toHaveBeenCalledTimes(1)
    expect(result.current.publicKey).toBe('GXYZ789')
    expect(result.current.network).toBe('PUBLIC')
    expect(result.current.isConnected).toBe(true)
  })

  it('connect() surfaces FreighterUnavailableError without auto-opening the install page', async () => {
    mockedRead.mockResolvedValue({
      publicKey: null,
      network: null,
      isConnected: false,
    })
    mockedConnect.mockRejectedValue(new FreighterUnavailableError())

    const { result } = renderHook(() => useFreighter())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.connect()
    })

    expect(openSpy).not.toHaveBeenCalled()
    expect(result.current.isConnected).toBe(false)
    expect(result.current.publicKey).toBeNull()
  })

  it('disconnect() clears the window.__freighterPublicKey global', async () => {
    mockedRead.mockResolvedValue({
      publicKey: 'GDISC123',
      network: 'TESTNET',
      isConnected: true,
    })

    const { result } = renderHook(() => useFreighter())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.publicKey).toBe('GDISC123')
    expect(window.__freighterPublicKey).toBe('GDISC123')

    await act(async () => {
      result.current.disconnect()
    })

    expect(window.__freighterPublicKey).toBeFalsy()
    expect(result.current.publicKey).toBeNull()
    expect(result.current.isConnected).toBe(false)
  })
})

describe('useFreighterConnection', () => {
  let openSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  afterEach(() => {
    openSpy.mockRestore()
  })

  it('populates publicKey, network and isConnected from readFreighterConnection', async () => {
    mockedRead.mockResolvedValue({
      publicKey: 'GCONN456',
      network: 'FUTURENET',
      isConnected: true,
    })

    const { result } = renderHook(() => useFreighterConnection())

    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.publicKey).toBe('GCONN456')
    expect(result.current.network).toBe('FUTURENET')
    expect(result.current.isConnected).toBe(true)
    expect(mockedRead).toHaveBeenCalledTimes(1)
  })

  it('reflects a disconnected state when readFreighterConnection reports no connection', async () => {
    mockedRead.mockResolvedValue({
      publicKey: null,
      network: null,
      isConnected: false,
    })

    const { result } = renderHook(() => useFreighterConnection())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.publicKey).toBeNull()
    expect(result.current.network).toBeNull()
    expect(result.current.isConnected).toBe(false)
  })

  it('connect() updates state from connectFreighter', async () => {
    mockedRead.mockResolvedValue({
      publicKey: null,
      network: null,
      isConnected: false,
    })
    mockedConnect.mockResolvedValue({
      publicKey: 'GNEW111',
      network: 'TESTNET',
      isConnected: true,
    })

    const { result } = renderHook(() => useFreighterConnection())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.connect()
    })

    expect(mockedConnect).toHaveBeenCalledTimes(1)
    expect(result.current.publicKey).toBe('GNEW111')
    expect(result.current.network).toBe('TESTNET')
    expect(result.current.isConnected).toBe(true)
  })

  it('connect() surfaces FreighterUnavailableError without auto-opening the install page', async () => {
    mockedRead.mockResolvedValue({
      publicKey: null,
      network: null,
      isConnected: false,
    })
    mockedConnect.mockRejectedValue(new FreighterUnavailableError())

    const { result } = renderHook(() => useFreighterConnection())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.connect()
    })

    expect(openSpy).not.toHaveBeenCalled()
    expect(result.current.isConnected).toBe(false)
    expect(result.current.publicKey).toBeNull()
  })

  it('disconnect() clears the window.__freighterPublicKey global', async () => {
    mockedRead.mockResolvedValue({
      publicKey: 'GDISC456',
      network: 'FUTURENET',
      isConnected: true,
    })

    const { result } = renderHook(() => useFreighterConnection())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(window.__freighterPublicKey).toBe('GDISC456')

    await act(async () => {
      result.current.disconnect()
    })

    expect(window.__freighterPublicKey).toBeFalsy()
    expect(result.current.publicKey).toBeNull()
    expect(result.current.isConnected).toBe(false)
  })
})

describe('useWallet', () => {
  let openSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  afterEach(() => {
    openSpy.mockRestore()
  })

  it('populates publicKey, network and isConnected from readFreighterConnection', async () => {
    mockedRead.mockResolvedValue({
      publicKey: 'GWALLET789',
      network: 'TESTNET',
      isConnected: true,
    })

    const { result } = renderHook(() => useWallet())

    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.publicKey).toBe('GWALLET789')
    expect(result.current.network).toBe('TESTNET')
    expect(result.current.isConnected).toBe(true)
    expect(mockedRead).toHaveBeenCalledTimes(1)
  })

  it('connect() updates state from connectFreighter', async () => {
    mockedRead.mockResolvedValue({
      publicKey: null,
      network: null,
      isConnected: false,
    })
    mockedConnect.mockResolvedValue({
      publicKey: 'GWALLETNEW',
      network: 'PUBLIC',
      isConnected: true,
    })

    const { result } = renderHook(() => useWallet())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await act(async () => {
      await result.current.connect()
    })

    expect(mockedConnect).toHaveBeenCalledTimes(1)
    expect(result.current.publicKey).toBe('GWALLETNEW')
    expect(result.current.network).toBe('PUBLIC')
    expect(result.current.isConnected).toBe(true)
  })

  it('disconnect() clears the window.__freighterPublicKey global', async () => {
    mockedRead.mockResolvedValue({
      publicKey: 'GWALLETDISC',
      network: 'TESTNET',
      isConnected: true,
    })

    const { result } = renderHook(() => useWallet())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(window.__freighterPublicKey).toBe('GWALLETDISC')

    await act(async () => {
      result.current.disconnect()
    })

    expect(window.__freighterPublicKey).toBeFalsy()
    expect(result.current.publicKey).toBeNull()
    expect(result.current.isConnected).toBe(false)
  })
})

describe('consolidated wallet state', () => {
  let openSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  afterEach(() => {
    openSpy.mockRestore()
  })

  it('useFreighter, useFreighterConnection and useWallet derive from the same state', async () => {
    mockedRead.mockResolvedValue({
      publicKey: 'GSHARED123',
      network: 'TESTNET',
      isConnected: true,
    })

    const freighter = renderHook(() => useFreighter())
    const connection = renderHook(() => useFreighterConnection())
    const wallet = renderHook(() => useWallet())

    await waitFor(() => {
      expect(freighter.result.current.loading).toBe(false)
      expect(connection.result.current.loading).toBe(false)
      expect(wallet.result.current.loading).toBe(false)
    })

    for (const hook of [freighter, connection, wallet]) {
      expect(hook.result.current.publicKey).toBe('GSHARED123')
      expect(hook.result.current.network).toBe('TESTNET')
      expect(hook.result.current.isConnected).toBe(true)
    }

    freighter.unmount()
    connection.unmount()
    wallet.unmount()
  })

  it('connect() updates are consistent across all three hooks', async () => {
    mockedRead.mockResolvedValue({
      publicKey: null,
      network: null,
      isConnected: false,
    })
    mockedConnect.mockResolvedValue({
      publicKey: 'GSHAREDNEW',
      network: 'PUBLIC',
      isConnected: true,
    })

    const freighter = renderHook(() => useFreighter())
    const connection = renderHook(() => useFreighterConnection())
    const wallet = renderHook(() => useWallet())

    await waitFor(() => {
      expect(freighter.result.current.loading).toBe(false)
      expect(connection.result.current.loading).toBe(false)
      expect(wallet.result.current.loading).toBe(false)
    })

    await act(async () => {
      await freighter.result.current.connect()
    })

    for (const hook of [freighter, connection, wallet]) {
      expect(hook.result.current.publicKey).toBe('GSHAREDNEW')
      expect(hook.result.current.network).toBe('PUBLIC')
      expect(hook.result.current.isConnected).toBe(true)
    }

    freighter.unmount()
    connection.unmount()
    wallet.unmount()
  })

  it('disconnect() clears the window global and is consistent across all three hooks', async () => {
    mockedRead.mockResolvedValue({
      publicKey: 'GSHAREDDISC',
      network: 'TESTNET',
      isConnected: true,
    })

    const freighter = renderHook(() => useFreighter())
    const connection = renderHook(() => useFreighterConnection())
    const wallet = renderHook(() => useWallet())

    await waitFor(() => {
      expect(freighter.result.current.loading).toBe(false)
      expect(connection.result.current.loading).toBe(false)
      expect(wallet.result.current.loading).toBe(false)
    })

    expect(window.__freighterPublicKey).toBe('GSHAREDDISC')

    await act(async () => {
      freighter.result.current.disconnect()
    })

    expect(window.__freighterPublicKey).toBeFalsy()

    for (const hook of [freighter, connection, wallet]) {
      expect(hook.result.current.publicKey).toBeNull()
      expect(hook.result.current.isConnected).toBe(false)
    }

    freighter.unmount()
    connection.unmount()
    wallet.unmount()
  })
})
