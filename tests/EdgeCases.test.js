/**
 * Edge case and missing test scenarios
 * Tests concurrent session handling, storage failure recovery,
 * circular state references, middleware execution order, and more.
 */

const USSDStateMachine = require('../lib/USSDStateMachine');
const InMemoryStorage = require('../lib/InMemoryStorage');
const { MiddlewareManager } = require('../lib/Middleware');
const { CircuitBreaker, createProtectedStorage } = require('../lib/CircuitBreaker');
const { RetryStrategy, createRetryStorage } = require('../lib/RetryStrategy');
const { FailingStorage } = require('../lib/TestingUtils');
const ValidationError = require('../lib/ValidationError');

function createTestStateMachine(overrides = {}) {
    return new USSDStateMachine({
        initialState: 'WELCOME',
        timeout: 300,
        logger: null,
        states: {
            WELCOME: {
                handler: async (input) => ({
                    response: 'CON Welcome! Select:\n1. Continue',
                    nextState: input === '1' ? 'MENU' : null
                })
            },
            MENU: {
                handler: async (input) => ({
                    response: input === '1' ? 'END Thank you' : 'CON Choose:\n1. Done',
                    nextState: input === '1' ? 'END' : null
                })
            }
        },
        ...overrides
    });
}

describe('Concurrent Session Handling', () => {
    test('should handle multiple sessions simultaneously', async () => {
        const sm = createTestStateMachine();

        const results = await Promise.all([
            sm.processInput('session1', ''),
            sm.processInput('session2', ''),
            sm.processInput('session3', '')
        ]);

        results.forEach(result => {
            expect(result).toContain('Welcome');
        });
    });

    test('should isolate session state between concurrent requests', async () => {
        const sm = createTestStateMachine();

        // Start session 1 and move to MENU
        await sm.processInput('s1', '');
        await sm.processInput('s1', '1');

        // Session 2 should still be at WELCOME
        const result = await sm.processInput('s2', '');
        expect(result).toContain('Welcome');

        // Session 1 should be at MENU
        const state1 = await sm.getCurrentState('s1');
        expect(state1).toBe('MENU');
    });

    test('should handle race condition on new session initialization', async () => {
        const sm = createTestStateMachine();

        // Fire multiple requests for the same new session simultaneously
        const results = await Promise.all([
            sm.processInput('race-session', ''),
            sm.processInput('race-session', ''),
            sm.processInput('race-session', '')
        ]);

        // All should get a valid response (no crashes)
        results.forEach(result => {
            expect(typeof result).toBe('string');
            expect(result.length).toBeGreaterThan(0);
        });
    });
});

describe('Storage Failure Recovery', () => {
    test('should handle storage getState failure gracefully', async () => {
        const failingStorage = new FailingStorage(null, { getState: true });

        const sm = createTestStateMachine({ storage: failingStorage });

        await expect(sm.processInput('test', '')).rejects.toThrow('Storage failure');
    });

    test('should recover using circuit breaker with fallback', async () => {
        let callCount = 0;
        const flakeyStorage = {
            getState: async () => {
                callCount++;
                if (callCount <= 5) throw new Error('connection lost');
                return null;
            },
            setState: async () => {},
            getData: async () => null,
            setData: async () => {},
            getSession: async () => null,
            getStateHistory: async () => [],
            pushStateHistory: async () => {},
            popStateHistory: async () => undefined,
            deleteSession: async () => {}
        };

        const fallback = new InMemoryStorage();
        const protectedStorage = createProtectedStorage(flakeyStorage, {
            failureThreshold: 3,
            resetTimeout: 50,
            fallbackStorage: fallback
        });

        // Trip the breaker
        for (let i = 0; i < 3; i++) {
            try { await protectedStorage.getState('test'); } catch (e) { /* expected */ }
        }

        // Circuit should be open, fallback used
        const state = await protectedStorage.getState('test');
        expect(state).toBeNull(); // fallback returns null for non-existent
    });

    test('should retry on transient storage failures', async () => {
        let attempts = 0;
        const flakeyStorage = {
            getState: async () => {
                attempts++;
                if (attempts < 3) throw new Error('connection lost');
                return 'STATE_A';
            },
            setState: async () => {},
            getData: async () => null,
            setData: async () => {},
            getSession: async () => null,
            getStateHistory: async () => [],
            pushStateHistory: async () => {},
            popStateHistory: async () => undefined,
            deleteSession: async () => {}
        };

        const retryStorage = createRetryStorage(flakeyStorage, {
            maxRetries: 3,
            baseDelay: 10
        });

        const state = await retryStorage.getState('test');
        expect(state).toBe('STATE_A');
        expect(attempts).toBe(3);
    });
});

