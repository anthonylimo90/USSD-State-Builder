# Metric exports and reference dashboard

P4-02 builds on the [metric contract](METRIC-DEFINITIONS.md), using the same validated events and logical identities. It adds `buildMetricReport`, `selectMetricEvidence`, `exportMetricReportPrometheus` and `createMetricOtelBridge` to the CommonJS/ESM root, with TypeScript declarations. The [local reference dashboard](../examples/metrics/server.js) is synthetic-only.

## Run and inspect

```bash
npm ci --ignore-scripts
npm run demo:metrics
```

Open `http://127.0.0.1:3202`. The default cohort has 8 HTTP attempts, 7 logical turns and 6 started sessions, including one inferred abandonment and one unknown closure. The scenario picker also demonstrates a late provider closure (abandoned becomes unknown), a late confirmed completion, and a 1,000-turn latency cohort alongside the original cohort. The latter is a deterministic synthetic metric sample, not a gateway load test or provider journey.

The page shows all-cohort totals and flow-version completion. Its state table supports flow filtering, completion after reaching each state, observed/inferred drop-off, validation retries, classified backend errors, latency samples and opt-in evidence inspection. Tables scroll within their regions on small screens; controls, tables and evidence are keyboard-accessible. Scenario changes cancel stale evidence views; closing evidence restores its trigger's focus. The `Show flow` control filters the state table; headline totals and flow table continue to describe the entire supplied cohort.

- `GET /api/report?scenario=baseline` returns the report with an explicit `provenance: synthetic` marker.
- `GET /metrics?scenario=baseline` returns Prometheus text (`text/plain; version=0.0.4`).
- `GET /api/evidence?scenario=baseline&flowVersion=mavuno-v1&state=MENU` returns bounded structural evidence. `__unknown__` selects a null version or state.

The demo binds to loopback, serves no external assets, takes no uploaded events, writes no data and sends no provider/business requests. Its examples ship in the packed package. A production endpoint needs the application's own event ingestion, authentication, scope selection and retention; this page is not a hosted telemetry service.

## Report meanings

```javascript
const { buildMetricReport, selectMetricEvidence } = require('ussd-state-builder');
const options = { asOf: '2026-10-01T00:00:10.000Z', inactivityMs: 5000 };
const report = buildMetricReport(redactedEvents, options);
const evidence = selectMetricEvidence(redactedEvents, options, {
  flowVersion: 'mavuno-v1', state: 'MENU', limit: 100
});
```

`report.summary` preserves P4-01's denominators and coverage diagnostics, omitting session IDs/details. `flows` and `states` expose bounded structural groups; metric labels never contain event/request/turn/session/business IDs. Unknown versions/states remain null in JSON and use the reserved `__unknown__` label in metrics. Each report permits at most 128 flow groups and 1,024 state groups, on top of the 100,000-envelope batch bound.

Flow request/turn/business groups use each fact's recorded flow version. Session completion belongs to the session's **start version**, even after a flow restart. State reach and final exits use the version of the corresponding logical turn. The final state's version is the last turn's version; sessions without turns fall into an explicit unknown-state group under their start version. A `v2` state exit can therefore belong to a session cohort started under `v1`. Do not expect each flow's session count to equal its turn-session count.

State reach counts distinct **started** sessions whose turns mention that state as previous or next state. Repeated visits count once. A turn is attributed to its **input/previous state**, not necessarily the handler executed after routing. State completion is completed journeys among sessions that reached that state / all sessions that reached it. Final-state observed drop-off is explicit cancellation + expiry / sessions that reached the state; inferred abandonment uses a separate numerator over the same denominator. Unknown closures and open sessions remain separate. These are reach/exit tables, not an invented linear funnel: loops, branches and missing evidence do not establish an ordered funnel.

Backend errors count `outcome: error` classified as `storage`, `provider` or `handler`. Timeout and unknown errors remain visible in `turns.errorClasses` and total error rates; they are not guessed to be backend failures. Requests and turns retain separate error grains. Never add their error counts together as unique failures.

`selectMetricEvidence` is an explicit, read-only investigation export. It includes the full observed session context for matching state visits, including later closure evidence, so the reason for a drop-off can be checked. Unknown-state sessions without turns are inspectable too. It preserves redacted pseudonymous IDs, sorts by occurrence time/ID, returns `total`/`truncated`, and defaults to 100 events with a maximum of 1,000. It excludes future events and raw data. Correlation IDs in this output are **not** metric labels.

## Latency policy

Latency uses whole logical-turn `durationMs`, including validation/errors, excluding repeated envelopes and HTTP receipt replays. Nearest-rank estimates use `sorted[ceil(p * count) - 1]`. Each group reports count, sum, minimum and maximum. p50 requires 20 samples by default, p95 100, p99 1,000; unavailable values are null in JSON and shown as a dash. These transparent defaults are a sample-size policy, not a confidence guarantee. Override deliberately with `latencyMinSamples: { p50, p95, p99 }`; thresholds must be positive integers and are returned with the report.

