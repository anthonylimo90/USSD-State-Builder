/**
 * Redis Storage Adapter for USSD State Machine
 *
 * Provides production-ready session storage using Redis.
 * Supports automatic expiration, state history, and connection management.
 */

const StorageInterface = require('./StorageInterface');

class RedisStorage extends StorageInterface {
    /**
     * Create a new Redis storage adapter
     * @param {Object} config - Redis configuration
     * @param {string} [config.host='localhost'] - Redis host
     * @param {number} [config.port=6379] - Redis port
     * @param {string} [config.password] - Redis password
     * @param {number} [config.db=0] - Redis database number
     * @param {string} [config.keyPrefix='ussd:'] - Key prefix for session data
     * @param {Object} [config.client] - Existing Redis client instance
     * @param {string} [config.url] - Redis URL (alternative to host/port)
     */
    /**
     * @param {number} [config.maxHistorySize=20] - Maximum number of states to keep in history.
     *   Prevents unbounded memory growth. When exceeded, oldest states are removed.
     */
    constructor(config = {}) {
        super();
        this.keyPrefix = config.keyPrefix || 'ussd:';
        this.client = config.client || null;
        this.ownClient = !config.client;
        this.config = config;
        this._initialized = false;
        this.maxHistorySize = config.maxHistorySize ?? 20;
    }

    /**
     * Initialize Redis connection
     * @private
     */
    async _ensureConnected() {
        if (this._initialized) return;

        if (!this.client) {
            // Dynamically import redis to make it an optional dependency
            let redis;
            try {
                redis = require('redis');
            } catch (err) {
                throw new Error(
                    'Redis package not found. Please install it: npm install redis'
                );
            }

            const clientOptions = {};

            if (this.config.url) {
                clientOptions.url = this.config.url;
            } else {
                clientOptions.socket = {
                    host: this.config.host || 'localhost',
                    port: this.config.port || 6379
                };
            }

            if (this.config.password) {
                clientOptions.password = this.config.password;
            }

            if (this.config.db !== undefined) {
                clientOptions.database = this.config.db;
            }

            this.client = redis.createClient(clientOptions);

            this.client.on('error', (err) => {
                console.error('Redis Client Error:', err);
            });

            await this.client.connect();
        }

        this._initialized = true;
    }

    /**
     * Get the Redis key for a session
     * @private
     */
    _getKey(sessionId) {
        return `${this.keyPrefix}${sessionId}`;
    }

    /**
     * Get the current state for a session
     * @param {string} sessionId - Session identifier
     * @returns {Promise<string|null>} Current state or null
     */
    async getState(sessionId) {
        await this._ensureConnected();
        const data = await this.client.hGet(this._getKey(sessionId), 'state');
        return data || null;
    }

    /**
     * Set the state for a session
     * @param {string} sessionId - Session identifier
     * @param {string} state - State to set
     * @param {number} timeout - Timeout in seconds
     */
    async setState(sessionId, state, timeout) {
        await this._ensureConnected();
        const key = this._getKey(sessionId);

        await this.client.hSet(key, 'state', state);
        await this.client.expire(key, timeout);
    }

    /**
     * Get custom data for a session
     * @param {string} sessionId - Session identifier
     * @returns {Promise<Object|null>} Session data or null
     */
    async getData(sessionId) {
        await this._ensureConnected();
        const data = await this.client.hGet(this._getKey(sessionId), 'data');
        return data ? JSON.parse(data) : null;
    }

    /**
     * Set custom data for a session
     * @param {string} sessionId - Session identifier
     * @param {Object} data - Data to store
     * @param {number} timeout - Timeout in seconds
     */
    async setData(sessionId, data, timeout) {
        await this._ensureConnected();
        const key = this._getKey(sessionId);

        // Merge with existing data
        const existingData = await this.getData(sessionId);
        const mergedData = { ...existingData, ...data };

        await this.client.hSet(key, 'data', JSON.stringify(mergedData));
        await this.client.expire(key, timeout);
    }

    /**
     * Get the full session object
     * @param {string} sessionId - Session identifier
     * @returns {Promise<Object|null>} Full session object or null
     */
    async getSession(sessionId) {
        await this._ensureConnected();
        const key = this._getKey(sessionId);
        const session = await this.client.hGetAll(key);

        if (!session || Object.keys(session).length === 0) {
            return null;
        }

        return {
            state: session.state || null,
            data: session.data ? JSON.parse(session.data) : null,
            stateHistory: session.stateHistory ? JSON.parse(session.stateHistory) : [],
            expiresAt: session.expiresAt ? parseInt(session.expiresAt, 10) : null
        };
    }

    /**
     * Set the full session object
     * @param {string} sessionId - Session identifier
     * @param {Object} session - Session object
     */
    async setSession(sessionId, session) {
        await this._ensureConnected();
        const key = this._getKey(sessionId);

        const fields = {};
        if (session.state) fields.state = session.state;
        if (session.data) fields.data = JSON.stringify(session.data);
        if (session.stateHistory) fields.stateHistory = JSON.stringify(session.stateHistory);
        if (session.expiresAt) fields.expiresAt = session.expiresAt.toString();

        if (Object.keys(fields).length > 0) {
            await this.client.hSet(key, fields);
        }
    }

    /**
     * Get state history for back navigation
     * @param {string} sessionId - Session identifier
     * @returns {Promise<string[]>} Array of previous states
     */
    async getStateHistory(sessionId) {
        await this._ensureConnected();
        const history = await this.client.hGet(this._getKey(sessionId), 'stateHistory');
        return history ? JSON.parse(history) : [];
    }

    /**
     * Push a state to history
     * @param {string} sessionId - Session identifier
     * @param {string} state - State to push
     */
    async pushStateHistory(sessionId, state) {
        await this._ensureConnected();
        const history = await this.getStateHistory(sessionId);
        history.push(state);

        // Enforce maxHistorySize to prevent unbounded memory growth
        if (this.maxHistorySize > 0 && history.length > this.maxHistorySize) {
            history.splice(0, history.length - this.maxHistorySize);
        }

        await this.client.hSet(this._getKey(sessionId), 'stateHistory', JSON.stringify(history));
    }

    /**
     * Pop a state from history (for back navigation)
     * @param {string} sessionId - Session identifier
     * @returns {Promise<string|undefined>} Previous state or undefined
     */
    async popStateHistory(sessionId) {
        await this._ensureConnected();
        const history = await this.getStateHistory(sessionId);
        const previousState = history.pop();
        await this.client.hSet(this._getKey(sessionId), 'stateHistory', JSON.stringify(history));
        return previousState;
    }

    /**
     * Delete a session
     * @param {string} sessionId - Session identifier
     */
    async deleteSession(sessionId) {
        await this._ensureConnected();
        await this.client.del(this._getKey(sessionId));
    }

    /**
     * Cleanup is handled automatically by Redis TTL
     * This method is provided for interface compatibility
     */
    async cleanup() {
        // Redis handles expiration automatically via TTL
        // This method exists for interface compatibility with InMemoryStorage
    }

    /**
     * Close the Redis connection
     */
    async close() {
        if (this.client && this.ownClient) {
            await this.client.quit();
            this._initialized = false;
        }
    }

    /**
     * Check if connected to Redis
     * @returns {boolean} Connection status
     */
    isConnected() {
        return this._initialized && this.client && this.client.isReady;
    }
}

module.exports = RedisStorage;
