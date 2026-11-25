import { test, expect } from '@playwright/test'
import { buildTestWebhookPayload } from '../lib/api'
import { signWebhookPayload } from '../lib/webhookSignature'

const CONTRACT_ID = 'CDSO4GGZH7KBUQYKOIQDCMCFSRYEPOVDUX7Z4IB5TWNTLT2GDRKDQOYR'
const SECRET = 'whsec_e2e_proxy_signature_check'

// The dashboard signs test payloads in the browser (`t=<unix>,v1=<hex>`) and
// sends only the signature to the proxy. These tests exercise the real
// /api/test-webhook route with no mocking.
test.describe('test-webhook proxy with a signing secret', () => {
  const body = JSON.stringify(
    buildTestWebhookPayload({ contractId: CONTRACT_ID, network: 'testnet' })
  )

  test('accepts a browser-signed t=,v1= signature', async ({ request }) => {
    const signature = await signWebhookPayload(SECRET, body)
    const res = await request.post('/api/test-webhook', {
      headers: { 'sec-fetch-site': 'same-origin' },
      data: { url: 'https://example.com/webhook', body, signature },
    })

    const json = await res.json()
    // The signature must pass the proxy's shape check. Delivery itself may
    // still fail offline (DNS), which is a different error.
    expect(json.error).not.toBe('Invalid signature')
    expect(res.status()).not.toBe(413)
  })

  test('still rejects the retired sha256= signature format', async ({
    request,
  }) => {
    const res = await request.post('/api/test-webhook', {
      headers: { 'sec-fetch-site': 'same-origin' },
      data: {
        url: 'https://example.com/webhook',
        body,
        signature: `sha256=${'a'.repeat(64)}`,
      },
    })

    expect(res.status()).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'Invalid signature' })
  })
})
