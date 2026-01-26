/**
 * MongoDB Storage Adapter for USSD State Machine
 * 
 * Provides production-ready session storage using MongoDB.
 * Supports automatic TTL expiration, state history, and connection management.
 */

const StorageInterface = require('./StorageInterface');

class MongoDBStorage extends StorageInterface {
    /**
     * Create a new MongoDB storage adapter
     * @param {Object} config - MongoDB configuration
     * @param {string} [config.uri='mongodb://localhost:27017'] - MongoDB connection URI
     * @param {string} [config.database='ussd'] - Database name
     * @param {string} [config.collection='sessions'] - Collection name
     * @param {Object} [config.client] - Existing MongoDB client instance
     * @param {Object} [config.options] - MongoDB connection options
     * @param {number} [config.options.maxPoolSize=10] - Maximum connection pool size
     * @param {number} [config.options.minPoolSize=0] - Minimum connection pool size
     * @param {number} [config.options.connectTimeoutMS=30000] - Connection timeout in ms
     * @param {number} [config.options.socketTimeoutMS=0] - Socket timeout in ms
     * @param {number} [config.maxHistorySize=20] - Maximum number of states to keep in history
     */
    constructor(config = {}) {
        super();
        this.uri = config.uri || 'mongodb://localhost:27017';
        this.database = config.database || 'ussd';
        this.collectionName = config.collection || 'sessions';
        this.client = config.client || null;
        this.ownClient = !config.client;
        this.options = config.options || {};
        this._db = null;
        this._collection = null;
        this._initialized = false;
        this.maxHistorySize = config.maxHistorySize ?? 20;
    }

    /**
     * Initialize MongoDB connection
     * @private
     */
    async _ensureConnected() {
        if (this._initialized) return;

        if (!this.client) {
            let MongoClient;
            try {
                const mongodb = require('mongodb');
                MongoClient = mongodb.MongoClient;
            } catch (err) {
                throw new Error(
                    'MongoDB package not found. Please install it: npm install mongodb'
                );
            }

            this.client = new MongoClient(this.uri, {
                ...this.options
            });

            await this.client.connect();
        }

        this._db = this.client.db(this.database);
        this._collection = this._db.collection(this.collectionName);

        // Create TTL index for automatic expiration
        await this._collection.createIndex(
            { expiresAt: 1 },
            { expireAfterSeconds: 0 }
        );

        // Create index on sessionId for faster lookups
        await this._collection.createIndex(
            { sessionId: 1 },
            { unique: true }
        );

        this._initialized = true;
    }

    /**
     * Get the current state for a session
     * @param {string} sessionId - Session identifier
     * @returns {Promise<string|null>} Current state or null
     */
    async getState(sessionId) {
        await this._ensureConnected();
        const doc = await this._collection.findOne({ sessionId });
        return doc ? doc.state : null;
    }

    /**
     * Set the state for a session
     * @param {string} sessionId - Session identifier
     * @param {string} state - State to set
     * @param {number} timeout - Timeout in seconds
     */
    async setState(sessionId, state, timeout) {
        await this._ensureConnected();
        const expiresAt = new Date(Date.now() + timeout * 1000);

        await this._collection.updateOne(
            { sessionId },
            {
                $set: { state, expiresAt, updatedAt: new Date() },
                $setOnInsert: {
                    sessionId,
                    createdAt: new Date(),
                    data: {},
                    stateHistory: []
                }
            },
            { upsert: true }
        );
    }

    /**
     * Get custom data for a session
     * @param {string} sessionId - Session identifier
     * @returns {Promise<Object|null>} Session data or null
     */
    async getData(sessionId) {
        await this._ensureConnected();
        const doc = await this._collection.findOne({ sessionId });
        return doc ? doc.data : null;
    }

    /**
     * Set custom data for a session
     * @param {string} sessionId - Session identifier
     * @param {Object} data - Data to store
     * @param {number} timeout - Timeout in seconds
     */
    async setData(sessionId, data, timeout) {
        await this._ensureConnected();
        const expiresAt = new Date(Date.now() + timeout * 1000);

        // Merge with existing data
        const existing = await this.getData(sessionId);
        const mergedData = { ...existing, ...data };

        await this._collection.updateOne(
            { sessionId },
            {
                $set: { data: mergedData, expiresAt, updatedAt: new Date() },
                $setOnInsert: {
                    sessionId,
                    createdAt: new Date(),
                    state: null,
                    stateHistory: []
                }
            },
            { upsert: true }
        );
    }

    /**
     * Get the full session object
     * @param {string} sessionId - Session identifier
     * @returns {Promise<Object|null>} Full session object or null
     */
    async getSession(sessionId) {
        await this._ensureConnected();
        const doc = await this._collection.findOne({ sessionId });

        if (!doc) return null;

        return {
            state: doc.state,
            data: doc.data || {},
            stateHistory: doc.stateHistory || [],
            expiresAt: doc.expiresAt ? doc.expiresAt.getTime() : null,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt
        };
    }

