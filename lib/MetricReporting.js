const { aggregateMetricEvents, createMetricEvent } = require('./MetricEvents');

const DEFAULT_LATENCY_MIN_SAMPLES = Object.freeze({ p50: 20, p95: 100, p99: 1000 });
const LABEL_UNKNOWN = '__unknown__';
const SESSION_OUTCOMES = ['completed', 'cancelled', 'expired', 'abandoned', 'unknown', 'open'];
const REQUEST_OUTCOMES = ['accepted', 'replay', 'rejected', 'error'];
const TURN_OUTCOMES = ['success', 'validation_error', 'error', 'blocked', 'flow_restart'];
const ERROR_CLASSES = ['validation', 'timeout', 'storage', 'provider', 'handler', 'unknown'];
const ratio = (numerator, denominator) => ({ numerator, denominator, value: denominator ? numerator / denominator : null });
const tally = (values, keys) => Object.fromEntries(keys.map(key => [key, values.filter(value => value === key).length]));
const backend = event => event.outcome === 'error' && ['storage', 'provider', 'handler'].includes(event.errorClass);
const groupKey = (version, state) => JSON.stringify([version, state]);
function policy(options) {
  if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options))) throw new TypeError('Invalid latency sample policy');
  const limits = { ...DEFAULT_LATENCY_MIN_SAMPLES, ...options };
  if (Object.keys(limits).some(key => !Object.hasOwn(DEFAULT_LATENCY_MIN_SAMPLES, key)) ||
      Object.values(limits).some(value => !Number.isSafeInteger(value) || value < 1 || value > 100000)) {
    throw new TypeError('Invalid latency sample policy');
  }
  return limits;
}
function latency(turns, limits) {
  const values = turns.map(turn => turn.durationMs).sort((a, b) => a - b);
  const percentiles = Object.fromEntries([['p50', 0.5], ['p95', 0.95], ['p99', 0.99]].map(([name, percentile]) =>
    [name, { value: values.length >= limits[name] ? values[Math.ceil(percentile * values.length) - 1] : null, minSamples: limits[name] }]));
  return { count: values.length, sumMs: values.reduce((total, value) => total + value, 0), minMs: values[0] ?? null,
    maxMs: values[values.length - 1] ?? null, ...percentiles };
}
function sessions(values) {
  const outcomes = tally(values.map(value => value.outcome), SESSION_OUTCOMES);
  return { total: values.length, outcomes, completionRate: ratio(outcomes.completed, values.length),
    cancellationRate: ratio(outcomes.cancelled, values.length), expiryRate: ratio(outcomes.expired, values.length),
    abandonmentRate: ratio(outcomes.abandoned, values.length), unknownRate: ratio(outcomes.unknown, values.length) };
}
function turnSummary(values) {
  const outcomes = tally(values.map(value => value.outcome), TURN_OUTCOMES);
  const bySession = new Map();
  for (const value of values) {
    if (!bySession.has(value.sessionId)) bySession.set(value.sessionId, []);
    bySession.get(value.sessionId).push(value);
  }
  let validationRetries = 0;
  for (const turns of bySession.values()) {
    turns.sort((a, b) => a.position - b.position);
    for (let index = 1; index < turns.length; index++) {
      const previous = turns[index - 1], current = turns[index];
      if (previous.outcome === 'validation_error' && current.position === previous.position + 1 &&
          previous.previousState !== null && previous.previousState === current.previousState && previous.flowVersion === current.flowVersion) validationRetries++;
    }
  }
  return { total: values.length, outcomes, validationRetries, validationRetryRate: ratio(validationRetries, outcomes.validation_error),
    validationErrorRate: ratio(outcomes.validation_error, values.length), errorRate: ratio(outcomes.error, values.length),
    backendErrors: values.filter(backend).length,
    errorClasses: tally(values.filter(value => value.errorClass !== null).map(value => value.errorClass), ERROR_CLASSES) };
}

