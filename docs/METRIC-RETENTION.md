# Metric retention and failure controls

`MetricEventBuffer` is an opt-in, bounded **in-process** evidence collector for the cohort APIs. It does not change session storage, the turn gateway or existing runtime telemetry. Applications supply correlated, redacted metric events; a trace observer alone cannot infer session starts, terminal reasons or business outcomes. See [metric definitions](METRIC-DEFINITIONS.md) and [exports](METRIC-EXPORTS-AND-DASHBOARD.md).

Run `npm run demo:metrics-retention` for an asserted synthetic journey: six started sessions → five after local deletion → zero after whole-cohort expiry → closed ingestion. It sends nothing externally.

```js
const { MetricEventBuffer, createMetricOtelBridge } = require('ussd-state-builder');
// meter comes from an application-owned OpenTelemetry MeterProvider.
const bridge = createMetricOtelBridge(meter, { maxSeries: 32768 });
const buffer = new MetricEventBuffer({
  flowVersions: ['mavuno-v1'],
  states: ['START', 'MENU', 'QUANTITY', 'DONE'],
  retentionMs: 60 * 60 * 1000,
  maxEvents: 10000,
  maxSessions: 1000,
  maxBytes: 8 * 1024 * 1024,
  maxTombstones: 4096,
  exportTimeoutMs: 5000,
  exporter(snapshot, { signal, isCurrent }) {
    if (!signal.aborted && isCurrent()) bridge.update([...snapshot.events], snapshot.options);
  },
  onFailure({ code }) { console.warn('Metric collector failure:', code); }
});
// metricEvent must use keyed pseudonyms and static authored labels.
const result = buffer.record(metricEvent); // Never throws; inspect accepted/reason.
await buffer.flush(); // Call from application scheduling, outside the USSD response path.
// Application deletion uses the same pseudonymous session identity:
buffer.deleteSession(pseudonymousSessionId);
await buffer.flush(); // Correct the next gauge snapshot.
// On shutdown, after outstanding application work has been stopped:
buffer.close();
bridge.close();
await meterProvider.shutdown();
```

## Bounds and retention

| Control | Default | Allowed range / behavior |
| --- | --- | --- |
| `flowVersions`, `states` | Required | Authored arrays, at most 128 / 1,024 entries; UUID-shaped and phone-like numeric labels are refused. Null/unknown structural labels remain allowed. |
| `retentionMs` | 3,600,000 | 1–31,536,000,000 ms; whole session expires at its earliest retained event time plus retention. |
| `maxEvents` | 10,000 | 1–100,000 envelopes; exact event-ID duplicates consume no additional slot. |
| `maxBytes` | 8,388,608 | 2,048–67,108,864 bytes of serialized events, separate from object/Map overhead. |
| `maxSessions` | 1,000 | 1–100,000 distinct retained session identities. |
| `maxTombstones` | 4,096 | 1–100,000 deletion/expiry identities. Overflow permanently pauses ingestion for this instance. |
| `exportTimeoutMs` | 5,000 | 1–60,000 ms public flush deadline. |
| `maxFutureSkewMs` | 0 | 0–60,000 ms admission tolerance; future evidence still stays out of reports until its timestamp. |
| `inactivityMs` | null | Opt-in inferred abandonment, 1–2,147,483,647 ms; independent of retention. |
| `now` | `Date.now` | Injected nonnegative integer epoch milliseconds. Clock regression cannot restore evicted evidence. |

Admission also bounds report labels to 128 flow groups and 1,024 flow/state pairs, conservatively reserving an unknown exit for every started flow. New events at capacity are rejected; existing cohorts are not partially evicted to make room. Events outside retention or beyond future tolerance are rejected. Expiry removes **every event in the session**, including recent turns and closure evidence, to avoid leaving a misleading denominator. The earliest timestamp also works with out-of-order arrival. Retention is measured from evidence time, not arrival time.

Pruning occurs on record, snapshot, stats, deletion, flush and exporter `isCurrent()` calls; there is no background timer. An idle collector therefore holds expired records until the next operation. Applications that need idle cleanup must call `stats()` or `flush()` on their own schedule, and stop that schedule on shutdown. Bounds cover retained event count, serialized bytes, sessions, tombstones and the single export snapshot; JavaScript object overhead, caller-held snapshots and application/exporter queues require their own limits. Admission validates the affected session and any reused logical identity before retaining evidence; invalid chronology/correlation cannot poison later reports. This collector is intended for modest local cohorts; admission scans retained evidence and is not a high-throughput durable ingestion service.

