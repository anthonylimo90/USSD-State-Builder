# Versioned traces and fixtures

Schema version 1 is the shared contract for local workbench inspection, future test export, and operational event aggregation. It records **one completed runtime turn**, with no raw user input, provider payload, phone number, session ID/data, response body, exception, PIN, or external response body. The schema is available through CommonJS, ESM, and TypeScript declarations. A future schema change that renames or changes the meaning of a field requires a new `schemaVersion`; readers should reject unknown versions rather than guess.

```js
const { createTraceObserver } = require('ussd-state-builder');
machine.useTurnObserver(createTraceObserver(event => events.push(event)));
```

The callback receives a validated, bounded JSON-compatible event. It should return synchronously; observer exceptions are isolated by the runtime, but a rejected Promise is not awaited. With `TurnGateway`, prepared turns stage their observer notifications until after the atomic receipt commit. Replayed gateway receipts do not execute or emit another runtime turn. A direct `processInput()` call is still a turn, including an internally replayed terminal response.

## Turn event

| Field | Meaning |
| --- | --- |
| `schemaVersion`, `eventType` | `1`, `"turn"` |
| `occurredAt` | UTC ISO timestamp after processing |
| `flowVersion` | Explicit application flow version, or `null` for an unversioned flow |
| `requestId`, `turnId` | Generated opaque UUIDs for this observation; they do not contain provider or session identifiers |
| `previousState`, `nextState` | Static state identifiers, or `null` for no known/active state; terminal and completed replay have `nextState: null` |
| `outcome` | `success`, `validation_error`, `error`, `blocked`, `replay`, or `flow_restart` |
| `durationMs` | Full runtime turn duration, rounded to integer milliseconds |
| `errorClass` | `validation`, `timeout`, `storage`, `provider`, `handler`, `unknown`, or `null` for a non-error outcome |

The core runtime currently classifies validation and abort errors; all other thrown errors are `unknown`. It never derives a class from an exception message. Application integrations may classify errors before calling `createTraceEvent`, but must not add arbitrary fields. Generated request/turn UUIDs identify observations, **not stable logical provider requests**; P4-01 will define stable deduplication and late-event identity at the gateway. Do not aggregate these generated IDs as stable request or session keys.

`createTraceEvent` rejects unknown fields and versions, invalid UUIDs, malformed state/version identifiers, mismatched error outcomes, and events larger than 2,048 UTF-8 bytes. State names and flow versions are application-authored metadata: do not construct them from user input or secrets. The validation boundary also does not sanitize other custom application loggers; redact those separately.

## Fixture format

`createReplayFixture` validates a `turn-sequence` JSON object with `schemaVersion: 1`, `caseId`, `flowVersion`, `clock.startMs`, and 1–64 turns. `clock.startMs` is an absolute Unix epoch millisecond timestamp. Each turn has a nondecreasing relative `atMs`, an input, up to 16 external response descriptors, and an expected outcome/state. External `atMs` values are relative to the same clock; each descriptor has a named operation, `success` or `error`, an HTTP status or `null`, and a response reference or `null`. The full fixture is limited to 65,536 UTF-8 bytes. Unknown fields are rejected at every level.

There are two explicit provenance modes:

- `synthetic`: every turn input uses `{ "kind": "synthetic", "value": "..." }`. An external descriptor names an **author-created fake** through `responseRef`. The fake response implementation is supplied by the future replay runner; no real response body belongs in this file. This mode may become a runnable deterministic test when P3-04 adds time and effect injection.
- `captured-redacted`: every input uses `{ "kind": "redacted", "alias": "input-alias-1" }` and every external `responseRef` is `null`. It retains timing, operation and status shape only. It is evidence for reproducing a dependency pattern, **not an executable replay**. Before turning it into a test, a developer must explicitly replace aliases and dependencies with synthetic choices and fake responses.

See [synthetic-order.json](../tests/fixtures/traces/synthetic-order.json) and [captured-redacted.json](../tests/fixtures/traces/captured-redacted.json). Both are hand-authored examples; the latter contains no actual provider capture. Synthetic inputs are bounded to 160 characters and reject control characters and common Kenyan mobile-number forms as a guardrail, but no validator can prove arbitrary text is synthetic. Never copy live input, output, exception text, external response bodies, phone numbers, PINs, tokens, or session data into either fixture mode. Keep any real capture in the separate, controlled capture workflow described by the [Africa's Talking contract](AFRICAS-TALKING-CONTRACT.md).

The fixture format is deliberately a data contract. The [local workbench](LOCAL-WORKBENCH.md) consumes these events for turn history, and P3-04 will implement deterministic playback and Jest export. A validated fixture alone does not execute a flow or reproduce captured external effects.
