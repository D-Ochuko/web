import { StrKey } from '@stellar/stellar-sdk'
import {
  buildSnapshot,
  parseImport,
  validateContractEntry,
} from '../importSchema'
import type { WatchedContract } from '@/types'

// A checksum-valid contract StrKey (all-zero hash).
const CID = StrKey.encodeContract(Buffer.alloc(32))
const good = {
  id: 'c1',
  label: 'Alpha',
  contract_id: CID,
  network: 'testnet',
  rules: [{ type: 'AnyTransaction' }],
  webhook_url: 'https://example.com/hook',
  created_at: 1,
  updated_at: 2,
}

describe('parseImport', () => {
  it('accepts valid entries', () => {
    const r = parseImport(JSON.stringify(buildSnapshot([good as never])))
    expect(r.contracts).toHaveLength(1)
    expect(r.errors).toEqual([])
  })

  it('reports per-entry errors without failing the import', () => {
    const r = parseImport(
      JSON.stringify({
        version: 1,
        contracts: [good, { ...good, network: 'nope' }, 5],
      })
    )
    expect(r.contracts).toHaveLength(1)
    expect(r.errors.map((e) => e.index)).toEqual([1, 2])
  })

  it('rejects bad JSON and bad envelope', () => {
    expect(() => parseImport('{')).toThrow(/Invalid JSON/)
    expect(() => parseImport('{"version":2,"contracts":[]}')).toThrow(
      /Invalid snapshot/
    )
  })

  it('rejects legacy address-only entries', () => {
    expect(
      typeof validateContractEntry({
        id: 'x',
        address: 'GABC',
        network: 'mainnet',
      })
    ).toBe('string')
  })

  it('validates rules and webhook url', () => {
    expect(
      validateContractEntry({ ...good, rules: [{ type: 'Bogus' }] })
    ).toMatch(/rule type/)
    expect(validateContractEntry({ ...good, webhook_url: 'nope' })).toMatch(
      /webhook_url/
    )
  })

  describe('webhook url validation codes', () => {
    it('rejects credentials embedded in the url', () => {
      const r = validateContractEntry({
        ...good,
        webhook_url: 'https://user:pass@example.com/hook',
      })
      expect(typeof r).toBe('string')
      expect(r).toMatch(/credential/i)
    })

    it('rejects plain http on mainnet', () => {
      const r = validateContractEntry({
        ...good,
        network: 'mainnet',
        webhook_url: 'http://example.com/hook',
      })
      expect(typeof r).toBe('string')
      expect(r).toMatch(/https/i)
    })

    it('rejects loopback addresses', () => {
      const r = validateContractEntry({
        ...good,
        webhook_url: 'http://127.0.0.1/hook',
      })
      expect(typeof r).toBe('string')
      expect(r).toMatch(/loopback|local/i)
    })

    it('rejects private network ranges', () => {
      const r = validateContractEntry({
        ...good,
        webhook_url: 'http://10.0.0.5/hook',
      })
      expect(typeof r).toBe('string')
      expect(r).toMatch(/private/i)
    })

    it('rejects credentials plus private range on mainnet', () => {
      const r = validateContractEntry({
        ...good,
        network: 'mainnet',
        webhook_url: 'http://user:pass@10.0.0.5/hook',
      })
      expect(typeof r).toBe('string')
    })

    it('accepts http on testnet (warning only)', () => {
      const r = validateContractEntry({
        ...good,
        webhook_url: 'http://example.com/hook',
      })
      expect(r).not.toBe('string')
      expect(typeof r).not.toBe('string')
    })
  })

  describe('webhook_secret', () => {
    it('preserves a valid secret through validation', () => {
      const r = validateContractEntry({
        ...good,
        webhook_secret: 'whsec_abc123',
      })
      expect(typeof r).not.toBe('string')
      expect(r).toMatchObject({ webhook_secret: 'whsec_abc123' })
    })

    it('omits the secret when absent', () => {
      expect(validateContractEntry(good)).not.toHaveProperty('webhook_secret')
    })

    it('rejects a non-string secret', () => {
      const r = validateContractEntry({ ...good, webhook_secret: 42 })
      expect(typeof r).toBe('string')
      expect(r).toMatch(/webhook_secret/)
    })

    it('rejects an empty secret', () => {
      const r = validateContractEntry({ ...good, webhook_secret: '   ' })
      expect(typeof r).toBe('string')
      expect(r).toMatch(/webhook_secret/)
    })

    it('preserves the secret through parseImport', () => {
      const r = parseImport(
        JSON.stringify({
          version: 1,
          contracts: [{ ...good, webhook_secret: 'whsec_xyz' }],
        })
      )
      expect(r.errors).toEqual([])
      expect(r.contracts[0]).toMatchObject({ webhook_secret: 'whsec_xyz' })
    })
  })

  it('rejects invalid admin function names and names the offender', () => {
    const r = validateContractEntry({
      ...good,
      rules: [
        { type: 'AdminFunctionCalled', functions: ['upgrade', 'set-admin'] },
      ],
    })
    expect(typeof r).toBe('string')
    expect(r).toMatch(/set-admin/)
    expect(r).not.toMatch(/upgrade/)
  })

  it('rejects admin function names over the 32-char symbol limit', () => {
    const long = 'a'.repeat(33)
    const r = validateContractEntry({
      ...good,
      rules: [{ type: 'AdminFunctionCalled', functions: [long] }],
    })
    expect(typeof r).toBe('string')
    expect(r).toMatch(/32/)
    expect(r).toContain(long)
  })

  it('preserves the enabled flag through validation', () => {
    expect(validateContractEntry({ ...good, enabled: true })).toMatchObject({
      enabled: true,
    })
    expect(validateContractEntry({ ...good, enabled: false })).toMatchObject({
      enabled: false,
    })
    expect(validateContractEntry(good)).not.toHaveProperty('enabled')
  })

  it('de-duplicates admin function names before saving', () => {
    const r = parseImport(
      JSON.stringify({
        version: 1,
        contracts: [
          {
            ...good,
            rules: [
              {
                type: 'AdminFunctionCalled',
                functions: ['upgrade', 'upgrade'],
              },
            ],
          },
        ],
      })
    )
    expect(r.errors).toEqual([])
    expect(r.contracts[0].rules[0]).toMatchObject({
      type: 'AdminFunctionCalled',
      functions: ['upgrade'],
    })
  })

  it('validates restored alerts, drops unknown fields and counts skipped', () => {
    const alert = {
      label: 'A',
      contract_id: CID,
      network: 'testnet',
      rule_triggered: 'AnyTransaction',
      transaction_hash: 'abc',
      timestamp: 1,
      horizon_link: 'https://h',
      extra: 'x',
    }
    const { transaction_hash: _omit, ...missingHash } = alert
    const r = parseImport(
      JSON.stringify({
        version: 2,
        contracts: [],
        alerts: [alert, missingHash],
      })
    )
    expect(r.alerts).toHaveLength(1)
    expect(r.alerts![0]).not.toHaveProperty('extra')
    expect(r.skippedAlerts).toBe(1)
  })
})

