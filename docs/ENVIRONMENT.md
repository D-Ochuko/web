# Environment variables

Copy `.env.example` to `.env.local` and set only what you need. Every variable is optional: with an empty `.env.local` the app runs in browser-only mode against the public Stellar networks.

Variables prefixed `NEXT_PUBLIC_` are inlined into the browser bundle at build time, so they are visible to every visitor. Never put secrets in them. Changing any variable needs a dev-server restart or a rebuild.

## Backend

| Variable              | Required | Default      | Purpose                                                                                                                                                                                                              |
| --------------------- | -------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | No       | empty string | Base URL of the `stellar-txwatch-core` API. When empty the app is in localStorage-only mode: contracts and alerts stay in the browser and no sync requests are made. Its origin is also added to the CSP allow-list. |

## Stellar network endpoints

Per-network variables win over the global one. When none is set the official public endpoint for that network is used. Each configured origin is added to the Content-Security-Policy `connect-src` list.

| Variable                                                          | Required | Default                                       | Purpose                            |
| ----------------------------------------------------------------- | -------- | --------------------------------------------- | ---------------------------------- |
| `NEXT_PUBLIC_HORIZON_URL`                                         | No       | official Horizon for each network             | Horizon URL for every network.     |
| `NEXT_PUBLIC_HORIZON_URL_MAINNET` / `_TESTNET` / `_FUTURENET`     | No       | `horizon.stellar.org` and its test variants   | Horizon URL for one network.       |
| `NEXT_PUBLIC_SOROBAN_RPC_URL`                                     | No       | default RPC for each network                  | Soroban RPC URL for every network. |
| `NEXT_PUBLIC_SOROBAN_RPC_URL_MAINNET` / `_TESTNET` / `_FUTURENET` | No       | gateway.fm (mainnet), SDF endpoints otherwise | Soroban RPC URL for one network.   |

If an endpoint is unreachable, lookups such as contract verification report "unavailable" and never block saving.

## Block explorer links

| Variable                                     | Required | Default        | Purpose                                                                  |
| -------------------------------------------- | -------- | -------------- | ------------------------------------------------------------------------ |
| `NEXT_PUBLIC_EXPLORER_URL_TEMPLATE_TX`       | No       | stellar.expert | Link template for transactions. Needs `{hash}`; `{network}` is optional. |
| `NEXT_PUBLIC_EXPLORER_URL_TEMPLATE_CONTRACT` | No       | stellar.expert | Link template for contracts. Same placeholders.                          |

Templates must be `http(s)` URLs that contain `{hash}`. An invalid template is ignored and the default is used. Custom networks only get explorer links when a template is set.

## Security and diagnostics

| Variable        | Required | Default | Purpose                                                                                                                                        |
| --------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENABLE_HSTS`   | No       | unset   | Set to `true` for production deployments served over HTTPS to add the conditional `Strict-Transport-Security` header. Read on the server only. |
| `DEBUG_STORAGE` | No       | unset   | Set to `true` to log storage read and write problems outside development builds.                                                               |

`NODE_ENV` is set by Next.js and should not be set by hand.

## What happens when a variable is missing

- No `NEXT_PUBLIC_API_URL`: browser-only mode, nothing is synced.
- No network overrides: public Horizon and Soroban RPC endpoints are used.
- No explorer templates: stellar.expert links are used.
- No `ENABLE_HSTS`: only the conditional production HSTS header is skipped; the other security headers in `next.config.mjs` are always sent.
