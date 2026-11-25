import { createHmac } from 'node:crypto'
import {
  DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
  finishWebhookSecretRotation,
  generateWebhookSecret,
  parseSignatureTimestamp,
  parseSignatureHeader,
  signWebhookPayload,
  verifyWebhookSignature,
} from '../lib/webhookSignature'

const SECRET = 'whsec_test'
const BODY = '{"contract_id":"CABC","is_test":true}'
const T = 1_760_000_000

describe('signWebhookPayload', () => {
  it('signs "<t>.<body>" with HMAC-SHA256 in t=,v1= form', async () => {
    const expected = createHmac('sha256', SECRET)
      .update(`${T}.${BODY}`)
      .digest('hex')
    expect(await signWebhookPayload(SECRET, BODY, T)).toBe(
      `t=${T},v1=${expected}`
    )
  })

  it('uses the current time by default', async () => {
    const before = Math.floor(Date.now() / 1000)
    const header = await signWebhookPayload(SECRET, BODY)
    const t = Number(header.match(/^t=(\d+),v1=[0-9a-f]{64}$/)?.[1])
    expect(t).toBeGreaterThanOrEqual(before)
    expect(t).toBeLessThanOrEqual(before + 2)
  })

  it('generates unique whsec_ secrets', () => {
    const a = generateWebhookSecret()
    expect(a).toMatch(/^whsec_[0-9a-f]{64}$/)
    expect(generateWebhookSecret()).not.toBe(a)
  })
})

describe('verifyWebhookSignature', () => {
  it('accepts a valid, fresh signature', async () => {
    const header = await signWebhookPayload(SECRET, BODY, T)
    await expect(
      verifyWebhookSignature(SECRET, BODY, header, { now: T + 10 })
    ).resolves.toEqual({ valid: true, timestamp: T })
  })

  it('rejects a stale signature (replay outside the 5-minute window)', async () => {
    const header = await signWebhookPayload(SECRET, BODY, T)
    const now = T + DEFAULT_SIGNATURE_TOLERANCE_SECONDS + 1
    await expect(
      verifyWebhookSignature(SECRET, BODY, header, { now })
    ).resolves.toEqual({ valid: false, reason: 'stale' })
  })

  it('rejects a timestamp too far in the future', async () => {
    const header = await signWebhookPayload(SECRET, BODY, T + 3600)
    await expect(
      verifyWebhookSignature(SECRET, BODY, header, { now: T })
    ).resolves.toMatchObject({ reason: 'stale' })
  })

  it('rejects a tampered body', async () => {
    const header = await signWebhookPayload(SECRET, BODY, T)
    await expect(
      verifyWebhookSignature(SECRET, BODY.replace('true', 'false'), header, {
        now: T,
      })
    ).resolves.toEqual({ valid: false, reason: 'mismatch' })
  })

  it('rejects a tampered timestamp (old signature re-stamped as fresh)', async () => {
    const header = await signWebhookPayload(SECRET, BODY, T)
    const restamped = header.replace(`t=${T}`, `t=${T + 1000}`)
    await expect(
      verifyWebhookSignature(SECRET, BODY, restamped, { now: T + 1000 })
    ).resolves.toEqual({ valid: false, reason: 'mismatch' })
  })

  it('rejects the wrong secret', async () => {
    const header = await signWebhookPayload(SECRET, BODY, T)
    await expect(
      verifyWebhookSignature('other', BODY, header, { now: T })
    ).resolves.toMatchObject({ reason: 'mismatch' })
  })

  it('accepts any matching v1 entry (secret rotation)', async () => {
    const oldSig = (await signWebhookPayload('old-secret', BODY, T)).split(
      ','
    )[1]
    const header = `${await signWebhookPayload(SECRET, BODY, T)},${oldSig}`
    await expect(
      verifyWebhookSignature('old-secret', BODY, header, { now: T })
    ).resolves.toMatchObject({ valid: true })
  })

  it('accepts the current secret when the header carries two v1 entries', async () => {
    const header = await signWebhookPayload(SECRET, BODY, T, {
      previousSecret: 'old-secret',
    })
    await expect(
      verifyWebhookSignature(SECRET, BODY, header, { now: T })
    ).resolves.toEqual({ valid: true, timestamp: T })
  })
})

