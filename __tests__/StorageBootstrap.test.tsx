import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import StorageBootstrap from '@/components/StorageBootstrap'
import { CONTRACTS_KEY, STORAGE_VERSION_KEY } from '@/lib/storageKeys'

// #509: migrateStorage is wired in through runMigrations(), which the root
// layout triggers by mounting <StorageBootstrap />. These tests pin that call
// site so the migration runner cannot silently become dead code again.
describe('StorageBootstrap', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stamps the storage version on mount', () => {
    expect(localStorage.getItem(STORAGE_VERSION_KEY)).toBeNull()
    render(<StorageBootstrap />)
    expect(Number(localStorage.getItem(STORAGE_VERSION_KEY))).toBeGreaterThan(0)
  })

  it('upgrades unversioned contracts on mount', () => {
    localStorage.setItem(
      CONTRACTS_KEY,
      JSON.stringify([
        {
          id: 'c1',
          label: 'Legacy',
          contract_id: 'CABC',
          network: 'testnet',
          rules: [],
          webhook_url: 'https://example.com/hook',
          created_at: 1,
          updated_at: 1,
        },
      ])
    )
    render(<StorageBootstrap />)
    const [contract] = JSON.parse(localStorage.getItem(CONTRACTS_KEY) ?? '[]')
    expect(contract.enabled).toBe(true)
  })
})
