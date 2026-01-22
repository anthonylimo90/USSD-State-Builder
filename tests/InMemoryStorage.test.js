const InMemoryStorage = require('../lib/InMemoryStorage');

describe('InMemoryStorage', () => {
  let storage;

  beforeEach(() => {
    storage = new InMemoryStorage();
  });

  test('should store and retrieve state', async () => {
    await storage.setState('session1', 'TEST_STATE', 300);
    const state = await storage.getState('session1');
    expect(state).toBe('TEST_STATE');
  });

  test('should store and retrieve data', async () => {
    await storage.setData('session1', { name: 'John' }, 300);
    const data = await storage.getData('session1');
    expect(data).toEqual({ name: 'John' });
  });

  test('should handle non-existent sessions', async () => {
    const state = await storage.getState('nonexistent');
    expect(state).toBeNull();

    const data = await storage.getData('nonexistent');
    expect(data).toBeNull();
  });

  test('should cleanup expired sessions', async () => {
    jest.useFakeTimers();

    await storage.setState('session1', 'STATE1', 100);  // 100 seconds timeout
    await storage.setState('session2', 'STATE2', 600);  // 600 seconds timeout

    jest.advanceTimersByTime(300 * 1000);  // Advance time by 300 seconds

    storage.cleanup();

    const state1 = await storage.getState('session1');
    const state2 = await storage.getState('session2');

    expect(state1).toBeNull();
    expect(state2).toBe('STATE2');

    jest.useRealTimers();
  });

  describe('maxHistorySize', () => {
    test('should use default maxHistorySize of 20', () => {
      const storage = new InMemoryStorage();
      expect(storage.maxHistorySize).toBe(20);
    });

    test('should accept custom maxHistorySize', () => {
      const storage = new InMemoryStorage({ maxHistorySize: 5 });
      expect(storage.maxHistorySize).toBe(5);
    });

    test('should enforce maxHistorySize limit on state history', async () => {
      const storage = new InMemoryStorage({ maxHistorySize: 3 });

      // Push more states than the limit
      await storage.pushStateHistory('session1', 'STATE1');
      await storage.pushStateHistory('session1', 'STATE2');
      await storage.pushStateHistory('session1', 'STATE3');
      await storage.pushStateHistory('session1', 'STATE4');
      await storage.pushStateHistory('session1', 'STATE5');

      const history = await storage.getStateHistory('session1');

      // Should only keep the last 3 states
      expect(history.length).toBe(3);
      expect(history).toEqual(['STATE3', 'STATE4', 'STATE5']);
    });

    test('should allow unlimited history when maxHistorySize is 0', async () => {
      const storage = new InMemoryStorage({ maxHistorySize: 0 });

      for (let i = 0; i < 50; i++) {
        await storage.pushStateHistory('session1', `STATE${i}`);
      }

      const history = await storage.getStateHistory('session1');
      expect(history.length).toBe(50);
    });

    test('should preserve oldest states on pop when at limit', async () => {
      const storage = new InMemoryStorage({ maxHistorySize: 3 });

      await storage.pushStateHistory('session1', 'STATE1');
      await storage.pushStateHistory('session1', 'STATE2');
      await storage.pushStateHistory('session1', 'STATE3');
      await storage.pushStateHistory('session1', 'STATE4');

      // Pop should return the most recent state
      const popped = await storage.popStateHistory('session1');
      expect(popped).toBe('STATE4');

      const history = await storage.getStateHistory('session1');
      expect(history).toEqual(['STATE2', 'STATE3']);
    });
  });
});
