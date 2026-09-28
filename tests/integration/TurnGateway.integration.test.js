const { randomUUID } = require('crypto');
const { createApp, RedisStorage, RedisTurnStore, TurnGateway, AfricasTalkingAdapter } = require('../..');
const describeLive = process.env.RUN_INTEGRATION ? describe : describe.skip;
const wire = text => ({ method: 'POST', contentType: 'application/x-www-form-urlencoded', body: new URLSearchParams({
  sessionId: 'shared', phoneNumber: '+254700000001', networkCode: '99999', serviceCode: '*384*000#', text
}).toString() });
describeLive('Atomic Redis turns across workers and restart', () => {
  let raw;
  let stores;
  let gateways;
  let calls;
  let key;
  const adapter = new AfricasTalkingAdapter({ applicationId: 'atomic-test', serviceCode: '*384*000#' });
  beforeEach(async () => {
    const prefix = `ussd:atomic:${randomUUID()}:`;
    raw = [0, 1].map(() => new RedisStorage({ url: process.env.REDIS_URL || 'redis://localhost:6379', keyPrefix: prefix }));
    await Promise.all(raw.map(storage => storage._ensureConnected()));
    calls = 0;
    stores = raw.map(storage => new RedisTurnStore({ storage }));
    gateways = raw.map((storage, i) => {
      const machine = createApp().flowVersion('v1').storage(storage).logger(null).state('home', s => s.run(async (input, id, ctx) => {
        calls++;
        await new Promise(resolve => setTimeout(resolve, 10));
        return { response: `CON ${input || 'Welcome'} (${(ctx.sessionData?.count || 0) + 1})`, data: { count: (ctx.sessionData?.count || 0) + 1 } };
      })).build();
      return new TurnGateway({ adapter, machine, store: stores[i] });
    });
    key = adapter.normalize(wire('')).sessionKey;
  });
  afterEach(async () => {
    await raw[0].deleteSession(key);
    await Promise.all(raw.map(storage => storage.close()));
  });
  test('two workers perform a turn once and replay every committed transcript after reconnecting', async () => {
    await gateways[0].handle(wire(''));
    const results = await Promise.all(gateways.map(gateway => gateway.handle(wire('1'))));
    expect(results.some(result => result.status === 200)).toBe(true);
    expect(await gateways[1].handle(wire('1'))).toEqual(results.find(result => result.status === 200));
    await gateways[1].handle(wire('1*1'));
    expect(calls).toBe(3);
    const record = await stores[0].read(key);
    expect(record).toMatchObject({ revision: 3, pending: null, session: { data: { count: 3, __ussdFlow: { version: 'v1' } } } });
    await raw[1].close();
    raw[1] = new RedisStorage({ ...raw[0].config });
    stores[1] = new RedisTurnStore({ storage: raw[1] });
    const restarted = createApp().flowVersion('v1').storage(raw[1]).state('home', s => s.run(() => { throw new Error('Replay ran handler'); })).build();
    gateways[1] = new TurnGateway({ adapter, machine: restarted, store: stores[1] });
    expect((await gateways[1].handle(wire('1'))).body).toBe('CON 1 (2)');
    expect(calls).toBe(3);
  });
  test('failure between execution and commit preserves the entire previous snapshot', async () => {
    await gateways[0].handle(wire(''));
    const previous = await raw[0].getSession(key);
    const original = stores[0].commit.bind(stores[0]);
    stores[0].commit = async () => { throw new Error('crash'); };
    expect((await gateways[0].handle(wire('1'))).status).toBe(500);
    expect(await raw[1].getSession(key)).toEqual(previous);
    expect((await stores[1].read(key)).revision).toBe(1);
    expect((await gateways[1].handle(wire('1'))).status).toBe(503);
    expect(calls).toBe(2);
    stores[0].commit = original;
  });
  test('old owner cannot commit after explicit recovery takes ownership', async () => {
    await gateways[0].handle(wire(''));
    const committed = await stores[0].read(key);
    const ledger = { ...committed, pending: { token: 'old', fingerprint: 'f' } };
    expect(await stores[0].claim(key, 1, ledger, 86400)).toBe(true);
    expect(await stores[1].claim(key, 1, { ...ledger, pending: { token: 'new', fingerprint: 'f' } }, 86400, 'old')).toBe(true);
    expect(await stores[0].commit(key, 1, 'old', { ...ledger, revision: 2, pending: null }, { state: 'wrong' }, 86400, 300000)).toBe(false);
    expect((await stores[1].read(key)).revision).toBe(1);
    expect(await raw[0].getState(key)).toBe('home');
  });
  test('expired active data is hidden while receipts remain replayable without extending TTL', async () => {
    const receipt = await gateways[0].handle(wire(''));
    const redisKey = raw[0]._getKey(key);
    await raw[0].client.hSet(redisKey, 'turnExpiresAt', String(Date.now() - 1));
    expect(await raw[1].getState(key)).toBe(null);
    expect(await raw[1].getData(key)).toBe(null);
    expect(await raw[1].getStateHistory(key)).toEqual([]);
    expect(await raw[1].getSession(key)).toBe(null);
    const before = await raw[0].client.pTTL(redisKey);
    expect(await gateways[1].handle(wire(''))).toEqual(receipt);
    expect(await raw[0].client.pTTL(redisKey)).toBeLessThanOrEqual(before);
    expect((await gateways[1].handle(wire('1'))).status).toBe(409);
  });
  test('a worker process crashes after a durable external effect; journal recovery never reruns the handler', async () => {
    const http = require('http');
    const { spawn } = require('child_process');
    const root = require('path').resolve(__dirname, '../..');
    const journalKey = `${raw[0].keyPrefix}external-journal`;
    const executionKey = `${raw[0].keyPrefix}executions`;
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const { idempotencyKey } = JSON.parse(Buffer.concat(chunks));
      await raw[0].client.hSetNX(journalKey, idempotencyKey, JSON.stringify({ response: 'END Paid', paid: true }));
      const receipt = await raw[0].client.hGet(journalKey, idempotencyKey);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(receipt);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let child;
    try {
      const initial = createApp().flowVersion('payment-v1').storage(raw[0]).state('home', s => s.message('Pay')).build();
      await new TurnGateway({ adapter, machine: initial, store: stores[0] }).handle(wire(''));
      const source = `
        const { createApp, RedisStorage, RedisTurnStore, TurnGateway, AfricasTalkingAdapter } = require(${JSON.stringify(root)});
        const storage = new RedisStorage(${JSON.stringify(raw[0].config)});
        const adapter = new AfricasTalkingAdapter({ applicationId: 'atomic-test', serviceCode: '*384*000#' });
        const machine = createApp().flowVersion('payment-v1').storage(storage).logger(null).state('home', s => s.run(async (input, id, ctx) => {
          await storage.client.incr(${JSON.stringify(executionKey)});
          await fetch('http://127.0.0.1:${server.address().port}/charge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: ctx.turn.idempotencyKey }) });
          process.exit(77);
        })).build();
        new TurnGateway({ adapter, machine, store: new RedisTurnStore({ storage }) }).handle(${JSON.stringify(wire('1'))}).then(() => process.exit(0));
      `;
      child = spawn(process.execPath, ['-e', source], { stdio: ['ignore', 'ignore', 'pipe'] });
      let errors = '';
      child.stderr.on('data', chunk => { errors += chunk; });
      const exit = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
      expect(errors).toBe('');
      expect(exit).toBe(77);
      const pending = await stores[1].read(key);
      expect(pending.revision).toBe(1);
      expect(pending.session.state).toBe('home');
      expect(await raw[0].client.get(executionKey)).toBe('1');
      expect(await raw[0].client.hLen(journalKey)).toBe(1);
      expect((await gateways[1].handle(wire('1'))).status).toBe(503);
      const recovery = new TurnGateway({ adapter, machine: gateways[1].machine, store: stores[1], recoverTurn: async ({ pending, session }) => {
        const entry = await raw[1].client.hGet(journalKey, pending.idempotencyKey);
        if (!entry) return null;
        const result = JSON.parse(entry);
        return { response: result.response, session: { ...session, expiresAt: Date.now() + 300000,
          data: { ...session.data, paid: result.paid, __ussdLifecycle: { completedResponse: result.response, completedAt: Date.now() } } } };
      } });
      expect((await recovery.recover(wire('1'))).body).toBe('END Paid');
      expect((await recovery.handle(wire('1'))).body).toBe('END Paid');
      expect(await raw[0].client.get(executionKey)).toBe('1');
      expect(await raw[0].client.hLen(journalKey)).toBe(1);
      expect(await stores[0].read(key)).toMatchObject({ revision: 2, pending: null, session: { data: { paid: true } } });
    } finally {
      if (child && child.exitCode === null) child.kill('SIGKILL');
      await new Promise(resolve => server.close(resolve));
      await raw[0].client.del([journalKey, executionKey]);
    }
  }, 15000);

  test('invalid commit arguments are rejected before any Redis fields change', async () => {
    await gateways[0].handle(wire(''));
    const prior = await raw[0].getSession(key);
    const record = await stores[0].read(key);
    const ledger = { ...record, pending: { token: 'candidate' } };
    expect(await stores[0].claim(key, 1, ledger, 86400)).toBe(true);
    await expect(stores[0].commit(key, 1, 'candidate', { ...ledger, revision: 2, pending: null },
      { state: 'wrong' }, 0, 300000)).rejects.toThrow(/commit/);
    expect(await raw[1].getSession(key)).toEqual(prior);
    expect((await stores[1].read(key)).revision).toBe(1);
  });

});