describe('Circular State References', () => {
    test('should handle states that loop back to themselves', async () => {
        const sm = new USSDStateMachine({
            initialState: 'INPUT',
            timeout: 300,
            logger: null,
            states: {
                INPUT: {
                    handler: async (input) => {
                        if (input === 'done') {
                            return { response: 'END Complete', nextState: null };
                        }
                        return {
                            response: 'CON Enter value (or "done"):',
                            nextState: 'INPUT' // loops back
                        };
                    }
                }
            }
        });

        // Loop multiple times
        for (let i = 0; i < 5; i++) {
            const result = await sm.processInput('loop-test', 'value');
            expect(result).toContain('Enter value');
        }

        // Then exit
        const result = await sm.processInput('loop-test', 'done');
        expect(result).toBe('END Complete');
    });

    test('should handle A -> B -> A state cycles', async () => {
        const sm = new USSDStateMachine({
            initialState: 'STATE_A',
            timeout: 300,
            logger: null,
            states: {
                STATE_A: {
                    handler: async (input) => ({
                        response: 'CON State A\n1. Go to B',
                        nextState: input === '1' ? 'STATE_B' : null
                    })
                },
                STATE_B: {
                    handler: async (input) => ({
                        response: 'CON State B\n1. Go to A',
                        nextState: input === '1' ? 'STATE_A' : null
                    })
                }
            }
        });

        await sm.processInput('cycle', '');
        await sm.processInput('cycle', '1'); // A -> B
        await sm.processInput('cycle', '1'); // B -> A
        await sm.processInput('cycle', '1'); // A -> B

        const state = await sm.getCurrentState('cycle');
        expect(state).toBe('STATE_B');
    });
});

describe('Middleware Execution Order', () => {
    test('should execute middleware in registration order', async () => {
        const order = [];
        const middleware = new MiddlewareManager();

        middleware.use('beforeProcess', async (ctx, next) => {
            order.push('first-before');
            await next();
            order.push('first-after');
        });

        middleware.use('beforeProcess', async (ctx, next) => {
            order.push('second-before');
            await next();
            order.push('second-after');
        });

        const sm = createTestStateMachine({ middleware });
        await sm.processInput('mw-order', '');

        expect(order).toEqual([
            'first-before',
            'second-before',
            'second-after',
            'first-after'
        ]);
    });

    test('should allow middleware to block processing', async () => {
        const middleware = new MiddlewareManager();

        middleware.use('beforeProcess', async (ctx, next) => {
            ctx.response = 'END Blocked by middleware';
            ctx.blocked = true;
            // Don't call next()
        });

        const sm = createTestStateMachine({ middleware });
        const result = await sm.processInput('blocked', '');

        expect(result).toBe('END Blocked by middleware');
    });

    test('should allow middleware to modify input', async () => {
        const middleware = new MiddlewareManager();

        middleware.use('beforeProcess', async (ctx, next) => {
            // Transform input
            if (ctx.input === 'one') {
                ctx.input = '1';
            }
            await next();
        });

        const sm = createTestStateMachine({ middleware });
        await sm.processInput('mod-input', '');
        const result = await sm.processInput('mod-input', 'one');

        // Should have transitioned to MENU since input was modified to '1'
        const state = await sm.getCurrentState('mod-input');
        expect(state).toBe('MENU');
    });

    test('should handle middleware errors in onError hook', async () => {
        const errors = [];
        const middleware = new MiddlewareManager();

        middleware.use('onError', async (ctx, next) => {
            errors.push(ctx.error);
            await next();
        });

        const sm = new USSDStateMachine({
            initialState: 'FAIL',
            timeout: 300,
            logger: null,
            middleware,
            states: {
                FAIL: {
                    validator: async () => { throw new ValidationError('bad input', 'input', 'test'); },
                    handler: async () => ({ response: 'CON ok' })
                }
            }
        });

        await sm.processInput('err-test', 'anything');

        expect(errors).toHaveLength(1);
        expect(errors[0]).toBeInstanceOf(ValidationError);
    });
});

