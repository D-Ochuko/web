# Security Policy

## Supported versions

This repository has no published releases. Security fixes are made against the latest commit on the `main` branch. Other branches, forks, and locally deployed snapshots are not guaranteed to receive security updates; upgrade to the latest `main` before reporting an issue against an older deployment.

## Reporting a vulnerability

Please use [GitHub Private Vulnerability Reporting](https://github.com/Tx-wats/web/security/advisories/new) to send a report directly to the maintainers. Do not open a public GitHub issue, discussion, or pull request for an unpatched vulnerability. If private reporting is unavailable, contact a repository owner through GitHub and request a private channel without posting exploit details publicly.

Include, where possible:

- Affected component, version or commit, and deployment configuration
- A concise description of the impact and the conditions required to reproduce it
- Safe reproduction steps or a proof of concept that does not access real user data or disrupt services
- Any suggested mitigation

Do not include live webhook URLs, Slack/Discord tokens, signing secrets, access tokens, personal data, or other credentials in the report. Redact them from logs and proof-of-concept requests.

## Response expectations

Maintainers will aim to acknowledge a report within 5 business days and provide an initial assessment within 10 business days. We will keep the reporter updated about remediation progress, coordinate a reasonable disclosure date, and notify them when a fix or mitigation is available. These are response goals, not a guaranteed service level; complexity or maintainer availability may affect timelines.

Please allow maintainers a reasonable opportunity to investigate and release a fix before any public disclosure. We will credit reporters in an advisory when they agree and when doing so does not create additional risk.

## Known limitations

The following are known, accepted limitations of the current implementation. They are documented here so that operators and future contributors can reason about them; they are not considered vulnerabilities in the current read-only monitoring use case.

### Wallet connection is not signature-verified

Connecting a wallet (for example via Freighter) only reads the public key reported by the wallet extension. The app does not issue a challenge for the user to sign, so a "connected" wallet is not cryptographic proof of ownership of that account.

This is acceptable today because the app is a read-only monitoring tool: it holds no funds, and wallet identity does not grant any permissions or privileged actions. If a future feature ties permissions to wallet identity (for example, controlling who may edit a contract's rules), it must introduce a signed-challenge authentication flow before relying on the wallet address for authorization.

### Webhook URL validation is client-side only

`isValidUrl` in `lib/stellar.ts` only checks that a webhook URL uses the `http` or `https` protocol. It does not reject `localhost`, private IP ranges, link-local addresses (such as `169.254.169.254`), or other internal hosts.

Any server-side component that fetches user-supplied webhook URLs must implement its own SSRF protections (for example, resolving and validating the destination host, blocking private/link-local ranges, and restricting redirects). Do not rely on the client-side check as a security boundary.
