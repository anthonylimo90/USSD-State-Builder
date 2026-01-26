/**
 * Retry Strategy for USSD State Machine
 *
 * Provides configurable retry logic with exponential backoff
 * for resilient storage operations and external service calls.
 */

/**
 * Delay for a given number of milliseconds
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class RetryStrategy {
    /**
     * Create a new Retry Strategy
     * @param {Object} [options] - Configuration options
     * @param {number} [options.maxRetries=3] - Maximum number of retries
     * @param {number} [options.baseDelay=100] - Base delay in ms for exponential backoff
     * @param {number} [options.maxDelay=5000] - Maximum delay in ms
     * @param {number} [options.backoffMultiplier=2] - Multiplier for exponential backoff
     * @param {boolean} [options.jitter=true] - Add random jitter to prevent thundering herd
     * @param {Function} [options.shouldRetry] - Custom function to determine if error is retryable
     * @param {Function} [options.onRetry] - Callback on each retry attempt
     */
    constructor(options = {}) {
        this.maxRetries = options.maxRetries ?? 3;
        this.baseDelay = options.baseDelay || 100;
        this.maxDelay = options.maxDelay || 5000;
        this.backoffMultiplier = options.backoffMultiplier || 2;
        this.jitter = options.jitter !== false;
        this.shouldRetry = options.shouldRetry || RetryStrategy.defaultShouldRetry;
        this.onRetry = options.onRetry || null;
    }

    /**
     * Default retry condition - retries on transient errors
     * @param {Error} error - The error to check
     * @returns {boolean} Whether to retry
     */
    static defaultShouldRetry(error) {
        // Don't retry validation or configuration errors
        if (error.name === 'ValidationError' || error.name === 'ConfigurationError') {
            return false;
        }

        // Retry on connection/network errors
        const retryableCodes = [
            'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE',
            'EHOSTUNREACH', 'EAI_AGAIN', 'ENOTFOUND'
        ];
        if (error.code && retryableCodes.includes(error.code)) {
            return true;
        }

        // Retry on common database errors
        const retryableMessages = [
            'connection lost', 'connection reset', 'timeout',
            'deadlock', 'lock timeout', 'too many connections',
            'pool is full', 'READONLY'
        ];
        const msg = (error.message || '').toLowerCase();
        return retryableMessages.some(m => msg.includes(m));
    }

    /**
     * Calculate delay for a given attempt
     * @param {number} attempt - Current attempt number (0-indexed)
     * @returns {number} Delay in milliseconds
     */
    calculateDelay(attempt) {
        const exponentialDelay = this.baseDelay * Math.pow(this.backoffMultiplier, attempt);
        const cappedDelay = Math.min(exponentialDelay, this.maxDelay);

        if (this.jitter) {
            // Full jitter: random between 0 and capped delay
            return Math.floor(Math.random() * cappedDelay);
        }

        return cappedDelay;
    }

    /**
     * Execute a function with retry logic
     * @param {Function} fn - Async function to execute
     * @returns {Promise<any>} Result of the function
     * @throws {Error} Last error if all retries exhausted
     */
    async execute(fn) {
        let lastError;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;

                if (attempt >= this.maxRetries || !this.shouldRetry(error)) {
                    throw error;
                }

                const retryDelay = this.calculateDelay(attempt);

                if (this.onRetry) {
                    this.onRetry(error, attempt + 1, retryDelay);
                }

                await delay(retryDelay);
            }
        }

        throw lastError;
    }
}

/**
 * Create a storage adapter wrapper with automatic retry
 * @param {Object} storage - Storage adapter
 * @param {Object} [options] - Retry options
 * @returns {Object} Wrapped storage with retry logic
 */
function createRetryStorage(storage, options = {}) {
    const strategy = new RetryStrategy(options);

    const handler = {
        get(target, prop) {
            const original = target[prop];

            if (typeof original !== 'function') {
                return original;
            }

            // Only wrap storage interface methods
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
                return strategy.execute(() => original.apply(target, args));
            };
        }
    };

    const proxy = new Proxy(storage, handler);
    proxy._retryStrategy = strategy;
    return proxy;
}

module.exports = { RetryStrategy, createRetryStorage };
