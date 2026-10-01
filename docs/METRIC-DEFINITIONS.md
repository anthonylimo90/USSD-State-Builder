# Metric definitions and event aggregation

P4-01 adds `createMetricEvent`, `createMetricId`, `metricTurnFromTrace` and `aggregateMetricEvents` to the CommonJS/ESM root package, with TypeScript declarations. This is a deterministic batch calculation over supplied evidence. It does not install an automatic collector, retain events, change provider receipts, or claim live provider validation. Exports and dashboards follow in P4-02; retention and collector failure controls follow in P4-03.

## Grains and denominators

| Grain | Stable identity and evidence | Count and denominator |
| --- | --- | --- |
| Request | `requestId`: one actual HTTP arrival, including a receipt replay, rejected arrival or error. Persist its UUID before retrying telemetry delivery. | All observed request attempts. `errorRate` = error attempts / all attempts; `replayRate` = receipt replays / all attempts. Rejected requests remain a separate outcome. |
| Turn | `turnId`: one committed logical execution, using the gateway's durable `idempotencyKey` (`ussd-turn:<fingerprint>`), independent of HTTP arrival. `position` is the adapter's monotonic transcript position. | All distinct observed logical turns, including validation errors, blocked executions and flow restarts. Receipt replay is a request outcome and never a new turn. |
| Session | `sessionId`: one provider session binding, pseudonymized from the normalized `sessionKey`. A `session_start` records its authoritative start time and original flow version. | All distinct started sessions with start time at or before `asOf`. Open, unknown and inferred outcomes remain in this denominator. Completion/cancellation/expiry/abandonment/unknown rates sum with the open share to one. |
| Business operation | `businessId`: one durable operation, such as placing an order or cancelling an order, correlated to its originating session. Emit after the operation journal confirms its result. | All distinct operations with observed outcome evidence at or before `asOf`. Completion rate is completed / observed operations. This is **not** success / every attempted operation: unreported or pending operations are not observable in this contract. |

Every rate returns `{ numerator, denominator, value }`, where `value` is a fraction in [0, 1]. Zero denominators return `null`, never a misleading zero percent. The session cohort is all supplied starts through `asOf`, not a closed-session-only cohort or an implicit date-window filter. To compare cohorts, supply the selected starts **and all their subsequent evidence through the same observation horizon**; disclose missing evidence.

Session rates exclude evidence without a start. `evidence.orphanEvents` and `orphanSessions` make those gaps visible; they are not manufactured starts. Request, turn and business totals still include those observed facts. A start arriving late brings its session into the denominator on the next rebuild. Session details retain pseudonymous correlation, start version, last activity, last state (next state, falling back to previous state for terminal turns), outcome, basis and provider outcome. IDs are evidence references, never metric labels.

## Outcomes

- **Completed:** an application-authored `session_end` with `outcome: 'completed'`, emitted only when the declared journey goal is confirmed. Neither an `END` response nor provider `Success` alone establishes completion.
- **Cancelled:** an explicit user cancellation acknowledged by the application. An order cancelled in a later session is a separate business cancellation operation; it does not rewrite the original order-placement operation or session.
- **Expired:** an explicitly observed application/session deadline expiration. A storage miss or provider `Incomplete` alone is insufficient evidence.
- **Abandoned:** an inference for an otherwise open session, only when an explicit `inactivityMs` policy is supplied and `asOf - lastActivityAt >= inactivityMs`. Last activity is the start or latest logical turn, excluding replay/rejection traffic. It is reported with `basis: 'inferred'`. Default inference is disabled.
- **Unknown:** closure is observed but its journey reason is unknown, or explicit journey outcomes conflict. `session_end: unknown` can later gain an explicit reason. Contradictory known reasons remain unknown with `basis: 'conflict'`; arrival order never selects a winner.
- **Open:** no observed closure or enabled inactivity inference yet.

Provider `Success`, `Incomplete` and `Failed` are transport evidence in `provider_end`, retained separately. Different statuses conflict; distinct provider fingerprints at the same timestamp also conflict, matching the existing event store. Same-status evidence at different times agrees. Provider conflicts cannot erase independently confirmed application completion, but remain visible in `providerOutcome: 'conflict'`. Business outcomes (`completed`, `cancelled`, `failed`) are immutable results of individual operations. Disagreeing outcomes for one operation are counted once as `unknown`; this contract is not a mutable order-status timeline.

Validation failures are `turn.outcome: 'validation_error'` with `errorClass: 'validation'`. `validationErrorRate` divides failures by logical turns. A **validation retry** is the immediately following position in the same session, flow version and previous state; it can fail again. Gaps or missing states do not prove a retry. `validationRetryRate` divides those retry pairs by observed validation failures, including failures with no observed subsequent attempt. `turn.errorRate` counts `outcome: 'error'` / logical turns, separately from validation failures. Error classes are allowlisted (`validation`, `timeout`, `storage`, `provider`, `handler`, `unknown`); never classify by matching exception text. The caller supplies known classifications; unknown remains unknown.

The older `createMetricsMiddleware().getMetrics()` counts **runtime observations**, despite the historic `totalRequests` name. Its `totalErrors` includes validation errors and its formatted `errorRate` is a percentage over those observations. It does not measure HTTP attempts, correlated sessions or business outcomes. Do not mix its denominator with this contract's rates.

## Schema, identities and integration boundary

