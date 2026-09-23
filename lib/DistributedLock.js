/**
 * Distributed Lock Manager for USSD State Machine
 *
 * Implements distributed locking using Redis for multi-instance deployments.
 * Prevents race conditions when multiple application instances handle
 * concurrent requests for the same session.
 *
 * Based on the Redlock algorithm pattern for distributed mutual exclusion.
 */

const { StorageError } = require('./Errors');
const { AsyncLocalStorage } = require('async_hooks');

/**
 * Distributed lock using Redis
 */
class DistributedLock {
    /**
     * Create a new DistributedLock
     * @param {Object} options - Lock configuration
     * @param {Object} options.redisClient - Connected Redis client instance
     * @param {string} [options.keyPrefix='ussd:lock:'] - Redis key prefix for locks
     * @param {number} [options.lockTTL=5000] - Lock time-to-live in ms (auto-release safety net)
     * @param {number} [options.acquireTimeout=10000] - Max time to wait for lock acquisition in ms
     * @param {number} [options.retryInterval=100] - Time between retry attempts in ms
     * @param {number} [options.retryJitter=50] - Random jitter added to retry interval in ms
     * @param {Function} [options.onLockFailure] - Callback when lock acquisition fails
     *
     * @example
     * const redis = require('redis');
     * const client = redis.createClient();
     * await client.connect();
     *
     * const lock = new DistributedLock({
     *   redisClient: client,
     *   lockTTL: 5000,
     *   acquireTimeout: 10000
     * });
     *
     * const release = await lock.acquire('session-123');
     * try {
     *   // Critical section - process USSD request
     * } finally {
     *   await release();
     * }
     */
    constructor(options = {}) {
        if (!options.redisClient) {
            throw new Error('DistributedLock requires a redisClient option');
        }

        this.redisClient = options.redisClient;
        this.keyPrefix = options.keyPrefix || 'ussd:lock:';
        this.lockTTL = options.lockTTL || 5000;
        this.acquireTimeout = options.acquireTimeout || 10000;
        this.retryInterval = options.retryInterval || 100;
        this.retryJitter = options.retryJitter || 50;
        this.onLockFailure = options.onLockFailure || null;

        // Track active locks for cleanup
        this._activeLocks = new Map();
    }

    /**
     * Acquire a distributed lock for a session
     * @param {string} sessionId - Session identifier to lock
     * @returns {Promise<Function>} Release function - call to release the lock
     * @throws {StorageError} If lock cannot be acquired within timeout
     *
     * @example
     * const release = await lock.acquire('session-123');
     * try {
     *   await processRequest(sessionId);
     * } finally {
     *   await release();
     * }
     */
    async acquire(sessionId) {
        const lockKey = `${this.keyPrefix}${sessionId}`;
        const lockValue = `${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
        const startTime = Date.now();

        while (Date.now() - startTime < this.acquireTimeout) {
            // Try to acquire lock using SET NX (set if not exists) with TTL
            const acquired = await this.redisClient.set(lockKey, lockValue, {
                NX: true,
                PX: this.lockTTL
            });

            if (acquired) {
                // Lock acquired successfully
                this._activeLocks.set(sessionId, { key: lockKey, value: lockValue });

                // Return release function
                const release = async () => {
                    await this._release(lockKey, lockValue);
                    this._activeLocks.delete(sessionId);
                };

                return release;
            }

            // Lock not acquired, wait and retry with jitter
            const jitter = Math.floor(Math.random() * this.retryJitter);
            await new Promise(resolve => setTimeout(resolve, this.retryInterval + jitter));
        }

        // Timeout - could not acquire lock
        if (this.onLockFailure) {
            this.onLockFailure(sessionId, this.acquireTimeout);
        }

        throw new StorageError(
            `Could not acquire lock for session "${sessionId}" within ${this.acquireTimeout}ms`,
            'lock_acquire',
            null
        );
    }

    /**
     * Release a lock safely (only if we still own it)
     * Uses a Lua script for atomic check-and-delete
     * @private
     * @param {string} lockKey - Redis key
     * @param {string} lockValue - Expected lock value (ownership proof)
     */
    async _release(lockKey, lockValue) {
        // Atomic check-and-delete using Lua script
        // Only deletes if the lock value matches (prevents releasing someone else's lock)
        const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
        `;

        try {
            await this.redisClient.eval(script, {
                keys: [lockKey],
                arguments: [lockValue]
            });
        } catch (error) {
            // Best effort release - lock will auto-expire via TTL
        }
    }

