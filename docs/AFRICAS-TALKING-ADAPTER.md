# Africa's Talking provider adapter

P2-03 provides a framework-neutral wire adapter and an optional Mavuno demo endpoint. The contract comes from [documented provider behavior](AFRICAS-TALKING-CONTRACT.md) and [sanitized sandbox interactive captures](../tests/fixtures/africas-talking/captured/2026-09-28-manifest.md). Tests of captured aliases verify structure and transcript behavior, not real subscriber formats or authenticated provider origin. End-event delivery remains unresolved under P2-01; reconciliation belongs to P2-06.

## Library API

```javascript
const { AfricasTalkingAdapter, normalizeUssdInput } = require('ussd-state-builder');
const adapter = new AfricasTalkingAdapter({
  applicationId: 'my-application', // trusted configuration, never a body field
  serviceCode: '*384*000#'         // replace with the configured service
});
const turn = adapter.normalize({
  method: 'POST',
  contentType: 'application/x-www-form-urlencoded',
  body: 'sessionId=demo-1&phoneNumber=%2B254700000001&networkCode=99999&serviceCode=%2A384%2A000%23&text=1%2A1'
});
// turn.input === '1'; turn.transcript === '1*1'; turn.position === 2
const incremental = normalizeUssdInput('1*1', 'incremental');
// incremental.input === '1*1'; no transcript position is inferred
const response = adapter.formatResponse('CON Welcome\n1. Continue');
// { status: 200, headers: { ... }, body: 'CON Welcome\n1. Continue' }
```

`normalize()` accepts raw UTF-8 form strings or Buffers. Collect a bounded raw body before framework form middleware loses duplicate-key information. It requires POST, form media type, the five documented string fields, and the configured service. Declared charsets must be UTF-8. It rejects duplicate decoded keys, malformed escapes/UTF-8, missing/invalid identities and disallowed controls. Unknown fields are parsed for malformed/duplicate values but are not forwarded. Decoding happens once; choices, whitespace, punctuation, Unicode and empty transcript segments are preserved. A literal `*` inside a cumulative field is a transcript delimiter; the provider format supplies no separate escaping layer for an input containing that delimiter.

Every normalized turn has `provider`, `applicationId`, original `sessionId`, `serviceCode`, exact `phoneNumber`, `networkCode`, and a scoped `sessionKey`. The key is a deterministic SHA-256 digest of the schema namespace, provider, configured application/service and provider session ID. It separates applications/services and excludes the caller from key derivation so a caller change can be detected against the existing binding. It is a storage key, not authentication or an irreversible anonymization guarantee.

Call `bindSession(turn, existingBinding)` against the session's stored binding before processing a turn. It returns the binding for a new session and rejects changes to provider, application, session, service, caller or network. Persist/read it under the gateway's session lock or transaction. Phone matching defaults to an optional `+` followed by 6–15 digits with a nonzero first digit; deployments may configure `phonePattern`. Caller matching is exact. The adapter does not silently normalize different caller representations into the same binding.

`compareTranscript(turn, previousTranscript)` returns `initial`, `missing_initial`, `next`, `repeat`, `stale`, `gap` or `conflict`. It compares whole segments rather than substring prefixes: `1` → `1*1` is a new turn; `1` → `10` is a conflict. An empty initial transcript has position 0, while `1*` has position 2 and an empty newest input. Do not replay every historical segment into the existing machine.

`handle(wireRequest, processTurn)` normalizes, calls your async gateway function with the normalized turn, then formats its string or `{ response, hopMetadata? }` result. The gateway function is responsible for persisted binding, sequencing/receipts and invoking `machine.processInput(turn.sessionKey, turn.input)`. `handle()` itself stores no session state or receipts. Return its `{ status, headers, body }` directly through any HTTP framework. Optional hop labels are limited to 99 printable ASCII characters without `|`; use static non-sensitive labels.

## Bounds and HTTP behavior

| Option | Default | Meaning |
| --- | --- | --- |
| `maxBodyBytes` | 16384 | Raw form bytes; bound the HTTP reader too |
| `maxFieldLength` | 128 | UTF-16 units in each identity field |
| `maxTranscriptLength` | 4096 | UTF-16 units in accumulated text |
| `maxInputLength` | 160 | UTF-16 units in the newest input |
| `maxResponseBytes` | 16384 | UTF-8 bytes in an application menu |

All limits are positive integers; forms are also limited to 32 fields. These defaults are local resource bounds, not operator character budgets. Configure conservative menus for the intended network and verify actual operator limits during P2-07. Oversized menus fail rather than being clipped. Fixed error menus are independent of the application menu bound.

Successful menus use HTTP 200 and `Content-Type: text/plain; charset=utf-8`, with the unquoted body and `Cache-Control: no-store`. Empty/invalid prefixes, leading whitespace/BOM, disallowed controls, invalid hop labels or oversized menus fail closed.

| Failure | HTTP status |
| --- | --- |
| Invalid form, encoding, identity, input | 400 |
| Wrong configured service | 403 |
| Unsupported method | 405, `Allow: POST` |
| Session binding or transcript conflict | 409 |
| Raw body too large | 413 |
| Wrong media type/declared charset | 415 |
| Unknown application error or invalid output | 500 |

`ProviderRequestError(code, status)` lets a gateway return a controlled 400–599 status. Error bodies are fixed terminal menus and do not expose exception messages or payloads. The provider documentation treats 40X responses as termination; 500/503 retry behavior remains unverified. No retry guarantee is inferred from the HTTP status.

## Mavuno endpoint and current boundary

Enable the optional provider route with `AT_SERVICE_CODE` (and optionally `AT_APPLICATION_ID`), or pass `serviceCode`/`applicationId` to `createLiveMarket()`. See the [demo run guide](../examples/live-market/README.md). The browser's `/ussd` endpoint remains incremental JSON; `/africas-talking/ussd` accepts the cumulative provider form. Their session namespaces are separate.

The [demo controller](../examples/live-market/provider.js) uses `TurnGateway` and `RedisTurnStore`. It commits staged runtime state, data, history, flow version, revision and the HTTP response together. Known callbacks, including older transcript positions and completed sessions, replay their exact receipts without executing handlers. Unknown stale/divergent requests, gaps and expired sessions are rejected. Durable pending ownership blocks uncertain retries until explicit reconciliation or retention expiry.

See [atomic receipts and recovery](TURN-RECEIPTS.md) for retention, supported adapters, application journals and crash evidence. External business effects are separate from the Redis turn commit; the demo explicitly reconciles confirmed terminal effects from its atomic operation journal. [Deadlines and cancellation](DEADLINES-AND-RECOVERY.md) bound the provider request and fence expired owners. End-event reconciliation is available through the [separate event gateway](SESSION-END-AND-CALLBACKS.md). The optional demo event route uses a configured local Bearer-token gate; verified provider-origin controls and stable hosting are still required before production use.

## Verification

Unit tests cover synthetic wire cases, sanitized actual capture aliases, exact decoding, caller/scope binding, transcript classification, bounds and response/error formatting. Redis/HTTP tests exercise ordering with repeated inputs, restart, lookup/cancellation, conflicts, concurrent repeats, empty segments, back navigation, uncertain turns and malformed/oversized requests. Packed-package checks exercise the provider endpoint as well as the existing browser demo.
