const { randomUUID } = require('node:crypto');
const { createMetricId, createMetricEvent, metricTurnFromTrace, aggregateMetricEvents,
  createTraceEvent, createApp, createTraceObserver } = require('..');
const fixture = require('./fixtures/metrics/synthetic-cohort.json');
const options = { asOf: fixture.asOf, inactivityMs: fixture.inactivityMs };
const sessionId = fixture.events[0].sessionId;
const time = ms => new Date(Date.parse('2026-10-01T00:00:00.000Z') + ms).toISOString();
const event = (eventType, extra = {}) => ({ eventType, eventId: randomUUID(), sessionId, occurredAt: time(1000), flowVersion: 'v1', ...extra });
const baseTurn = () => event('turn', { turnId: randomUUID(), position: 0, previousState: 'START', nextState: 'MENU', outcome: 'success', durationMs: 10 });

describe('metric identities and schema', () => {
  test('keyed IDs are stable, domain separated and never include their source', () => {
    const secret = 'a'.repeat(32);
    const value = createMetricId(secret, 'session', 'provider-private-key');
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(createMetricId(secret, 'session', 'provider-private-key')).toBe(value);
    expect(createMetricId(secret, 'turn', 'provider-private-key')).not.toBe(value);
    expect(createMetricId('b'.repeat(32), 'session', 'provider-private-key')).not.toBe(value);
    expect(() => createMetricId('short', 'session', 'key')).toThrow();
    expect(() => createMetricId(secret, 'phone', 'key')).toThrow();
  });
  test.each(['input', 'response', 'phoneNumber', 'fields', 'data', 'errorMessage'])('rejects raw field %s', field => {
    expect(() => createMetricEvent(event('session_start', { [field]: 'private' }))).toThrow('Unsupported metric schema field');
  });
  test.each([
    { schemaVersion: 2 }, { occurredAt: '2026-10-01' }, { sessionId: 'raw-session' },
    { eventId: 'raw-event' }, { eventType: '__proto__' }, { flowVersion: 'private value' }
  ])('rejects malformed common fields %j', extra => expect(() => createMetricEvent(event('session_start', extra))).toThrow());
  test.each([{ outcome: 'replay' }, { durationMs: -1 }, { position: 0.5 }, { errorClass: 'storage' },
    { previousState: 'free text' }, { nextState: undefined }, { outcome: 'validation_error', errorClass: 'handler' }])(
    'rejects malformed turn %j', extra => expect(() => createMetricEvent({ ...baseTurn(), ...extra })).toThrow());
  test('normalizes UUID casing and freezes the allowlisted envelope', () => {
    const value = createMetricEvent(event('session_start', { sessionId: sessionId.toUpperCase() }));
    expect(Object.isFrozen(value)).toBe(true);
    expect(value.sessionId).toBe(sessionId);
    expect(value.schemaVersion).toBe(1);
  });
  test('trace conversion requires caller correlation and rejects replay as a new turn', () => {
    const trace = createTraceEvent({ requestId: randomUUID(), turnId: randomUUID(), occurredAt: time(1000), flowVersion: 'v1',
      previousState: 'START', nextState: 'MENU', outcome: 'success', durationMs: 10 });
    const correlation = { eventId: randomUUID(), sessionId, turnId: randomUUID(), position: 0 };
    expect(metricTurnFromTrace(trace, correlation)).toMatchObject(correlation);
    expect(metricTurnFromTrace(trace, correlation).turnId).not.toBe(trace.turnId);
    expect(() => metricTurnFromTrace({ ...trace, outcome: 'replay' }, correlation)).toThrow();
  });
  test('projects an actual committed fluent SDK observation', async () => {
    const events = [];
    const app = createApp().state('START', state => state.run(() => 'END Welcome')).logger(null).build();
    app.useTurnObserver(createTraceObserver(trace => events.push(metricTurnFromTrace(trace,
      { eventId: randomUUID(), sessionId, turnId: randomUUID(), position: 0 })), { now: () => time(1000) }));
    await app.processInput('synthetic-private-session', '');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: 'turn', outcome: 'success', nextState: null });
    expect(JSON.stringify(events)).not.toContain('synthetic-private-session');
  });
});