    /**
     * Extend the TTL of an active lock
     * Useful for long-running operations that need more time
     * @param {string} sessionId - Session identifier
     * @param {number} [additionalMs] - Additional time in ms (defaults to lockTTL)
     * @returns {Promise<boolean>} Whether the extension was successful
     *
     * @example
     * const release = await lock.acquire('session-123');
     * // Operation taking longer than expected
     * const extended = await lock.extend('session-123', 5000);
     */
    async extend(sessionId, additionalMs) {
        const lockData = this._activeLocks.get(sessionId);
        if (!lockData) {
            return false;
        }

        const ttl = additionalMs || this.lockTTL;

        // Atomic check-and-extend using Lua script
        const script = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("pexpire", KEYS[1], ARGV[2])
            else
                return 0
            end
        `;

        try {
            const result = await this.redisClient.eval(script, {
                keys: [lockData.key],
                arguments: [lockData.value, ttl.toString()]
            });
            return result === 1;
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if a session is currently locked
     * @param {string} sessionId - Session identifier
     * @returns {Promise<boolean>} Whether the session is locked
     */
    async isLocked(sessionId) {
        const lockKey = `${this.keyPrefix}${sessionId}`;
        const exists = await this.redisClient.exists(lockKey);
        return exists === 1;
    }

    /**
     * Force release a lock (admin operation - use with caution)
     * @param {string} sessionId - Session identifier
     * @returns {Promise<boolean>} Whether a lock was released
     */
    async forceRelease(sessionId) {
        const lockKey = `${this.keyPrefix}${sessionId}`;
        const result = await this.redisClient.del(lockKey);
        this._activeLocks.delete(sessionId);
        return result === 1;
    }

    /**
     * Release all active locks held by this instance
     * Call during graceful shutdown
     * @returns {Promise<number>} Number of locks released
     */
    async releaseAll() {
        let released = 0;
        for (const [sessionId, lockData] of this._activeLocks) {
            try {
                await this._release(lockData.key, lockData.value);
                released++;
            } catch (error) {
                // Best effort
            }
        }
        this._activeLocks.clear();
        return released;
    }

    /**
     * Get statistics about active locks
     * @returns {Object} Lock statistics
     */
    getStats() {
        return {
            activeLocks: this._activeLocks.size,
            lockTTL: this.lockTTL,
            acquireTimeout: this.acquireTimeout
        };
    }
}

/**
 * Create a distributed lock manager wrapping a storage adapter
 * Automatically acquires/releases locks around storage operations
 * @param {Object} storage - Storage adapter to wrap
 * @param {Object} lockOptions - DistributedLock options
 * @returns {Object} Wrapped storage with distributed locking
 *
 * @example
 * const lockedStorage = createDistributedLockManager(redisStorage, {
 *   redisClient: client,
 *   lockTTL: 5000
 * });
 *
 * const machine = new USSDStateMachine({
 *   storage: lockedStorage,
 *   // ...
 * });
 */
function createDistributedLockManager(storage, lockOptions) {
    const lock = new DistributedLock(lockOptions);
    const lockContext = new AsyncLocalStorage();

    const handler = {
        get(target, prop) {
            if (prop === 'withSessionLock') {
                return async (sessionId, fn) => {
                    const release = await lock.acquire(sessionId);
                    const renewal = setInterval(() => {
                        lock.extend(sessionId).catch(() => {});
                    }, Math.max(1, Math.floor(lock.lockTTL / 2)));
                    renewal.unref?.();
                    try {
                        return await lockContext.run(sessionId, fn);
                    } finally {
                        clearInterval(renewal);
                        await release();
                    }
                };
            }
            const original = target[prop];

            if (typeof original !== 'function') {
                return original;
            }

            // Methods that need locking (write operations)
            const lockedMethods = [
                'setState', 'setData', 'setSession',
                'pushStateHistory', 'popStateHistory', 'deleteSession'
            ];

            if (!lockedMethods.includes(prop)) {
                return original.bind(target);
            }

            return async (...args) => {
                const sessionId = args[0]; // First arg is always sessionId
                if (lockContext.getStore() === sessionId) {
                    return original.apply(target, args);
                }
                const release = await lock.acquire(sessionId);
                try {
                    return await original.apply(target, args);
                } finally {
                    await release();
                }
            };
        }
    };

    const proxy = new Proxy(storage, handler);
    proxy._distributedLock = lock;
    return proxy;
}

module.exports = { DistributedLock, createDistributedLockManager };
