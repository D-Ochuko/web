// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { getAllAlerts, getContracts } from '../storage'
import { ALERTS_KEY, CONTRACTS_KEY } from '../storageKeys'

// #510: load() validates every persisted entry at runtime, so stale or
// tampered data cannot reach components as a half-shaped object.
const validContract = {
  id: 'c1',
  label: 'Valid',
  contract_id: 'CABC',
  network: 'testnet',
  rules: [],
  webhook_url: 'https://example.com/hook',
  created_at: 1,
  updated_at: 1,
}

beforeEach(() => localStorage.clear())

describe('runtime validation of persisted data', () => {
  it('drops contracts whose required fields have the wrong type', () => {
    localStorage.setItem(
      CONTRACTS_KEY,
      JSON.stringify([
        validContract,
        { ...validContract, id: 2 },
        { ...validContract, contract_id: null },
        { ...validContract, network: undefined },
      ])
    )
    expect(getContracts().map((c) => c.id)).toEqual(['c1'])
  })

  it('normalises a contract whose rules field is not an array', () => {
    localStorage.setItem(
      CONTRACTS_KEY,
      JSON.stringify([{ ...validContract, rules: 'not-an-array' }])
    )
    expect(getContracts()[0].rules).toEqual([])
  })

  it('drops alerts missing a contract id or a numeric timestamp', () => {
    localStorage.setItem(
      ALERTS_KEY,
      JSON.stringify([
        { contract_id: 'CABC', timestamp: 10 },
        { timestamp: 20 },
        { contract_id: 'CABC', timestamp: '30' },
        'garbage',
      ])
    )
    expect(getAllAlerts()).toHaveLength(1)
  })

  it('falls back to an empty list when the stored JSON is invalid', () => {
    localStorage.setItem(CONTRACTS_KEY, '{not json')
    expect(getContracts()).toEqual([])
  })
})
