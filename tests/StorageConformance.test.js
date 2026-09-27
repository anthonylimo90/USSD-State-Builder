const { randomUUID } = require('crypto');
const InMemoryStorage = require('../lib/InMemoryStorage');
const RedisStorage = require('../lib/RedisStorage');
const MongoDBStorage = require('../lib/MongoDBStorage');
const PostgreSQLStorage = require('../lib/PostgreSQLStorage');
const { createEncryptedStorage } = require('../lib/SessionEncryption');
const { DistributedLock, createDistributedLockManager } = require('../lib/DistributedLock');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const runLive = Boolean(process.env.RUN_INTEGRATION);
const live = runLive ? describe : describe.skip;

function contract(name, create, { persistent = false } = {}) {
  describe(`${name} storage contract`, () => {
    let first;
    let second;
    let id;

    beforeEach(async () => {
      id = `contract-${randomUUID()}`;
      second = null;
      first = create();
      if (first._ensureConnected) await first._ensureConnected();
    });

    afterEach(async () => {
      if (first) await first.deleteSession(id);
      if (second) await second.close();
      if (first) await first.close();
    });

    test('merges data, retains bounded history, and deletes all session views', async () => {
      await first.setState(id, 'MENU', 30);
      await first.setData(id, { one: 1, keep: 'yes' }, 30);
      await first.setData(id, { two: 2, one: 3 }, 30);
      expect(await first.getData(id)).toMatchObject({ one: 3, two: 2, keep: 'yes' });
      for (const state of ['A', 'B', 'C']) await first.pushStateHistory(id, state);
      expect(await first.getStateHistory(id)).toEqual(['B', 'C']);
      expect(await first.popStateHistory(id)).toBe('C');
      expect(await first.getStateHistory(id)).toEqual(['B']);
      expect(await first.getState(id)).toBe('MENU');
      await first.deleteSession(id);
      expect(await first.getState(id)).toBeNull();
      expect(await first.getData(id)).toBeNull();
      expect(await first.getStateHistory(id)).toEqual([]);
      expect(await first.getSession(id)).toBeNull();
    });

    test('expires reads immediately and refreshes TTL on a same-state write', async () => {
      await first.setState(id, 'MENU', 1);
      await first.setData(id, { marker: true }, 1);
      await first.pushStateHistory(id, 'START');
      await sleep(600);
      await first.setState(id, 'MENU', 2);
      await sleep(600);
      expect(await first.getState(id)).toBe('MENU');
      expect(await first.getData(id)).toEqual({ marker: true });
      await sleep(1500);
      expect(await first.getState(id)).toBeNull();
      expect(await first.getData(id)).toBeNull();
      expect(await first.getSession(id)).toBeNull();
      expect(await first.getStateHistory(id)).toEqual([]);
      expect(await first.popStateHistory(id)).toBeUndefined();
    }, 10000);

    test('has explicit restart behavior', async () => {
      await first.setState(id, 'MENU', 30);
      await first.setData(id, { marker: true }, 30);
      second = create();
      if (second._ensureConnected) await second._ensureConnected();
      expect(await second.getState(id)).toBe(persistent ? 'MENU' : null);
      expect(await second.getData(id)).toEqual(persistent ? { marker: true } : null);
    });

    test('starts fresh when writing after expiry', async () => {
      await first.setState(id, 'OLD', 1);
      await first.setData(id, { old: true }, 1);
      await first.pushStateHistory(id, 'BEFORE');
      await sleep(1100);
      await first.setData(id, { current: true }, 30);
      expect(await first.getState(id)).toBeNull();
      expect(await first.getData(id)).toEqual({ current: true });
      expect(await first.getStateHistory(id)).toEqual([]);
    }, 10000);
  });
}

contract('InMemory', () => new InMemoryStorage({ maxHistorySize: 2 }));

