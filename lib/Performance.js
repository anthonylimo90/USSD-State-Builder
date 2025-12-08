/**
 * Performance Utilities for USSD State Machine
 * 
 * Provides caching, lazy loading, and performance optimization utilities.
 */

/**
 * Simple LRU Cache implementation
 * Least Recently Used cache with configurable size and TTL.
 */
class LRUCache {
    /**
     * Create a new LRU Cache
     * @param {Object} options - Cache options
     * @param {number} [options.maxSize=100] - Maximum number of items
     * @param {number} [options.ttl=0] - Time-to-live in milliseconds (0 = no expiry)
     */
    constructor(options = {}) {
        this.maxSize = options.maxSize || 100;
        this.ttl = options.ttl || 0;
        this.cache = new Map();
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0
        };
    }

    /**
     * Get a value from cache
     * @param {string} key - Cache key
     * @returns {any} Cached value or undefined
     */
    get(key) {
        const item = this.cache.get(key);

        if (!item) {
            this.stats.misses++;
            return undefined;
        }

        // Check if expired
        if (this.ttl > 0 && Date.now() > item.expires) {
            this.cache.delete(key);
            this.stats.misses++;
            return undefined;
        }

        // Move to end (most recently used)
        this.cache.delete(key);
        this.cache.set(key, item);
        this.stats.hits++;

        return item.value;
    }

    /**
     * Set a value in cache
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     * @param {number} [ttl] - Optional TTL override
     */
    set(key, value, ttl) {
        // Remove oldest if at capacity
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
            this.stats.evictions++;
        }

        const itemTtl = ttl || this.ttl;
        this.cache.set(key, {
            value,
            expires: itemTtl > 0 ? Date.now() + itemTtl : 0,
            createdAt: Date.now()
        });
    }

    /**
     * Check if key exists and is not expired
     * @param {string} key - Cache key
     * @returns {boolean} Whether key exists
     */
    has(key) {
        const item = this.cache.get(key);
        if (!item) return false;
        if (this.ttl > 0 && Date.now() > item.expires) {
            this.cache.delete(key);
            return false;
        }
        return true;
    }

    /**
     * Delete a key from cache
     * @param {string} key - Cache key
     * @returns {boolean} Whether key was deleted
     */
    delete(key) {
        return this.cache.delete(key);
    }

    /**
     * Clear all cache entries
     */
    clear() {
        this.cache.clear();
        this.stats = { hits: 0, misses: 0, evictions: 0 };
    }

    /**
     * Get cache size
     * @returns {number} Current cache size
     */
    get size() {
        return this.cache.size;
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache statistics
     */
    getStats() {
        const total = this.stats.hits + this.stats.misses;
        return {
            ...this.stats,
            size: this.cache.size,
            maxSize: this.maxSize,
            hitRate: total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) + '%' : '0%'
        };
    }

    /**
     * Remove expired entries
     * @returns {number} Number of entries removed
     */
    prune() {
        if (this.ttl === 0) return 0;

        let removed = 0;
        const now = Date.now();

        for (const [key, item] of this.cache) {
            if (now > item.expires) {
                this.cache.delete(key);
                removed++;
            }
        }

        return removed;
    }
}

/**
 * Memoization utility
 * Caches function results based on arguments.
 */
function memoize(fn, options = {}) {
    const cache = new LRUCache({
        maxSize: options.maxSize || 100,
        ttl: options.ttl || 0
    });

    const keyGenerator = options.keyGenerator || ((...args) => JSON.stringify(args));

    const memoized = async (...args) => {
        const key = keyGenerator(...args);

        if (cache.has(key)) {
            return cache.get(key);
        }

        const result = await fn(...args);
        cache.set(key, result);
        return result;
    };

    memoized.cache = cache;
    memoized.clear = () => cache.clear();

    return memoized;
}

/**
 * Lazy loader for state handlers
 * Loads handlers on-demand to reduce startup time.
 */
class LazyLoader {
    /**
     * Create a new Lazy Loader
     */
    constructor() {
        this.loaders = new Map();
        this.loaded = new Map();
    }

