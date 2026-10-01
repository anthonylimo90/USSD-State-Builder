const { createHmac } = require('node:crypto');
const { createTraceEvent } = require('./TraceSchema');

const METRIC_SCHEMA_VERSION = 1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATE = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const ERRORS = ['validation', 'timeout', 'storage', 'provider', 'handler', 'unknown'];
const FIELDS = {
  request: ['requestId', 'outcome', 'durationMs', 'errorClass'],
  turn: ['turnId', 'position', 'previousState', 'nextState', 'outcome', 'durationMs', 'errorClass'],
  session_start: [],
  session_end: ['outcome'],
  provider_end: ['outcome'],
  business_outcome: ['businessId', 'outcome']
};
function check(condition, message) { if (!condition) throw new TypeError(message); }
function id(value) {
  check(typeof value === 'string' && UUID.test(value), 'Metric IDs must be opaque UUIDs');
  return value.toLowerCase();
}
function timestamp(value) {
  check(typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
    'Metric timestamps must be canonical UTC ISO strings');
  return value;
}
function count(value) { check(Number.isSafeInteger(value) && value >= 0 && value <= 2147483647, 'Invalid metric count'); return value; }
function oneOf(value, values) { check(values.includes(value), 'Unsupported metric outcome'); return value; }

/** Keyed, domain-separated pseudonyms. Never export the source key or use these IDs as labels. */
function createMetricId(secret, namespace, key) {
  check((typeof secret === 'string' || Buffer.isBuffer(secret)) && Buffer.byteLength(secret) >= 32, 'Metric identity needs a secret of at least 32 bytes');
  oneOf(namespace, ['session', 'request', 'turn', 'event', 'provider_event', 'business']);
  check(typeof key === 'string' && key.length > 0 && Buffer.byteLength(key) <= 8192, 'Invalid metric identity key');
  const bytes = createHmac('sha256', secret).update(JSON.stringify(['ussd-metrics-v1', namespace, key])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 128; // UUID v8: application-defined, keyed identity.
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** No raw input, response, provider body, exception or session data is accepted. */
function createMetricEvent(source) {
  check(source && typeof source === 'object' && !Array.isArray(source) && Object.hasOwn(FIELDS, source.eventType), 'Unsupported metric event');
  const allowed = ['schemaVersion', 'eventType', 'eventId', 'occurredAt', 'sessionId', 'flowVersion', ...FIELDS[source.eventType]];
  check(Object.keys(source).every(key => allowed.includes(key)), 'Unsupported metric schema field');
  check(source.schemaVersion === undefined || source.schemaVersion === METRIC_SCHEMA_VERSION, 'Unsupported metric version');
  const flowVersion = source.flowVersion ?? null;
  check(flowVersion === null || (typeof flowVersion === 'string' && VERSION.test(flowVersion)), 'Invalid metric flow version');
  const event = { schemaVersion: METRIC_SCHEMA_VERSION, eventType: source.eventType, eventId: id(source.eventId),
    occurredAt: timestamp(source.occurredAt), sessionId: id(source.sessionId), flowVersion };
  if (source.eventType === 'request' || source.eventType === 'turn') {
    event[source.eventType === 'request' ? 'requestId' : 'turnId'] = id(source[source.eventType === 'request' ? 'requestId' : 'turnId']);
    event.outcome = oneOf(source.outcome, source.eventType === 'request' ? ['accepted', 'replay', 'rejected', 'error'] :
      ['success', 'validation_error', 'error', 'blocked', 'flow_restart']);
    event.durationMs = count(source.durationMs);
    event.errorClass = source.errorClass ?? null;
    check(event.errorClass === null || ERRORS.includes(event.errorClass), 'Invalid metric error class');
    check(['error', 'validation_error'].includes(event.outcome) === (event.errorClass !== null), 'Metric error classification does not match outcome');
    check(event.outcome !== 'validation_error' || event.errorClass === 'validation', 'Validation errors require validation classification');
  }
  if (source.eventType === 'turn') {
    event.position = count(source.position);
    for (const field of ['previousState', 'nextState']) {
      check(source[field] === null || (typeof source[field] === 'string' && STATE.test(source[field])), 'Invalid metric state');
      event[field] = source[field];
    }
  }
  if (source.eventType === 'session_end') event.outcome = oneOf(source.outcome, ['completed', 'cancelled', 'expired', 'unknown']);
  if (source.eventType === 'provider_end') event.outcome = oneOf(source.outcome, ['Success', 'Incomplete', 'Failed']);
  if (source.eventType === 'business_outcome') {
    event.businessId = id(source.businessId);
    event.outcome = oneOf(source.outcome, ['completed', 'cancelled', 'failed']);
  }
  check(Buffer.byteLength(JSON.stringify(event)) <= 2048, 'Metric event exceeds byte limit');
  return Object.freeze(event);
}

/** Attach authoritative logical correlation; generated trace UUIDs are deliberately not reused. */
function metricTurnFromTrace(trace, { eventId, sessionId, turnId, position }) {
  const value = createTraceEvent(trace);
  return createMetricEvent({ eventType: 'turn', eventId, sessionId, turnId, position,
    occurredAt: value.occurredAt, flowVersion: value.flowVersion, previousState: value.previousState,
    nextState: value.nextState, outcome: value.outcome, durationMs: value.durationMs, errorClass: value.errorClass });
}

function rate(numerator, denominator) { return { numerator, denominator, value: denominator ? numerator / denominator : null }; }
function add(map, key, event) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(event);
}
function distinct(values) { return [...new Set(values)]; }
function counts(values, keys) {
  return Object.fromEntries(keys.map(key => [key, values.filter(value => value === key).length]));
}

/** Deterministic batch aggregation. Rebuild from retained evidence when late events arrive. */
function aggregateMetricEvents(sources, { asOf, inactivityMs = null } = {}) {
  timestamp(asOf);
  check(inactivityMs === null || (Number.isSafeInteger(inactivityMs) && inactivityMs > 0 && inactivityMs <= 2147483647), 'Invalid inactivity policy');
  check(Array.isArray(sources) && sources.length <= 100000, 'Metric batch must contain at most 100000 events');
  const events = new Map();
  let duplicateEvents = 0;
  for (const source of sources) {
    const event = createMetricEvent(source);
    const existing = events.get(event.eventId);
    check(!existing || JSON.stringify(existing) === JSON.stringify(event), 'Conflicting metric event identity');
    if (existing) duplicateEvents++;
    else events.set(event.eventId, event);
  }
  const included = [...events.values()].filter(event => Date.parse(event.occurredAt) <= Date.parse(asOf));
  const groups = Object.fromEntries(Object.keys(FIELDS).map(type => [type, new Map()]));
  const sessionEvents = new Map();
  for (const event of included) {
    const key = event.eventType === 'request' ? event.requestId : event.eventType === 'turn' ? event.turnId :
      event.eventType === 'business_outcome' ? event.businessId : event.sessionId;
    add(groups[event.eventType], key, event);
    add(sessionEvents, event.sessionId, event);
  }
  // Distinct envelopes for one logical request/turn/business operation must agree exactly.
  let duplicateFacts = 0;
  for (const type of ['request', 'turn', 'business_outcome']) {
    for (const values of groups[type].values()) {
      const canonical = value => JSON.stringify({ ...value, eventId: null });
      if (type !== 'business_outcome') {
        check(values.every(value => canonical(value) === canonical(values[0])), 'Conflicting logical metric identity');
        duplicateFacts += values.length - 1;
      } else {
        check(values.every(value => value.sessionId === values[0].sessionId && value.flowVersion === values[0].flowVersion), 'Conflicting business correlation');
        duplicateFacts += values.length - distinct(values.map(canonical)).length;
      }
    }
  }
  const requests = [...groups.request.values()].map(values => values[0]);
  const turns = [...groups.turn.values()].map(values => values[0]);
  const positionKeys = new Set();
  for (const turn of turns) {
    const key = `${turn.sessionId}:${turn.position}`;
    check(!positionKeys.has(key), 'Conflicting turn position');
    positionKeys.add(key);
  }
  const requestOutcomes = counts(requests.map(event => event.outcome), ['accepted', 'replay', 'rejected', 'error']);
  const turnOutcomes = counts(turns.map(event => event.outcome), ['success', 'validation_error', 'error', 'blocked', 'flow_restart']);
  const sessionDetails = [];
  const turnsBySession = new Map();
  for (const turn of turns) add(turnsBySession, turn.sessionId, turn);
  let validationRetries = 0;
  for (const values of turnsBySession.values()) {
    values.sort((a, b) => a.position - b.position);
    check(values.every((value, index) => !index || Date.parse(value.occurredAt) >= Date.parse(values[index - 1].occurredAt)), 'Turn timestamps contradict positions');
    for (let index = 1; index < values.length; index++) {
      const previous = values[index - 1], current = values[index];
      if (previous.outcome === 'validation_error' && current.position === previous.position + 1 &&
          previous.previousState !== null && current.previousState === previous.previousState && current.flowVersion === previous.flowVersion) validationRetries++;
    }
  }
  for (const [sessionId, starts] of groups.session_start) {
    const start = starts[0];
    check(starts.every(value => value.occurredAt === start.occurredAt && value.flowVersion === start.flowVersion), 'Conflicting session start');
    duplicateFacts += starts.length - 1;
    const evidence = sessionEvents.get(sessionId);
    check(evidence.every(value => Date.parse(value.occurredAt) >= Date.parse(start.occurredAt)), 'Metric evidence predates session start');
    const sessionTurns = turnsBySession.get(sessionId) || [];
    const endings = groups.session_end.get(sessionId) || [];
    const reasons = distinct(endings.filter(value => value.outcome !== 'unknown').map(value => value.outcome));
    const provider = groups.provider_end.get(sessionId) || [];
    const statuses = distinct(provider.map(value => value.outcome));
    const providerConflict = statuses.length > 1 || new Set(provider.map(value => value.occurredAt)).size !== provider.length;
    const lastActivityAt = [start, ...sessionTurns].reduce((latest, value) => Date.parse(value.occurredAt) > Date.parse(latest) ? value.occurredAt : latest, start.occurredAt);
    let outcome = 'open', basis = 'observed';
    if (reasons.length > 1) { outcome = 'unknown'; basis = 'conflict'; }
    else if (reasons.length) outcome = reasons[0];
    else if (endings.length || provider.length) { outcome = 'unknown'; basis = providerConflict ? 'conflict' : 'observed_closure'; }
    else if (inactivityMs !== null && Date.parse(asOf) - Date.parse(lastActivityAt) >= inactivityMs) { outcome = 'abandoned'; basis = 'inferred'; }
    sessionDetails.push({ sessionId, flowVersion: start.flowVersion, startedAt: start.occurredAt, lastActivityAt,
      lastState: sessionTurns.length ? sessionTurns[sessionTurns.length - 1].nextState ?? sessionTurns[sessionTurns.length - 1].previousState : null,
      outcome, basis, providerOutcome: providerConflict ? 'conflict' : statuses[0] || null });
  }
  sessionDetails.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  const sessionOutcomes = counts(sessionDetails.map(value => value.outcome), ['completed', 'cancelled', 'expired', 'abandoned', 'unknown', 'open']);
  const businessOutcomes = counts([...groups.business_outcome.values()].map(values => {
    const outcomes = distinct(values.map(value => value.outcome));
    return outcomes.length === 1 ? outcomes[0] : 'unknown';
  }), ['completed', 'cancelled', 'failed', 'unknown']);
  const orphans = included.filter(value => value.eventType !== 'session_start' && !groups.session_start.has(value.sessionId));
  return { schemaVersion: METRIC_SCHEMA_VERSION, asOf, inactivityMs,
    evidence: { uniqueEvents: included.length, futureEvents: events.size - included.length, duplicateEvents, duplicateFacts,
      orphanEvents: orphans.length, orphanSessions: new Set(orphans.map(value => value.sessionId)).size },
    requests: { total: requests.length, outcomes: requestOutcomes, errorRate: rate(requestOutcomes.error, requests.length), replayRate: rate(requestOutcomes.replay, requests.length) },
    turns: { total: turns.length, outcomes: turnOutcomes, validationRetries,
      validationRetryRate: rate(validationRetries, turnOutcomes.validation_error),
      validationErrorRate: rate(turnOutcomes.validation_error, turns.length), errorRate: rate(turnOutcomes.error, turns.length),
      errorClasses: counts(turns.filter(value => value.errorClass !== null).map(value => value.errorClass), ERRORS) },
    sessions: { total: sessionDetails.length, outcomes: sessionOutcomes,
      completionRate: rate(sessionOutcomes.completed, sessionDetails.length), cancellationRate: rate(sessionOutcomes.cancelled, sessionDetails.length),
      expiryRate: rate(sessionOutcomes.expired, sessionDetails.length), abandonmentRate: rate(sessionOutcomes.abandoned, sessionDetails.length),
      unknownRate: rate(sessionOutcomes.unknown, sessionDetails.length), details: sessionDetails },
    business: { total: groups.business_outcome.size, outcomes: businessOutcomes,
      completionRate: rate(businessOutcomes.completed, groups.business_outcome.size) }
  };
}
module.exports = { METRIC_SCHEMA_VERSION, createMetricId, createMetricEvent, metricTurnFromTrace, aggregateMetricEvents };
