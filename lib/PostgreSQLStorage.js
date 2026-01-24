/**
 * PostgreSQL Storage Adapter for USSD State Machine
 * 
 * Provides production-ready session storage using PostgreSQL.
 * Supports automatic session cleanup, state history, and connection pooling.
 */

const StorageInterface = require('./StorageInterface');

class PostgreSQLStorage extends StorageInterface {
    /**
     * Create a new PostgreSQL storage adapter
     * @param {Object} config - PostgreSQL configuration
     * @param {string} [config.host='localhost'] - Database host
     * @param {number} [config.port=5432] - Database port
     * @param {string} [config.database='ussd'] - Database name
     * @param {string} [config.user='postgres'] - Database user
     * @param {string} [config.password] - Database password
     * @param {string} [config.connectionString] - Connection string (alternative to host/port)
     * @param {string} [config.table='ussd_sessions'] - Table name
     * @param {Object} [config.pool] - Existing pg Pool instance
     * @param {Object} [config.poolConfig] - Pool configuration options
     * @param {number} [config.maxHistorySize=20] - Maximum number of states to keep in history
     */
    constructor(config = {}) {
        super();
        this.config = config;
        this.table = config.table || 'ussd_sessions';
        this.pool = config.pool || null;
        this.ownPool = !config.pool;
        this._initialized = false;
        this.maxHistorySize = config.maxHistorySize ?? 20;
    }

    /**
     * Initialize PostgreSQL connection and ensure table exists
     * @private
     */
    async _ensureConnected() {
        if (this._initialized) return;

        if (!this.pool) {
            let pg;
            try {
                pg = require('pg');
            } catch (err) {
                throw new Error(
                    'PostgreSQL package not found. Please install it: npm install pg'
                );
            }

            const poolConfig = {
                ...this.config.poolConfig
            };

            if (this.config.connectionString) {
                poolConfig.connectionString = this.config.connectionString;
            } else {
                poolConfig.host = this.config.host || 'localhost';
                poolConfig.port = this.config.port || 5432;
                poolConfig.database = this.config.database || 'ussd';
                poolConfig.user = this.config.user || 'postgres';
                if (this.config.password) {
                    poolConfig.password = this.config.password;
                }
            }

            this.pool = new pg.Pool(poolConfig);
        }

        // Create table if it doesn't exist
        await this._createTable();
        this._initialized = true;
    }

    /**
     * Create the sessions table
     * @private
     */
    async _createTable() {
        const createTableQuery = `
      CREATE TABLE IF NOT EXISTS ${this.table} (
        session_id VARCHAR(255) PRIMARY KEY,
        state VARCHAR(255),
        data JSONB DEFAULT '{}',
        state_history TEXT[] DEFAULT ARRAY[]::TEXT[],
        expires_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_${this.table}_expires_at 
        ON ${this.table} (expires_at);
    `;

        await this.pool.query(createTableQuery);
    }

