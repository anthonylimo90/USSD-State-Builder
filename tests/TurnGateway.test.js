const { createApp, InMemoryStorage, AfricasTalkingAdapter, TurnGateway, InMemoryTurnStore } = require('..');
const adapter = () => new AfricasTalkingAdapter({ applicationId: 'turn-tests', serviceCode: '*384*000#' });
const wire = text => ({ method: 'POST', contentType: 'application/x-www-form-urlencoded', body: new URLSearchParams({
  sessionId: 'one', phoneNumber: '+254700000001', networkCode: '99999', serviceCode: '*384*000#', text
}).toString() });
function setup(options = {}) {
  const storage = new InMemoryStorage();
  const effect = jest.fn((input, id, context) => ({ response: `CON Count ${(context.sessionData?.count || 0) + 1}: ${input}`, data: { count: (context.sessionData?.count || 0) + 1 } }));
  const machine = createApp().flowVersion('v1').storage(storage).logger(null).state('home', s => s.run(effect)).build();
  const store = new InMemoryTurnStore({ storage });
  const gateway = new TurnGateway({ machine, adapter: adapter(), store, ...options });
  return { storage, effect, machine, store, gateway };
}

test('repeated callbacks replay their exact response; identical choices at different positions execute distinct turns', async () => {
  const { gateway, effect, store } = setup();
  const first = await gateway.handle(wire(''));
  expect(await gateway.handle(wire(''))).toEqual(first);
  const one = await gateway.handle(wire('1'));
  const two = await gateway.handle(wire('1*1'));
  expect(await gateway.handle(wire('1'))).toEqual(one);
  expect(await gateway.handle(wire('1*1'))).toEqual(two);
  expect(effect).toHaveBeenCalledTimes(3);
  const record = await store.read(adapter().normalize(wire('')).sessionKey);
  expect(record.revision).toBe(3);
  expect(record.session.data.count).toBe(3);
});

test('staged state/data/history and lifecycle callbacks are invisible until commit', async () => {
  const storage = new InMemoryStorage();
  const entered = jest.fn();
  const machine = createApp().storage(storage).state('home', s => s.message('Home').on('1').goto('next'))
    .state('next', s => s.message('Next').onEnter(entered)).build();
  await machine.processInput('staged', '');
  const prepared = await machine.prepareTurn('staged', '1', { session: await storage.getSession('staged') });
  expect(await machine.getCurrentState('staged')).toBe('home');
  expect(prepared.session.state).toBe('next');
  expect(prepared.session.stateHistory).toEqual(['home']);
  expect(entered).not.toHaveBeenCalled();
  await prepared.notify();
  await prepared.notify();
  expect(entered).toHaveBeenCalledTimes(1);
});

test('writes through captured machine methods are staged and retained definitions share the stage', async () => {
  const storage = new InMemoryStorage();
  let old;
  old = createApp().flowVersion('v1').storage(storage).state('home', s => s.run(async () => {
    await old.setSessionData('captured', { captured: true });
    return { response: 'CON Old' };
  })).build();
  const current = createApp().flowVersion('v2', { previousFlows: [old] }).storage(storage).state('home', s => s.message('New')).build();
  const prepared = await current.prepareTurn('captured', '', { session: { state: 'home', data: { __ussdFlow: { version: 'v1' } }, stateHistory: [] } });
  expect(await storage.getData('captured')).toBeFalsy();
  expect(prepared.response).toBe('CON Old');
  expect(prepared.session.data).toMatchObject({ captured: true, __ussdFlow: { version: 'v1' } });
});

test('commit failure leaves the original state and revision intact and blocks uncertain re-execution', async () => {
  const { gateway, store, storage, effect } = setup();
  await gateway.handle(wire(''));
  const key = adapter().normalize(wire('')).sessionKey;
  const prior = await storage.getData(key);
  store.commit = jest.fn(async () => { throw new Error('Crash before commit'); });
  expect((await gateway.handle(wire('1'))).status).toBe(500);
  expect(await storage.getData(key)).toEqual(prior);
  expect((await store.read(key)).revision).toBe(1);
  expect((await gateway.handle(wire('1'))).status).toBe(503);
  expect(effect).toHaveBeenCalledTimes(2);
});

test('concurrent workers replay completed receipts without repeating a handler', async () => {
  const { gateway, store, machine, effect } = setup();
  const other = new TurnGateway({ machine, adapter: adapter(), store });
  await gateway.handle(wire(''));
  const results = await Promise.all([gateway.handle(wire('1')), other.handle(wire('1'))]);
  expect(results.some(result => result.status === 200)).toBe(true);
  expect(await other.handle(wire('1'))).toEqual(results.find(result => result.status === 200));
  expect(effect).toHaveBeenCalledTimes(2);
});

test('conflicts, gaps and changed callers do not execute handlers', async () => {
  const { gateway, effect } = setup();
  await gateway.handle(wire(''));
  await gateway.handle(wire('1'));
  for (const text of ['2', '1*1*2']) expect((await gateway.handle(wire(text))).status).toBe(409);
  const changed = wire('1');
  changed.body = changed.body.replace('700000001', '700000002');
  expect((await gateway.handle(changed)).status).toBe(409);
  expect(effect).toHaveBeenCalledTimes(2);
});

