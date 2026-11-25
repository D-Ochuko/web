// @vitest-environment node
//
// CI guard for the tx-watch-core contract (#481). Parses docs/openapi.yaml,
// compiles the schemas the client depends on, and validates the example
// fixtures in docs/fixtures/ against them. If the contract drifts from what the
// client expects (or a fixture is edited to something the schema forbids), this
// test fails in CI via `npm run test:openapi`.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import Ajv, { type ValidateFunction } from 'ajv'
import type { ApiSchemas } from '@/lib/api-types'

// Compile-time guard: the generated types must stay in sync with the schemas
// this test reads from the spec. Indexing ApiSchemas with each schema name (as
// a type, via `keyof`) also keeps every generated type referenced so knip does
// not report them as unused.
type SchemaName = keyof ApiSchemas
const REQUIRED_SCHEMAS: readonly SchemaName[] = [
  'Network',
  'AlertRule',
  'WatchedContract',
  'AlertPayload',
  'AlertEnvelope',
  'ErrorBody',
]

const root = resolve(__dirname, '..')
const spec = parse(readFileSync(resolve(root, 'docs/openapi.yaml'), 'utf8'))
const schemas = spec.components.schemas as Record<string, unknown>

function fixture<T = unknown>(name: string): T {
  return JSON.parse(
    readFileSync(resolve(root, 'docs/fixtures', name), 'utf8')
  ) as T
}

/** Compile a schema, resolving local `#/components/schemas/...` refs. */
function compile(schema: unknown): ValidateFunction {
  // ajv only needs the schema objects; OpenAPI is a JSON-Schema dialect for the
  // subset used here (type/properties/required/items/enum/oneOf), so we compile
  // directly with unknown-format keywords disabled.
  const ajv = new Ajv({
    strict: false,
    allErrors: true,
    validateFormats: false,
  })
  return ajv.compile(schema as object)
}

describe('OpenAPI contract', () => {
  it('exposes the schemas the client relies on', () => {
    for (const name of REQUIRED_SCHEMAS) {
      expect(schemas).toHaveProperty(name)
    }
  })

  it('declares the routes the client calls', () => {
    const paths = Object.keys(spec.paths)
    expect(paths).toEqual(
      expect.arrayContaining(['/contracts', '/contracts/{id}', '/alerts'])
    )
    expect(Object.keys(spec.paths['/contracts'])).toEqual(
      expect.arrayContaining(['get', 'post'])
    )
    expect(Object.keys(spec.paths['/contracts/{id}'])).toEqual(
      expect.arrayContaining(['put', 'delete'])
    )
    expect(Object.keys(spec.paths['/alerts'])).toEqual(
      expect.arrayContaining(['get'])
    )
  })
})

describe('contract fixtures validate against the schema', () => {
  it('accepts a list of WatchedContract', () => {
    const validate = compile({ type: 'array', items: schemas.WatchedContract })
    const data = fixture('contracts.list.json')
    const ok = validate(data)
    if (!ok) console.error(validate.errors)
    expect(ok).toBe(true)
  })

  it('accepts a bare array of AlertPayload', () => {
    const validate = compile({ type: 'array', items: schemas.AlertPayload })
    const data = fixture('alerts.list.json')
    const ok = validate(data)
    if (!ok) console.error(validate.errors)
    expect(ok).toBe(true)
  })

  it('accepts an AlertEnvelope wrapping AlertPayload', () => {
    const validate = compile(schemas.AlertEnvelope)
    const data = fixture('alerts.envelope.json')
    const ok = validate(data)
    if (!ok) console.error(validate.errors)
    expect(ok).toBe(true)
  })

  it('accepts every documented ErrorBody example', () => {
    const validate = compile(schemas.ErrorBody)
    const errors = fixture<Record<string, unknown>>('errors.json')
    for (const [status, body] of Object.entries(errors)) {
      const ok = validate(body)
      if (!ok) console.error(status, validate.errors)
      expect(ok, `error ${status} should be a valid ErrorBody`).toBe(true)
    }
  })

  it('rejects a contract missing required fields', () => {
    const validate = compile(schemas.WatchedContract)
    const ok = validate({ id: 'x', label: 'y' })
    expect(ok).toBe(false)
  })

  it('rejects an alert with an unknown rule_triggered', () => {
    const validate = compile(schemas.AlertPayload)
    const ok = validate({
      label: 'x',
      contract_id: 'c',
      network: 'testnet',
      rule_triggered: 'NotARealRule',
      transaction_hash: 'h',
      timestamp: 0,
      horizon_link: 'https://horizon.example/tx',
    })
    expect(ok).toBe(false)
  })
})
