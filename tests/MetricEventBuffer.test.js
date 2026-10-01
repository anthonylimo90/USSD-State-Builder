const { MetricEventBuffer, createMetricOtelBridge, createMetricId } = require('..');
const fixture = require('./fixtures/metrics/synthetic-cohort.json');
const id = n => createMetricId('x'.repeat(32), 'event', String(n));
const time = Date.parse(fixture.asOf);
const start = (n = 1, at = time) => ({ schemaVersion: 1, eventType: 'session_start', eventId: id(n), sessionId: id(n + 10000), flowVersion: 'v1', occurredAt: new Date(at).toISOString() });
const make = options => new MetricEventBuffer({ flowVersions: ['v1', 'mavuno-v1'], states: ['START', 'MENU', 'QUANTITY', 'DONE'], now: () => time, ...options });
const settle = () => new Promise(resolve => setImmediate(resolve));

describe('bounded metric evidence', () => {
  test.each([{ maxEvents: 1 }, { maxSessions: 1 }])('rejects newest evidence at a configured bound %o', controls => {
    const buffer = make(controls);
    expect(buffer.record(start())).toEqual({ accepted: true, duplicate: false });
    expect(buffer.record(start(2))).toEqual({ accepted: false, reason: 'capacity' });
    expect(buffer.snapshot().report.summary.sessions.total).toBe(1);
  });
  test('flow-group capacity includes null without poisoning snapshots', () => {
    const versions = Array.from({ length: 128 }, (_, index) => `v${index}`);
    const buffer = make({ flowVersions: versions });
    versions.forEach((flowVersion, index) => expect(buffer.record({ ...start(index + 1), flowVersion }).accepted).toBe(true));
    expect(buffer.record({ ...start(200), flowVersion: null }).reason).toBe('capacity');
    expect(buffer.snapshot().report.flows).toHaveLength(128);
  });
  test('byte capacity and exact duplicates do not consume extra slots', () => {
    const buffer = make({ maxBytes: 2048 });
    expect(buffer.record(start()).accepted).toBe(true);
    const bytes = buffer.stats().bytes;
    expect(buffer.record(start()).duplicate).toBe(true);
    expect(buffer.stats().bytes).toBe(bytes);
    for (let n = 2; n < 30; n++) buffer.record(start(n));
    expect(buffer.stats()).toMatchObject({ capacity: expect.any(Number) });
    expect(buffer.stats().capacity).toBeGreaterThan(0);
    expect(buffer.stats().bytes).toBeLessThanOrEqual(2048);
  });
  test('rejects conflicting envelopes and logical identifiers without poisoning reports', () => {
    const buffer = make();
    const request = fixture.events.find(event => event.eventType === 'request');
    expect(buffer.record(request).accepted).toBe(true);
    expect(buffer.record({ ...request, durationMs: request.durationMs + 1 }).reason).toBe('invalid');
    expect(buffer.record({ ...request, eventId: id(500), sessionId: id(501) }).reason).toBe('invalid');
    expect(buffer.snapshot().report.summary.requests.total).toBe(1);
  });
  test('rejects chronology errors before retaining a late start', () => {
    const buffer = make();
    const turn = fixture.events.find(event => event.eventType === 'turn');
    expect(buffer.record(turn).accepted).toBe(true);
    expect(buffer.record({ ...start(200), sessionId: turn.sessionId, occurredAt: new Date(time).toISOString() }).reason).toBe('invalid');
    expect(() => buffer.snapshot()).not.toThrow();
  });
  test('whole-session expiry uses the earliest evidence and survives clock regression', () => {
    let clock = time;
    const buffer = make({ now: () => clock, retentionMs: 1000 });
    const event = start(); buffer.record(event);
    clock += 999;
    buffer.record({ ...event, eventId: id(2), eventType: 'session_end', outcome: 'completed', occurredAt: new Date(clock).toISOString() });
    expect(buffer.stats().events).toBe(2);
    clock++;
    expect(buffer.snapshot().report.summary.sessions.total).toBe(0);
    expect(buffer.stats().evictedEvents).toBe(2);
    clock -= 1000;
    expect(buffer.record(event).reason).toBe('denied');
  });
  test('expired and future events are rejected with explicit skew policy', () => {
    const buffer = make({ retentionMs: 1000 });
    expect(buffer.record(start(1, time - 1000)).reason).toBe('expired');
    expect(buffer.record(start(2, time + 1)).reason).toBe('future');
    const tolerant = make({ maxFutureSkewMs: 100 });
    expect(tolerant.record(start(3, time + 100)).accepted).toBe(true);
    expect(tolerant.snapshot().report.summary.sessions.total).toBe(0);
  });
  test('deletion is idempotent and denies fresh evidence for that session forever', () => {
    let clock = time;
    const buffer = make({ now: () => clock, retentionMs: 1000 });
    const event = start(); buffer.record(event); buffer.record(start(2));
    expect(buffer.deleteSession(event.sessionId.toUpperCase()).deletedEvents).toBe(1);
    expect(buffer.deleteSession(event.sessionId).deletedEvents).toBe(0);
    expect(buffer.snapshot().events.some(value => value.sessionId === event.sessionId)).toBe(false);
    clock += 2000;
    expect(buffer.record({ ...event, occurredAt: new Date(clock).toISOString() }).reason).toBe('denied');
  });
  test('tombstone overflow seals ingestion instead of forgetting deleted identities', () => {
    const buffer = make({ maxTombstones: 1 });
    buffer.deleteSession(start().sessionId);
    expect(buffer.deleteSession(start(2).sessionId).ingestionPaused).toBe(true);
    expect(buffer.record(start(3)).reason).toBe('capacity');
    expect(buffer.stats().tombstones).toBe(1);
  });
  test('clear and close erase local evidence and prevent ingestion', async () => {
    const buffer = make(); buffer.record(start()); buffer.clear();
    expect(buffer.stats()).toMatchObject({ events: 0, bytes: 0, sessions: 0, tombstones: 0, ingestionPaused: true });
    expect(buffer.record(start()).reason).toBe('capacity');
    buffer.close(); buffer.close();
    expect(buffer.record(start()).reason).toBe('closed');
    expect(buffer.stats().rejectedClosed).toBe(1);
    expect(await buffer.flush()).toEqual({ status: 'closed' });
    expect(() => buffer.snapshot()).toThrow('closed');
  });
  test('raw data, arbitrary labels, phone labels and UUID labels cannot enter the buffer', () => {
    const onFailure = jest.fn(() => { throw new Error('private'); });
    const buffer = make({ onFailure });
    expect(buffer.record({ ...start(), phoneNumber: '+254712345678' }).reason).toBe('invalid');
    expect(buffer.record({ ...start(), flowVersion: 'unknown-caller' }).reason).toBe('labels');
    expect(buffer.stats().events).toBe(0);
    expect(onFailure).toHaveBeenCalledWith({ code: 'record_invalid' });
    expect(() => make({ flowVersions: ['254712345678'] })).toThrow('allowlist');
    expect(() => make({ flowVersions: [id(1)] })).toThrow('allowlist');
  });
  test.each([{ retentionMs: 0 }, { maxEvents: Infinity }, { exportTimeoutMs: 60001 }, { states: undefined }, { maxFutureSkewMs: -1 }])('rejects invalid policy %o', options => {
    expect(() => make(options)).toThrow();
  });
  test('clock failures are classified without leaking exceptions', async () => {
    const buffer = make({ now: () => { throw new Error('secret'); } });
    expect(buffer.record(start()).reason).toBe('invalid');
    expect(await buffer.flush()).toEqual({ status: 'failed', code: 'clock_invalid' });
  });
});