/** Validated evidence is normalized before grouping. IDs never enter report labels. */
function buildMetricReport(sources, options) {
  const summary = aggregateMetricEvents(sources, options);
  const limits = policy(options?.latencyMinSamples);
  const events = [...new Map(sources.map(source => {
    const value = createMetricEvent(source);
    return [value.eventId, value];
  })).values()].filter(value => Date.parse(value.occurredAt) <= Date.parse(summary.asOf));
  const unique = (type, key) => [...new Map(events.filter(value => value.eventType === type).map(value => [value[key], value])).values()];
  const turns = unique('turn', 'turnId'), requests = unique('request', 'requestId');
  const started = new Map(summary.sessions.details.map(value => [value.sessionId, value]));
  const versions = new Map();
  const states = new Map();
  function version(value) {
    const key = JSON.stringify(value);
    if (!versions.has(key)) versions.set(key, { flowVersion: value, turns: [], requests: [], sessions: [], business: new Map() });
    return versions.get(key);
  }
  function state(value, name) {
    const key = groupKey(value, name);
    if (!states.has(key)) states.set(key, { flowVersion: value, state: name, turns: [], reached: new Set(), exits: [] });
    return states.get(key);
  }
  const lastTurn = new Map();
  for (const turn of turns) {
    version(turn.flowVersion).turns.push(turn);
    state(turn.flowVersion, turn.previousState).turns.push(turn);
    if (started.has(turn.sessionId)) {
      for (const name of new Set([turn.previousState, turn.nextState].filter(name => name !== null))) state(turn.flowVersion, name).reached.add(turn.sessionId);
      const previous = lastTurn.get(turn.sessionId);
      if (!previous || previous.position < turn.position) lastTurn.set(turn.sessionId, turn);
    }
  }
  for (const request of requests) version(request.flowVersion).requests.push(request);
  for (const value of started.values()) {
    version(value.flowVersion).sessions.push(value);
    const last = lastTurn.get(value.sessionId);
    const exit = state(last ? last.flowVersion : value.flowVersion, value.lastState);
    exit.reached.add(value.sessionId);
    exit.exits.push(value);
  }
  for (const event of events.filter(value => value.eventType === 'business_outcome')) {
    const bucket = version(event.flowVersion).business;
    if (!bucket.has(event.businessId)) bucket.set(event.businessId, new Set());
    bucket.get(event.businessId).add(event.outcome);
  }
  if (versions.size > 128 || states.size > 1024) throw new TypeError('Metric report exceeds flow/state group limits');
  const flows = [...versions.values()].map(value => {
    const requestOutcomes = tally(value.requests.map(request => request.outcome), REQUEST_OUTCOMES);
    const businessOutcomes = tally([...value.business.values()].map(outcomes => outcomes.size === 1 ? [...outcomes][0] : 'unknown'), ['completed', 'cancelled', 'failed', 'unknown']);
    return { flowVersion: value.flowVersion,
      requests: { total: value.requests.length, outcomes: requestOutcomes, backendErrors: value.requests.filter(backend).length,
        errorRate: ratio(requestOutcomes.error, value.requests.length), replayRate: ratio(requestOutcomes.replay, value.requests.length) },
      turns: turnSummary(value.turns), sessions: sessions(value.sessions),
      business: { total: value.business.size, outcomes: businessOutcomes, completionRate: ratio(businessOutcomes.completed, value.business.size) },
      latency: latency(value.turns, limits) };
  }).sort((a, b) => JSON.stringify(a.flowVersion).localeCompare(JSON.stringify(b.flowVersion)));
  const stateRows = [...states.values()].map(value => {
    const exits = tally(value.exits.map(exit => exit.outcome), SESSION_OUTCOMES);
    return { flowVersion: value.flowVersion, state: value.state, turns: turnSummary(value.turns),
      sessionsReached: value.reached.size, reachedSessionOutcomes: tally([...value.reached].map(id => started.get(id).outcome), SESSION_OUTCOMES),
      exits, observedDropOffRate: ratio(exits.cancelled + exits.expired, value.reached.size),
      inferredDropOffRate: ratio(exits.abandoned, value.reached.size), latency: latency(value.turns, limits) };
  }).sort((a, b) => groupKey(a.flowVersion, a.state).localeCompare(groupKey(b.flowVersion, b.state)));
  const { details, ...sessionSummary } = summary.sessions;
  return { schemaVersion: 1, asOf: summary.asOf, inactivityMs: summary.inactivityMs, latencyMinSamples: limits,
    summary: { ...summary, sessions: sessionSummary }, flows, states: stateRows, latency: latency(turns, limits) };
}

