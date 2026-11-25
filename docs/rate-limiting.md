# Rate limiting the test-webhook proxy

`POST /api/test-webhook` allows 10 requests per minute per client IP.

## Client IP

The limit is keyed on the client address resolved by `lib/clientIp.ts`:

- The socket address (`req.ip`) is used by default. `X-Forwarded-For` is
  ignored, because clients can set it to anything.
- Behind a reverse proxy or load balancer, set `TRUSTED_PROXY_HOPS` to the
  number of proxies between the internet and the app. Each trusted proxy
  appends the address it received the request from, so the client is the
  entry that many places from the right. Entries further left were supplied
  by the client and are ignored.

| Deployment                                           | `TRUSTED_PROXY_HOPS` |
| ---------------------------------------------------- | -------------------- |
| App served directly (`next start`, dev)              | unset (`0`)          |
| One load balancer or CDN in front, which appends XFF | `1`                  |
| Two proxies in front (e.g. CDN then load balancer)   | `2`                  |

Set it only when the proxies in front overwrite or append to
`X-Forwarded-For`. If the app is reachable without the proxy, a client can
bypass the proxy and spoof the header, so leave it unset in that case.
Invalid values are treated as `0`.

## Shared store across instances

The default limiter counts in memory, per process. On serverless platforms or
with several app instances, each instance keeps its own window, so a client can
make up to 10 requests per instance per minute.

To enforce one limit across instances, implement `RateLimitStore` from
`lib/rateLimit.ts` over a shared store and pass it to `createRateLimiter`:

```ts
import { createRateLimiter, type RateLimitStore } from '@/lib/rateLimit'

const redisStore: RateLimitStore = {
  async hit(key, windowMs, now) {
    // Atomically increment the window's counter and expire it after windowMs.
    // Key the counter by the window start so windows do not overlap.
    const windowStart = Math.floor(now / windowMs) * windowMs
    const count = await redis.incr(`rl:${key}:${windowStart}`)
    if (count === 1) await redis.pexpire(`rl:${key}:${windowStart}`, windowMs)
    return { count, windowStart }
  },
}

const rateLimit = createRateLimiter(10, 60_000, redisStore)
```

The increment must be atomic (for example Redis `INCR`), otherwise concurrent
requests can slip past the limit. Pass the store in
`app/api/test-webhook/route.ts`, in place of the default.
