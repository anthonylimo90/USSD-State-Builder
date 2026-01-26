const { CircuitBreaker, createProtectedStorage, STATES } = require('../lib/CircuitBreaker');
const InMemoryStorage = require('../lib/InMemoryStorage');

describe('CircuitBreaker', () => {
    let breaker;

    beforeEach(() => {
        breaker = new CircuitBreaker({
            failureThreshold: 3,
            resetTimeout: 100,
            halfOpenMaxAttempts: 1
        });
    });

    test('starts in CLOSED state', () => {
        expect(breaker.state).toBe(STATES.CLOSED);
    });

    test('stays CLOSED on successful calls', async () => {
        await breaker.execute(() => Promise.resolve('ok'));
        await breaker.execute(() => Promise.resolve('ok'));
        expect(breaker.state).toBe(STATES.CLOSED);
    });

    test('opens after failure threshold reached', async () => {
        for (let i = 0; i < 3; i++) {
            try {
                await breaker.execute(() => Promise.reject(new Error('fail')));
            } catch (e) { /* expected */ }
        }
        expect(breaker.state).toBe(STATES.OPEN);
    });

    test('fails fast when OPEN', async () => {
        // Trip the breaker
        for (let i = 0; i < 3; i++) {
            try {
                await breaker.execute(() => Promise.reject(new Error('fail')));
            } catch (e) { /* expected */ }
        }

        await expect(breaker.execute(() => Promise.resolve('ok'))).rejects.toThrow('Circuit breaker is OPEN');
    });

    test('uses fallback when OPEN', async () => {
        for (let i = 0; i < 3; i++) {
            try {
                await breaker.execute(() => Promise.reject(new Error('fail')));
            } catch (e) { /* expected */ }
        }

        const result = await breaker.execute(
            () => Promise.resolve('original'),
            () => 'fallback'
        );
        expect(result).toBe('fallback');
    });

    test('transitions to HALF_OPEN after resetTimeout', async () => {
        for (let i = 0; i < 3; i++) {
            try {
                await breaker.execute(() => Promise.reject(new Error('fail')));
            } catch (e) { /* expected */ }
        }
        expect(breaker.state).toBe(STATES.OPEN);

        // Wait for reset timeout
        await new Promise(r => setTimeout(r, 150));
        expect(breaker.state).toBe(STATES.HALF_OPEN);
    });

    test('closes on success in HALF_OPEN', async () => {
        for (let i = 0; i < 3; i++) {
            try {
                await breaker.execute(() => Promise.reject(new Error('fail')));
            } catch (e) { /* expected */ }
        }

        await new Promise(r => setTimeout(r, 150));
        expect(breaker.state).toBe(STATES.HALF_OPEN);

        await breaker.execute(() => Promise.resolve('ok'));
        expect(breaker.state).toBe(STATES.CLOSED);
    });

    test('reopens on failure in HALF_OPEN', async () => {
        for (let i = 0; i < 3; i++) {
            try {
                await breaker.execute(() => Promise.reject(new Error('fail')));
            } catch (e) { /* expected */ }
        }

        await new Promise(r => setTimeout(r, 150));
        expect(breaker.state).toBe(STATES.HALF_OPEN);

        try {
            await breaker.execute(() => Promise.reject(new Error('still failing')));
        } catch (e) { /* expected */ }
        expect(breaker.state).toBe(STATES.OPEN);
    });

    test('resets failure count on success in CLOSED', async () => {
        // 2 failures (below threshold)
        for (let i = 0; i < 2; i++) {
            try {
                await breaker.execute(() => Promise.reject(new Error('fail')));
            } catch (e) { /* expected */ }
        }

        // Success resets counter
        await breaker.execute(() => Promise.resolve('ok'));

        // 2 more failures should NOT trip the breaker (counter was reset)
        for (let i = 0; i < 2; i++) {
            try {
                await breaker.execute(() => Promise.reject(new Error('fail')));
            } catch (e) { /* expected */ }
        }
        expect(breaker.state).toBe(STATES.CLOSED);
    });

    test('calls onStateChange callback', async () => {
        const changes = [];
        breaker = new CircuitBreaker({
            failureThreshold: 2,
            resetTimeout: 50,
            onStateChange: (from, to) => changes.push({ from, to })
        });

        for (let i = 0; i < 2; i++) {
            try {
                await breaker.execute(() => Promise.reject(new Error('fail')));
            } catch (e) { /* expected */ }
        }

        expect(changes).toEqual([{ from: STATES.CLOSED, to: STATES.OPEN }]);
    });

    test('supports custom isFailure function', async () => {
        breaker = new CircuitBreaker({
            failureThreshold: 2,
            isFailure: (result) => result === null
        });

        await breaker.execute(() => Promise.resolve(null));
        await breaker.execute(() => Promise.resolve(null));
        expect(breaker.state).toBe(STATES.OPEN);
    });

    test('manual reset returns to CLOSED', async () => {
        for (let i = 0; i < 3; i++) {
            try {
                await breaker.execute(() => Promise.reject(new Error('fail')));
            } catch (e) { /* expected */ }
        }
        expect(breaker.state).toBe(STATES.OPEN);

        breaker.reset();
        expect(breaker.state).toBe(STATES.CLOSED);
    });

    test('getStats returns correct statistics', async () => {
        await breaker.execute(() => Promise.resolve('ok'));
        try {
            await breaker.execute(() => Promise.reject(new Error('fail')));
        } catch (e) { /* expected */ }

        const stats = breaker.getStats();
        expect(stats.state).toBe(STATES.CLOSED);
        expect(stats.failureCount).toBe(1);
        expect(stats.successCount).toBe(1);
        expect(stats.totalCalls).toBe(2);
        expect(stats.lastFailureTime).toBeTruthy();
    });

    test('OPEN error has correct code', async () => {
        for (let i = 0; i < 3; i++) {
            try {
                await breaker.execute(() => Promise.reject(new Error('fail')));
            } catch (e) { /* expected */ }
        }

        try {
            await breaker.execute(() => Promise.resolve('ok'));
            fail('should have thrown');
        } catch (error) {
            expect(error.code).toBe('CIRCUIT_OPEN');
            expect(error.circuitState).toBe(STATES.OPEN);
        }
    });
});

