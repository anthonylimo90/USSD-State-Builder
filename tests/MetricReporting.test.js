const { buildMetricReport, selectMetricEvidence, exportMetricReportPrometheus, createMetricOtelBridge } = require('..');
const { scenario } = require('../examples/metrics/scenarios');
const { MeterProvider, InMemoryMetricExporter, PeriodicExportingMetricReader, AggregationTemporality, DataPointType } = require('@opentelemetry/sdk-metrics');
const baseline = scenario();
const reportFor = name => { const data = scenario(name); return buildMetricReport(data.events, data.options); };
const stateFor = (report, state) => report.states.find(value => value.state === state && value.flowVersion === 'mavuno-v1');

describe('metric reports', () => {
  test('known flow and state totals are independently enumerated', () => {
    const report = reportFor('baseline');
    expect(report.summary.sessions).not.toHaveProperty('details');
    expect(report.flows).toHaveLength(1);
    expect(report.flows[0]).toMatchObject({ flowVersion: 'mavuno-v1', turns: { total: 7, validationRetries: 1, backendErrors: 1 },
      requests: { total: 8, backendErrors: 1 }, sessions: { total: 6, completionRate: { numerator: 1, denominator: 6 } } });
    expect(stateFor(report, 'START')).toMatchObject({ sessionsReached: 4, turns: { total: 4, backendErrors: 1 },
      exits: { cancelled: 1, expired: 1 }, observedDropOffRate: { numerator: 2, denominator: 4, value: 0.5 } });
    expect(stateFor(report, 'QUANTITY')).toMatchObject({ sessionsReached: 1, turns: { total: 2, validationRetries: 1 }, reachedSessionOutcomes: { completed: 1 } });
    expect(stateFor(report, 'MENU')).toMatchObject({ sessionsReached: 1, turns: { total: 0 }, exits: { abandoned: 1 }, inferredDropOffRate: { value: 1 } });
    expect(stateFor(report, null)).toMatchObject({ sessionsReached: 2, exits: { unknown: 1, open: 1 } });
    expect(JSON.stringify(report)).not.toContain(baseline.events[0].sessionId);
  });
  test('late correction keeps observed and inferred exits separate', () => {
    expect(stateFor(reportFor('late-provider'), 'MENU')).toMatchObject({ exits: { abandoned: 0, unknown: 1 }, inferredDropOffRate: { value: 0 }, observedDropOffRate: { value: 0 } });
    expect(stateFor(reportFor('late-completion'), 'MENU')).toMatchObject({ exits: { abandoned: 0, completed: 1 } });
  });
  test('nearest-rank percentiles, sums and samples use deduplicated logical turns', () => {
    const flow = reportFor('latency').flows.find(value => value.flowVersion === 'latency-v1');
    expect(flow.latency).toEqual({ count: 1000, sumMs: 500500, minMs: 1, maxMs: 1000, p50: { value: 500, minSamples: 20 }, p95: { value: 950, minSamples: 100 }, p99: { value: 990, minSamples: 1000 } });
    expect(reportFor('baseline').latency).toMatchObject({ count: 7, sumMs: 116, p50: { value: null }, p95: { value: null }, p99: { value: null } });
  });
  test('sample threshold boundaries are exact, overridable and explicit', () => {
    const value = buildMetricReport(baseline.events, { ...baseline.options, latencyMinSamples: { p50: 7, p95: 8, p99: 7 } });
    expect(value.latency).toMatchObject({ p50: { value: 12, minSamples: 7 }, p95: { value: null, minSamples: 8 }, p99: { value: 50, minSamples: 7 } });
    expect(() => buildMetricReport([], { ...baseline.options, latencyMinSamples: { p50: 0 } })).toThrow('policy');
    expect(() => buildMetricReport([], { ...baseline.options, latencyMinSamples: { raw: 1 } })).toThrow('policy');
  });
  test('delivery order does not affect reports and empty reports have no invented percentiles', () => {
    expect(buildMetricReport([...baseline.events].reverse(), baseline.options)).toEqual(reportFor('baseline'));
    expect(buildMetricReport([], baseline.options).latency).toMatchObject({ count: 0, minMs: null, p50: { value: null } });
  });
  test('state exits follow the last turn version while the session cohort retains its start version', () => {
    const data = { ...baseline };
    // Duplicate envelopes for the selected terminal position are updated together.
    data.events = baseline.events.map(value => value.eventType === 'turn' && value.position === 3 ? { ...value, flowVersion: 'v2' } : value);
    const report = buildMetricReport(data.events, data.options);
    expect(report.flows.find(value => value.flowVersion === 'mavuno-v1').sessions.outcomes.completed).toBe(1);
    expect(report.flows.find(value => value.flowVersion === 'v2').sessions.total).toBe(0);
    expect(report.states.find(value => value.flowVersion === 'v2' && value.state === 'CONFIRM').exits.completed).toBe(1);
  });
  test('evidence is opt-in, bounded and includes full session context and unknown closures', () => {
    const evidence = selectMetricEvidence(baseline.events, baseline.options, { flowVersion: 'mavuno-v1', state: 'MENU', limit: 2 });
    expect(evidence.total).toBe(3); expect(evidence.events).toHaveLength(2); expect(evidence.truncated).toBe(true);
    const unknown = selectMetricEvidence(baseline.events, baseline.options, { flowVersion: 'mavuno-v1', state: null });
    expect(unknown.events.filter(value => value.eventType === 'provider_end')).toHaveLength(1);
    expect(() => selectMetricEvidence(baseline.events, baseline.options, { limit: 1001 })).toThrow();
  });
});