/** Opt-in evidence export for investigation; never feed this output into metric labels. */
function selectMetricEvidence(sources, options, { flowVersion, state, limit = 100 } = {}) {
  const report = buildMetricReport(sources, options);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new TypeError('Invalid evidence limit');
  const turns = [...new Map(sources.map(createMetricEvent).filter(value => value.eventType === 'turn' && Date.parse(value.occurredAt) <= Date.parse(report.asOf))
    .map(value => [value.turnId, value])).values()];
  const matching = turns.filter(value => (flowVersion === undefined || value.flowVersion === flowVersion) &&
    (state === undefined || value.previousState === state || value.nextState === state));
  const sessionIds = new Set(matching.map(value => value.sessionId));
  if (state === null) {
    const knownTurns = new Set(turns.map(value => value.sessionId));
    for (const detail of aggregateMetricEvents(sources, options).sessions.details) {
      if (!knownTurns.has(detail.sessionId) && (flowVersion === undefined || detail.flowVersion === flowVersion)) sessionIds.add(detail.sessionId);
    }
  }
  const evidence = [...new Map(sources.map(createMetricEvent).filter(value => Date.parse(value.occurredAt) <= Date.parse(report.asOf) &&
    (sessionIds.has(value.sessionId) || (state === undefined && (flowVersion === undefined || value.flowVersion === flowVersion))))
    .map(value => [value.eventId, value])).values()].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.eventId.localeCompare(b.eventId));
  return { asOf: report.asOf, total: evidence.length, truncated: evidence.length > limit, events: evidence.slice(0, limit) };
}