    /**
     * Register a lazy loader for a key
     * @param {string} key - Loader key
     * @param {Function} loader - Async loader function
     */
    register(key, loader) {
        this.loaders.set(key, loader);
    }

    /**
     * Get or load a value
     * @param {string} key - Loader key
     * @returns {Promise<any>} Loaded value
     */
    async get(key) {
        // Return cached if already loaded
        if (this.loaded.has(key)) {
            return this.loaded.get(key);
        }

        // Load if loader exists
        const loader = this.loaders.get(key);
        if (loader) {
            const value = await loader();
            this.loaded.set(key, value);
            return value;
        }

        return undefined;
    }

    /**
     * Check if value is loaded
     * @param {string} key - Loader key
     * @returns {boolean} Whether value is loaded
     */
    isLoaded(key) {
        return this.loaded.has(key);
    }

    /**
     * Preload specific keys
     * @param {string[]} keys - Keys to preload
     */
    async preload(keys) {
        await Promise.all(keys.map(key => this.get(key)));
    }

    /**
     * Clear loaded values
     * @param {string} [key] - Optional specific key to clear
     */
    clear(key) {
        if (key) {
            this.loaded.delete(key);
        } else {
            this.loaded.clear();
        }
    }
}

/**
 * Debounce utility
 * Delays execution until after wait period of inactivity.
 */
function debounce(fn, wait) {
    let timeout;

    return function debounced(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), wait);
    };
}

/**
 * Throttle utility
 * Limits execution to once per wait period.
 */
function throttle(fn, wait) {
    let lastCall = 0;
    let timeout;

    return function throttled(...args) {
        const now = Date.now();
        const remaining = wait - (now - lastCall);

        if (remaining <= 0) {
            lastCall = now;
            fn.apply(this, args);
        } else if (!timeout) {
            timeout = setTimeout(() => {
                lastCall = Date.now();
                timeout = null;
                fn.apply(this, args);
            }, remaining);
        }
    };
}

/**
 * Batch processor
 * Batches multiple calls into a single operation.
 */
class BatchProcessor {
    /**
     * Create a new Batch Processor
     * @param {Function} processor - Batch processing function (items) => results
     * @param {Object} [options] - Batch options
     * @param {number} [options.maxSize=10] - Maximum batch size
     * @param {number} [options.maxWait=50] - Maximum wait time in ms
     */
    constructor(processor, options = {}) {
        this.processor = processor;
        this.maxSize = options.maxSize || 10;
        this.maxWait = options.maxWait || 50;
        this.queue = [];
        this.timeout = null;
    }

    /**
     * Add item to batch
     * @param {any} item - Item to process
     * @returns {Promise<any>} Promise resolving to result
     */
    add(item) {
        return new Promise((resolve, reject) => {
            this.queue.push({ item, resolve, reject });

            if (this.queue.length >= this.maxSize) {
                this._flush();
            } else if (!this.timeout) {
                this.timeout = setTimeout(() => this._flush(), this.maxWait);
            }
        });
    }

    /**
     * Flush the batch
     * @private
     */
    async _flush() {
        clearTimeout(this.timeout);
        this.timeout = null;

        const batch = this.queue.splice(0, this.maxSize);
        if (batch.length === 0) return;

        try {
            const items = batch.map(b => b.item);
            const results = await this.processor(items);

            batch.forEach((b, i) => {
                b.resolve(results[i]);
            });
        } catch (error) {
            batch.forEach(b => b.reject(error));
        }
    }
}

/**
 * Performance monitor
 * Tracks and reports performance metrics.
 */
class PerformanceMonitor {
    constructor() {
        this.metrics = {};
        this.timers = new Map();
    }

    /**
     * Start a timer
     * @param {string} name - Timer name
     */
    startTimer(name) {
        this.timers.set(name, process.hrtime.bigint());
    }