describe('Back Navigation Edge Cases', () => {
    test('should handle back navigation at initial state (no history)', async () => {
        const sm = createTestStateMachine({ enableBackNavigation: true });

        await sm.processInput('back-test', '');
        const result = await sm.processInput('back-test', '0');

        // Should stay at WELCOME since there's no history
        expect(result).toContain('Welcome');
    });

    test('should handle back navigation when disabled', async () => {
        const sm = createTestStateMachine({ enableBackNavigation: false });

        await sm.processInput('no-back', '');
        await sm.processInput('no-back', '1'); // Move to MENU

        // Input '0' should be treated as regular input, not back nav
        const result = await sm.processInput('no-back', '0');
        expect(result).toContain('Choose');
    });
});

describe('Input Edge Cases', () => {
    test('should handle empty input', async () => {
        const sm = createTestStateMachine();
        const result = await sm.processInput('empty', '');
        expect(result).toContain('Welcome');
    });

    test('should handle null-like inputs', async () => {
        const sm = createTestStateMachine();
        const result = await sm.processInput('null-input', '');
        expect(typeof result).toBe('string');
    });

    test('should reject input exceeding maxInputLength', async () => {
        const sm = createTestStateMachine({ maxInputLength: 10 });
        await expect(
            sm.processInput('long-input', 'a'.repeat(20))
        ).rejects.toThrow('Input too long');
    });

    test('should allow any length when maxInputLength is 0', async () => {
        const sm = createTestStateMachine({ maxInputLength: 0 });
        const result = await sm.processInput('unlimited', 'a'.repeat(1000));
        expect(typeof result).toBe('string');
    });
});

describe('Hook Error Strategies', () => {
    test('should log hook errors by default', async () => {
        const logs = [];
        const sm = createTestStateMachine({
            logger: { error: (...args) => logs.push(args) },
            hooks: {
                onStateEnter: () => { throw new Error('hook error'); }
            }
        });

        await sm.processInput('hook-log', '');
        await sm.processInput('hook-log', '1');

        expect(logs.length).toBeGreaterThan(0);
    });

    test('should throw hook errors when strategy is throw', async () => {
        const sm = createTestStateMachine({
            hookErrorStrategy: 'throw',
            hooks: {
                onStateEnter: () => { throw new Error('hook error'); }
            }
        });

        await sm.processInput('hook-throw', '');
        await expect(sm.processInput('hook-throw', '1')).rejects.toThrow('hook error');
    });

    test('should call callback on hook errors when strategy is callback', async () => {
        const hookErrors = [];
        const sm = createTestStateMachine({
            hookErrorStrategy: 'callback',
            onHookError: (hookName, error) => hookErrors.push({ hookName, error }),
            hooks: {
                onStateEnter: () => { throw new Error('hook error'); }
            }
        });

        await sm.processInput('hook-cb', '');
        await sm.processInput('hook-cb', '1');

        expect(hookErrors.length).toBeGreaterThan(0);
        expect(hookErrors[0].hookName).toBe('onStateEnter');
    });
});

describe('Session Lifecycle', () => {
    test('should track session activity', async () => {
        const sm = createTestStateMachine();

        expect(await sm.isSessionActive('new-session')).toBe(false);

        // processInput with a transition stores the state
        await sm.processInput('new-session', '');
        await sm.processInput('new-session', '1'); // transitions to MENU, stores state
        expect(await sm.isSessionActive('new-session')).toBe(true);

        await sm.endSession('new-session');
        expect(await sm.isSessionActive('new-session')).toBe(false);
    });

    test('should get and set session data', async () => {
        const sm = createTestStateMachine();
        await sm.processInput('data-test', '');

        await sm.setSessionData('data-test', { key: 'value' });
        const data = await sm.getSessionData('data-test');
        expect(data).toEqual({ key: 'value' });
    });

    test('should merge session data across state transitions', async () => {
        const sm = new USSDStateMachine({
            initialState: 'STEP1',
            timeout: 300,
            logger: null,
            states: {
                STEP1: {
                    handler: async (input) => ({
                        response: 'CON Step 1',
                        nextState: 'STEP2',
                        data: { step1: 'done' }
                    })
                },
                STEP2: {
                    handler: async (input, sessionId, ctx) => ({
                        response: `END Step1 was: ${ctx.sessionData?.step1}`,
                        data: { step2: 'done' }
                    })
                }
            }
        });

        await sm.processInput('merge-test', '');
        const result = await sm.processInput('merge-test', 'anything');

        expect(result).toContain('Step1 was: done');
    });
});
