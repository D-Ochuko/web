# File Ownership & Area Map

This document maps key files and directories to their functional areas, helping contributors understand which files to modify for specific features.

## Directory Structure & Ownership

### `/app` — Pages & Routing

| File/Directory                | Responsibility                                             |
| ----------------------------- | ---------------------------------------------------------- |
| `app/page.tsx`                | Landing page — hero, feature overview, CTA                 |
| `app/layout.tsx`              | Root layout — navigation, theme provider, global styles    |
| `app/dashboard/page.tsx`      | Dashboard — contract stats, grid view                      |
| `app/contracts/page.tsx`      | Contract list — search, filter, pagination                 |
| `app/contracts/new/page.tsx`  | Add contract form — validation, registration, webhook test |
| `app/contracts/[id]/page.tsx` | Contract detail — alert rules, webhook history, settings   |
| `app/not-found.tsx`           | 404 error page                                             |

### `/components` — Reusable UI Components

| File                   | Responsibility                                                   |
| ---------------------- | ---------------------------------------------------------------- |
| `FreighterConnect.tsx` | Wallet connection — Freighter integration, public key management |
| `ContractCard.tsx`     | Contract summary card — displays contract info, network badge    |
| `RuleBuilder.tsx`      | Alert rule configuration — form inputs for all rule types        |
| `AlertRuleBadge.tsx`   | Rule type display — badge styling and labels for each rule type  |
| `WebhookLog.tsx`       | Webhook delivery history table — status, timestamps, retry info  |
| `NetworkBadge.tsx`     | Network indicator — Mainnet/Testnet/Futurenet badge              |
| `CopyButton.tsx`       | Clipboard utility — copy contract ID, transaction hash           |
| `MobileNav.tsx`        | Mobile navigation drawer — responsive menu                       |
| `EmptyState.tsx`       | Empty list placeholder — no contracts, no rules, no history      |

### `/lib` — Business Logic & Utilities

| File                        | Responsibility                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `stellar.ts`                | Stellar integration — Horizon URLs, Soroban RPC, contract validation, explorer links                                   |
| `freighter.ts`              | Wallet integration — the only module that imports `@stellar/freighter-api` (connect, address, network, signing)        |
| `storage.ts`                | localStorage persistence — contract registry, settings, cache; see [Browser Storage Schema](docs/storage-schema.md)    |
| `api.ts`                    | Backend communication — fetch wrapper, webhook test, API calls                                                         |
| `contractsApi.ts`           | Contract API — contract-specific data fetching                                                                         |
| `contractSort.ts`           | Sorting utilities — sort contracts by various criteria                                                                 |
| `contractSync.ts`           | Contract synchronization — sync contracts with backend                                                                 |
| `dashboard.ts`              | Dashboard utilities — stats calculations, aggregations                                                                 |
| `formatAmount.ts`           | Number formatting — format tokens, amounts, decimals                                                                   |
| `format.ts`                 | General formatting — dates, addresses, hashes                                                                          |
| `importSchema.ts`           | Import/export functionality — schema validation for imports and exports (v1 contracts-only and v2 full-backup formats) |
| `notifications.ts`          | Notification handling — toast messages, alerts                                                                         |
| `ruleMeta.ts`               | Alert rule metadata — rule type definitions                                                                            |
| `storageLogger.ts`          | Storage debugging — log storage operations                                                                             |
| `webhookSignature.ts`       | Webhook verification — HMAC-SHA256 signature validation                                                                |
| `migrations.ts`             | Storage migrations — schema version management                                                                         |
| `alertSource.ts`            | Alert source utilities — alert classification                                                                          |
| `useAlerts.ts`              | React hook — alert state management                                                                                    |
| `useAnalytics.ts`           | React hook — analytics tracking                                                                                        |
| `useContracts.ts`           | React hook — contract state management                                                                                 |
| `useFreighter.ts`           | React hook — Freighter wallet interaction                                                                              |
| `useFreighterConnection.ts` | React hook — wallet connection state                                                                                   |
| `useWallet.ts`              | React hook — wallet utilities                                                                                          |
| `links.ts`                  | Centralized repository URLs — GitHub org, repo links                                                                   |

### `/hooks` — Custom React Hooks

| File                                       | Responsibility                                    |
| ------------------------------------------ | ------------------------------------------------- |
| (All hook files use `use*` naming in lib/) | Custom React hooks for state management and logic |

### `/types` — TypeScript Definitions

| File             | Responsibility                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `types/index.ts` | Shared types — mirrors Rust structs from stellar-txwatch-core (Contract, AlertRule, WebhookLog, etc.) |

### Root Configuration Files

| File                 | Responsibility                          |
| -------------------- | --------------------------------------- |
| `package.json`       | Dependencies, scripts, project metadata |
| `tsconfig.json`      | TypeScript configuration                 |
| `tailwind.config.ts` | Tailwind CSS theme, colors, spacing     |
| `next.config.mjs`    | Next.js build configuration             |
| `postcss.config.mjs` | PostCSS plugins                         |
| `.eslintrc.json`     | ESLint rules for code quality           |
| `.env.example`       | Environment variable template           |

### Documentation

| File                     | Responsibility                                                         |
| ------------------------ | ---------------------------------------------------------------------- |
| `README.md`              | Project overview, setup, tech stack, integration guide                 |
| `CONTRIBUTING.md`        | Contribution guidelines, branch naming, commit style, PR checklist    |

## Alert Polling & Notifications

Alert polling is driven by `startAlertPolling` (see `hooks/useAlertSync.ts`).

- **Foreground (visible tab):** polls at the normal interval and delivers in-page alerts plus browser notifications.
- **Background (hidden tab):** when browser notifications are enabled, polling continues at a slower interval (~2 minutes) so notifications can still arrive while the user is looking elsewhere. A single leader tab (elected via `BroadcastChannel`/`localStorage`, see #43) performs background polling to avoid duplicate notifications across tabs.
- **Known limit:** polling cannot run when the browser is fully closed, so no notifications are delivered in that case. Web Push is tracked as a follow-up to cover closed-browser delivery.
