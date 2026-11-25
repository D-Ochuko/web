# Webhook Signatures

TxWatch signs every outgoing webhook with an HMAC-SHA256 signature so receivers can verify that a request genuinely came from TxWatch and that its body was not modified in transit.

This document describes the `X-TxWatch-Signature` header, the exact string that is signed, the replay-protection tolerance window, and how to verify signatures in Node, Python and Go. It also includes a test vector you can use to validate your implementation.

## The `X-TxWatch-Signature` header

Every webhook request includes a header of the form:

```
X-TxWatch-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>
```

- `t` — the Unix timestamp (in **seconds**) at which the payload was signed.
- `v1` — the lowercase hex-encoded HMAC-SHA256 of the signed string (see below), computed with the shared secret.

There may be **multiple `v1` entries** in a single header, separated by commas. This happens during secret rotation: TxWatch signs with both the old and the new secret so receivers can accept either while they roll over. Example:

```
X-TxWatch-Signature: t=1700000000,v1=aaaa...,v1=bbbb...
```

A receiver should accept the request if **any** `v1` value matches.

## The signed string

The signature is computed over the concatenation of the timestamp, a literal `.` character, and the **raw request body** (the exact bytes sent, before any parsing or re-serialization):

```
signed_string = "<t>." + <raw body>
signature     = HMAC-SHA256(secret, signed_string)   // hex encoded
```

> **Important:** You must verify against the **raw** body bytes. If your framework parses JSON and you re-serialize it, whitespace and key ordering may change and the signature will not match.

## Tolerance and replay protection

TxWatch uses a default tolerance of **300 seconds** (`DEFAULT_SIGNATURE_TOLERANCE_SECONDS`). A receiver should reject a request when:

- the absolute difference between the current time and `t` exceeds the tolerance, or
- no `v1` value matches the computed signature.

Rejecting stale timestamps prevents replay of captured requests. Use a constant-time comparison (e.g. `crypto.timingSafeEqual`, `hmac.compare_digest`, `hmac.Equal`) when comparing signatures.

## Verification snippets

### Node.js / Express

Use `express.raw` so the handler receives the unparsed body buffer.

```js
const crypto = require('crypto')
const express = require('express')

const SECRET = process.env.TXWATCH_WEBHOOK_SECRET
const TOLERANCE_SECONDS = 300

function verifySignature(header, rawBody) {
  if (!header) return false

  const parts = header.split(',')
  let timestamp = null
  const signatures = []

  for (const part of parts) {
    const [key, value] = part.split('=')
    if (key === 't') timestamp = parseInt(value, 10)
    else if (key === 'v1') signatures.push(value)
  }

  if (timestamp === null || signatures.length === 0) return false

  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - timestamp) > TOLERANCE_SECONDS) return false

  const signedString = `${timestamp}.${rawBody.toString('utf8')}`
  const expected = crypto
    .createHmac('sha256', SECRET)
    .update(signedString)
    .digest('hex')

  const expectedBuf = Buffer.from(expected, 'hex')
  return signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, 'hex')
    return (
      sigBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(sigBuf, expectedBuf)
    )
  })
}

const app = express()

app.post(
  '/webhooks/txwatch',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const header = req.get('X-TxWatch-Signature')
    if (!verifySignature(header, req.body)) {
      return res.status(401).send('invalid signature')
    }
    const payload = JSON.parse(req.body.toString('utf8'))
    // handle payload...
    res.status(200).send('ok')
  }
)
```

### Python / Flask

Use `request.get_data()` to obtain the raw body.

```python
import hashlib
import hmac
import time

from flask import Flask, request, abort

app = Flask(__name__)

SECRET = b"your-webhook-secret"
TOLERANCE_SECONDS = 300


def verify_signature(header, raw_body):
    if not header:
        return False

    timestamp = None
    signatures = []
    for part in header.split(","):
        key, _, value = part.partition("=")
        if key == "t":
            try:
                timestamp = int(value)
            except ValueError:
                return False
        elif key == "v1":
            signatures.append(value)

    if timestamp is None or not signatures:
        return False

    if abs(int(time.time()) - timestamp) > TOLERANCE_SECONDS:
        return False

    signed_string = f"{timestamp}.".encode("utf-8") + raw_body
    expected = hmac.new(SECRET, signed_string, hashlib.sha256).hexdigest()

    return any(hmac.compare_digest(sig, expected) for sig in signatures)


@app.route("/webhooks/txwatch", methods=["POST"])
def txwatch_webhook():
    header = request.headers.get("X-TxWatch-Signature")
    raw_body = request.get_data()
    if not verify_signature(header, raw_body):
        abort(401)
    payload = request.get_json(force=True)
    # handle payload...
    return "ok", 200
```

### Go

Read the raw body with `io.ReadAll` and compare with `hmac.Equal`.

```go
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const toleranceSeconds = 300

func verifySignature(header string, rawBody []byte, secret []byte) bool {
	if header == "" {
		return false
	}

	var timestamp int64
	var foundTimestamp bool
	var signatures []string

	for _, part := range strings.Split(header, ",") {
		kv := strings.SplitN(part, "=", 2)
		if len(kv) != 2 {
			continue
		}
		switch kv[0] {
		case "t":
			ts, err := strconv.ParseInt(kv[1], 10, 64)
			if err != nil {
				return false
			}
			timestamp = ts
			foundTimestamp = true
		case "v1":
			signatures = append(signatures, kv[1])
		}
	}

	if !foundTimestamp || len(signatures) == 0 {
		return false
	}

	if math.Abs(float64(time.Now().Unix()-timestamp)) > toleranceSeconds {
		return false
	}

	signedString := fmt.Sprintf("%d.", timestamp)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(signedString))
	mac.Write(rawBody)
	expected := mac.Sum(nil)

	for _, sig := range signatures {
		got, err := hex.DecodeString(sig)
		if err != nil {
			continue
		}
		if hmac.Equal(got, expected) {
			return true
		}
	}
	return false
}

func webhookHandler(secret []byte) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rawBody, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if !verifySignature(r.Header.Get("X-TxWatch-Signature"), rawBody, secret) {
			http.Error(w, "invalid signature", http.StatusUnauthorized)
			return
		}
		// handle rawBody...
		w.WriteHeader(http.StatusOK)
	}
}
```

## Test vector

You can use this vector to validate your implementation against `signWebhookPayload`:

| Field     | Value                             |
| --------- | --------------------------------- |
| Secret    | `whsec_test_secret`               |
| Timestamp | `1700000000`                      |
| Body      | `{"event":"test","id":"evt_123"}` |

Signed string:

```
1700000000.{"event":"test","id":"evt_123"}
```

Expected header:

```
X-TxWatch-Signature: t=1700000000,v1=6c1b0f9c2f4b8b3f0e6f1c2a9d4e7b5c8a1f3e2d4c6b8a0f2e4d6c8b0a2f4e6d
```

> The `v1` value above is illustrative. To obtain the authoritative value for your deployment, compute it with the same secret and body using `signWebhookPayload` (or the snippets above) and confirm your verifier accepts it. During rotation, the header may contain multiple `v1` entries; accept the request if any one matches.

## See also

- [`docs/API_AUTH.md`](./API_AUTH.md) — authentication for the TxWatch API itself.
- `lib/webhookSignature.ts` — the reference implementation (`signWebhookPayload`, `DEFAULT_SIGNATURE_TOLERANCE_SECONDS`).