/** Shared gauge samples for Prometheus and the actual OpenTelemetry Meter API. */
function samples(report) {
  const values = [];
  const push = (name, value, labels = {}, unit = '1') => { if (value !== null) values.push({ name: `ussd_cohort_${name}`, value, labels, unit }); };
  push('as_of_seconds', Date.parse(report.asOf) / 1000, {}, 's');
  for (const [name, value] of Object.entries(report.summary.evidence)) push('evidence', value, { kind: name });
  for (const flow of report.flows) {
    const labels = { flow_version: flow.flowVersion ?? LABEL_UNKNOWN };
    for (const grain of ['requests', 'turns', 'sessions', 'business']) {
      for (const [outcome, count] of Object.entries(flow[grain].outcomes)) push(grain, count, { ...labels, outcome });
    }
    for (const [name, value] of Object.entries(flow.sessions)) if (name.endsWith('Rate')) {
      push('session_ratio', value.value, { ...labels, measure: name });
      push('session_denominator', value.denominator, { ...labels, measure: name });
    }
    push('validation_retries', flow.turns.validationRetries, labels);
    push('backend_errors', flow.turns.backendErrors, { ...labels, grain: 'turn' });
    push('backend_errors', flow.requests.backendErrors, { ...labels, grain: 'request' });
    emitLatency(flow.latency, labels);
  }
  for (const state of report.states) {
    const labels = { flow_version: state.flowVersion ?? LABEL_UNKNOWN, state: state.state ?? LABEL_UNKNOWN };
    push('state_sessions_reached', state.sessionsReached, labels);
    push('state_validation_retries', state.turns.validationRetries, labels);
    push('state_backend_errors', state.turns.backendErrors, labels);
    for (const [outcome, count] of Object.entries(state.exits)) push('state_exits', count, { ...labels, outcome });
    push('state_dropoff_ratio', state.observedDropOffRate.value, { ...labels, basis: 'observed' });
    push('state_dropoff_ratio', state.inferredDropOffRate.value, { ...labels, basis: 'inferred' });
    push('state_completion_ratio', ratio(state.reachedSessionOutcomes.completed, state.sessionsReached).value, labels);
    emitLatency(state.latency, labels);
  }
  function emitLatency(value, labels) {
    push('turn_duration_samples', value.count, labels);
    push('turn_duration_accumulated_seconds', value.sumMs / 1000, labels, 's');
    for (const name of ['p50', 'p95', 'p99']) {
      push('turn_duration_percentile_seconds', value[name].value === null ? null : value[name].value / 1000, { ...labels, percentile: name }, 's');
      push('turn_duration_min_samples', value[name].minSamples, { ...labels, percentile: name });
    }
  }
  return values;
}
function exportMetricReportPrometheus(sources, options) {
  const report = buildMetricReport(sources, options);
  const grouped = new Map();
  for (const value of samples(report)) {
    if (!grouped.has(value.name)) grouped.set(value.name, []);
    grouped.get(value.name).push(value);
  }
  const escape = value => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return [...grouped].map(([name, values]) => `# HELP ${name} USSD cohort snapshot ${name.slice(12)}\n# TYPE ${name} gauge\n` +
    values.map(value => `${name}${Object.keys(value.labels).length ? '{' + Object.entries(value.labels).map(([key, item]) => `${key}="${escape(item)}"`).join(',') + '}' : ''} ${value.value}`).join('\n')).join('\n\n') + '\n';
}

function createMetricOtelBridge(meter) {
  if (typeof meter?.createObservableGauge !== 'function' || typeof meter?.addBatchObservableCallback !== 'function' ||
      typeof meter?.removeBatchObservableCallback !== 'function') throw new TypeError('OpenTelemetry bridge requires a Meter API');
  let current = [], closed = false;
  const instruments = new Map();
  let knownSeries = new Map();
  const callback = result => { for (const value of current) result.observe(instruments.get(value.name), value.value, value.labels); };
  let registered = false, registeredInstruments = [];
  function update(sources, options) {
    if (closed) throw new Error('OpenTelemetry metric bridge is closed');
    const active = samples(buildMetricReport(sources, options));
    const retained = new Map([...knownSeries].map(([key, value]) => [key, { ...value, value: NaN }]));
    for (const value of active) retained.set(JSON.stringify([value.name, value.labels]), value);
    if (retained.size > 32768) throw new TypeError('OpenTelemetry bridge exceeds series capacity');
    // Cumulative SDK readers retain absent series: explicit NaN invalidates their old values.
    const next = [...retained.values()];
    const names = new Map(next.map(value => [value.name, value.unit]));
    let added = false;
    for (const [name, unit] of names) if (!instruments.has(name)) {
      instruments.set(name, meter.createObservableGauge(name, { description: 'USSD cohort snapshot', unit }));
      added = true;
    }
    if (added) {
      if (registered) meter.removeBatchObservableCallback(callback, registeredInstruments);
      registeredInstruments = [...instruments.values()];
      meter.addBatchObservableCallback(callback, registeredInstruments);
      registered = true;
    }
    knownSeries = retained;
    current = next;
  }
  function close() {
    if (registered) meter.removeBatchObservableCallback(callback, registeredInstruments);
    registered = false; closed = true; current = []; knownSeries.clear();
  }
  return { update, close };
}
module.exports = { DEFAULT_LATENCY_MIN_SAMPLES, buildMetricReport, selectMetricEvidence, exportMetricReportPrometheus, createMetricOtelBridge };
