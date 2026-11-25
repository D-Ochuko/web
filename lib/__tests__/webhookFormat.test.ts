import {
  formatWebhookBody,
  suggestWebhookFormat,
  summarizeAlert,
} from '@/lib/webhookFormat'
import type { AlertPayload } from '@/types'

const alert: AlertPayload = {
  label: 'Treasury',
  contract_id: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
  network: 'testnet',
  rule_triggered: 'LargeTransfer',
  transaction_hash: 'ab'.repeat(32),
  amount: 1000,
  timestamp: 1700000000000,
  horizon_link: 'https://horizon-testnet.stellar.org/transactions/abab',
  is_test: true,
}

describe('suggestWebhookFormat', () => {
  it.each([
    ['https://hooks.slack.com/services/T000/B000/XXXX', 'slack'],
    ['https://discord.com/api/webhooks/1/abc', 'discord'],
    ['https://DISCORDAPP.COM/api/webhooks/1/abc', 'discord'],
    ['https://canary.discord.com/api/webhooks/1/abc', 'discord'],
    ['https://example.com/hook', 'json'],
    ['https://hooks.slack.com.evil.example/hook', 'json'],
    ['not a url', 'json'],
    ['', 'json'],
  ])('suggests the format for %s', (url, expected) => {
    expect(suggestWebhookFormat(url)).toBe(expected)
  })
})

describe('formatWebhookBody', () => {
  it('sends the raw alert for json', () => {
    expect(formatWebhookBody(alert, 'json')).toBe(JSON.stringify(alert))
  })

  it('wraps the summary in a Slack text body', () => {
    const parsed = JSON.parse(formatWebhookBody(alert, 'slack'))
    expect(Object.keys(parsed)).toEqual(['text'])
    expect(parsed.text).toBe(summarizeAlert(alert))
  })

  it('wraps the summary in a Discord content body', () => {
    const parsed = JSON.parse(formatWebhookBody(alert, 'discord'))
    expect(Object.keys(parsed)).toEqual(['content'])
    expect(parsed.content).toBe(summarizeAlert(alert))
  })

  it('is deterministic for the same alert', () => {
    expect(formatWebhookBody(alert, 'slack')).toBe(
      formatWebhookBody({ ...alert }, 'slack')
    )
  })
})

describe('summarizeAlert', () => {
  it('includes the rule, contract, transaction and link', () => {
    const text = summarizeAlert(alert)
    expect(text).toContain('TxWatch test alert: LargeTransfer')
    expect(text).toContain(`Contract: Treasury (${alert.contract_id})`)
    expect(text).toContain(`Transaction: ${alert.transaction_hash}`)
    expect(text).toContain(`Horizon: ${alert.horizon_link}`)
    expect(text).toContain('Amount: 1000 XLM')
  })

  it('omits function and amount lines when the alert has none', () => {
    const text = summarizeAlert({
      ...alert,
      amount: undefined,
      function_name: undefined,
    })
    expect(text).not.toContain('Amount:')
    expect(text).not.toContain('Function:')
  })
})
