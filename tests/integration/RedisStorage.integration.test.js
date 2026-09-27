/**
 * Redis Storage Integration Tests
 *
 * These tests require a running Redis instance.
 * Skip with: SKIP_INTEGRATION=1 npm test
 *
 * Start Redis: docker run -d -p 6379:6379 redis:7-alpine
 */

const RedisStorage = require('../../lib/RedisStorage');
const { WebhookManager } = require('../../lib/WebhookManager');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Skip integration tests unless explicitly enabled
const describeIntegration = process.env.RUN_INTEGRATION ? describe : describe.skip;

describeIntegration('RedisStorage Integration', () => {
    let storage;

    beforeAll(async () => {
        storage = new RedisStorage({
            url: REDIS_URL,
            keyPrefix: 'ussd:test:',
            maxHistorySize: 20
        });
        // Ensure connection
        await storage._ensureConnected();
    });

    afterAll(async () => {
        if (storage) {
            // Clean up test keys
            const client = storage.client;
            const keys = await client.keys('ussd:test:*');
            if (keys.length > 0) {
                await client.del(keys);
            }
            await storage.close();
        }
    });

    afterEach(async () => {
        // Clean up after each test
        const client = storage.client;
        const keys = await client.keys('ussd:test:*');
        if (keys.length > 0) {
            await client.del(keys);
        }
    });

    test('should store and retrieve state', async () => {
        await storage.setState('session-1', 'WELCOME', 300);
        const state = await storage.getState('session-1');
        expect(state).toBe('WELCOME');
    });

    test('should return null for non-existent session', async () => {
        const state = await storage.getState('non-existent');
        expect(state).toBeNull();
    });

    test('should store and retrieve session data', async () => {
        await storage.setState('session-2', 'FORM', 300);
        await storage.setData('session-2', { name: 'John', phone: '254712345678' }, 300);
        const data = await storage.getData('session-2');
        expect(data).toEqual({ name: 'John', phone: '254712345678' });
    });

    test('should merge session data on subsequent writes', async () => {
        await storage.setState('session-3', 'FORM', 300);
        await storage.setData('session-3', { name: 'John' }, 300);
        await storage.setData('session-3', { phone: '254712345678' }, 300);
        const data = await storage.getData('session-3');
        expect(data).toEqual({ name: 'John', phone: '254712345678' });
    });

    test('should manage state history for back navigation', async () => {
        await storage.setState('session-4', 'WELCOME', 300);
        await storage.pushStateHistory('session-4', 'WELCOME');
        await storage.pushStateHistory('session-4', 'MENU');
        await storage.pushStateHistory('session-4', 'SUBMENU');

        const history = await storage.getStateHistory('session-4');
        expect(history).toEqual(['WELCOME', 'MENU', 'SUBMENU']);

        const popped = await storage.popStateHistory('session-4');
        expect(popped).toBe('SUBMENU');
    });

    test('should enforce maxHistorySize', async () => {
        const smallStorage = new RedisStorage({
            url: REDIS_URL,
            keyPrefix: 'ussd:test:small:',
            maxHistorySize: 3
        });
        await smallStorage._ensureConnected();

        for (let i = 0; i < 5; i++) {
            await smallStorage.pushStateHistory('session-5', `STATE_${i}`);
        }

        const history = await smallStorage.getStateHistory('session-5');
        expect(history.length).toBe(3);
        expect(history).toEqual(['STATE_2', 'STATE_3', 'STATE_4']);

        // Cleanup
        await smallStorage.client.del('ussd:test:small:session-5');
        await smallStorage.close();
    });

    test('should delete sessions', async () => {
        await storage.setState('session-6', 'WELCOME', 300);
        await storage.setData('session-6', { test: true }, 300);
        await storage.deleteSession('session-6');

        const state = await storage.getState('session-6');
        expect(state).toBeNull();
    });

    test('should handle concurrent operations', async () => {
        const promises = [];
        for (let i = 0; i < 10; i++) {
            promises.push(
                storage.setState(`concurrent-${i}`, `STATE_${i}`, 300)
            );
        }

        await Promise.all(promises);

        for (let i = 0; i < 10; i++) {
            const state = await storage.getState(`concurrent-${i}`);
            expect(state).toBe(`STATE_${i}`);
        }
    });

    test('claims a webhook once across manager instances', async () => {
        const first = new WebhookManager({ storage, keyPrefix: 'webhook:' });
        const second = new WebhookManager({ storage, keyPrefix: 'webhook:' });
        try {
            const registration = await first.register('shared-session');
            const results = await Promise.all([
                first.receive(registration.webhookId, { source: 'first' }, registration.secret),
                second.receive(registration.webhookId, { source: 'second' }, registration.secret)
            ]);
            expect(results.filter(result => result.success)).toHaveLength(1);
            expect((await storage.getData(`webhook:${registration.webhookId}`)).status).toBe('received');
        } finally {
            first.destroy();
            second.destroy();
        }
    });

    test('should execute transactions atomically', async () => {
        await storage.withTransaction(async (tx) => {
            tx.setState('tx-session', 'COMPLETE', 300);
            tx.setData('tx-session', { amount: 1000 }, 300);
        });

        const state = await storage.getState('tx-session');
        expect(state).toBe('COMPLETE');
        const data = await storage.getData('tx-session');
        expect(data).toEqual({ amount: 1000 });
    });

    test('should handle session expiration via TTL', async () => {
        await storage.setState('expiring-session', 'WELCOME', 1); // 1 second TTL

        // Should exist immediately
        let state = await storage.getState('expiring-session');
        expect(state).toBe('WELCOME');

        // Wait for expiration
        await new Promise(resolve => setTimeout(resolve, 1500));

        state = await storage.getState('expiring-session');
        expect(state).toBeNull();
    }, 5000);

    test('should report connection status', () => {
        expect(storage.isConnected()).toBe(true);
    });
});
