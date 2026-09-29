const fs = require('node:fs');
const path = require('node:path');
const { createApp, USSDStateMachine, InMemoryStorage, ValidationError,
  createTraceEvent, createTraceObserver, createReplayFixture, TRACE_SCHEMA_VERSION,
  MAX_TRACE_BYTES, MAX_FIXTURE_BYTES } = require('..');

const idA = '11111111-1111-4111-8111-111111111111';
const idB = '22222222-2222-4222-8222-222222222222';
const baseEvent = { schemaVersion: 1, eventType: 'turn', occurredAt: '2026-09-29T00:00:00.000Z',
  flowVersion: '1.0.0', requestId: idA, turnId: idB, previousState: 'MENU', nextState: 'ITEM',
  outcome: 'success', durationMs: 12, errorClass: null };
const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/traces', name), 'utf8'));

describe('versioned trace contract', () => {
  test('retains only bounded structural fields and rejects sensitive additions without echoing them', () => {
    const event = createTraceEvent(baseEvent);
    expect(event).toEqual(baseEvent);
    expect(TRACE_SCHEMA_VERSION).toBe(1);
    expect(Buffer.byteLength(JSON.stringify(event))).toBeLessThanOrEqual(MAX_TRACE_BYTES);
    for (const field of ['input', 'phoneNumber', 'pin', 'response', 'sessionData', 'error', 'sessionId']) {
      expect(() => createTraceEvent({ ...baseEvent, [field]: 'SENSITIVE_VALUE' })).toThrow('Unsupported trace schema field');
    }
    expect(() => createTraceEvent({ ...baseEvent, previousState: '+254700000001' })).toThrow('Invalid trace identifier');
    expect(() => createTraceEvent({ ...baseEvent, requestId: 'customer-session-1' })).toThrow('Trace IDs must be opaque UUIDs');
    expect(() => createTraceEvent({ ...baseEvent, outcome: 'error', errorClass: null })).toThrow();
    expect(() => createTraceEvent({ ...baseEvent, outcome: 'validation_error', errorClass: 'unknown' })).toThrow();
    expect(() => createTraceEvent({ ...baseEvent, outcome: 'success', errorClass: 'unknown' })).toThrow();
    expect(() => createTraceEvent({ ...baseEvent, schemaVersion: 2 })).toThrow();
  });

  test('emits one safe event after a traditional or SDK turn with state, outcome and timing', async () => {
    const events = [];
    const ids = [idA, idB];
    const observe = createTraceObserver(event => events.push(event), {
      now: () => '2026-09-29T00:00:00.000Z', id: () => ids.shift() || idA
    });
    const machine = createApp().flowVersion('v1').state('MENU', state => state
      .run(() => 'Home').on('1').goto('ITEM'))
      .state('ITEM', state => state.validate(input => {
        if (input === 'bad') throw new ValidationError('Secret validation message');
      }).run(() => 'Item'))
      .logger(null).build();
    machine.useTurnObserver(observe);
    expect(await machine.processInput('private-session', '')).toBe('CON Home');
    expect(await machine.processInput('private-session', '1')).toContain('Item');
    await machine.processInput('private-session', 'bad');
    expect(events.map(event => [event.previousState, event.nextState, event.outcome, event.errorClass]))
      .toEqual([['MENU', 'MENU', 'success', null], ['MENU', 'ITEM', 'success', null],
        ['ITEM', 'ITEM', 'validation_error', 'validation']]);
    expect(events[0]).toMatchObject({ flowVersion: 'v1', requestId: idA, turnId: idB });
    expect(JSON.stringify(events)).not.toMatch(/private-session|Secret validation message|bad/);

    const traditional = new USSDStateMachine({ initialState: 'HOME', storage: new InMemoryStorage(),
      states: { HOME: { handler: () => ({ response: 'END Done' }) } }, logger: null });
    const traditionalEvents = [];
    traditional.useTurnObserver(createTraceObserver(event => traditionalEvents.push(event)));
    await traditional.processInput('another-private-session', 'private-pin');
    expect(traditionalEvents[0]).toMatchObject({ flowVersion: null, previousState: 'HOME', nextState: null });
    expect(JSON.stringify(traditionalEvents)).not.toContain('private-pin');
  });

  test('defers prepared-turn traces until notification after commit', async () => {
    const machine = createApp().flowVersion('v1').storage(new InMemoryStorage()).logger(null)
      .state('MENU', state => state.message('Choose').on('1').goto('ITEM'))
      .state('ITEM', state => state.message('Item')).build();
    const events = [];
    machine.useTurnObserver(createTraceObserver(event => events.push(event)));
    await machine.processInput('private-session', '');
    events.length = 0;
    const session = await machine.storage.getSession('private-session');
    const prepared = await machine.prepareTurn('private-session', '1', { session });
    expect(prepared.response).toBe('CON Item');
    expect(events).toEqual([]);
    await prepared.notify();
    await prepared.notify();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ previousState: 'MENU', nextState: 'ITEM', outcome: 'success' });
  });

  test('classifies thrown errors without copying error text or user input', async () => {
    const machine = new USSDStateMachine({ initialState: 'HOME', storage: new InMemoryStorage(),
      states: { HOME: { handler: () => { throw new Error('secret provider response'); } } }, logger: null });
    const events = [];
    machine.useTurnObserver(createTraceObserver(event => events.push(event)));
    await expect(machine.processInput('private-session', '1234')).rejects.toThrow('secret provider response');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ previousState: 'HOME', nextState: 'HOME',
      outcome: 'error', errorClass: 'unknown' });
    expect(JSON.stringify(events)).not.toMatch(/private-session|1234|secret provider response/);
  });

  test('separates runnable synthetic fixtures from captured dependency shapes', () => {
    const synthetic = createReplayFixture(fixture('synthetic-order.json'));
    const captured = createReplayFixture(fixture('captured-redacted.json'));
    expect(synthetic.provenance).toBe('synthetic');
    expect(synthetic.turns[1].external[0].responseRef).toBe('synthetic-catalog-1');
    expect(captured.provenance).toBe('captured-redacted');
    expect(captured.turns[0].input).toEqual({ kind: 'redacted', alias: 'input-alias-1' });
    expect(Buffer.byteLength(JSON.stringify(synthetic))).toBeLessThanOrEqual(MAX_FIXTURE_BYTES);
    expect(() => createReplayFixture({ ...captured, turns: [{ ...captured.turns[0],
      input: { kind: 'synthetic', value: '1' } }] })).toThrow();
    expect(() => createReplayFixture({ ...captured, turns: [{ ...captured.turns[0],
      input: { kind: 'redacted', alias: 'input-alias-1', value: undefined } }] })).toThrow();
    expect(() => createReplayFixture({ ...captured, turns: [{ ...captured.turns[0],
      external: [{ ...captured.turns[0].external[0], responseRef: 'actual-body' }] }] })).toThrow();
    expect(() => createReplayFixture({ ...synthetic, turns: [{ ...synthetic.turns[0],
      input: { kind: 'synthetic', value: '+254700000001' } }] })).toThrow();
    expect(() => createReplayFixture({ ...synthetic, turns: [{ ...synthetic.turns[0],
      sessionData: { pin: '1234' } }] })).toThrow('Unsupported trace schema field');
    expect(() => createReplayFixture({ ...synthetic, turns: [...synthetic.turns].reverse() })).toThrow('Fixture time must be monotonic');
  });
});