    /**
     * Set the full session object
     * @param {string} sessionId - Session identifier
     * @param {Object} session - Session object
     */
    async setSession(sessionId, session) {
        await this._ensureConnected();

        const update = {
            updatedAt: new Date()
        };

        if (session.state !== undefined) update.state = session.state;
        if (session.data !== undefined) update.data = session.data;
        if (session.stateHistory !== undefined) update.stateHistory = session.stateHistory;
        if (session.expiresAt !== undefined) {
            update.expiresAt = new Date(session.expiresAt);
        }

        await this._collection.updateOne(
            { sessionId },
            {
                $set: update,
                $setOnInsert: { sessionId, createdAt: new Date() }
            },
            { upsert: true }
        );
    }

    /**
     * Get state history for back navigation
     * @param {string} sessionId - Session identifier
     * @returns {Promise<string[]>} Array of previous states
     */
    async getStateHistory(sessionId) {
        await this._ensureConnected();
        const doc = await this._collection.findOne({ sessionId });
        return doc ? (doc.stateHistory || []) : [];
    }

    /**
     * Push a state to history
     * @param {string} sessionId - Session identifier
     * @param {string} state - State to push
     */
    async pushStateHistory(sessionId, state) {
        await this._ensureConnected();

        // Use $slice to limit history size and prevent unbounded growth
        const pushOp = this.maxHistorySize > 0
            ? { stateHistory: { $each: [state], $slice: -this.maxHistorySize } }
            : { stateHistory: state };

        await this._collection.updateOne(
            { sessionId },
            {
                $push: pushOp,
                $set: { updatedAt: new Date() }
            }
        );
    }

    /**
     * Pop a state from history (for back navigation)
     * @param {string} sessionId - Session identifier
     * @returns {Promise<string|undefined>} Previous state or undefined
     */
    async popStateHistory(sessionId) {
        await this._ensureConnected();

        const doc = await this._collection.findOne({ sessionId });
        if (!doc || !doc.stateHistory || doc.stateHistory.length === 0) {
            return undefined;
        }

        const previousState = doc.stateHistory[doc.stateHistory.length - 1];

        await this._collection.updateOne(
            { sessionId },
            {
                $pop: { stateHistory: 1 },
                $set: { updatedAt: new Date() }
            }
        );

        return previousState;
    }

    /**
     * Delete a session
     * @param {string} sessionId - Session identifier
     */
    async deleteSession(sessionId) {
        await this._ensureConnected();
        await this._collection.deleteOne({ sessionId });
    }

    /**
     * Cleanup is handled automatically by MongoDB TTL index
     */
    async cleanup() {
        // MongoDB handles expiration automatically via TTL index
    }

    /**
     * Execute operations atomically using MongoDB transactions
     * Requires a MongoDB replica set.
     * @param {Function} fn - Async function receiving this storage instance
     * @returns {Promise<any>} Result of the function
     */
    async withTransaction(fn) {
        await this._ensureConnected();
        const session = this.client.startSession();
        try {
            let result;
            await session.withTransaction(async () => {
                result = await fn(this);
            });
            return result;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Close the MongoDB connection
     */
    async close() {
        if (this.client && this.ownClient) {
            await this.client.close();
            this._initialized = false;
            this._db = null;
            this._collection = null;
        }
    }

    /**
     * Check if connected to MongoDB
     * @returns {boolean} Connection status
     */
    isConnected() {
        return this._initialized && this.client !== null;
    }

    /**
     * Get storage statistics
     * @returns {Promise<Object>} Statistics object
     */
    async getStats() {
        await this._ensureConnected();

        const count = await this._collection.countDocuments();
        const stats = await this._collection.stats();

        return {
            type: 'MongoDBStorage',
            connected: this.isConnected(),
            database: this.database,
            collection: this.collectionName,
            sessionCount: count,
            storageSize: stats.storageSize,
            avgObjectSize: stats.avgObjSize
        };
    }

    /**
     * Find sessions by criteria
     * @param {Object} query - MongoDB query
     * @param {Object} [options] - Query options
     * @returns {Promise<Array>} Array of sessions
     */
    async findSessions(query, options = {}) {
        await this._ensureConnected();
        return this._collection.find(query, options).toArray();
    }

    /**
     * Count sessions matching criteria
     * @param {Object} query - MongoDB query
     * @returns {Promise<number>} Count of matching sessions
     */
    async countSessions(query = {}) {
        await this._ensureConnected();
        return this._collection.countDocuments(query);
    }
}

module.exports = MongoDBStorage;
