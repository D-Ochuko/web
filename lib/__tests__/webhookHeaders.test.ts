import {
  WEBHOOK_HEADERS_MAX_COUNT,
  maskWebhookHeaderValue,
  parseWebhookHeaders,
  selectTestDeliveryHeaders,
} from '@/lib/webhookHeaders'

describe('parseWebhookHeaders', () => {
  it('returns an empty map when headers are absent', () => {
    expect(parseWebhookHeaders(undefined)).toEqual({})
    expect(parseWebhookHeaders(null)).toEqual({})
  })

  it('keeps valid headers and trims names and values', () => {
    expect(parseWebhookHeaders({ ' Authorization ': ' Bearer abc ' })).toEqual({
      Authorization: 'Bearer abc',
    })
  })

  it.each([
    ['a non-object', 'Authorization: x'],
    ['an array', ['Authorization']],
    ['a non-string value', { Authorization: 42 }],
    ['an empty value', { Authorization: '   ' }],
    ['an invalid name', { 'Bad Name': 'x' }],
    ['a reserved header', { Host: 'evil.example' }],
    ['a reserved header in any case', { 'content-LENGTH': '0' }],
    ['the signature header', { 'X-TxWatch-Signature': 'x' }],
    ['a hop-by-hop header', { 'Transfer-Encoding': 'chunked' }],
    ['a value with a line break', { 'X-Key': 'a\r\nInjected: 1' }],
    ['a value over the length limit', { 'X-Key': 'x'.repeat(513) }],
    ['duplicate names in different case', { 'X-Key': 'a', 'x-key': 'b' }],
  ])('rejects %s', (_label, value) => {
    expect(parseWebhookHeaders(value)).toBeNull()
  })

  it('rejects more headers than the per-contract limit', () => {
    const many = Object.fromEntries(
      Array.from({ length: WEBHOOK_HEADERS_MAX_COUNT + 1 }, (_, i) => [
        `X-H${i}`,
        'v',
      ])
    )
    expect(parseWebhookHeaders(many)).toBeNull()
  })
})

describe('maskWebhookHeaderValue', () => {
  it('hides short values entirely', () => {
    expect(maskWebhookHeaderValue('secret')).toBe('••••••••')
  })

  it('shows only the last four characters of longer values', () => {
    expect(maskWebhookHeaderValue('Bearer abcdef1234')).toBe('••••••••1234')
  })

  it('does not reveal the value length', () => {
    expect(maskWebhookHeaderValue('a'.repeat(9))).toBe(
      maskWebhookHeaderValue('a'.repeat(300))
    )
  })
})

describe('selectTestDeliveryHeaders', () => {
  it('keeps allow-listed names regardless of case', () => {
    expect(
      selectTestDeliveryHeaders({ AUTHORIZATION: 'Bearer t', 'X-Api-Key': 'k' })
    ).toEqual({ AUTHORIZATION: 'Bearer t', 'X-Api-Key': 'k' })
  })

  it('drops names that are not on the allow-list', () => {
    expect(
      selectTestDeliveryHeaders({ 'X-Custom': 'v', Host: 'evil.example' })
    ).toEqual({})
  })

  it('drops allow-listed names whose values are unsafe', () => {
    expect(selectTestDeliveryHeaders({ Authorization: 'a\nb' })).toEqual({})
  })

  it('returns an empty map for non-object input', () => {
    expect(selectTestDeliveryHeaders(undefined)).toEqual({})
    expect(selectTestDeliveryHeaders(['Authorization'])).toEqual({})
    expect(selectTestDeliveryHeaders('Authorization')).toEqual({})
  })
})
