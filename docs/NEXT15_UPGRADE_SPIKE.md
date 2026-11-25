# Next.js 15 / React 19 upgrade spike

Tracks the evaluation of moving off `next@14.2.35` and `react@^18`. This is a
plan, not a migration: nothing here changes the dependency versions.

## Why evaluate

- Upstream security and bug fixes land on the current major first; staying on 14
  long-term means backporting or going without them.
- Next 15 pairs with React 19 and changes several defaults the app relies on.
- `eslint-config-next` for newer Next versions expects ESLint 9 flat config, so
  the two upgrades should be planned together (see the ESLint note below).

## Areas to review before bumping

| Area               | Change in Next 15 / React 19                                                                                 | Where it touches this app                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Async request APIs | `cookies()`, `headers()`, `params` and `searchParams` become async.                                          | `app/contracts/[id]/page.tsx` (route `params`), `app/api/test-webhook/route.ts`, `middleware.ts`.                            |
| Caching defaults   | `fetch` requests, `GET` route handlers and the client router cache are no longer cached by default.          | `app/api/test-webhook/route.ts`; the app is otherwise client-rendered from `localStorage`, so impact should be small.        |
| React 19           | `ref` as a prop, `use`, new `act` import location, removed legacy APIs.                                      | No `forwardRef` usage today; re-check during the codemod run. `@testing-library/react` must also move to a React 19 release. |
| Testing libraries  | `@testing-library/react@^14` targets React 18.                                                               | All component tests under `__tests__/`.                                                                                      |
| Wallet and SDK     | Confirm `@stellar/freighter-api` and `@stellar/stellar-sdk` work with React 19 and the new bundler defaults. | `lib/freighter.ts`, `lib/stellar.ts`, `lib/contractExists.ts`.                                                               |
| CSP and nonces     | Re-verify that the per-request nonce set in `middleware.ts` still reaches Next's inline scripts.             | `middleware.ts`, `next.config.mjs`, `__tests__/middlewareCsp.test.ts`.                                                       |

## Suggested approach

1. Branch off `main` and run the official codemod (`npx @next/codemod@canary upgrade latest`) to see the size of the change before committing to it.
2. Upgrade `next`, `react`, `react-dom`, `@types/react` and `@types/react-dom` together; bump `eslint-config-next` to the same Next version.
3. Move to ESLint 9 with a flat config in the same pull request, since the new `eslint-config-next` requires it.
4. Update `@testing-library/react` (and `@testing-library/user-event` if needed), then run unit tests, the Playwright e2e suite and the testnet smoke workflow.
5. Check the production build output, bundle size and CSP headers against the current baseline before merging.

## Exit criteria

- Lint, type-check, unit tests, e2e tests and the build all pass on Next 15 / React 19.
- No regression in the CSP headers or the wallet connection flow.
- Any behaviour changes caused by the new caching defaults are documented here.
