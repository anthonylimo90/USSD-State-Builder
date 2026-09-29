const { randomUUID } = require('node:crypto');

const TRACE_SCHEMA_VERSION = 1;
const MAX_TRACE_BYTES = 2048;
const MAX_FIXTURE_BYTES = 65536;
const OUTCOMES = new Set(['success', 'validation_error', 'error', 'blocked', 'replay', 'flow_restart']);
const ERRORS = new Set(['validation', 'timeout', 'storage', 'provider', 'handler', 'unknown']);
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OPAQUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function shape(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    throw new TypeError('Unsupported trace schema field');
  }
}
function identifier(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new TypeError('Invalid trace identifier');
  return value;
}
function flowVersion(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !VERSION.test(value)) throw new TypeError('Invalid flow version');
  return value;
}
function bounded(value, max, label) {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > max) throw new TypeError(`${label} exceeds byte limit`);
  return Object.freeze(value);
}
function count(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError('Invalid trace count or time');
  return value;
}
function opaque(value) {
  if (typeof value !== 'string' || !OPAQUE_ID.test(value)) throw new TypeError('Trace IDs must be opaque UUIDs');
  return value;
}

/** Create a bounded, allowlisted event. Arbitrary runtime objects are never copied. */
function createTraceEvent(source) {
  shape(source, ['schemaVersion', 'eventType', 'occurredAt', 'flowVersion', 'requestId', 'turnId',
    'previousState', 'nextState', 'outcome', 'durationMs', 'errorClass']);
  if (source.schemaVersion !== undefined && source.schemaVersion !== TRACE_SCHEMA_VERSION) throw new TypeError('Unsupported trace version');
  if (source.eventType !== undefined && source.eventType !== 'turn') throw new TypeError('Unsupported trace event');
  const occurredAt = source.occurredAt ?? new Date().toISOString();
  if (typeof occurredAt !== 'string' || !Number.isFinite(Date.parse(occurredAt)) ||
      new Date(occurredAt).toISOString() !== occurredAt) throw new TypeError('Invalid trace timestamp');
  if (!OUTCOMES.has(source.outcome)) throw new TypeError('Invalid trace outcome');
  const errorClass = source.errorClass ?? null;
  if (errorClass !== null && !ERRORS.has(errorClass)) throw new TypeError('Invalid trace error class');
  if (['error', 'validation_error'].includes(source.outcome) !== (errorClass !== null)) {
    throw new TypeError('Trace error classification does not match outcome');
  }
  if (source.outcome === 'validation_error' && errorClass !== 'validation') {
    throw new TypeError('Validation errors require validation classification');
  }
  const event = {
    schemaVersion: TRACE_SCHEMA_VERSION, eventType: 'turn', occurredAt,
    flowVersion: flowVersion(source.flowVersion),
    requestId: opaque(source.requestId), turnId: opaque(source.turnId),
    previousState: identifier(source.previousState, true), nextState: identifier(source.nextState, true),
    outcome: source.outcome, durationMs: count(source.durationMs, 0, 2147483647), errorClass
  };
  return bounded(event, MAX_TRACE_BYTES, 'Trace event');
}

/** Convert a complete-turn observation to the common event shape. */
function createTraceObserver(onEvent, { now = () => new Date().toISOString(), id = randomUUID } = {}) {
  if (typeof onEvent !== 'function' || typeof now !== 'function' || typeof id !== 'function') {
    throw new TypeError('Trace observer needs an event callback and clock/ID functions');
  }
  return observation => onEvent(createTraceEvent({
    occurredAt: now(), flowVersion: observation.flowVersion ?? null,
    requestId: id(), turnId: id(), previousState: observation.previousState ?? null,
    nextState: observation.nextState ?? null, outcome: observation.outcome,
    durationMs: observation.durationMs, errorClass: observation.errorClass ?? null
  }));
}

function traceInput(value, provenance) {
  shape(value, ['kind', 'value', 'alias']);
  if (provenance === 'synthetic' && value.kind === 'synthetic' && typeof value.value === 'string' &&
      !Object.hasOwn(value, 'alias') &&
      value.value.length <= 160 && ![...value.value].some(char => char.charCodeAt(0) < 32) &&
      !/(?:\+?254|0)7\d{8}/.test(value.value)) return { kind: 'synthetic', value: value.value };
  if (provenance === 'captured-redacted' && value.kind === 'redacted' && !Object.hasOwn(value, 'value')) {
    return { kind: 'redacted', alias: identifier(value.alias) };
  }
  throw new TypeError('Fixture input must match its provenance');
}
function externalResponse(value, provenance) {
  shape(value, ['operation', 'atMs', 'result', 'statusCode', 'responseRef']);
  if (!['success', 'error'].includes(value.result)) throw new TypeError('Invalid external result');
  if (value.statusCode !== null && (value.statusCode === undefined || !Number.isSafeInteger(value.statusCode) ||
      value.statusCode < 100 || value.statusCode > 599)) throw new TypeError('Invalid external status');
  if (provenance === 'synthetic') identifier(value.responseRef);
  else if (value.responseRef !== null) throw new TypeError('Captured responses cannot contain replay references');
  return { operation: identifier(value.operation), atMs: count(value.atMs, 0, 86400000),
    result: value.result, statusCode: value.statusCode, responseRef: value.responseRef };
}

/** A synthetic fixture can replay; a captured-redacted fixture cannot. */
function createReplayFixture(source) {
  shape(source, ['schemaVersion', 'fixtureType', 'provenance', 'caseId', 'flowVersion', 'clock', 'turns']);
  if (source.schemaVersion !== TRACE_SCHEMA_VERSION || source.fixtureType !== 'turn-sequence' ||
      !['synthetic', 'captured-redacted'].includes(source.provenance)) throw new TypeError('Unsupported fixture version or provenance');
  shape(source.clock, ['startMs']);
  if (!Array.isArray(source.turns) || source.turns.length < 1 || source.turns.length > 64) {
    throw new TypeError('Fixture needs 1-64 turns');
  }
  let previousAt = -1;
  const turns = source.turns.map(turn => {
    shape(turn, ['atMs', 'input', 'external', 'expected']);
    const atMs = count(turn.atMs, 0, 86400000);
    if (atMs < previousAt) throw new TypeError('Fixture time must be monotonic');
    previousAt = atMs;
    if (!Array.isArray(turn.external) || turn.external.length > 16) throw new TypeError('Too many external responses');
    shape(turn.expected, ['outcome', 'state']);
    if (!OUTCOMES.has(turn.expected.outcome)) throw new TypeError('Invalid fixture outcome');
    return { atMs, input: traceInput(turn.input, source.provenance),
      external: turn.external.map(item => externalResponse(item, source.provenance)),
      expected: { outcome: turn.expected.outcome, state: identifier(turn.expected.state, true) } };
  });
  return bounded({ schemaVersion: TRACE_SCHEMA_VERSION, fixtureType: 'turn-sequence',
    provenance: source.provenance, caseId: identifier(source.caseId),
    flowVersion: flowVersion(source.flowVersion), clock: { startMs: count(source.clock.startMs, 0, 8640000000000000) },
    turns }, MAX_FIXTURE_BYTES, 'Trace fixture');
}

module.exports = { TRACE_SCHEMA_VERSION, MAX_TRACE_BYTES, MAX_FIXTURE_BYTES,
  createTraceEvent, createTraceObserver, createReplayFixture };
