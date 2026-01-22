/**
 * Middleware Manager for USSD State Machine
 * 
 * Provides a plugin/middleware system for extending USSD functionality.
 * Middleware can intercept and modify requests/responses at various points.
 */

/**
 * Middleware execution context
 * @typedef {Object} MiddlewareContext
 * @property {string} sessionId - Session identifier
 * @property {string} input - User input
 * @property {string} currentState - Current state name
 * @property {Object} sessionData - Current session data
 * @property {Object} metadata - Additional metadata
 */

/**
 * Middleware function type
 * @callback MiddlewareFunction
 * @param {MiddlewareContext} context - Execution context
 * @param {Function} next - Call to proceed to next middleware
 * @returns {Promise<any>}
 */

class MiddlewareManager {
    constructor() {
        this.middlewares = {
            beforeProcess: [],
            afterProcess: [],
            onError: [],
            onStateChange: [],
            onSessionStart: [],
            onSessionEnd: []
        };
    }

    /**
     * Register middleware for a specific hook
     * @param {string} hook - Hook name (beforeProcess, afterProcess, onError, onStateChange, onSessionStart, onSessionEnd)
     * @param {MiddlewareFunction} fn - Middleware function
     * @returns {MiddlewareManager} this for chaining
     */
    use(hook, fn) {
        if (typeof hook === 'function') {
            // If only function provided, add to beforeProcess
            fn = hook;
            hook = 'beforeProcess';
        }

        if (!this.middlewares[hook]) {
            throw new Error(`Unknown middleware hook: ${hook}. Valid hooks: ${Object.keys(this.middlewares).join(', ')}`);
        }

        if (typeof fn !== 'function') {
            throw new Error('Middleware must be a function');
        }

        this.middlewares[hook].push(fn);
        return this;
    }

    /**
     * Execute middlewares for a specific hook
     * @param {string} hook - Hook name
     * @param {MiddlewareContext} context - Execution context
     * @returns {Promise<MiddlewareContext>} Modified context
     */
    async execute(hook, context) {
        const middlewares = this.middlewares[hook] || [];
        let index = 0;

        const next = async () => {
            if (index < middlewares.length) {
                const middleware = middlewares[index++];
                await middleware(context, next);
            }
        };

        await next();
        return context;
    }

    /**
     * Remove all middlewares for a hook or all hooks
     * @param {string} [hook] - Optional hook name
     */
    clear(hook) {
        if (hook) {
            if (this.middlewares[hook]) {
                this.middlewares[hook] = [];
            }
        } else {
            Object.keys(this.middlewares).forEach(h => {
                this.middlewares[h] = [];
            });
        }
    }

    /**
     * Get count of registered middlewares
     * @param {string} [hook] - Optional hook name
     * @returns {number} Count of middlewares
     */
    count(hook) {
        if (hook) {
            return (this.middlewares[hook] || []).length;
        }
        return Object.values(this.middlewares).reduce((sum, arr) => sum + arr.length, 0);
    }
}

// Built-in middleware factories

/**
 * Create a logging middleware
 * @param {Object} [options] - Logging options
 * @param {Function} [options.logger=console.log] - Logger function
 * @param {boolean} [options.logInput=true] - Log user input
 * @param {boolean} [options.logResponse=true] - Log response
 * @param {boolean} [options.logTiming=true] - Log execution time
 * @returns {MiddlewareFunction}
 */
function createLoggingMiddleware(options = {}) {
    const {
        logger = console.log,
        logInput = true,
        logResponse = true,
        logTiming = true
    } = options;

    return async (context, next) => {
        const startTime = Date.now();

        if (logInput) {
            logger(`[USSD] Session: ${context.sessionId}, State: ${context.currentState}, Input: "${context.input}"`);
        }

        await next();

        if (logTiming) {
            const duration = Date.now() - startTime;
            logger(`[USSD] Session: ${context.sessionId} completed in ${duration}ms`);
        }

        if (logResponse && context.response) {
            logger(`[USSD] Response: ${context.response.substring(0, 100)}${context.response.length > 100 ? '...' : ''}`);
        }
    };
}

/**
 * Create a rate limiting middleware
 *
 * IMPORTANT: This middleware uses in-memory storage for tracking requests.
 * It will NOT work correctly in distributed/clustered environments where
 * requests may be handled by different instances. For distributed systems,
 * use a Redis-based rate limiting solution instead.
 *
 * @param {Object} options - Rate limit options
 * @param {number} [options.maxRequests=10] - Max requests per window
 * @param {number} [options.windowMs=60000] - Time window in milliseconds
 * @param {string} [options.message='Too many requests. Please try again later.'] - Error message
 * @returns {Object} Object containing middleware function and cleanup method
 * @returns {MiddlewareFunction} returns.middleware - The middleware function to use
 * @returns {Function} returns.cleanup - Call this to stop the cleanup interval (for graceful shutdown)
 * @returns {Function} returns.reset - Reset all rate limit counters
 *
 * @example
 * const rateLimiter = createRateLimitMiddleware({ maxRequests: 5 });
 * stateMachine.use('beforeProcess', rateLimiter.middleware);
 *
 * // On graceful shutdown:
 * process.on('SIGTERM', () => {
 *   rateLimiter.cleanup();
 * });
 */
