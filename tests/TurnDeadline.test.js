const { createApp, InMemoryStorage, InMemoryTurnStore, TurnGateway, AfricasTalkingAdapter } = require('..');
const adapter = new AfricasTalkingAdapter({ applicationId: 'deadline', serviceCode: '*384*000#' });
const wire = text => ({ method: 'POST', contentType: 'application/x-www-form-urlencoded', body: new URLSearchParams({ sessionId: 'deadline', phoneNumber: '+254700000001', networkCode: '99999', serviceCode: '*384*000#', text }).toString() });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function setup(handler, options = {}) {
  const storage = new InMemoryStorage();
  const machine = createApp().flowVersion('v1').storage(storage).logger(null).state('home', s => s.run(handler)).build();
  const store = new InMemoryTurnStore({ storage });
  const gateway = new TurnGateway({ adapter, machine, store, deadlineMs: 100, ownershipCheckMs: 5, ...options });
  return { storage, machine, store, gateway, key: adapter.normalize(wire('')).sessionKey };
}
test('deadline aborts cooperative work and leaves no snapshot or receipt', async () => {
  let context;
  let cancelled = false;
  const { gateway, store, key } = setup(async (input, id, ctx) => {
    context = ctx;
    await new Promise((resolve, reject) => ctx.signal.addEventListener('abort', () => { cancelled = true; reject(ctx.signal.reason); }, { once: true }));
    return { response: 'END Late' };
  }, { deadlineMs: 30 });
  expect((await gateway.handle(wire(''))).status).toBe(503);
  expect(cancelled).toBe(true);
  expect(context.deadlineAt).toBeLessThanOrEqual(Date.now());
  expect(await store.read(key)).toMatchObject({ revision: 0, receipts: [], pending: { deadlineAt: expect.any(Number) }, session: null });
  expect((await gateway.handle(wire(''))).status).toBe(503);
});
test('an uncooperative late handler cannot commit even after the response times out', async () => {
  let finish;
  let signal;
  const { gateway, store, key } = setup(async (input, id, ctx) => {
    signal = ctx.signal;
    await new Promise(resolve => { finish = resolve; });
    return { response: 'END Late', data: { late: true } };
  }, { deadlineMs: 25 });
  expect((await gateway.handle(wire(''))).status).toBe(503);
  expect(signal.aborted).toBe(true);
  finish();
  await sleep(10);
  expect(await store.read(key)).toMatchObject({ revision: 0, session: null, receipts: [] });
});
test('local lock wait consumes the same budget and never executes the queued handler', async () => {
  const handler = jest.fn(() => ({ response: 'CON Ready' }));
  const { machine, gateway, store, key } = setup(handler, { deadlineMs: 25 });
  await machine._acquireSessionLock(key);
  try {
    expect((await gateway.handle(wire(''))).status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
    expect(machine._sessionLocks.get(key).waiters.size).toBe(0);
  } finally { machine._releaseSessionLock(key); }
  await sleep(10);
  expect(handler).not.toHaveBeenCalled();
  expect((await store.read(key)).revision).toBe(0);
  expect(machine._sessionLocks.size).toBe(0);
});
test('caller cancellation and an already expired deadline do not start new work', async () => {
  const handler = jest.fn(() => ({ response: 'CON Ready' }));
  const { gateway, store, key } = setup(handler);
  const controller = new AbortController();
  controller.abort();
  expect((await gateway.handle(wire(''), { signal: controller.signal })).status).toBe(503);
  expect((await gateway.handle(wire(''), { deadlineAt: Date.now() - 1 })).status).toBe(503);
  expect(await store.read(key)).toBe(null);
  expect(handler).not.toHaveBeenCalled();
});
test('storage and initial-data work consume the budget before handler execution', async () => {
  const handler = jest.fn(() => ({ response: 'CON Ready' }));
  let cancelled = false;
  const { gateway, store, key } = setup(handler, { deadlineMs: 25, sessionData: (turn, ctx) => new Promise((resolve, reject) => {
    ctx.signal.addEventListener('abort', () => { cancelled = true; reject(ctx.signal.reason); }, { once: true });
  }) });
  expect((await gateway.handle(wire(''))).status).toBe(503);
  expect(cancelled).toBe(true);
  expect(handler).not.toHaveBeenCalled();
  expect(await store.read(key)).toBe(null);
});
test('ownership replacement aborts the old worker; journal recovery commits without its handler', async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let oldSignal;
  const { gateway, machine, store, key } = setup(async (input, id, ctx) => {
    oldSignal = ctx.signal;
    started();
    await new Promise((resolve, reject) => ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true }));
    return { response: 'END Wrong' };
  }, { deadlineMs: 1000 });
  const old = gateway.handle(wire(''));
  await ready;
  const recovery = new TurnGateway({ adapter, machine, store, deadlineMs: 1000, recoverTurn: async ({ signal }) => {
    expect(signal.aborted).toBe(false);
    await sleep(20);
    return { response: 'END Reconciled', session: { state: 'home', data: {}, stateHistory: [] } };
  } });
  expect((await recovery.recover(wire(''))).body).toBe('END Reconciled');
  expect((await old).status).toBe(503);
  expect(oldSignal.aborted).toBe(true);
  expect(await store.read(key)).toMatchObject({ revision: 1, pending: null });
});
test('store rejects an expired lease even when its token and revision still match', async () => {
  const { store, gateway, key } = setup(() => ({ response: 'CON Ready' }));
  await gateway.handle(wire(''));
  const record = await store.read(key);
  const claimed = { ...record, pending: { token: 'expired' } };
  expect(await store.claim(key, 1, claimed, 600, null, 1)).toBe(true);
  await sleep(5);
  expect(await store.commit(key, 1, 'expired', { ...record, revision: 2, pending: null }, { state: 'wrong' }, 600, 300000)).toBe(false);
  expect((await store.read(key)).revision).toBe(1);
});
test('a hung recovery resolver receives cancellation and cannot install a receipt', async () => {
  const { gateway, machine, store, key } = setup(() => { throw new Error('uncertain'); });
  await gateway.handle(wire(''));
  let aborted = false;
  const recovery = new TurnGateway({ adapter, machine, store, deadlineMs: 25, recoverTurn: ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true });
  }) });
  expect((await recovery.recover(wire(''))).status).toBe(503);
  expect(aborted).toBe(true);
  expect((await store.read(key)).revision).toBe(0);
});

test('a delayed claim cannot reserve ownership after the original request budget has expired', async () => {
  const handler = jest.fn(() => ({ response: 'CON Ready' }));
  const { gateway, store, key } = setup(handler, { deadlineMs: 20 });
  const original = store.claim.bind(store);
  store.claim = async (...args) => { await sleep(50); return original(...args); };
  expect((await gateway.handle(wire(''))).status).toBe(503);
  await sleep(45);
  expect(await store.read(key)).toBe(null);
  expect(handler).not.toHaveBeenCalled();
});