describe('dual-secret signing during the rotation grace window', () => {
  const PREVIOUS = 'whsec_previous'
  const GRACE_EXPIRES_AT = T + 24 * 60 * 60

  it('emits two v1= entries while the grace window is open', async () => {
    const header = await signWebhookPayload(SECRET, BODY, T, {
      previousSecret: PREVIOUS,
      previousSecretExpiresAt: GRACE_EXPIRES_AT,
      now: T,
    })
    expect(header.match(/v1=[0-9a-f]{64}/g)).toHaveLength(2)
    expect(header).toMatch(new RegExp(`^t=${T},v1=[0-9a-f]{64},v1=[0-9a-f]{64}$`))
  })

  it('verifies against both the current and the previous secret', async () => {
    const header = await signWebhookPayload(SECRET, BODY, T, {
      previousSecret: PREVIOUS,
      previousSecretExpiresAt: GRACE_EXPIRES_AT,
      now: T,
    })
    await expect(
      verifyWebhookSignature(SECRET, BODY, header, { now: T + 10 })
    ).resolves.toEqual({ valid: true, timestamp: T })
    await expect(
      verifyWebhookSignature(PREVIOUS, BODY, header, { now: T + 10 })
    ).resolves.toEqual({ valid: true, timestamp: T })
  })

  it('signs with only the current secret once the grace window has expired', async () => {
    const header = await signWebhookPayload(SECRET, BODY, T, {
      previousSecret: PREVIOUS,
      previousSecretExpiresAt: GRACE_EXPIRES_AT,
      now: GRACE_EXPIRES_AT,
    })
    expect(header.match(/v1=/g)).toHaveLength(1)
    await expect(
      verifyWebhookSignature(PREVIOUS, BODY, header, { now: T })
    ).resolves.toEqual({ valid: false, reason: 'mismatch' })
  })

  it('signs with only the current secret when no expiry is configured', async () => {
    const header = await signWebhookPayload(SECRET, BODY, T, {
      previousSecret: PREVIOUS,
    })
    expect(header.match(/v1=/g)).toHaveLength(1)
  })

  it('finish rotation clears the previous secret so only the current one signs', async () => {
    const rotated = finishWebhookSecretRotation({
      secret: SECRET,
      previousSecret: PREVIOUS,
      previousSecretExpiresAt: GRACE_EXPIRES_AT,
    })
    expect(rotated.previousSecret).toBeUndefined()
    expect(rotated.previousSecretExpiresAt).toBeUndefined()

    const header = await signWebhookPayload(rotated.secret, BODY, T, {
      previousSecret: rotated.previousSecret,
      previousSecretExpiresAt: rotated.previousSecretExpiresAt,
      now: T,
    })
    expect(header.match(/v1=/g)).toHaveLength(1)
    await expect(
      verifyWebhookSignature(PREVIOUS, BODY, header, { now: T })
    ).resolves.toEqual({ valid: false, reason: 'mismatch' })
  })

  it.each([
    undefined,
    '',
    'sha256=abcd',
    `t=${T}`,
    'v1=abcd',
    `t=soon,v1=${'0'.repeat(64)}`,
  ])('rejects a malformed header %j', async (header) => {
    await expect(
      verifyWebhookSignature(SECRET, BODY, header, { now: T })
    ).resolves.toEqual({ valid: false, reason: 'malformed' })
  })
})

describe('parseSignatureTimestamp', () => {
  it('returns the t= of a header built by signWebhookPayload', async () => {
    const header = await signWebhookPayload('whsec_x', '{}', 1700000000)
    expect(parseSignatureTimestamp(header)).toBe(1700000000)
  })

  it.each([
    '',
    `sha256=${'a'.repeat(64)}`,
    `t=abc,v1=${'a'.repeat(64)}`,
    `t=1700000000,v1=${'a'.repeat(63)}`,
    `t=1700000000,v1=${'A'.repeat(64)}`,
    `t=1700000000,v1=${'a'.repeat(64)},v1=${'b'.repeat(64)}`,
    `v1=${'a'.repeat(64)},t=1700000000`,
    `t=1700000000000000,v1=${'a'.repeat(64)}`,
  ])('returns null for %j', (header) => {
    expect(parseSignatureTimestamp(header)).toBeNull()
describe('parseSignatureHeader', () => {
  const MAC = 'a'.repeat(64)

  it('parses the timestamp and every v1 entry', () => {
    expect(
      parseSignatureHeader(`t=${T},v1=${MAC},v1=${'b'.repeat(64)}`)
    ).toEqual({
      timestamp: T,
      signatures: [expect.any(Uint8Array), expect.any(Uint8Array)],
    })
  })

  it.each([
    ['null', null],
    ['an empty header', ''],
    ['the legacy sha256= form', `sha256=${MAC}`],
    ['no timestamp', `v1=${MAC}`],
    ['a non-numeric timestamp', `t=12x,v1=${MAC}`],
    ['no v1 entry', `t=${T}`],
    ['a MAC that is not 32 bytes', `t=${T},v1=${'a'.repeat(62)}`],
  ])('returns null for %s', (_label, header) => {
    expect(parseSignatureHeader(header)).toBeNull()
  })

  it('agrees with verifyWebhookSignature on well-formed headers', async () => {
    const header = await signWebhookPayload(SECRET, BODY, T)
    expect(parseSignatureHeader(header)?.timestamp).toBe(T)
    await expect(
      verifyWebhookSignature(SECRET, BODY, header, { now: T })
    ).resolves.toEqual({ valid: true, timestamp: T })
  })
})
