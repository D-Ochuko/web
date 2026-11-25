// Generates `lib/api-types.ts` from `docs/openapi.yaml` (#481).
//
// The OpenAPI document is the single source of truth for the tx-watch-core
// contract; this script derives the TypeScript types the client imports so the
// shapes cannot silently drift. It intentionally implements only the small
// subset of OpenAPI 3.0 used by `docs/openapi.yaml` (object/array/string/
// integer/number/boolean schemas, `$ref` into `#/components/schemas`, `enum`,
// `required` and `oneOf`) rather than pulling in a full compiler.
//
// Run with `npm run gen:api-types`. The committed output is checked in so the
// build and CI never need this script; re-run it whenever the spec changes.

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parse } from 'yaml'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const specPath = resolve(root, 'docs/openapi.yaml')
const outPath = resolve(root, 'lib/api-types.ts')

const tsType = {
  string: 'string',
  integer: 'number',
  number: 'number',
  boolean: 'boolean',
}

/** Quote a string the way the repo's prettier config does (single quotes). */
function quote(value) {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/** Render a union of enum values, wrapping onto separate lines past 80 cols. */
function renderEnum(values) {
  const parts = values.map(quote)
  const inline = parts.join(' | ')
  if (inline.length + 2 <= 80) return inline
  return `\n  | ${parts.join('\n  | ')}`
}

/** A property key: bare when a valid identifier, otherwise a quoted string. */
function key(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : quote(name)
}

/** Render a single schema node (not a `$ref`) to a TypeScript type string. */
function renderSchema(doc, schema) {
  if (schema.$ref) return refName(schema.$ref)
  if (schema.oneOf)
    return schema.oneOf.map((s) => renderSchema(doc, s)).join(' | ')
  if (schema.enum) return renderEnum(schema.enum)
  if (schema.type === 'array') return `${renderSchema(doc, schema.items)}[]`
  if (schema.type === 'object' || schema.properties)
    return renderObject(doc, schema)
  if (schema.type) return tsType[schema.type] ?? 'unknown'
  return 'unknown'
}

/** Render an object schema to `{ ... }` with `?` for optional members. */
function renderObject(doc, schema) {
  const properties = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  const lines = Object.entries(properties).map(([name, prop]) => {
    const optional = required.has(name) ? '' : '?'
    return `  ${key(name)}${optional}: ${renderSchema(doc, prop)}`
  })
  if (lines.length === 0) return 'Record<string, unknown>'
  return `{\n${lines.join('\n')}\n}`
}

/** Turn `#/components/schemas/Foo` into the exported type name `Foo`. */
function refName(ref) {
  const name = ref.split('/').pop()
  return name
}

const doc = parse(await readFile(specPath, 'utf8'))
const schemas = doc.components?.schemas ?? {}

const body = []
for (const [name, schema] of Object.entries(schemas)) {
  const rendered = `export type ${name} = ${renderSchema(doc, schema)}`
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
  body.push(rendered)
}

const header = `// AUTO-GENERATED from docs/openapi.yaml by scripts/generate-api-types.mjs.
// Do not edit by hand. Run \`npm run gen:api-types\` after changing the spec.
//
// These types mirror the tx-watch-core REST contract consumed by
// lib/contractsApi.ts and lib/alertSource.ts (#481).
/* eslint-disable */
`

const footer = `\nexport type ApiSchemas = {\n${Object.keys(schemas)
  .map((name) => `  ${name}: ${name}`)
  .join('\n')}\n}\n`

await writeFile(outPath, `${header}\n${body.join('\n\n')}\n${footer}`, 'utf8')
console.log(`Generated ${outPath} (${body.length} types)`)