test('receipt expiry is independent of active expiry and replay never extends retention', async () => {
  jest.useFakeTimers();
  try {
    const { gateway, effect, store } = setup({ receiptTTL: 600 });
    const first = await gateway.handle(wire(''));
    jest.advanceTimersByTime(301000);
    expect(await gateway.handle(wire(''))).toEqual(first);
    expect((await gateway.handle(wire('1'))).status).toBe(409);
    jest.advanceTimersByTime(300000);
    expect(await store.read(adapter().normalize(wire('')).sessionKey)).toBe(null);
    expect(effect).toHaveBeenCalledTimes(1);
  } finally { jest.useRealTimers(); }
});

test('explicit journal recovery commits a crashed external effect without rerunning its handler', async () => {
  const storage = new InMemoryStorage();
  const journal = new Map();
  const handler = jest.fn((input, id, ctx) => {
    if (!input) return { response: 'CON Pay' };
    journal.set(ctx.turn.idempotencyKey, { response: 'END Paid', data: { paid: true } });
    throw new Error('Crash after external effect');
  });
  const machine = createApp().storage(storage).logger(null).state('home', s => s.run(handler)).build();
  const store = new InMemoryTurnStore({ storage });
  const first = new TurnGateway({ adapter: adapter(), machine, store });
  await first.handle(wire(''));
  expect((await first.handle(wire('1'))).status).toBe(500);
  const recovery = new TurnGateway({ adapter: adapter(), machine, store, recoverTurn: ({ pending, session }) => {
    const result = journal.get(pending.idempotencyKey);
    return result && { response: result.response, session: { ...session, data: { ...session.data, ...result.data }, expiresAt: Date.now() + 300000 } };
  } });
  expect((await recovery.recover(wire('1'))).body).toBe('END Paid');
  expect((await first.handle(wire('1'))).body).toBe('END Paid');
  expect((await first.handle(wire('1*1'))).status).toBe(409);
  expect(handler).toHaveBeenCalledTimes(2);
  expect(journal.size).toBe(1);
  const record = await store.read(adapter().normalize(wire('')).sessionKey);
  expect(record).toMatchObject({ revision: 2, pending: null, session: { data: { paid: true, __ussdLifecycle: { completedResponse: 'END Paid' } } } });
});

test('receipt capacity rejects new work rather than silently evicting replay evidence', async () => {
  const { gateway, effect } = setup({ maxTurns: 1 });
  const first = await gateway.handle(wire(''));
  expect((await gateway.handle(wire('1'))).status).toBe(409);
  expect(await gateway.handle(wire(''))).toEqual(first);
  expect(effect).toHaveBeenCalledTimes(1);
});

test('a lost commit acknowledgement replays the committed response after restart', async () => {
  const { gateway, store, effect, machine } = setup();
  await gateway.handle(wire(''));
  const commit = store.commit.bind(store);
  store.commit = async (...args) => { await commit(...args); throw new Error('Lost acknowledgement'); };
  expect((await gateway.handle(wire('1'))).status).toBe(500);
  store.commit = commit;
  const restarted = new TurnGateway({ adapter: adapter(), machine, store });
  expect((await restarted.handle(wire('1'))).body).toBe('CON Count 2: 1');
  expect(effect).toHaveBeenCalledTimes(2);
});

test('post-commit lifecycle and observer failures cannot change the recorded response', async () => {
  const storage = new InMemoryStorage();
  const machine = createApp().storage(storage).logger({ error() { throw new Error('Logger failed'); } })
    .state('home', s => s.message('Home').on('1').goto('done'))
    .state('done', s => s.message('Done').end()).build();
  const store = new InMemoryTurnStore({ storage });
  const ended = jest.fn(async () => {
    expect((await store.read(adapter().normalize(wire('')).sessionKey)).revision).toBe(2);
    throw new Error('Notification failed');
  });
  machine.use('onSessionEnd', ended);
  machine.useTurnObserver(() => { throw new Error('Observer failed'); });
  const gateway = new TurnGateway({ adapter: adapter(), machine, store });
  expect((await gateway.handle(wire(''))).status).toBe(200);
  const result = await gateway.handle(wire('1'));
  expect(result).toMatchObject({ status: 200, body: 'END Done' });
  expect(await gateway.handle(wire('1'))).toEqual(result);
  expect(ended).toHaveBeenCalledTimes(1);
});

test('a losing first caller cannot replay another caller’s concurrently claimed receipt', async () => {
  const { gateway, effect } = setup();
  const other = wire('');
  other.body = other.body.replace('700000001', '700000002');
  const results = await Promise.all([gateway.handle(wire('')), gateway.handle(other)]);
  expect(results.map(result => result.status).sort()).toEqual([200, 409]);
  expect(effect).toHaveBeenCalledTimes(1);
});