The original cohort has 7 turn samples and a 116 ms sum; all default percentiles are unavailable. The synthetic `latency-v1` cohort contains values 1…1,000 ms: sum 500,500 ms, p50 500 ms, p95 950 ms, p99 990 ms. The dashboard's overall latency also includes the original seven turns; filter the state table to `latency-v1` to inspect its exact values.

## Prometheus

```javascript
const { exportMetricReportPrometheus } = require('ussd-state-builder');
const body = exportMetricReportPrometheus(redactedEvents, options);
```

Every `ussd_cohort_*` family is a **gauge**, because this is a retained cohort snapshot whose counts can decrease when late evidence corrects earlier inference. Do not apply `rate()` to these counts. Metrics expose outcome counts by grain, session ratios and denominators, state reach/exits/completion/drop-off, validation retries, backend errors, latency samples, percentile thresholds and the `as_of_seconds` observation horizon.

Time-valued metrics use seconds: `ussd_cohort_turn_duration_percentile_seconds{percentile="p95"}` and `ussd_cohort_turn_duration_accumulated_seconds`. JSON and the dashboard retain milliseconds. Percentile series below threshold, and ratios with a zero denominator, are omitted rather than exported as zero. `turn_duration_samples` discloses the sample count. Latency families contain both flow-wide series (without a state label) and state series: select one level, rather than summing them together. For example:

```promql
ussd_cohort_session_ratio{measure="completionRate"}
ussd_cohort_state_dropoff_ratio{basis="inferred"}
ussd_cohort_backend_errors{grain="request"}
ussd_cohort_turn_duration_percentile_seconds{state="",percentile="p95"}
```

The official [Prometheus exposition rules](https://prometheus.io/docs/instrumenting/exposition_formats/) and [exporter guidance](https://prometheus.io/docs/instrumenting/writing_exporters/) informed the format and gauge semantics. `npm run test:metrics-prometheus` uses official `prom/prometheus:v3.5.0` `promtool check metrics` in disposable, network-isolated Docker containers. It validates baseline, both late-event scenarios, the latency cohort and an empty cohort, including naming lint. This gate runs in the CI package job; Docker must be available (the first invocation may fetch the image).

## Actual OpenTelemetry SDK bridge

The existing `OpenTelemetryCollector` and `createExportableMetrics({ format: 'opentelemetry' })` remain legacy JSON helpers, **not** SDK integrations. The new bridge uses the actual [OpenTelemetry Meter API](https://opentelemetry.io/docs/specs/otel/metrics/api/) to register observable gauges. It takes a caller-owned meter, adds no runtime SDK dependency and does not configure a global provider or network endpoint.

```javascript
const { MeterProvider, PeriodicExportingMetricReader,
  InMemoryMetricExporter, AggregationTemporality } = require('@opentelemetry/sdk-metrics');
const { createMetricOtelBridge } = require('ussd-state-builder');

const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const provider = new MeterProvider({
  readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60000 })]
});
const bridge = createMetricOtelBridge(provider.getMeter('ussd-cohort'));
bridge.update(redactedEvents, options);
await provider.forceFlush();
// Inspect exporter.getMetrics() or use your application's configured exporter.
bridge.close();
await provider.shutdown();
```

`update` validates/builds the complete next snapshot before publishing it; invalid evidence leaves the previous snapshot intact and throws to the caller. Gauge samples match the Prometheus report, units and allowlisted attributes. Actual SDK 2.6.0 / API 1.9.0 integration tests use the in-memory exporter and a real periodic reader, covering new instruments, corrections, failed updates, empty cohorts and callback cleanup. A TypeScript consumer passes an actual SDK meter to the structural interface.

Cumulative SDK readers retain absent gauge values. When a previously exported series disappears or its percentile becomes unavailable, the bridge emits **NaN**, meaning unavailable, to invalidate that cached value. Retired series stay unavailable rather than reverting to stale measurements. The bridge caps retained current/retired series at 32,768; capacity failure throws before publishing the next snapshot. Do not turn NaN into zero or use plain JSON serialization of SDK data as an OTLP exporter. SDK/network exporters are application-owned; network delivery to an external collector was not exercised here.

`close()` is idempotent and unregisters the callback; it does not own the provider or erase the SDK's already collected history. Call `provider.shutdown()` for timer/SDK cleanup. Keep one bridge per dedicated meter lifetime; use a fresh provider/meter for a new telemetry generation. P4-03 will address broader retention, deletion and collector failure controls.

## Validation boundary

The automated report tests independently check START reach 4, observed exits 2/4, QUANTITY validation retries 1/1, MENU inferred exits 1/1 and unknown-state reach 2. Late evidence changes those counts without inventing completion. HTTP tests check the same report/export/evidence paths and safe errors. Browser checks cover scenario updates, flow filtering, sufficient/insufficient latency, evidence focus, keyboard access and responsive containment. Packed consumers exercise the new API without an OpenTelemetry runtime dependency.

All examples and measurements are synthetic. Live Mavuno/provider validation remains parked, and no external collector deployment or production observability claim follows from these local checks.
