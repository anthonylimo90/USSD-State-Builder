const { createDistributedLockManager } = require('../lib/DistributedLock');
const USSDStateMachine = require('../lib/USSDStateMachine');
const InMemoryStorage = require('../lib/InMemoryStorage');

class CopyStorage extends InMemoryStorage {
  async getData(sessionId) {
    const data = await super.getData(sessionId);
    return data && { ...data };
  }
}

test('distributed storage lock serializes complete requests across machines', async () => {
  const values = new Map();
  const redisClient = {
    async set(key, value, options) {
      if (options.NX && values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    },
    async eval(script, { keys, arguments: args }) {
      if (values.get(keys[0]) !== args[0]) return 0;
      if (script.includes('pexpire')) return 1;
      values.delete(keys[0]);
      return 1;
    }
  };
  const storage = new CopyStorage();
  await storage.setState('shared', 'COUNTER', 300);
  await storage.setData('shared', { count: 0 }, 300);
  const createMachine = () => new USSDStateMachine({
    initialState: 'COUNTER',
    storage: createDistributedLockManager(storage, {
      redisClient,
      lockTTL: 1000,
      retryInterval: 1,
      retryJitter: 1
    }),
    states: {
      COUNTER: {
        handler: async (input, sessionId, context) => {
          const count = context.sessionData.count + 1;
          await new Promise(resolve => setTimeout(resolve, 10));
          return { response: `CON ${count}`, data: { count } };
        }
      }
    }
  });
  const first = createMachine();
  const second = createMachine();

  expect(await Promise.all([
    first.processInput('shared', '1'),
    second.processInput('shared', '2')
  ])).toEqual(['CON 1', 'CON 2']);
  expect(await storage.getData('shared')).toEqual({ count: 2 });
});