describe('known metric cohort', () => {
  test('independently checked totals and explicit denominators', () => {
    const result = aggregateMetricEvents(fixture.events, options);
    expect(result.evidence).toEqual({ uniqueEvents: 30, futureEvents: 1, duplicateEvents: 3, duplicateFacts: 2, orphanEvents: 1, orphanSessions: 1 });
    expect(result.requests).toMatchObject({ total: 8, outcomes: { accepted: 5, replay: 1, rejected: 1, error: 1 }, errorRate: { numerator: 1, denominator: 8, value: 0.125 } });
    expect(result.turns).toMatchObject({ total: 7, validationRetries: 1, validationRetryRate: { numerator: 1, denominator: 1, value: 1 }, outcomes: { success: 5, validation_error: 1, error: 1, blocked: 0, flow_restart: 0 },
      validationErrorRate: { numerator: 1, denominator: 7, value: 1 / 7 }, errorRate: { numerator: 1, denominator: 7, value: 1 / 7 } });
    expect(result.sessions.outcomes).toEqual({ completed: 1, cancelled: 1, expired: 1, abandoned: 1, unknown: 1, open: 1 });
    expect(result.sessions.completionRate).toEqual({ numerator: 1, denominator: 6, value: 1 / 6 });
    expect(result.business).toMatchObject({ total: 2, outcomes: { completed: 1, cancelled: 1, failed: 0, unknown: 0 }, completionRate: { numerator: 1, denominator: 2, value: 0.5 } });
  });
  test('delivery order does not affect the report', () => {
    expect(aggregateMetricEvents([...fixture.events].reverse(), options)).toEqual(aggregateMetricEvents(fixture.events, options));
  });
  test('absence of an inactivity policy leaves silent sessions open', () => {
    const result = aggregateMetricEvents(fixture.events, { asOf: fixture.asOf });
    expect(result.sessions.outcomes).toMatchObject({ abandoned: 0, open: 2 });
  });
  test('late provider closure corrects inference without claiming expiry or completion', () => {
    const result = aggregateMetricEvents([...fixture.events, event('provider_end', { sessionId: fixture.events[3].sessionId, occurredAt: time(1000), outcome: 'Incomplete' })], options);
    expect(result.sessions.outcomes).toMatchObject({ abandoned: 0, unknown: 2, completed: 1, expired: 1 });
    expect(result.sessions.details.find(value => value.sessionId === fixture.events[3].sessionId)).toMatchObject({ basis: 'observed_closure', providerOutcome: 'Incomplete' });
  });
  test('late authored completion replaces inferred abandonment', () => {
    const result = aggregateMetricEvents([...fixture.events, event('session_end', { sessionId: fixture.events[3].sessionId, occurredAt: time(1000), outcome: 'completed' })], options);
    expect(result.sessions.outcomes).toMatchObject({ abandoned: 0, completed: 2 });
  });
  test('provider conflicts remain visible beside independently authored completion', () => {
    const values = [event('session_start', { occurredAt: time(0) }), event('session_end', { outcome: 'completed' }),
      event('provider_end', { outcome: 'Success' }), event('provider_end', { outcome: 'Failed', occurredAt: time(2000) })];
    const result = aggregateMetricEvents(values.reverse(), options);
    expect(result.sessions.details[0]).toMatchObject({ outcome: 'completed', providerOutcome: 'conflict' });
    expect(aggregateMetricEvents(values.filter(value => value.eventType !== 'session_end'), options).sessions.details[0]).toMatchObject({ outcome: 'unknown', basis: 'conflict' });
  });
  test('different provider fingerprints at the same timestamp conflict like the event store', () => {
    const result = aggregateMetricEvents([event('session_start', { occurredAt: time(0) }), event('provider_end', { outcome: 'Success' }), event('provider_end', { outcome: 'Success' })], options);
    expect(result.sessions.details[0].providerOutcome).toBe('conflict');
  });
  test('contradictory authored closures and business facts are unknown', () => {
    const businessId = randomUUID();
    const result = aggregateMetricEvents([event('session_start', { occurredAt: time(0) }),
      event('session_end', { outcome: 'completed' }), event('session_end', { outcome: 'cancelled' }),
      event('business_outcome', { businessId, outcome: 'completed' }), event('business_outcome', { businessId, outcome: 'failed' })], options);
    expect(result.sessions.details[0]).toMatchObject({ outcome: 'unknown', basis: 'conflict' });
    expect(result.business.outcomes.unknown).toBe(1);
  });
  test('a late start repairs the session denominator for previously orphaned closure', () => {
    const orphan = fixture.events.find(value => value.eventType === 'provider_end' && value.sessionId !== fixture.events[4].sessionId && value.occurredAt === time(600));
    const result = aggregateMetricEvents([...fixture.events, event('session_start', { sessionId: orphan.sessionId, occurredAt: time(0) })], options);
    expect(result.sessions.total).toBe(7);
    expect(result.sessions.outcomes.unknown).toBe(2);
    expect(result.evidence.orphanEvents).toBe(0);
  });
  test('duplicate operation evidence counts one business fact and conflicting correlation fails', () => {
    const first = event('business_outcome', { businessId: randomUUID(), outcome: 'completed' });
    const result = aggregateMetricEvents([first, { ...first, eventId: randomUUID() }], options);
    expect(result.business.total).toBe(1);
    expect(result.business.outcomes.completed).toBe(1);
    expect(result.evidence.duplicateFacts).toBe(1);
  });
  test('zero denominators are null and no future evidence is pulled in', () => {
    const result = aggregateMetricEvents([event('session_start', { occurredAt: time(12000) })], options);
    expect(result.sessions.completionRate).toEqual({ numerator: 0, denominator: 0, value: null });
    expect(result.evidence.futureEvents).toBe(1);
  });
  test('unknown application closure can later gain an explicit reason', () => {
    const result = aggregateMetricEvents([event('session_start', { occurredAt: time(0) }), event('session_end', { outcome: 'unknown' }), event('session_end', { outcome: 'cancelled' })], options);
    expect(result.sessions.outcomes.cancelled).toBe(1);
  });
  test.each(['eventId', 'turnId', 'position'])('rejects contradictory %s rather than counting first arrival', key => {
    const first = baseTurn();
    const second = { ...first, eventId: randomUUID(), durationMs: 99 };
    if (key === 'eventId') second.eventId = first.eventId;
    if (key === 'position') second.turnId = randomUUID();
    expect(() => aggregateMetricEvents([first, second], options)).toThrow('Conflicting');
  });
  test('rejects contradictory starts, timestamps and business ownership', () => {
    expect(() => aggregateMetricEvents([event('session_start'), event('session_start', { occurredAt: time(2000) })], options)).toThrow('Conflicting session start');
    expect(() => aggregateMetricEvents([event('session_start'), { ...baseTurn(), occurredAt: time(0) }], options)).toThrow('predates');
    expect(() => aggregateMetricEvents([baseTurn(), { ...baseTurn(), position: 1, occurredAt: time(0) }], options)).toThrow('timestamps contradict');
    const businessId = randomUUID();
    expect(() => aggregateMetricEvents([event('business_outcome', { businessId, outcome: 'completed' }), event('business_outcome', { businessId, outcome: 'completed', sessionId: randomUUID() })], options)).toThrow('business correlation');
  });
  test('validation retries require adjacent positions, same state and flow version', () => {
    const first = { ...baseTurn(), outcome: 'validation_error', errorClass: 'validation' };
    for (const changes of [{ position: 2 }, { previousState: 'OTHER' }, { flowVersion: 'v2' }]) {
      expect(aggregateMetricEvents([first, { ...baseTurn(), position: 1, ...changes }], options).turns.validationRetries).toBe(0);
    }
  });
  test('inactivity uses the last logical turn, not replay traffic, and the exact threshold', () => {
    const values = [event('session_start', { occurredAt: time(0) }), { ...baseTurn(), occurredAt: time(5000) },
      event('request', { requestId: randomUUID(), outcome: 'replay', durationMs: 1, occurredAt: time(9999) })];
    expect(aggregateMetricEvents(values, options).sessions.outcomes.abandoned).toBe(1);
    expect(aggregateMetricEvents(values, { ...options, asOf: time(9999) }).sessions.outcomes.open).toBe(1);
  });
  test('rejects missing as-of, invalid inference windows and oversized batches', () => {
    expect(() => aggregateMetricEvents([])).toThrow();
    expect(() => aggregateMetricEvents([], { ...options, inactivityMs: 0 })).toThrow();
    expect(() => aggregateMetricEvents(Array(100001), options)).toThrow('at most');
  });
});
