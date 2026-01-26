const { RetryStrategy, createRetryStorage } = require('../lib/RetryStrategy');
const InMemoryStorage = require('../lib/InMemoryStorage');

describe('RetryStrategy', () => {
    test('succeeds on first try', async () => {
        const strategy = new RetryStrategy({ maxRetries: 3 });
        const result = await strategy.execute(() => Promise.resolve('ok'));
        expect(result).toBe('ok');
    });

    test('retries on failure and eventually succeeds', async () => {
        const strategy = new RetryStrategy({ maxRetries: 3, baseDelay: 10 });
        let attempts = 0;

        const result = await strategy.execute(() => {
            attempts++;
            if (attempts < 3) {
                return Promise.reject(new Error('connection lost'));
            }
            return Promise.resolve('recovered');
        });

        expect(result).toBe('recovered');
        expect(attempts).toBe(3);
    });

    test('throws after max retries exhausted', async () => {
        const strategy = new RetryStrategy({ maxRetries: 2, baseDelay: 10 });

        await expect(
            strategy.execute(() => Promise.reject(new Error('connection lost')))
        ).rejects.toThrow('connection lost');
    });

    test('does not retry non-retryable errors', async () => {
        const strategy = new RetryStrategy({ maxRetries: 3, baseDelay: 10 });
        let attempts = 0;

        const error = new Error('bad config');
        error.name = 'ValidationError';

        await expect(
            strategy.execute(() => {
                attempts++;
                return Promise.reject(error);
            })
        ).rejects.toThrow('bad config');

        expect(attempts).toBe(1);
    });

    test('calls onRetry callback', async () => {
        const retries = [];
        const strategy = new RetryStrategy({
            maxRetries: 2,
            baseDelay: 10,
            onRetry: (error, attempt, retryDelay) => {
                retries.push({ message: error.message, attempt, retryDelay });
            }
        });

        let attempts = 0;
        await strategy.execute(() => {
            attempts++;
            if (attempts < 3) {
                return Promise.reject(new Error('timeout'));
            }
            return Promise.resolve('ok');
        });

        expect(retries).toHaveLength(2);
        expect(retries[0].attempt).toBe(1);
        expect(retries[1].attempt).toBe(2);
    });

    test('respects custom shouldRetry function', async () => {
        const strategy = new RetryStrategy({
            maxRetries: 3,
            baseDelay: 10,
            shouldRetry: (error) => error.code === 'RETRY_ME'
        });

        let attempts = 0;

        const error = new Error('custom error');
        error.code = 'NO_RETRY';

        await expect(
            strategy.execute(() => {
                attempts++;
                return Promise.reject(error);
            })
        ).rejects.toThrow('custom error');

        expect(attempts).toBe(1);
    });

    test('calculateDelay respects maxDelay', () => {
        const strategy = new RetryStrategy({
            baseDelay: 100,
            maxDelay: 500,
            backoffMultiplier: 2,
            jitter: false
        });

        expect(strategy.calculateDelay(0)).toBe(100);
        expect(strategy.calculateDelay(1)).toBe(200);
        expect(strategy.calculateDelay(2)).toBe(400);
        expect(strategy.calculateDelay(3)).toBe(500); // capped
        expect(strategy.calculateDelay(10)).toBe(500); // still capped
    });

    test('calculateDelay with jitter stays within bounds', () => {
        const strategy = new RetryStrategy({
            baseDelay: 100,
            maxDelay: 1000,
            jitter: true
        });

        for (let i = 0; i < 100; i++) {
            const d = strategy.calculateDelay(2);
            expect(d).toBeGreaterThanOrEqual(0);
            expect(d).toBeLessThanOrEqual(400);
        }
    });

    describe('defaultShouldRetry', () => {
        test('returns false for ValidationError', () => {
            const error = new Error('bad input');
            error.name = 'ValidationError';
            expect(RetryStrategy.defaultShouldRetry(error)).toBe(false);
        });

        test('returns false for ConfigurationError', () => {
            const error = new Error('bad config');
            error.name = 'ConfigurationError';
            expect(RetryStrategy.defaultShouldRetry(error)).toBe(false);
        });

        test('returns true for connection errors', () => {
            const error = new Error('network error');
            error.code = 'ECONNRESET';
            expect(RetryStrategy.defaultShouldRetry(error)).toBe(true);
        });

        test('returns true for timeout errors', () => {
            const error = new Error('request timeout');
            error.code = 'ETIMEDOUT';
            expect(RetryStrategy.defaultShouldRetry(error)).toBe(true);
        });

        test('returns true for connection lost message', () => {
            const error = new Error('Connection lost to database');
            expect(RetryStrategy.defaultShouldRetry(error)).toBe(true);
        });

        test('returns false for unknown errors', () => {
            const error = new Error('something unexpected');
            expect(RetryStrategy.defaultShouldRetry(error)).toBe(false);
        });
    });
});

describe('createRetryStorage', () => {
    test('wraps storage with retry logic', async () => {
        const storage = new InMemoryStorage();
        const retryStorage = createRetryStorage(storage, {
            maxRetries: 2,
            baseDelay: 10
        });

        await retryStorage.setState('test', 'STATE_A', 300);
        const state = await retryStorage.getState('test');
        expect(state).toBe('STATE_A');
    });

    test('retries on transient failures', async () => {
        let calls = 0;
        const storage = {
            getState: jest.fn().mockImplementation(() => {
                calls++;
                if (calls < 3) {
                    return Promise.reject(new Error('connection lost'));
                }
                return Promise.resolve('STATE_A');
            }),
            setState: jest.fn(),
            getData: jest.fn(),
            setData: jest.fn(),
            getSession: jest.fn(),
            setSession: jest.fn(),
            getStateHistory: jest.fn(),
            pushStateHistory: jest.fn(),
            popStateHistory: jest.fn(),
            deleteSession: jest.fn(),
            cleanup: jest.fn(),
            close: jest.fn()
        };

        const retryStorage = createRetryStorage(storage, {
            maxRetries: 3,
            baseDelay: 10
        });

        const state = await retryStorage.getState('test');
        expect(state).toBe('STATE_A');
        expect(calls).toBe(3);
    });

    test('exposes retry strategy via _retryStrategy', () => {
        const storage = new InMemoryStorage();
        const retryStorage = createRetryStorage(storage);
        expect(retryStorage._retryStrategy).toBeInstanceOf(RetryStrategy);
    });
});
