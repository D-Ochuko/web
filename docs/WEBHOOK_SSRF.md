# Webhook SSRF protection

A contract's `webhook_url` is user-supplied. Anything that sends an HTTP request to it from a server (today the test-webhook proxy, later a server-side alert sender) can be pointed at internal addresses such as `127.0.0.1`, a private network, or a cloud metadata endpoint (`169.254.169.254`). This page records the controls that exist, and the checklist any server-side sender must meet before it ships.

## What is in place today

The only server-side sender is the test-webhook proxy at `app/api/test-webhook/route.ts`, backed by `lib/webhookProxy.ts` and `lib/ipRanges.ts`.

| Control                  | Where                                               | Behaviour                                                                                                                                             |
| ------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheme allow-list        | `route.ts`                                          | Only `http:` and `https:` are accepted.                                                                                                               |
| Host classification      | `classifyHost()` in `lib/ipRanges.ts`               | `localhost`, `*.localhost` and IP literals outside global unicast (loopback, private, link-local, CGNAT, documentation, multicast, ...) are rejected. |
| DNS resolution check     | `resolvePublicAddresses()` in `lib/webhookProxy.ts` | Every address a hostname resolves to must be public; one private answer rejects the request.                                                          |
| DNS rebinding protection | `vettedLookup` in `lib/webhookProxy.ts`             | The socket connects only to addresses vetted in the same lookup, so a changed DNS answer between check and connect cannot reach a private address.    |
| No redirects             | `deliverWebhook()` in `lib/webhookProxy.ts`         | Redirect responses are returned as-is and never followed, so a public URL cannot bounce the request to an internal one.                               |
| Timeout and body limit   | `deliverWebhook()`                                  | The request has a deadline and only a small snippet of the response body is read.                                                                     |
| Rate limiting            | `createRateLimiter()` in `lib/webhookProxy.ts`      | Fixed-window limit per client address (in memory, per server instance).                                                                               |
| Client-side pre-check    | `validateWebhookUrl()` in `lib/stellar.ts`          | The form rejects private and loopback targets early; this is a convenience, not a security boundary.                                                  |

Tests: `__tests__/testWebhookProxy.test.ts`, `__tests__/testWebhookRoute.test.ts`, `lib/__tests__/webhookProxy.test.ts` and `lib/__tests__/ipRanges.test.ts`.

## Checklist for a future server-side alert sender

A sender that delivers real alerts must reuse the same building blocks rather than re-implementing them:

1. Validate the URL scheme and run `classifyHost()` when the webhook is saved **and** again on every delivery, since DNS answers change.
2. Deliver through `deliverWebhook()` (or an equivalent that uses `vettedLookup`) so the connection is pinned to vetted public addresses.
3. Never follow redirects.
4. Set a short timeout and cap the response size read.
5. Do not forward user cookies, API keys or other credentials to the webhook target. Sign the payload (`lib/webhookSignature.ts`) instead.
6. Rate limit per contract and per destination, and back off after repeated failures so the sender cannot be used to hammer a third party.
7. If outbound traffic runs inside a cloud or cluster network, also block metadata and internal ranges at the network layer (egress rules); application checks are a second line of defence.
8. Log blocked attempts without logging payloads or secrets.