describe('Prometheus snapshot exposition', () => {
  test('gauge families have unique samples, trailing newline, finite values and no correlation IDs', () => {
    const text = exportMetricReportPrometheus(baseline.events, baseline.options);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toContain(' counter');
    const keys = new Set();
    for (const line of text.split('\n').filter(value => value && !value.startsWith('#'))) {
      const match = line.match(/^(ussd_cohort_[a-z_]+(?:\{[^}]+\})?) ([0-9.e+-]+)$/);
      expect(match).not.toBeNull(); expect(Number.isFinite(Number(match[2]))).toBe(true);
      expect(keys.has(match[1])).toBe(false); keys.add(match[1]);
    }
    expect(text).toContain('ussd_cohort_sessions{flow_version="mavuno-v1",outcome="completed"} 1');
    expect(text).toContain('ussd_cohort_state_dropoff_ratio{flow_version="mavuno-v1",state="MENU",basis="inferred"} 1');
    expect(text).not.toContain('ussd_cohort_turn_duration_percentile_seconds');
    for (const field of ['sessionId', 'requestId', 'eventId', 'turnId', 'businessId']) for (const event of baseline.events) if (event[field]) expect(text).not.toContain(event[field]);
  });
  test('sufficient samples expose expected quantiles and late corrections can decrease gauges', () => {
    const data = scenario('latency'); const text = exportMetricReportPrometheus(data.events, data.options);
    expect(text).toContain('ussd_cohort_turn_duration_percentile_seconds{flow_version="latency-v1",percentile="p99"} 0.99');
    const late = scenario('late-provider');
    expect(exportMetricReportPrometheus(late.events, late.options)).toContain('ussd_cohort_sessions{flow_version="mavuno-v1",outcome="abandoned"} 0');
  });
});

describe('actual OpenTelemetry SDK integration', () => {
  let provider, exporter, bridge, meter;
  beforeEach(() => {
    exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    provider = new MeterProvider({ readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60000 })] });
    meter = provider.getMeter('ussd-cohort-test');
    bridge = createMetricOtelBridge(meter);
  });
  afterEach(async () => { bridge.close(); await provider.shutdown(); });
  async function collect() {
    exporter.reset(); await provider.forceFlush();
    return exporter.getMetrics().flatMap(value => value.scopeMetrics.flatMap(scope => scope.metrics));
  }
  const points = (values, name) => values.filter(value => value.descriptor.name === name).flatMap(value => value.dataPoints);
  test('exports real SDK gauge data with allowlisted attributes and correct totals', async () => {
    bridge.update(baseline.events, baseline.options); const values = await collect();
    expect(values.length).toBeGreaterThan(0);
    expect(values.every(value => value.dataPointType === DataPointType.GAUGE)).toBe(true);
    expect(points(values, 'ussd_cohort_sessions').find(value => value.attributes.outcome === 'completed').value).toBe(1);
    expect(points(values, 'ussd_cohort_sessions').reduce((total, value) => total + value.value, 0)).toBe(6);
    expect(JSON.stringify(values)).not.toContain(baseline.events[0].sessionId);
    expect(points(values, 'ussd_cohort_turn_duration_percentile_seconds')).toHaveLength(0);
  });
  test('new instruments, late corrections, failed updates and disappearing series stay consistent', async () => {
    bridge.update(baseline.events, baseline.options); await collect();
    const large = scenario('latency'); bridge.update(large.events, large.options);
    const values = await collect();
    expect(points(values, 'ussd_cohort_turn_duration_percentile_seconds').find(value => value.attributes.flow_version === 'latency-v1' && value.attributes.percentile === 'p95' && !value.attributes.state).value).toBe(0.95);
    const late = scenario('late-provider'); bridge.update(late.events, late.options);
    expect(() => bridge.update([{ input: 'private' }], baseline.options)).toThrow();
    const corrected = await collect();
    expect(points(corrected, 'ussd_cohort_sessions').find(value => value.attributes.outcome === 'abandoned').value).toBe(0);
    expect(points(corrected, 'ussd_cohort_turn_duration_percentile_seconds').every(value => Number.isNaN(value.value))).toBe(true);
    expect(points(corrected, 'ussd_cohort_sessions').filter(value => value.attributes.flow_version === 'latency-v1').every(value => Number.isNaN(value.value))).toBe(true);
    const removed = jest.spyOn(meter, 'removeBatchObservableCallback');
    bridge.close(); bridge.close();
    expect(removed).toHaveBeenCalledTimes(1);
    expect(() => bridge.update(baseline.events, baseline.options)).toThrow('closed');
  });
  test('an initially empty cohort can gain instruments without duplicate callback registration', async () => {
    bridge.update([], baseline.options); await collect(); bridge.update(baseline.events, baseline.options);
    expect(points(await collect(), 'ussd_cohort_sessions')).toHaveLength(6);
  });
  test('rejects JSON collectors without a Meter API', () => expect(() => createMetricOtelBridge({})).toThrow('Meter API'));
});