## Deletion and redaction

`deleteSession(sessionId)` accepts an opaque metric UUID, removes its retained evidence, invalidates an in-flight snapshot and permanently denies new evidence for that identity for the instance's lifetime. It is idempotent, including before evidence arrives. Pseudonyms are still linkable data and must be protected. Store the application-to-pseudonym mapping securely if deletion must be possible later; this library does not store that mapping.

Expiry identities are denied for another retention interval; after that, old evidence still fails its age check. Never reuse a session identity for a new session. Explicit deletion tombstones are permanent until the instance is destroyed. When tombstone capacity is reached, ingestion pauses rather than forgetting a deletion. Start a replacement instance only with an application-owned deletion policy that prevents erased evidence being reimported. `clear()` erases all local evidence/tombstones and permanently pauses ingestion; `close()` additionally disables snapshots/exports. They do not resume automatically.

Metric schema validation rejects unexpected raw fields such as phone numbers, input, response or exceptions. The buffer additionally requires explicit flow/state label rosters. Do not fill those rosters from user/session/request values; textual IDs cannot universally be recognized as IDs. Reports and exported labels omit correlation UUIDs. Opt-in evidence snapshots do contain pseudonymous UUIDs and require appropriate access control. Failure notifications contain only fixed codes; stats contain counts, sizes and lifecycle flags.

Deletion removes references owned by this collector; it is not secure memory overwriting. Caller-held snapshots, a pending exporter and external copies can still hold earlier evidence. Exporters must honor `signal` and recheck `isCurrent()` immediately before publishing. A check followed by an asynchronous write is not atomic: remote systems need their own fencing, retention and erasure operation. Already published metrics, traces, logs, dashboard responses, caches, archives and backups are **not deleted** by this buffer. Updating gauges corrects current values; it does not erase historical backend samples. End-to-end deletion requires an application-owned inventory and independently verified remote deletion.

## Failure behavior

`record()` returns `{ accepted, duplicate?, reason? }` and isolates validation/clock failures and failure-observer exceptions. Reject reasons are `invalid`, `labels`, `expired`, `future`, `capacity`, `denied` or `closed`. Stats count every rejection reason. `onFailure` receives `record_invalid`, `clock_invalid`, `snapshot_invalid`, `export_failed`, `export_timeout` or `tombstone_capacity` where applicable. Keep the callback synchronous and small; any external alert delivery needs its own bounded queue. Returned callback promise rejections are consumed, without awaiting them or retrying them.

`flush()` resolves with `exported`, `busy`, `no_exporter`, `closed`, `failed`, `invalidated` or `timeout`. It does not retry or enqueue calls. A physical export holds the **one slot until its promise settles**, even after the public deadline, deletion or close. A hung exporter therefore yields timeout followed by busy, instead of accumulating unresolved retries. Timeout aborts its signal; close/deletion/expiry invalidate it. An uncooperative exporter cannot be forcibly cancelled. A synchronous blocking exporter can also block Node's event loop and delay the timer: run genuinely blocking work outside the process. An exporter resolving a value signals success; adapters must throw/reject on failure. Failed and timed-out snapshots remain available for an explicitly scheduled later attempt, subject to retention; successful flush does not erase evidence. Late failure after timeout can emit an additional `export_failed` notification.

Snapshots validate/report synchronously and may throw on invalid clocks or closed instances; do not call snapshot or flush in the response path. Telemetry is isolated by application wiring: `record()` can be invoked from an observer, while scheduling, exporter work and remote alerts stay outside the turn. Nothing installs an observer or scheduler automatically.

## OpenTelemetry lifetime

`createMetricOtelBridge(meter, { maxSeries })` limits distinct series across its lifetime, including retired series (default 32,768; range 1–65,536). Overflow rejects an update before publishing it. The previous snapshot remains available. Retired series are reported as NaN because cumulative SDK readers retain absent points; they are not zero-valued successful outcomes. Partial instrument setup can retry registration safely.

Use one bridge per dedicated meter/provider lifetime, a fixed roster, and application-owned SDK/exporter controls. Buffer deletion/expiry plus a fresh flush corrects actual SDK gauge values and invalidates retired series; SDK caches and backend history remain separate. `bridge.close()` removes the callback, but does not own SDK shutdown or erase its cumulative cache. Shut down the dedicated provider to end that lifetime. Actual in-memory SDK tests validate these corrections; no external collector, live traffic or remote deletion is claimed.