live('live adapters', () => {
  const prefix = `ussd:contract:${randomUUID()}:`;
  contract('Redis', () => new RedisStorage({
    url: process.env.REDIS_URL || 'redis://localhost:6379', keyPrefix: prefix, maxHistorySize: 2
  }), { persistent: true });

  if (process.env.MONGODB_URI) contract(
    'MongoDB', () => new MongoDBStorage({
      uri: process.env.MONGODB_URI,
      database: process.env.MONGODB_DATABASE || 'ussd_conformance',
      collection: `sessions_${process.env.JEST_WORKER_ID || '1'}`,
      maxHistorySize: 2
    }),
    { persistent: true }
  );

  if (process.env.POSTGRES_URL) contract(
    'PostgreSQL', () => new PostgreSQLStorage({
      connectionString: process.env.POSTGRES_URL,
      table: 'ussd_conformance_sessions', maxHistorySize: 2
    }),
    { persistent: true }
  );

  test('two Redis workers serialize encrypted read-modify-write turns', async () => {
    const keyPrefix = `ussd:worker-contract:${randomUUID()}:`;
    const first = new RedisStorage({ url: process.env.REDIS_URL || 'redis://localhost:6379', keyPrefix });
    const second = new RedisStorage({ url: process.env.REDIS_URL || 'redis://localhost:6379', keyPrefix });
    const id = 'shared';
    try {
      await Promise.all([first._ensureConnected(), second._ensureConnected()]);
      const wrap = storage => createDistributedLockManager(
        createEncryptedStorage(storage, { encryptionKey: Buffer.alloc(32, 9) }),
        { redisClient: storage.client, keyPrefix: `${keyPrefix}lock:`, retryInterval: 1, retryJitter: 1 }
      );
      const a = wrap(first);
      const b = wrap(second);
      await a.setData(id, { count: 0 }, 30);
      const increment = storage => storage.withSessionLock(id, async () => {
        const { count } = await storage.getData(id);
        await sleep(20);
        await storage.setData(id, { count: count + 1 }, 30);
      });
      await Promise.all([increment(a), increment(b)]);
      expect(await a.getData(id)).toEqual({ count: 2 });
      expect(await first.getData(id)).toHaveProperty('_encrypted');

      const leaseA = new DistributedLock({ redisClient: first.client, keyPrefix: `${keyPrefix}lease:`, lockTTL: 50 });
      const leaseB = new DistributedLock({ redisClient: second.client, keyPrefix: `${keyPrefix}lease:`, lockTTL: 50 });
      const releaseA = await leaseA.acquire('ownership');
      await sleep(80);
      const releaseB = await leaseB.acquire('ownership');
      await releaseA();
      expect(await leaseB.isLocked('ownership')).toBe(true);
      await releaseB();
    } finally {
      await first.deleteSession(id);
      await first.close();
      await second.close();
    }
  });
});

test('encryption and locking compose across two independent workers', async () => {
  const raw = new InMemoryStorage();
  const locks = new Map();
  const redisClient = {
    async set(key, value, options) {
      if (options.NX && locks.has(key)) return null;
      locks.set(key, value);
      return 'OK';
    },
    async eval(script, { keys, arguments: args }) {
      if (locks.get(keys[0]) !== args[0]) return 0;
      if (script.includes('pexpire')) return 1;
      locks.delete(keys[0]);
      return 1;
    }
  };
  const worker = () => createDistributedLockManager(
    createEncryptedStorage(raw, { encryptionKey: Buffer.alloc(32, 7) }),
    { redisClient, lockTTL: 1000, retryInterval: 1, retryJitter: 1 }
  );
  const a = worker();
  const b = worker();
  await a.setData('shared', { count: 0 }, 30);
  const increment = storage => storage.withSessionLock('shared', async () => {
    const { count } = await storage.getData('shared');
    await sleep(10);
    await storage.setData('shared', { count: count + 1 }, 30);
  });
  await Promise.all([increment(a), increment(b)]);
  expect(await raw.getData('shared')).toHaveProperty('_encrypted');
  expect(await a.getData('shared')).toEqual({ count: 2 });
});
