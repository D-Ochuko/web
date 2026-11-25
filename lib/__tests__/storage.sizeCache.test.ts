// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AlertPayload } from '@/types'
import { addAlert, getAllAlerts } from '../storage'

// #508: the size estimate behind the 90% quota guard is cached, so a write no
// longer re-reads every localStorage key.
const alert = (n: number): AlertPayload =>
  ({
    label: 'A',
    contract_id: 'CABC',
    network: 'testnet',
    rule_triggered: 'AnyTransaction',
    transaction_hash: `hash-${n}`,
    timestamp: Date.now() + n,
    horizon_link: 'https://example.com',
  }) as AlertPayload

describe('storage size cache', () => {
  beforeEach(() => localStorage.clear())

  it('does not re-read every key on each write', () => {
    for (let i = 0; i < 20; i++)
      localStorage.setItem(`other_key_${i}`, 'x'.repeat(50))
    addAlert(alert(0)) // primes the cache
    const keySpy = vi.spyOn(Storage.prototype, 'key')
    for (let i = 1; i <= 10; i++) addAlert(alert(i))
    expect(keySpy).not.toHaveBeenCalled()
    keySpy.mockRestore()
  })

  it('still stores every alert after repeated writes', () => {
    for (let i = 0; i < 10; i++) addAlert(alert(i))
    expect(getAllAlerts()).toHaveLength(10)
  })

  it('recounts after localStorage is cleared', () => {
    addAlert(alert(0))
    localStorage.clear()
    const keySpy = vi.spyOn(Storage.prototype, 'key')
    addAlert(alert(1))
    addAlert(alert(2))
    expect(getAllAlerts()).toHaveLength(2)
    keySpy.mockRestore()
  })
})
