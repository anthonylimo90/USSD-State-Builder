/**
 * Circuit Breaker for USSD State Machine
 *
 * Implements the circuit breaker pattern to prevent cascading failures.
 * When a service fails repeatedly, the circuit "opens" and fails fast
 * without calling the service, giving it time to recover.
 *
 * States: CLOSED (normal) -> OPEN (failing fast) -> HALF_OPEN (testing recovery)
 */

const STATES = {
    CLOSED: 'CLOSED',
    OPEN: 'OPEN',
    HALF_OPEN: 'HALF_OPEN'
};

class CircuitBreaker {
    /**
     * Create a new Circuit Breaker
     * @param {Object} [options] - Configuration options
     * @param {number} [options.failureThreshold=5] - Failures before opening circuit
     * @param {number} [options.resetTimeout=30000] - Time in ms before trying half-open
     * @param {number} [options.halfOpenMaxAttempts=1] - Max test requests in half-open state
     * @param {Function} [options.onStateChange] - Callback when circuit state changes
     * @param {Function} [options.isFailure] - Custom function to determine if result is a failure
     */
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 5;
        this.resetTimeout = options.resetTimeout || 30000;
        this.halfOpenMaxAttempts = options.halfOpenMaxAttempts || 1;
        this.onStateChange = options.onStateChange || null;
        this.isFailure = options.isFailure || null;

        this._state = STATES.CLOSED;
        this._failureCount = 0;
        this._lastFailureTime = null;
        this._halfOpenAttempts = 0;
        this._successCount = 0;
        this._totalCalls = 0;
    }

    /**
     * Get the current circuit state
     * @returns {string} Current state (CLOSED, OPEN, or HALF_OPEN)
     */
    get state() {
        // Check if we should transition from OPEN to HALF_OPEN
        if (this._state === STATES.OPEN && this._lastFailureTime) {
            const elapsed = Date.now() - this._lastFailureTime;
            if (elapsed >= this.resetTimeout) {
                this._transition(STATES.HALF_OPEN);
            }
        }
        return this._state;
    }

    /**
     * Execute a function through the circuit breaker
     * @param {Function} fn - Async function to execute
     * @param {Function} [fallback] - Fallback function when circuit is open
     * @returns {Promise<any>} Result of fn or fallback
     * @throws {Error} CircuitOpenError when circuit is open and no fallback
     */
    async execute(fn, fallback) {
        const currentState = this.state; // triggers state check
        this._totalCalls++;

        if (currentState === STATES.OPEN) {
            if (fallback) {
                return fallback();
            }
            const error = new Error('Circuit breaker is OPEN');
            error.code = 'CIRCUIT_OPEN';
            error.circuitState = STATES.OPEN;
            throw error;
        }

        if (currentState === STATES.HALF_OPEN) {
            if (this._halfOpenAttempts >= this.halfOpenMaxAttempts) {
                if (fallback) {
                    return fallback();
                }
                const error = new Error('Circuit breaker is HALF_OPEN, max attempts reached');
                error.code = 'CIRCUIT_HALF_OPEN';
                error.circuitState = STATES.HALF_OPEN;
                throw error;
            }
            this._halfOpenAttempts++;
        }

        try {
            const result = await fn();

            // Check custom failure condition
            if (this.isFailure && this.isFailure(result)) {
                this._onFailure();
                return result;
            }

            this._onSuccess();
            return result;
        } catch (error) {
            this._onFailure();
            throw error;
        }
    }

    /**
     * Handle a successful execution
     * @private
     */
    _onSuccess() {
        this._successCount++;

        if (this._state === STATES.HALF_OPEN) {
            // Success in half-open means service recovered
            this._reset();
        } else if (this._state === STATES.CLOSED) {
            // Reset failure count on success
            this._failureCount = 0;
        }
    }

    /**
     * Handle a failed execution
     * @private
     */
    _onFailure() {
        this._failureCount++;
        this._lastFailureTime = Date.now();

        if (this._state === STATES.HALF_OPEN) {
            // Failure in half-open means service still down
            this._transition(STATES.OPEN);
            this._halfOpenAttempts = 0;
        } else if (this._state === STATES.CLOSED && this._failureCount >= this.failureThreshold) {
            this._transition(STATES.OPEN);
        }
    }

    /**
     * Transition to a new state
     * @private
     * @param {string} newState - Target state
     */
    _transition(newState) {
        const oldState = this._state;
        if (oldState === newState) return;

        this._state = newState;

        if (newState === STATES.HALF_OPEN) {
            this._halfOpenAttempts = 0;
        }

        if (this.onStateChange) {
            this.onStateChange(oldState, newState);
        }
    }

    /**
     * Reset the circuit breaker to closed state
     */
    reset() {
        this._reset();
    }

    /**
     * @private
     */
    _reset() {
        this._transition(STATES.CLOSED);
        this._failureCount = 0;
        this._halfOpenAttempts = 0;
        this._lastFailureTime = null;
    }

    /**
     * Get circuit breaker statistics
     * @returns {Object} Statistics
     */
    getStats() {
        return {
            state: this.state,
            failureCount: this._failureCount,
            successCount: this._successCount,
            totalCalls: this._totalCalls,
            lastFailureTime: this._lastFailureTime
                ? new Date(this._lastFailureTime).toISOString()
                : null
        };
    }
}

/**
 * Create a circuit breaker wrapper for a storage adapter
 * @param {Object} storage - Storage adapter
 * @param {Object} [options] - Circuit breaker options
 * @returns {Object} Wrapped storage with circuit breaker
 */
function createProtectedStorage(storage, options = {}) {
    const breaker = new CircuitBreaker(options);
    const fallbackStorage = options.fallbackStorage || null;

    const handler = {
        get(target, prop) {
            const original = target[prop];

            // Only wrap async methods
            if (typeof original !== 'function') {
                return original;
            }

            // Don't wrap non-storage methods
            const storageMethods = [
                'getState', 'setState', 'getData', 'setData',
                'getSession', 'setSession', 'getStateHistory',
                'pushStateHistory', 'popStateHistory', 'deleteSession',
                'cleanup', 'close'
            ];

            if (!storageMethods.includes(prop)) {
                return original.bind(target);
            }

            return async (...args) => {
                const fallbackFn = fallbackStorage && typeof fallbackStorage[prop] === 'function'
                    ? () => fallbackStorage[prop](...args)
                    : undefined;

                return breaker.execute(
                    () => original.apply(target, args),
                    fallbackFn
                );
            };
        }
    };

    const proxy = new Proxy(storage, handler);
    proxy._circuitBreaker = breaker;
    return proxy;
}

module.exports = { CircuitBreaker, createProtectedStorage, STATES };