Metric schema v1 accepts only common `eventId`, `sessionId`, canonical UTC ISO `occurredAt`, optional static `flowVersion`, and the fields appropriate to one of six event types: `request`, `turn`, `session_start`, `session_end`, `provider_end`, `business_outcome`. UUIDs are normalized to lowercase. Counts, states and versions are bounded; each normalized event is frozen and at most 2 KiB. Unknown fields, raw inputs, provider bodies, phones, responses, data and exception messages are rejected without echoing them. Use only authored state/version labels, never customer-derived labels. Pseudonyms are still correlatable data, not anonymization.

`createMetricId(secret, namespace, key)` derives a deterministic UUID v8 using domain-separated HMAC-SHA256 and a secret of at least 32 bytes. Keep the secret private and stable for the evidence horizon. Namespace choices are `session`, `request`, `turn`, `event`, `provider_event`, `business`. Rotation deliberately changes identities; do not mix old and new pseudonym generations in one cohort without an explicit migration. Never substitute an unkeyed phone hash.

At the provider/application integration boundary:

1. Give every HTTP arrival a fresh request UUID, then retain it for retries of **telemetry delivery**. The provider repeating the same request creates another attempt. Pre-normalization failures cannot reliably correlate to a session and require a separate ingress counter; do not fabricate a binding.
2. Use the normalized bound `sessionKey` for the session pseudonym. Persist the first successful logical turn's start timestamp/version once. If earlier ingress is needed, define it as a separate attempted-session cohort.
3. Project a turn only after atomic receipt commit, with the durable turn identity, adapter position, original occurrence time and flow version. Do not report uncertain/uncommitted handler execution as a committed turn. Correlation must belong to the invocation, not a shared mutable “current session” variable.
4. Project provider events after `eventStore.accept` confirms durable acceptance. Reuse the normalized event fingerprint for `eventId`; retain event occurrence time, even if delivery is late. Include duplicate delivery in the same envelope rather than generating a new fingerprint. Do not send `event.fields` or `event.binding` into telemetry.
5. Author journey-end reasons and business operations at their confirmed application boundaries. Persist envelopes or reproducible identities/timestamps so a transport retry cannot create new facts.

For example, a normalized end event can be projected explicitly:

```javascript
const { createMetricId, createMetricEvent } = require('ussd-state-builder');

function projectProviderEnd(normalized, secret, flowVersion = null) {
  return createMetricEvent({
    eventType: 'provider_end',
    eventId: createMetricId(secret, 'provider_event', normalized.fingerprint),
    sessionId: createMetricId(secret, 'session', normalized.sessionKey),
    occurredAt: new Date(normalized.occurredAt).toISOString(),
    flowVersion,
    outcome: normalized.status
  });
}
```

This projection preserves the event adapter's timestamp interpretation; the provider timezone uncertainty remains documented in the [provider contract](AFRICAS-TALKING-CONTRACT.md). `metricTurnFromTrace(trace, { eventId, sessionId, turnId, position })` validates trace v1 then attaches explicit logical correlation. It deliberately drops the trace's generated request/turn observation IDs. A trace `replay` cannot be converted to a turn: use a request replay event. Traces without authoritative correlation cannot establish these grains.

## Duplicates, late events and conflicts

`aggregateMetricEvents(events, { asOf, inactivityMs })` validates a finite batch of at most 100,000 envelopes. It deduplicates exact `eventId` copies, then distinct envelopes of the same `requestId`, `turnId`, session start or business fact. Repeated logical request/turn facts must match their original timestamp and payload; conflicting IDs, position collisions, contradictory starts, reversed turn chronology or cross-session business correlation throw a safe `TypeError`. No partial report is returned. Provider and outcome disagreements are valid uncertain evidence and produce unknown/conflict results instead.

The report uses **event time**, not arrival time. Future facts are excluded and counted in `futureEvents`; duplicate-envelope diagnostics count the entire supplied batch. Rebuild over retained evidence when late facts arrive, using the desired `asOf`: a late confirmed completion can replace prior inferred abandonment, and a late provider closure can replace it with observed unknown. Existing reports are not immutable final counts, and no watermark or completeness guarantee is inferred. The batch API is not a telemetry queue or durable store; retention, loss, delivery and deletion are application responsibilities pending P4-03.

## Validation dataset

[synthetic-cohort.json](../tests/fixtures/metrics/synthetic-cohort.json) contains 34 supplied envelopes: 30 unique included envelopes, one future envelope and three repeated deliveries. Two additional included envelopes repeat existing logical facts under different event IDs. The independently enumerated totals through `2026-10-01T00:00:10.000Z`, with a 5-second inactivity policy, are:

| Metric | Expected |
| --- | --- |
| HTTP attempts | 8: 5 accepted, 1 replay, 1 rejected, 1 error |
| Logical turns | 7: 5 success, 1 validation failure, 1 error |
| Validation retries | 1 / 1 observed validation failure |
| Started sessions | 6: 1 completed, 1 cancelled, 1 expired, 1 inferred abandoned, 1 unknown, 1 open |
| Session completion | 1 / 6 |
| Observed business operations | 2: 1 completed, 1 cancelled; completion 1 / 2 |
| Missing-start evidence | 1 provider event for 1 orphan session |

`tests/MetricEvents.test.js` verifies those totals, reversed delivery order, late corrections, missing starts, absent inference policy, future evidence, zero denominators, duplicate/conflicting identities, validation retry gaps, provider conflicts, redaction and an actual fluent SDK turn projection. Packed CommonJS/ESM and TypeScript consumers also execute/use the aggregation API. All traffic in this evidence is synthetic; parked live Mavuno validation remains separate.
