import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendTestWebhook } from '@/lib/api'

// #529: sendTestWebhook combines an internal timeout with an optional caller
// AbortSignal (passed as `signalOrTimeoutMs`). These tests pin both branches
// and the way the two are told apart in the thrown error.
const URL = 'https://example.com/hook'

function abortAware(): ReturnType<typeof vi.fn> {
  return vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        const fail = () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        if (init.signal?.aborted) return fail()
        init.signal?.addEventListener('abort', fail)
      })
  )
}

describe('sendTestWebhook abort handling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('aborts and reports a timeout when a numeric timeout elapses', async () => {
    const fetchMock = abortAware()
    vi.stubGlobal('fetch', fetchMock)

    const result = sendTestWebhook(URL, {
      contractId: 'CBCDEF',
      signalOrTimeoutMs: 50,
    })
    const assertion = expect(result).rejects.toThrow('Webhook request timed out')
    await vi.advanceTimersByTimeAsync(51)
    await assertion

    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal
    expect(signal.aborted).toBe(true)
  })

  it('reports a caller cancellation when the external signal aborts first', async () => {
    const fetchMock = abortAware()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    const result = sendTestWebhook(URL, {
      contractId: 'CBCDEF',
      signalOrTimeoutMs: controller.signal,
    })
    const assertion = expect(result).rejects.toThrow(
      'Webhook request cancelled by caller'
    )
    await vi.advanceTimersByTimeAsync(10)
    controller.abort()
    await assertion
  })

  it('does not start the request when the external signal is already aborted', async () => {
    const fetchMock = abortAware()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()

    await expect(
      sendTestWebhook(URL, {
        contractId: 'CBCDEF',
        signalOrTimeoutMs: controller.signal,
      })
    ).rejects.toThrow('Webhook request cancelled by caller')
    const signal = fetchMock.mock.calls[0]?.[1].signal as AbortSignal | undefined
    if (signal) expect(signal.aborted).toBe(true)
  })

  it('still applies the default timeout when only an external signal is given', async () => {
    vi.stubGlobal('fetch', abortAware())
    const controller = new AbortController()

    const result = sendTestWebhook(URL, {
      contractId: 'CBCDEF',
      signalOrTimeoutMs: controller.signal,
    })
    const assertion = expect(result).rejects.toThrow('Webhook request timed out')
    await vi.advanceTimersByTimeAsync(10_001)
    await assertion
    expect(controller.signal.aborted).toBe(false)
  })

  it('clears the timeout timer after a successful delivery', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
      })
    )

    const result = await sendTestWebhook(URL, { contractId: 'CBCDEF' })
    expect(result.ok).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
