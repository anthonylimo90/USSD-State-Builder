/**
 * Error Recovery Example
 *
 * Demonstrates production error handling patterns using CircuitBreaker,
 * RetryStrategy, ErrorHandler, and the middleware error hook. These
 * patterns prevent cascading failures when external services go down.
 *
 * Run: node examples/error-recovery.js
 */

const {
    USSDStateMachine,
    ResponseBuilder,
    InMemoryStorage,
    CircuitBreaker,
    RetryStrategy,
    createProtectedStorage,
    createRetryStorage,
    ErrorHandler,
    StorageError,
    HandlerError
} = require('../');

// --- 1. Circuit Breaker: fail fast when a dependency is down ---

const breaker = new CircuitBreaker({
    failureThreshold: 3,        // Open circuit after 3 consecutive failures
    resetTimeout: 10000,        // Try again after 10 seconds
    halfOpenMaxAttempts: 1,     // Allow 1 test request in half-open state
    onStateChange: (from, to) => {
        console.log(`[circuit-breaker] ${from} -> ${to}`);
    }
});

// Simulate an unreliable external API (e.g., balance service)
let apiCallCount = 0;
async function fetchBalance(phone) {
    apiCallCount++;
    // Simulate failures on first 4 calls, then recover
    if (apiCallCount <= 4) {
        throw new Error('Connection timeout');
    }
    return { balance: 1250.75, currency: 'KES' };
}

// --- 2. Retry Strategy: retry transient errors with backoff ---

const retry = new RetryStrategy({
    maxRetries: 2,
    baseDelay: 200,
    maxDelay: 2000,
    jitter: true,
    onRetry: (error, attempt, delayMs) => {
        console.log(`[retry] Attempt ${attempt} after ${delayMs}ms: ${error.message}`);
    },
    // Only retry network-like errors, not validation errors
    shouldRetry: (error) => {
        return error.message.includes('timeout') || error.message.includes('connection');
    }
});

// --- 3. Protected storage: wrap storage with circuit breaker + retry ---

const baseStorage = new InMemoryStorage();

// Layer 1: Add automatic retries to storage operations
const retriedStorage = createRetryStorage(baseStorage, {
    maxRetries: 2,
    baseDelay: 50
});

// Layer 2: Add circuit breaker on top of retried storage
const protectedStorage = createProtectedStorage(retriedStorage, {
    failureThreshold: 5,
    resetTimeout: 15000,
    onStateChange: (from, to) => {
        console.log(`[storage-circuit] ${from} -> ${to}`);
    }
});

// --- 4. State machine with error handling hooks ---

const ussd = new USSDStateMachine({
    initialState: 'WELCOME',
    storage: protectedStorage,
    hookErrorStrategy: 'callback',
    onHookError: (hookName, error) => {
        console.log(`[hook-error] ${hookName}: ${error.message}`);
    },
    states: {
        WELCOME: {
            handler: async () => ({
                response: ResponseBuilder.menu('MobileBank', ['Check Balance', 'Mini Statement']),
                nextState: 'MENU'
            })
        },
        MENU: {
            handler: async (input, sessionId) => {
                if (input === '1') {
                    // Use circuit breaker to call the unreliable balance API
                    try {
                        const result = await breaker.execute(
                            () => fetchBalance(sessionId),
                            // Fallback: return cached/default data when circuit is open
                            () => ({ balance: 'unavailable', currency: 'KES' })
                        );
                        return {
                            response: ResponseBuilder.end(
                                `Balance: ${result.currency} ${result.balance}`
                            )
                        };
                    } catch (err) {
                        return {
                            response: ResponseBuilder.end(
                                'Balance service is temporarily unavailable. Try again later.'
                            )
                        };
                    }
                }
                if (input === '2') {
                    // Use retry strategy for a flaky operation
                    try {
                        const statement = await retry.execute(async () => {
                            // Simulated flaky call that succeeds on second attempt
                            if (Math.random() < 0.5) throw new Error('Connection timeout');
                            return ['- KES 500 to John', '- KES 200 from Mary'];
                        });
                        return {
                            response: ResponseBuilder.end(
                                'Mini Statement:\n' + statement.join('\n')
                            )
                        };
                    } catch (err) {
                        return { response: ResponseBuilder.end('Could not load statement.') };
                    }
                }
                return { response: ResponseBuilder.error('Invalid option') };
            }
        }
    }
});

// --- 5. ErrorHandler utility for user-friendly messages ---

const friendlyMessages = {
    STORAGE_ERROR: 'We are experiencing technical difficulties.',
    HANDLER_ERROR: 'Something went wrong processing your request.',
    DEFAULT: 'An unexpected error occurred. Please try again.'
};

// --- Demo ---

async function demo() {
    // Normal flow
    const r1 = await ussd.processInput('s1', '');
    console.log('Welcome:', r1);

    // Check balance -- will hit circuit breaker failures, then fallback
    const r2 = await ussd.processInput('s1', '1');
    console.log('Balance:', r2);

    // Show circuit breaker stats
    console.log('Breaker stats:', breaker.getStats());

    // Show ErrorHandler producing user-friendly messages
    const storageErr = new StorageError('Redis connection lost', 'getState');
    console.log('Friendly msg:', ErrorHandler.getUserMessage(storageErr, friendlyMessages));

    const handlerErr = new HandlerError('Null pointer', 'MENU');
    console.log('Formatted log:', ErrorHandler.formatForLogging(handlerErr));
}

demo().catch(console.error);