    /**
     * Get the current state for a session
     * @param {string} sessionId - Session identifier
     * @returns {Promise<string|null>} Current state or null
     */
    async getState(sessionId) {
        await this._ensureConnected();

        const result = await this.pool.query(
            `SELECT state FROM ${this.table} 
       WHERE session_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
            [sessionId]
        );

        return result.rows.length > 0 ? result.rows[0].state : null;
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

        await this.pool.query(
            `INSERT INTO ${this.table} (session_id, state, expires_at, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (session_id) 
       DO UPDATE SET state = $2, expires_at = $3, updated_at = NOW()`,
            [sessionId, state, expiresAt]
        );
    }

    /**
     * Get custom data for a session
     * @param {string} sessionId - Session identifier
     * @returns {Promise<Object|null>} Session data or null
     */
    async getData(sessionId) {
        await this._ensureConnected();

        const result = await this.pool.query(
            `SELECT data FROM ${this.table} 
       WHERE session_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
            [sessionId]
        );

        return result.rows.length > 0 ? result.rows[0].data : null;
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

        // Merge with existing data using JSONB concatenation
        await this.pool.query(
            `INSERT INTO ${this.table} (session_id, data, expires_at, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (session_id) 
       DO UPDATE SET data = ${this.table}.data || $2, expires_at = $3, updated_at = NOW()`,
            [sessionId, JSON.stringify(data), expiresAt]
        );
    }

    /**
     * Get the full session object
     * @param {string} sessionId - Session identifier
     * @returns {Promise<Object|null>} Full session object or null
     */
    async getSession(sessionId) {
        await this._ensureConnected();

        const result = await this.pool.query(
            `SELECT * FROM ${this.table} 
       WHERE session_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
            [sessionId]
        );

        if (result.rows.length === 0) return null;

        const row = result.rows[0];
        return {
            state: row.state,
            data: row.data || {},
            stateHistory: row.state_history || [],
            expiresAt: row.expires_at ? row.expires_at.getTime() : null,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    /**
     * Set the full session object
     * @param {string} sessionId - Session identifier
     * @param {Object} session - Session object
     */
    async setSession(sessionId, session) {
        await this._ensureConnected();

        const values = [sessionId];
        const sets = [];
        let paramIndex = 2;

        if (session.state !== undefined) {
            sets.push(`state = $${paramIndex}`);
            values.push(session.state);
            paramIndex++;
        }
        if (session.data !== undefined) {
            sets.push(`data = $${paramIndex}`);
            values.push(JSON.stringify(session.data));
            paramIndex++;
        }
        if (session.stateHistory !== undefined) {
            sets.push(`state_history = $${paramIndex}`);
            values.push(session.stateHistory);
            paramIndex++;
        }
        if (session.expiresAt !== undefined) {
            sets.push(`expires_at = $${paramIndex}`);
            values.push(new Date(session.expiresAt));
            paramIndex++;
        }

        sets.push('updated_at = NOW()');

        if (sets.length > 1) {
            await this.pool.query(
                `UPDATE ${this.table} SET ${sets.join(', ')} WHERE session_id = $1`,
                values
            );
        }
    }

    /**
     * Get state history for back navigation
     * @param {string} sessionId - Session identifier
     * @returns {Promise<string[]>} Array of previous states
     */
    async getStateHistory(sessionId) {
        await this._ensureConnected();

        const result = await this.pool.query(
            `SELECT state_history FROM ${this.table} WHERE session_id = $1`,
            [sessionId]
        );

        return result.rows.length > 0 ? (result.rows[0].state_history || []) : [];
    }

    /**
     * Push a state to history
     * @param {string} sessionId - Session identifier
     * @param {string} state - State to push
     */
    async pushStateHistory(sessionId, state) {
        await this._ensureConnected();

        // Append state and trim to maxHistorySize to prevent unbounded growth
        if (this.maxHistorySize > 0) {
            await this.pool.query(
                `UPDATE ${this.table}
           SET state_history = (
             SELECT array_agg(elem) FROM (
               SELECT unnest(array_append(COALESCE(state_history, ARRAY[]::text[]), $2)) as elem
               OFFSET GREATEST(0, array_length(COALESCE(state_history, ARRAY[]::text[]), 1) + 1 - $3)
             ) sub
           ), updated_at = NOW()
           WHERE session_id = $1`,
                [sessionId, state, this.maxHistorySize]
            );
        } else {
            await this.pool.query(
                `UPDATE ${this.table}
           SET state_history = array_append(COALESCE(state_history, ARRAY[]::text[]), $2), updated_at = NOW()
           WHERE session_id = $1`,
                [sessionId, state]
            );
        }
    }

    /**
     * Pop a state from history (for back navigation)
     * @param {string} sessionId - Session identifier
     * @returns {Promise<string|undefined>} Previous state or undefined
     */
    async popStateHistory(sessionId) {
        await this._ensureConnected();

        // Get the last state and remove it in one transaction
        // Use COALESCE to handle NULL state_history
        const result = await this.pool.query(
            `UPDATE ${this.table}
       SET state_history = COALESCE(state_history, ARRAY[]::text[])[1:GREATEST(0, array_length(COALESCE(state_history, ARRAY[]::text[]), 1)-1)],
           updated_at = NOW()
       WHERE session_id = $1 AND array_length(COALESCE(state_history, ARRAY[]::text[]), 1) > 0
       RETURNING (COALESCE(state_history, ARRAY[]::text[]))[array_length(COALESCE(state_history, ARRAY[]::text[]), 1)] as previous_state`,
            [sessionId]
        );

        if (result.rows.length > 0 && result.rows[0].previous_state) {
            return result.rows[0].previous_state;
        }

        return undefined;
    }

    /**
     * Delete a session
     * @param {string} sessionId - Session identifier
     */
    async deleteSession(sessionId) {
        await this._ensureConnected();
        await this.pool.query(
            `DELETE FROM ${this.table} WHERE session_id = $1`,
            [sessionId]
        );
    }

    /**
     * Clean up expired sessions
     */
    async cleanup() {
        await this._ensureConnected();

        const result = await this.pool.query(
            `DELETE FROM ${this.table} WHERE expires_at < NOW()`
        );

        return result.rowCount;
    }

    /**
     * Close the PostgreSQL connection pool
     */
    async close() {
        if (this.pool && this.ownPool) {
            await this.pool.end();
            this._initialized = false;
        }
    }

    /**
     * Check if connected to PostgreSQL
     * @returns {boolean} Connection status
     */
    isConnected() {
        return this._initialized && this.pool !== null;
    }

    /**
     * Get storage statistics
     * @returns {Promise<Object>} Statistics object
     */
    async getStats() {
        await this._ensureConnected();

        const countResult = await this.pool.query(
            `SELECT COUNT(*) as total,
              COUNT(*) FILTER (WHERE expires_at > NOW()) as active
       FROM ${this.table}`
        );

        const sizeResult = await this.pool.query(
            `SELECT pg_total_relation_size($1) as size`,
            [this.table]
        );

        return {
            type: 'PostgreSQLStorage',
            connected: this.isConnected(),
            table: this.table,
            totalSessions: parseInt(countResult.rows[0].total),
            activeSessions: parseInt(countResult.rows[0].active),
            tableSize: parseInt(sizeResult.rows[0].size)
        };
    }

    /**
     * Execute raw query
     * @param {string} query - SQL query
     * @param {Array} [params] - Query parameters
     * @returns {Promise<Object>} Query result
     */
    async query(query, params = []) {
        await this._ensureConnected();
        return this.pool.query(query, params);
    }
}

module.exports = PostgreSQLStorage;
