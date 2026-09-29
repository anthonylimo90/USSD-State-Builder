const { randomUUID } = require('crypto');
const { createApp, RedisStorage, RedisTurnStore, TurnGateway, AfricasTalkingAdapter,
  AfricasTalkingEventAdapter, RedisSessionEventStore, SessionEventGateway } = require('../..');
const describeLive = process.env.RUN_INTEGRATION ? describe : describe.skip;
describeLive('Durable provider end-event reconciliation', () => {
  let storage;
  let eventStore;
  let eventGateway;
  let gateway;
  let turnStore;
  let prefix;
  let calls;
  const config = { applicationId: 'events-test', serviceCode: '*384*000#' };
  const turnAdapter = new AfricasTalkingAdapter(config);
  const eventAdapter = new AfricasTalkingEventAdapter(config);
  const turnWire = (text = '', overrides = {}) => ({ method: 'POST', contentType: 'application/x-www-form-urlencoded',
    body: new URLSearchParams({ sessionId: 'shared', phoneNumber: '+254700000001', networkCode: '99999',
      serviceCode: config.serviceCode, text, ...overrides }).toString() });
  const eventWire = (overrides = {}) => ({ method: 'POST', contentType: 'application/x-www-form-urlencoded',
    body: new URLSearchParams({ date: '2026-09-29 10:11:12', sessionId: 'shared',
      phoneNumber: '+254700000001', networkCode: '99999', serviceCode: config.serviceCode,
      status: 'Incomplete', cost: '0.00', durationInMillis: '1000', hopsCount: '1', hopsMetadata: '',
      input: '', lastAppResponse: 'CON Welcome', ...overrides }).toString() });
  const sessionKey = turnAdapter.normalize(turnWire()).sessionKey;
  beforeEach(async () => {
    prefix = `ussd:event-test:${randomUUID()}:`;
    storage = new RedisStorage({ url: process.env.REDIS_URL || 'redis://localhost:6379', keyPrefix: prefix });
    await storage._ensureConnected();
    eventStore = new RedisSessionEventStore({ storage });
    eventGateway = new SessionEventGateway({ adapter: eventAdapter, store: eventStore });
    turnStore = new RedisTurnStore({ storage });
    calls = 0;
    const machine = createApp().flowVersion('v1').storage(storage).logger(null).state('home', s => s.run(input => {
      calls++;
      return { response: `CON ${input || 'Welcome'}` };
    })).build();
    gateway = new TurnGateway({ adapter: turnAdapter, machine, store: turnStore, eventStore });
  });
  afterEach(async () => {
    const keys = await storage.client.keys(`${prefix}*`);
    if (keys.length) await storage.client.del(keys);
    await storage.close();
  });
  test('duplicate, older and conflicting end events are durably classified; late turns are fenced', async () => {
    const first = await gateway.handle(turnWire());
    expect(first.body).toBe('CON Welcome');
    expect((await eventGateway.handle(eventWire({ phoneNumber: '+254700000002' }))).status).toBe(409);
    expect(await eventStore.read(sessionKey)).toBe(null);
    expect((await eventGateway.handle(eventWire())).classification).toBe('accepted');
    expect((await eventGateway.handle(eventWire())).classification).toBe('duplicate');
    expect((await eventGateway.handle(eventWire({ date: '2026-09-29 10:11:10' }))).classification).toBe('stale');
    expect((await eventGateway.handle(eventWire({ status: 'Failed', date: '2026-09-29 10:11:13' }))).classification).toBe('conflict');
    const journal = await eventStore.read(sessionKey);
    expect(journal).toMatchObject({ revision: 3, outcome: 'conflict', bindingSource: 'turn' });
    expect(journal.events.map(item => item.occurredAt)).toEqual([10, 12, 13].map(second => Date.UTC(2026, 8, 29, 10, 11, second)));
    expect((await gateway.handle(turnWire())).body).toBe(first.body);
    expect((await gateway.handle(turnWire('1'))).status).toBe(409);
    expect((await eventGateway.handle(eventWire({ phoneNumber: '+254700000002' }))).status).toBe(409);
    expect((await eventGateway.handle(eventWire({ serviceCode: '*384*999#' }))).status).toBe(403);
    expect(calls).toBe(1);
  });
  test('a restarted worker accepts an event after active expiry and retains it beyond handset-key deletion', async () => {
    await gateway.handle(turnWire());
    await storage.client.hSet(storage._getKey(sessionKey), 'turnExpiresAt', String(Date.now() - 1));
    const restartedStorage = new RedisStorage({ ...storage.config });
    const restartedEventStore = new RedisSessionEventStore({ storage: restartedStorage });
    const restartedEventGateway = new SessionEventGateway({ adapter: eventAdapter, store: restartedEventStore });
    try {
      expect((await restartedEventGateway.handle(eventWire())).status).toBe(200);
      expect((await restartedEventStore.read(sessionKey)).bindingSource).toBe('turn');
      await storage.client.del(storage._getKey(sessionKey));
      expect((await gateway.handle(turnWire('1'))).status).toBe(409);
      expect((await restartedEventGateway.handle(eventWire())).classification).toBe('duplicate');
      expect((await restartedEventStore.read(sessionKey)).outcome).toBe('Incomplete');
    } finally { await restartedStorage.close(); }
  });
  test('late event without surviving turn binding is retained as event-only evidence', async () => {
    await gateway.handle(turnWire());
    await storage.client.del(storage._getKey(sessionKey));
    expect((await eventGateway.handle(eventWire())).status).toBe(200);
    expect((await eventStore.read(sessionKey)).bindingSource).toBe('event_only');
    expect((await gateway.handle(turnWire())).status).toBe(409);
  });
  test('two workers accepting the same event install one revision', async () => {
    await gateway.handle(turnWire());
    const otherStorage = new RedisStorage({ ...storage.config });
    const other = new SessionEventGateway({ adapter: eventAdapter, store: new RedisSessionEventStore({ storage: otherStorage }) });
    try {
      const responses = await Promise.all([eventGateway.handle(eventWire()), other.handle(eventWire())]);
      expect(responses.map(item => item.classification).sort()).toEqual(['accepted', 'duplicate']);
      expect((await eventStore.read(sessionKey)).revision).toBe(1);
    } finally { await otherStorage.close(); }
  });
  test('a provider end event cancels a pending owner but explicit confirmed recovery may finish', async () => {
    const initial = await gateway.handle(turnWire());
    expect(initial.status).toBe(200);
    let began;
    let abortObserved = false;
    const ready = new Promise(resolve => { began = resolve; });
    const machine = createApp().flowVersion('v1').storage(storage).logger(null).state('home', s => s.run(async (input, id, ctx) => {
      began();
      await new Promise((resolve, reject) => ctx.signal.addEventListener('abort', () => {
        abortObserved = true; reject(ctx.signal.reason);
      }, { once: true }));
      return { response: 'END Late' };
    })).build();
    const owner = new TurnGateway({ adapter: turnAdapter, machine, store: turnStore, eventStore,
      ownershipCheckMs: 10, deadlineMs: 1000 });
    const running = owner.handle(turnWire('1'));
    await ready;
    expect((await eventGateway.handle(eventWire())).status).toBe(200);
    expect((await running).status).toBe(503);
    expect(abortObserved).toBe(true);
    const recovery = new TurnGateway({ adapter: turnAdapter, machine, store: turnStore, eventStore,
      recoverTurn: ({ session }) => ({ response: 'END Confirmed', session }) });
    expect((await recovery.recover(turnWire('1'))).body).toBe('END Confirmed');
    expect((await recovery.handle(turnWire('1'))).body).toBe('END Confirmed');
    expect((await recovery.handle(turnWire('1*2'))).status).toBe(409);
  });
});