describe('export lifecycle', () => {
  test('one hung physical export holds its slot after the public timeout', async () => {
    jest.useFakeTimers();
    let release;
    const exporter = jest.fn(() => new Promise(resolve => { release = resolve; }));
    const failures = [];
    const buffer = make({ exporter, exportTimeoutMs: 20, onFailure: value => failures.push(value) });
    const pending = buffer.flush(); await Promise.resolve();
    jest.advanceTimersByTime(20);
    expect(await pending).toEqual({ status: 'timeout' });
    for (let i = 0; i < 10; i++) expect(await buffer.flush()).toEqual({ status: 'busy' });
    expect(exporter).toHaveBeenCalledTimes(1);
    expect(failures).toEqual([{ code: 'export_timeout' }]);
    expect(exporter.mock.calls[0][1].signal.aborted).toBe(true);
    release(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    jest.useRealTimers(); await settle();
    expect(buffer.stats().exportInFlight).toBe(false);
    buffer.close();
  });
  test.each(['delete', 'expiry', 'clear', 'close'])('%s invalidates an in-flight snapshot before publication', async action => {
    let clock = time, release, context;
    const buffer = make({ retentionMs: 1000, now: () => clock, exporter: (_, controls) => { context = controls; return new Promise(resolve => { release = resolve; }); } });
    buffer.record(start());
    const pending = buffer.flush(); await Promise.resolve();
    if (action === 'delete') buffer.deleteSession(start().sessionId);
    if (action === 'expiry') { clock += 1000; buffer.stats(); }
    if (action === 'clear') buffer.clear();
    if (action === 'close') buffer.close();
    expect(await pending).toEqual({ status: 'invalidated' });
    expect(context.isCurrent()).toBe(false);
    expect(context.signal.aborted).toBe(true);
    release(); await settle();
    expect(buffer.stats().exports).toBe(0);
    buffer.close();
  });
  test('export and failure observer rejections are isolated, next flush can recover', async () => {
    const exporter = jest.fn().mockRejectedValueOnce(new Error('secret')).mockResolvedValue(undefined);
    const buffer = make({ exporter, onFailure: async () => { throw new Error('secret'); } });
    expect(await buffer.flush()).toEqual({ status: 'failed', code: 'export_failed' });
    expect(await buffer.flush()).toEqual({ status: 'exported' });
    buffer.close();
  });
  test('deleted cohort is corrected in the next exported report', async () => {
    const reports = [];
    const buffer = make({ exporter: snapshot => reports.push(snapshot.report) });
    buffer.record(start()); buffer.record(start(2));
    await buffer.flush(); buffer.deleteSession(start().sessionId); await buffer.flush();
    expect(reports.map(report => report.summary.sessions.total)).toEqual([2, 1]);
    expect(JSON.stringify(reports)).not.toContain(start().sessionId);
    buffer.close();
  });
  test('without an exporter no work or background timer is created', async () => {
    expect(await make().flush()).toEqual({ status: 'no_exporter' });
  });
});

describe('OpenTelemetry bounded series and recovery', () => {
  const meter = () => ({ createObservableGauge: jest.fn(() => ({})), addBatchObservableCallback: jest.fn(), removeBatchObservableCallback: jest.fn() });
  test('series overflow preserves the previous callback snapshot', () => {
    const sink = meter(), bridge = createMetricOtelBridge(sink, { maxSeries: 100 });
    bridge.update([], { asOf: fixture.asOf });
    const callback = sink.addBatchObservableCallback.mock.calls[0][0];
    const before = []; callback({ observe: (...args) => before.push(args) });
    expect(() => bridge.update(fixture.events, fixture)).toThrow('capacity');
    const after = []; callback({ observe: (...args) => after.push(args) });
    expect(after).toEqual(before); bridge.close();
  });
  test('partial instrument creation failure can recover its full registration', () => {
    const sink = meter(), bridge = createMetricOtelBridge(sink);
    sink.createObservableGauge.mockImplementationOnce(() => ({})).mockImplementationOnce(() => { throw new Error('unavailable'); });
    expect(() => bridge.update([], { asOf: fixture.asOf })).toThrow('unavailable');
    bridge.update([], { asOf: fixture.asOf });
    expect(sink.addBatchObservableCallback.mock.calls[0][1].length).toBe(sink.createObservableGauge.mock.calls.length - 1);
    bridge.close();
  });
});
