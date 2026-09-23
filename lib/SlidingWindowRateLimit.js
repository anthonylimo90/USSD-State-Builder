/**
 * Sliding Window Rate Limiter
 *
 * Implements a sliding window counter algorithm for more accurate
 * rate limiting compared to fixed window counters. Supports both
 * in-memory and Redis-backed implementations.
 */

/**
 * In-memory sliding window rate limiter
 */
class SlidingWindowRateLimit {
    /**
     * Create a new SlidingWindowRateLimit
     * @param {Object} [options] - Rate limit options
     * @param {number} [options.maxRequests=10] - Maximum requests per window
     * @param {number} [options.windowMs=60000] - Window duration in milliseconds
     * @param {number} [options.precision=10] - Number of sub-windows for sliding calculation
     * @param {string} [options.message='Too many requests. Please try again later.'] - Error message
     *
     * @example
     * const limiter = new SlidingWindowRateLimit({
     *   maxRequests: 10,
     *   windowMs: 60000,
     *   precision: 10
     * });
     */
    constructor(options = {}) {
        this.maxRequests = options.maxRequests || 10;
        this.windowMs = options.windowMs || 60000;
        this.precision = options.precision || 10;
        this.message = options.message || 'Too many requests. Please try again later.';

        this._subWindowMs = this.windowMs / this.precision;
        this._windows = new Map();
        this._cleanupTimer = null;

        this._startCleanup();
    }

    /**
     * Check if a request should be allowed
     * @param {string} key - Rate limit key (e.g., session ID)
     * @returns {Object} Result with allowed flag and metadata
     */
    check(key) {
        const now = Date.now();
        const windowData = this._getOrCreateWindow(key);
        const count = this._getCount(windowData, now);

        const allowed = count < this.maxRequests;
        const remaining = Math.max(0, this.maxRequests - count - (allowed ? 1 : 0));
        const resetAt = this._getResetTime(windowData, now);

        if (allowed) {
            this._increment(windowData, now);
        }

        return {
            allowed,
            remaining,
            limit: this.maxRequests,
            resetAt,
            retryAfter: allowed ? 0 : Math.ceil((resetAt - now) / 1000)
        };
    }

    /**
     * Get or create window data for a key
     * @private
     */
    _getOrCreateWindow(key) {
        if (!this._windows.has(key)) {
            this._windows.set(key, {
                buckets: new Map(),
                lastAccess: Date.now()
            });
        }
        const data = this._windows.get(key);
        data.lastAccess = Date.now();
        return data;
    }

    /**
     * Get current count within the sliding window
     * @private
     */
    _getCount(windowData, now) {
        const windowStart = now - this.windowMs;
        let count = 0;

        for (const [timestamp, bucketCount] of windowData.buckets) {
            if (timestamp >= windowStart) {
                count += bucketCount;
            }
        }

        return count;
    }

    /**
     * Increment the current sub-window bucket
     * @private
     */
    _increment(windowData, now) {
        const bucketKey = Math.floor(now / this._subWindowMs) * this._subWindowMs;
        const current = windowData.buckets.get(bucketKey) || 0;
        windowData.buckets.set(bucketKey, current + 1);

        // Clean old buckets
        const windowStart = now - this.windowMs;
        for (const [timestamp] of windowData.buckets) {
            if (timestamp < windowStart) {
                windowData.buckets.delete(timestamp);
            }
        }
    }

    /**
     * Get the reset time for a window
     * @private
     */
    _getResetTime(windowData, now) {
        const windowStart = now - this.windowMs;
        let oldestBucket = now;

        for (const [timestamp] of windowData.buckets) {
            if (timestamp >= windowStart && timestamp < oldestBucket) {
                oldestBucket = timestamp;
            }
        }

        return oldestBucket + this.windowMs;
    }

    /**
     * Start periodic cleanup of expired windows
     * @private
     */
    _startCleanup() {
        this._cleanupTimer = setInterval(() => {
            const now = Date.now();
            const windowStart = now - this.windowMs;

            for (const [key, data] of this._windows) {
                // Remove expired buckets
                for (const [timestamp] of data.buckets) {
                    if (timestamp < windowStart) {
                        data.buckets.delete(timestamp);
                    }
                }

                // Remove empty windows that haven't been accessed recently
                if (data.buckets.size === 0 && now - data.lastAccess > this.windowMs * 2) {
                    this._windows.delete(key);
                }
            }
        }, this.windowMs);

        if (this._cleanupTimer.unref) {
            this._cleanupTimer.unref();
        }
    }

    /**
     * Reset a specific key
     * @param {string} key - Key to reset
     */
    reset(key) {
        this._windows.delete(key);
    }

    /**
     * Reset all rate limit data
     */
    resetAll() {
        this._windows.clear();
    }

    /**
     * Stop the cleanup timer
     */
    destroy() {
        if (this._cleanupTimer) {
            clearInterval(this._cleanupTimer);
            this._cleanupTimer = null;
        }
        this._windows.clear();
    }

    /**
     * Get current statistics
     * @returns {Object} Rate limiter statistics
     */
    getStats() {
        return {
            trackedKeys: this._windows.size,
            maxRequests: this.maxRequests,
            windowMs: this.windowMs,
            precision: this.precision
        };
    }
}

/**
 * Create sliding window rate limit middleware
 * @param {Object} [options] - SlidingWindowRateLimit options
 * @returns {Object} Object with middleware, cleanup, and reset functions
 *
 * @example
 * const limiter = createSlidingWindowRateLimit({
 *   maxRequests: 10,
 *   windowMs: 60000
 * });
 * machine.use('beforeProcess', limiter.middleware);
 */
function createSlidingWindowRateLimit(options = {}) {
    const limiter = new SlidingWindowRateLimit(options);
    const message = options.message || 'Too many requests. Please try again later.';

    const middleware = async (context, next) => {
        const result = limiter.check(context.sessionId);

        if (!result.allowed) {
            context.response = `END ${message}`;
            context.blocked = true;
            context.rateLimitInfo = result;
            return;
        }

        // Attach rate limit headers info to context
        context.rateLimitInfo = result;

        await next();
    };

    return {
        middleware,
        limiter,
        cleanup: () => limiter.destroy(),
        reset: (key) => key ? limiter.reset(key) : limiter.resetAll(),
        getStats: () => limiter.getStats()
    };
}

module.exports = { SlidingWindowRateLimit, createSlidingWindowRateLimit };