    /**
     * End a timer and record the duration
     * @param {string} name - Timer name
     * @returns {number} Duration in milliseconds
     */
    endTimer(name) {
        const start = this.timers.get(name);
        if (!start) return 0;

        const end = process.hrtime.bigint();
        const duration = Number(end - start) / 1e6; // Convert to ms

        this.timers.delete(name);

        if (!this.metrics[name]) {
            this.metrics[name] = {
                count: 0,
                total: 0,
                min: Infinity,
                max: 0,
                avg: 0
            };
        }

        const m = this.metrics[name];
        m.count++;
        m.total += duration;
        m.min = Math.min(m.min, duration);
        m.max = Math.max(m.max, duration);
        m.avg = m.total / m.count;

        return duration;
    }

    /**
     * Time an async function
     * @param {string} name - Timer name
     * @param {Function} fn - Async function to time
     * @returns {Promise<any>} Function result
     */
    async time(name, fn) {
        this.startTimer(name);
        try {
            return await fn();
        } finally {
            this.endTimer(name);
        }
    }

    /**
     * Get metrics
     * @param {string} [name] - Optional specific metric name
     * @returns {Object} Metrics
     */
    getMetrics(name) {
        if (name) {
            return this.metrics[name] || null;
        }

        return Object.entries(this.metrics).reduce((acc, [key, m]) => {
            acc[key] = {
                count: m.count,
                avg: m.avg.toFixed(2) + 'ms',
                min: m.min.toFixed(2) + 'ms',
                max: m.max.toFixed(2) + 'ms',
                total: m.total.toFixed(2) + 'ms'
            };
            return acc;
        }, {});
    }

    /**
     * Reset metrics
     */
    reset() {
        this.metrics = {};
        this.timers.clear();
    }
}

/**
 * Create a caching wrapper for storage adapter
 * @param {Object} storage - Storage adapter
 * @param {Object} [options] - Cache options
 * @returns {Object} Cached storage adapter
 */
function createCachedStorage(storage, options = {}) {
    const cache = new LRUCache({
        maxSize: options.maxSize || 1000,
        ttl: options.ttl || 30000 // 30 seconds default
    });

    return {
        async getState(sessionId) {
            const key = `state:${sessionId}`;
            let state = cache.get(key);

            if (state === undefined) {
                state = await storage.getState(sessionId);
                if (state !== null) {
                    cache.set(key, state);
                }
            }

            return state;
        },

        async setState(sessionId, state, timeout) {
            const key = `state:${sessionId}`;
            await storage.setState(sessionId, state, timeout);
            cache.set(key, state);
        },

        async getData(sessionId) {
            const key = `data:${sessionId}`;
            let data = cache.get(key);

            if (data === undefined) {
                data = await storage.getData(sessionId);
                if (data !== null) {
                    cache.set(key, data);
                }
            }

            return data;
        },

        async setData(sessionId, data, timeout) {
            const key = `data:${sessionId}`;
            await storage.setData(sessionId, data, timeout);
            // Invalidate cache since data is merged
            cache.delete(key);
        },

        // Pass through other methods
        getSession: storage.getSession?.bind(storage),
        setSession: async (sessionId, session) => {
            await storage.setSession?.(sessionId, session);
            cache.delete(`state:${sessionId}`);
            cache.delete(`data:${sessionId}`);
        },
        getStateHistory: storage.getStateHistory?.bind(storage),
        pushStateHistory: storage.pushStateHistory?.bind(storage),
        popStateHistory: storage.popStateHistory?.bind(storage),
        deleteSession: async (sessionId) => {
            await storage.deleteSession?.(sessionId);
            cache.delete(`state:${sessionId}`);
            cache.delete(`data:${sessionId}`);
        },
        cleanup: storage.cleanup?.bind(storage),
        close: storage.close?.bind(storage),

        // Cache management
        cache,
        clearCache: () => cache.clear(),
        getCacheStats: () => cache.getStats()
    };
}

module.exports = {
    LRUCache,
    memoize,
    LazyLoader,
    debounce,
    throttle,
    BatchProcessor,
    PerformanceMonitor,
    createCachedStorage
};