describe('createProtectedStorage', () => {
    test('wraps storage methods with circuit breaker', async () => {
        const storage = new InMemoryStorage();
        const protectedStorage = createProtectedStorage(storage, {
            failureThreshold: 2,
            resetTimeout: 100
        });

        await protectedStorage.setState('test', 'STATE_A', 300);
        const state = await protectedStorage.getState('test');
        expect(state).toBe('STATE_A');
    });

    test('exposes circuit breaker via _circuitBreaker', () => {
        const storage = new InMemoryStorage();
        const protectedStorage = createProtectedStorage(storage);
        expect(protectedStorage._circuitBreaker).toBeInstanceOf(CircuitBreaker);
    });

    test('uses fallback storage when circuit opens', async () => {
        const failingStorage = {
            getState: jest.fn().mockRejectedValue(new Error('connection lost')),
            setState: jest.fn().mockRejectedValue(new Error('connection lost')),
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

        const fallbackStorage = new InMemoryStorage();
        await fallbackStorage.setState('test', 'FALLBACK_STATE', 300);

        const protectedStorage = createProtectedStorage(failingStorage, {
            failureThreshold: 2,
            fallbackStorage
        });

        // Trip the breaker
        for (let i = 0; i < 2; i++) {
            try {
                await protectedStorage.getState('test');
            } catch (e) { /* expected */ }
        }

        // Should use fallback
        const state = await protectedStorage.getState('test');
        expect(state).toBe('FALLBACK_STATE');
    });
});