function createRateLimitMiddleware(options = {}) {
    const {
        maxRequests = 10,
        windowMs = 60000,
        message = 'Too many requests. Please try again later.'
    } = options;

    const requests = new Map();
    let cleanupIntervalId = null;

    // Cleanup old entries periodically
    cleanupIntervalId = setInterval(() => {
        const now = Date.now();
        for (const [key, data] of requests) {
            if (now - data.windowStart > windowMs) {
                requests.delete(key);
            }
        }
    }, windowMs);

    // Prevent interval from keeping the process alive
    if (cleanupIntervalId.unref) {
        cleanupIntervalId.unref();
    }

    const middleware = async (context, next) => {
        const key = context.sessionId;
        const now = Date.now();

        let data = requests.get(key);
        if (!data || now - data.windowStart > windowMs) {
            data = { count: 0, windowStart: now };
        }

        data.count++;
        requests.set(key, data);

        if (data.count > maxRequests) {
            context.response = `END ${message}`;
            context.blocked = true;
            return;
        }

        await next();
    };

    const cleanup = () => {
        if (cleanupIntervalId) {
            clearInterval(cleanupIntervalId);
            cleanupIntervalId = null;
        }
        requests.clear();
    };

    const reset = () => {
        requests.clear();
    };

    return { middleware, cleanup, reset };
}

/**
 * Create a session timeout middleware
 * @param {Object} options - Timeout options
 * @param {number} [options.warningThreshold=60] - Seconds before timeout to warn
 * @param {string} [options.warningMessage='Session expiring soon.'] - Warning message
 * @returns {MiddlewareFunction}
 */
function createSessionTimeoutMiddleware(options = {}) {
    const {
        warningThreshold = 60,
        warningMessage = 'Session expiring soon.'
    } = options;

    return async (context, next) => {
        await next();

        // Add warning if session is about to expire
        if (context.sessionExpiresAt) {
            const secondsRemaining = (context.sessionExpiresAt - Date.now()) / 1000;
            if (secondsRemaining < warningThreshold && secondsRemaining > 0) {
                if (context.response && context.response.startsWith('CON')) {
                    context.response = context.response + `\n(${warningMessage})`;
                }
            }
        }
    };
}

/**
 * Create an analytics middleware
 * @param {Object} options - Analytics options
 * @param {Function} options.track - Tracking function (event, properties) => void
 * @returns {MiddlewareFunction}
 */
function createAnalyticsMiddleware(options = {}) {
    const { track } = options;

    if (typeof track !== 'function') {
        throw new Error('Analytics middleware requires a track function');
    }

    return async (context, next) => {
        const startTime = Date.now();
        const previousState = context.currentState;

        await next();

        const duration = Date.now() - startTime;

        track('ussd_interaction', {
            sessionId: context.sessionId,
            input: context.input,
            fromState: previousState,
            toState: context.nextState || previousState,
            duration,
            timestamp: new Date().toISOString()
        });
    };
}

/**
 * Create an input sanitization middleware
 * @param {Object} [options] - Sanitization options
 * @param {number} [options.maxLength=160] - Maximum input length
 * @param {boolean} [options.trim=true] - Trim whitespace
 * @param {boolean} [options.removeSpecialChars=false] - Remove special characters
 * @returns {MiddlewareFunction}
 */
function createSanitizationMiddleware(options = {}) {
    const {
        maxLength = 160,
        trim = true,
        removeSpecialChars = false
    } = options;

    return async (context, next) => {
        let input = context.input || '';

        if (trim) {
            input = input.trim();
        }

        if (maxLength && input.length > maxLength) {
            input = input.substring(0, maxLength);
        }

        if (removeSpecialChars) {
            input = input.replace(/[^\w\s@.-]/g, '');
        }

        context.input = input;
        context.originalInput = context.input;

        await next();
    };
}

/**
 * Create a metrics collection middleware
 * @param {Object} [options] - Metrics options
 * @returns {Object} Middleware and metrics accessor
 */
function createMetricsMiddleware(options = {}) {
    const metrics = {
        totalRequests: 0,
        totalErrors: 0,
        requestsByState: {},
        averageResponseTime: 0,
        _responseTimes: []
    };

    const middleware = async (context, next) => {
        const startTime = Date.now();
        metrics.totalRequests++;

        const state = context.currentState || 'unknown';
        metrics.requestsByState[state] = (metrics.requestsByState[state] || 0) + 1;

        try {
            await next();
        } catch (error) {
            metrics.totalErrors++;
            throw error;
        } finally {
            const duration = Date.now() - startTime;
            metrics._responseTimes.push(duration);

            // Keep only last 1000 response times
            if (metrics._responseTimes.length > 1000) {
                metrics._responseTimes.shift();
            }

            metrics.averageResponseTime =
                metrics._responseTimes.reduce((a, b) => a + b, 0) / metrics._responseTimes.length;
        }
    };

    const getMetrics = () => ({
        totalRequests: metrics.totalRequests,
        totalErrors: metrics.totalErrors,
        errorRate: metrics.totalRequests > 0
            ? (metrics.totalErrors / metrics.totalRequests * 100).toFixed(2) + '%'
            : '0%',
        requestsByState: { ...metrics.requestsByState },
        averageResponseTime: Math.round(metrics.averageResponseTime) + 'ms'
    });

    const resetMetrics = () => {
        metrics.totalRequests = 0;
        metrics.totalErrors = 0;
        metrics.requestsByState = {};
        metrics.averageResponseTime = 0;
        metrics._responseTimes = [];
    };

    return { middleware, getMetrics, resetMetrics };
}

module.exports = {
    MiddlewareManager,
    createLoggingMiddleware,
    createRateLimitMiddleware,
    createSessionTimeoutMiddleware,
    createAnalyticsMiddleware,
    createSanitizationMiddleware,
    createMetricsMiddleware
};
