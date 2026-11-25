/**
 * Header carrying the delivery signature, Stripe-style:
 * `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`.
 *
 * Signing the timestamp together with the body lets receivers reject replays
 * of a captured delivery once it is older than their tolerance window. The
 * format must match the one emitted by tx-watch-core.
 */
export const SIGNATURE_HEADER = 'X-TxWatch-Signature'

/** Default replay window receivers should accept, in seconds (5 minutes). */
export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300

/**
 * Default grace period during which a rotated-out webhook secret keeps being
 * accepted, in seconds (24 hours). During this window deliveries are signed
 * with both the current and the previous secret so receivers can be
 * redeployed without dropping events.
 */
export const DEFAULT_SECRET_ROTATION_GRACE_SECONDS = 24 * 60 * 60

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join(
    ''
  )

const fromHex = (hex: string): Uint8Array | null => {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++)
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** A v1 MAC is an HMAC-SHA256 digest: 32 bytes, 64 hex characters. */
const SIGNATURE_MAC_HEX = /^[0-9a-f]{64}$/i

const enc = new TextEncoder()

function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage]
  )
}

/** Generates a random 32-byte webhook signing secret (hex, prefixed "whsec_"). */
export function generateWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `whsec_${toHex(bytes.buffer)}`
}

/**
 * Computes the X-TxWatch-Signature value for a raw request body.
 *
 * When `previousSecret` is supplied (i.e. a rotation is in its grace period)
 * the header carries two `v1=` entries: one for the current secret and one for
 * the previous secret, so receivers holding either secret keep verifying.
 *
 * @param timestamp Unix time in seconds; defaults to now.
 */
export async function signWebhookPayload(
  secret: string,
  body: string,
  timestamp: number = Math.floor(Date.now() / 1000),
  previousSecret?: string | null
): Promise<string> {
  const t = Math.floor(timestamp)
  const data = enc.encode(`${t}.${body}`)
  const sign = async (s: string): Promise<string> => {
    const key = await hmacKey(s, 'sign')
    return toHex(await crypto.subtle.sign('HMAC', key, data))
  }
  const entries = [`v1=${await sign(secret)}`]
  if (previousSecret && previousSecret !== secret) {
    entries.push(`v1=${await sign(previousSecret)}`)
  }
  return `t=${t},${entries.join(',')}`
}

/**
 * Returns the previous secret to sign with, or null when no rotation is in
 * progress or its grace window has elapsed.
 * @param now Unix time in seconds; defaults to now.
 */
export function activePreviousSecret(
  previousSecret: string | null | undefined,
  previousSecretExpiresAt: number | null | undefined,
  now: number = Math.floor(Date.now() / 1000)
): string | null {
  if (!previousSecret || previousSecretExpiresAt == null) return null
  return now < previousSecretExpiresAt ? previousSecret : null
}

/**
 * Strict form of the header the dashboard emits: one timestamp and one
 * 64-hex `v1` MAC, `t=<unix seconds>,v1=<hex>`.
 */
const SIGNATURE_HEADER_FORMAT = /^t=(\d{1,12}),v1=[0-9a-f]{64}$/

/**
 * Parses a dashboard-built X-TxWatch-Signature value and returns its `t=`
 * timestamp (Unix seconds), or null if it is not in the strict
 * `t=<seconds>,v1=<64 hex>` form. Does not check the MAC.
 */
export function parseSignatureTimestamp(header: string): number | null {
  const match = SIGNATURE_HEADER_FORMAT.exec(header)
  return match ? Number(match[1]) : null
/** A parsed X-TxWatch-Signature header; `signatures` holds every v1 MAC. */
export interface ParsedSignatureHeader {
  timestamp: number
  signatures: Uint8Array[]
}

/**
 * Parses a `t=<unix>,v1=<hex>[,v1=<hex>...]` header. Returns null when the
 * timestamp is missing or not digits, or when no v1 entry is a 32-byte hex MAC.
 * Shared by the receiver-side verifier and the test-webhook proxy, so both
 * agree on what a well-formed signature looks like.
 */
export function parseSignatureHeader(
  header: string | null | undefined
): ParsedSignatureHeader | null {
  let timestamp: number | null = null
  const signatures: Uint8Array[] = []
  for (const part of (header ?? '').split(',')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (name === 't' && /^\d+$/.test(value)) timestamp = Number(value)
    else if (name === 'v1' && SIGNATURE_MAC_HEX.test(value)) {
      const bytes = fromHex(value)
      if (bytes) signatures.push(bytes)
    }
  }
  if (timestamp === null || signatures.length === 0) return null
  return { timestamp, signatures }
}

export type SignatureVerification =
  | { valid: true; timestamp: number }
  | { valid: false; reason: 'malformed' | 'stale' | 'mismatch' }

export interface VerifyWebhookSignatureOptions {
  /** Maximum allowed age (and clock skew), in seconds. Default 300. */
  toleranceSeconds?: number
  /** Current Unix time in seconds; injectable for tests. */
  now?: number
}

/**
 * Verifies an X-TxWatch-Signature header against the raw request body.
 * Rejects headers whose timestamp is outside the tolerance window (replays),
 * and compares MACs in constant time. Any of several `v1` entries may match,
 * to allow secret rotation.
 */
export async function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string | null | undefined,
  {
    toleranceSeconds = DEFAULT_SIGNATURE_TOLERANCE_SECONDS,
    now = Math.floor(Date.now() / 1000),
  }: VerifyWebhookSignatureOptions = {}
): Promise<SignatureVerification> {
  const parsed = parseSignatureHeader(header)
  if (!parsed) return { valid: false, reason: 'malformed' }
  const { timestamp, signatures } = parsed
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return { valid: false, reason: 'stale' }
  }

  const key = await hmacKey(secret, 'verify')
  const data = enc.encode(`${timestamp}.${body}`)
  for (const sig of signatures) {
    // subtle.verify compares in constant time.
    if (await crypto.subtle.verify('HMAC', key, sig, data)) {
      return { valid: true, timestamp }
    }
  }
  return { valid: false, reason: 'mismatch' }
}
