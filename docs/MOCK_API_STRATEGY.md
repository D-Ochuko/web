# Mock API Strategy

This document explains what is mocked and what is real when you develop or test the dashboard without the `stellar-txwatch-core` backend.

## What is real and what is mocked

| Area                  | Without a backend                                                                   | Notes                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Contracts and alerts  | Stored in `localStorage` by `lib/storage.ts`.                                       | Nothing to mock: leave `NEXT_PUBLIC_API_URL` empty and `isApiConfigured()` is `false`, so no sync runs.   |
| Contract sync         | Skipped when no API URL is set.                                                     | With a URL, `lib/contractsApi.ts` calls the API through `apiFetch()` (see below).                         |
| Test webhook delivery | **Real.** `sendTestWebhook()` in `lib/api.ts` posts to the webhook URL you enter.   | In a production browser build it goes through the `/api/test-webhook` proxy route to avoid CORS failures. |
| Stellar lookups       | **Real.** Horizon and Soroban RPC endpoints are called (see `docs/ENVIRONMENT.md`). | Point the endpoint variables at a local node if you need isolation.                                       |
| Sample alerts         | `seedMockAlerts()` in `lib/storage.ts` writes sample alerts to `localStorage`.      | A helper for tests and manual setup; it is not wired into any page.                                       |

There is no mocked webhook endpoint on the API: the core backend does not expose one, and the dashboard never calls a `/webhook/test` route.

## Running against a mock API

Set `NEXT_PUBLIC_API_URL` in `.env.local` to point at your mock server, then restart the dev server:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
```

The only endpoints the app uses are the contract CRUD routes in `lib/contractsApi.ts`:

| Method   | Path             | Body / response                      |
| -------- | ---------------- | ------------------------------------ |
| `GET`    | `/contracts`     | `WatchedContract[]`                  |
| `POST`   | `/contracts`     | Body and response: `WatchedContract` |
| `PUT`    | `/contracts/:id` | Body and response: `WatchedContract` |
| `DELETE` | `/contracts/:id` | `204` with an empty body             |

`apiFetch()` adds an `Authorization` header when a key is configured, times out after 15 seconds, and treats a `401` as "authentication required" (see `docs/API_AUTH.md`). Errors from a non-2xx response use the JSON `message` or `error` field when present.

## Mock API Server

A minimal mock that serves the contract routes (`mock-server.js`):

```javascript
const http = require('http')

const mockContract = {
  id: 'test-123',
  label: 'Test Contract',
  contract_id: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
  network: 'testnet',
  rules: [{ type: 'LargeTransfer', threshold_xlm: 1000 }],
  webhook_url: 'https://webhook.site/test',
  created_at: Date.now(),
  updated_at: Date.now(),
}

const mockAlertPayload = {
  label: 'Test Contract',
  contract_id: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
  network: 'testnet',
  rule_triggered: 'LargeTransfer',
  transaction_hash: 'abc123def456',
  function_name: 'transfer',
  amount: 5000,
  timestamp: Date.now(),
  horizon_link: 'https://horizon-testnet.stellar.org/transactions/abc123def456',
}
const contracts = [
  {
    id: 'test-123',
    label: 'Test Contract',
    contract_id: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
    network: 'testnet',
    rules: [{ type: 'LargeTransfer', threshold_xlm: 1000 }],
    webhook_url: 'https://webhook.site/test',
    created_at: Date.now(),
    updated_at: Date.now(),
  },
]

const server = http.createServer((req, res) => {
  // The dashboard runs on another origin, so allow it.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS'
  )
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  if (req.url === '/contracts' && req.method === 'GET') {
    res.writeHead(200)
    res.end(JSON.stringify(contracts))
  } else {
    res.writeHead(404)
    res.end(JSON.stringify({ error: 'Not found' }))
  }
})

server.listen(3001, () => console.log('Mock API on :3001'))
```

Run with `node mock-server.js`. Extend it with `POST`, `PUT` and `DELETE` handlers if the flow you are working on writes contracts.

If you run the mock on a different origin, its origin must also be allowed by the Content-Security-Policy `connect-src` list; `NEXT_PUBLIC_API_URL` is added to it automatically.

## Development Workflow

1. Leave `NEXT_PUBLIC_API_URL` empty to work in browser-only mode, or point it at a mock that matches the contract routes above.
2. Develop UI components against that data.
3. When the real API is ready, update `NEXT_PUBLIC_API_URL`.
4. Tests verify the API layer handles responses correctly.

## Assumed core fields

The dashboard reads the fields below. They are optional and are not yet in
`tx-watch-core`, so the dashboard must work without them. Each one needs a
matching core change before it is relied on in production.

| Object                         | Field             | Values                                                                        | Behaviour when absent                                          |
| ------------------------------ | ----------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Alert payload (`AlertPayload`) | `delivery_status` | `success`, `failed`, `pending`                                                | No status badge. The dashboard never assumes `success` (#407). |
| Contract (`WatchedContract`)   | `webhook_headers` | Map of header name to value; at most 5 names; no hop-by-hop headers or `Host` | No custom headers are sent (#408).                             |
| Contract (`WatchedContract`)   | `webhook_format`  | `json`, `slack`, `discord`                                                    | `json`, the raw alert payload (#409).                          |

Test deliveries only send the headers on the proxy allow-list
(`authorization`, `x-api-key`, `x-auth-token`, `x-webhook-token`). Header values
are credentials; see `docs/storage-schema.md`.

## Testing

Use `apiFetch()` from `lib/api.ts` for all API calls. Mock it or `fetch` in tests with Vitest:

```typescript
import { vi } from 'vitest'

// Mock the entire api module
vi.mock('@/lib/api', () => ({
  apiFetch: vi.fn().mockResolvedValue([]),
  isApiConfigured: vi.fn().mockReturnValue(true),
}))

// Or stub fetch globally
// Or stub fetch globally; apiFetch reads the body with `res.text()`
vi.stubGlobal(
  'fetch',
  vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: [] }),
    status: 200,
    text: async () => JSON.stringify([]),
  })
)
```

See `__tests__/api.test.ts` for examples, including the timeout and abort paths.