describe('LargeTransfer threshold validation', () => {
  const withThreshold = (t: unknown) => ({
    ...good,
    rules: [{ type: 'LargeTransfer', threshold_xlm: t }],
  })

  it.each([0, -1, 1e12, 0.123456789])('rejects %s', (t) => {
    const result = validateContractEntry(withThreshold(t))
    expect(typeof result).toBe('string')
    expect(result).toMatch(/^invalid threshold_xlm: /)
  })

  it('reports specific reasons', () => {
    expect(validateContractEntry(withThreshold(0))).toContain('greater than 0')
    expect(validateContractEntry(withThreshold(1e12))).toContain(
      'cannot exceed'
    )
    expect(validateContractEntry(withThreshold(0.123456789))).toContain(
      'decimal places'
    )
    expect(validateContractEntry(withThreshold('5'))).toBe(
      'threshold_xlm must be a number'
    )
  })

  it('accepts valid thresholds', () => {
    const result = validateContractEntry(withThreshold(0.0000001))
    expect(typeof result).toBe('object')
    expect(validateContractEntry(withThreshold(50_000_000_000))).toHaveProperty(
      'rules'
    )
  })
})

describe('duplicates within one import file', () => {
  it('reports later duplicates as errors and keeps the first', () => {
    const { id: _id, ...noId } = good
    const result = parseImport(
      JSON.stringify([noId, { ...noId, label: 'Again' }])
    )
    expect(result.contracts).toHaveLength(1)
    expect(result.contracts[0].label).toBe('Alpha')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].index).toBe(1)
    expect(result.errors[0].message).toMatch(/duplicate/)
  })

  it('generates a non-colon-joined id when none is provided', () => {
    const { id: _id, ...noId } = good
    const { contracts } = parseImport(JSON.stringify([noId]))
    expect(contracts[0].id).not.toBe(`${CID}:testnet`)
    expect(contracts[0].id.length).toBeGreaterThan(0)
  })

  it('allows the same contract_id on different networks', () => {
    const { id: _id, ...noId } = good
    const result = parseImport(
      JSON.stringify([noId, { ...noId, network: 'futurenet' }])
    )
    expect(result.contracts).toHaveLength(2)
    expect(new Set(result.contracts.map((c) => c.id)).size).toBe(2)
  })
})

describe('label rules', () => {
  it('trims labels', () => {
    const result = validateContractEntry({ ...good, label: '  Alpha  ' })
    expect(result).toHaveProperty('label', 'Alpha')
  })

  it('rejects labels over the max length and accepts exactly the max', () => {
    expect(validateContractEntry({ ...good, label: 'a'.repeat(101) })).toBe(
      'label must be 100 characters or less'
    )
    expect(
      validateContractEntry({ ...good, label: 'a'.repeat(100) })
    ).toHaveProperty('label')
  })

  it('falls back to contract_id for a blank label', () => {
    expect(validateContractEntry({ ...good, label: '   ' })).toHaveProperty(
      'label',
      CID
    )
  })
})

describe('webhook format and headers on import (#408, #409)', () => {
  const entry = {
    contract_id: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
    network: 'testnet',
    webhook_url: 'https://example.com/hook',
    rules: [],
  }

  it('keeps a known non-default format', () => {
    const result = validateContractEntry({ ...entry, webhook_format: 'slack' })
    expect(typeof result).not.toBe('string')
    expect((result as WatchedContract).webhook_format).toBe('slack')
  })

  it('drops the default json format so older records stay unchanged', () => {
    const result = validateContractEntry({ ...entry, webhook_format: 'json' })
    expect((result as WatchedContract).webhook_format).toBeUndefined()
  })

  it('rejects an unknown format', () => {
    expect(
      validateContractEntry({ ...entry, webhook_format: 'teams' })
    ).toMatch(/invalid webhook_format/)
  })

  it('keeps valid headers and rejects reserved ones', () => {
    const ok = validateContractEntry({
      ...entry,
      webhook_headers: { Authorization: 'Bearer t' },
    }) as WatchedContract
    expect(ok.webhook_headers).toEqual({ Authorization: 'Bearer t' })

    expect(
      validateContractEntry({ ...entry, webhook_headers: { Host: 'x' } })
    ).toMatch(/invalid webhook_headers/)
  })
})
