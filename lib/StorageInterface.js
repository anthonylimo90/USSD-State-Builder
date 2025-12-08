/**
 * Storage Interface for USSD State Machine
 * 
 * Abstract base class that defines the contract for all storage adapters.
 * Extend this class to create custom storage implementations.
 * 
 * @abstract
 */
class StorageInterface {
    constructor() {
        if (this.constructor === StorageInterface) {
            throw new Error('StorageInterface is abstract and cannot be instantiated directly');
        }
    }

    /**
     * Get the current state for a session
     * @param {string} sessionId - Session identifier
     * @returns {Promise<string|null>} Current state or null if not found
     * @abstract
     */
    async getState(sessionId) {
        throw new Error('Method getState() must be implemented');
    }

    /**
     * Set the state for a session
     * @param {string} sessionId - Session identifier
     * @param {string} state - State to set
     * @param {number} timeout - Timeout in seconds
     * @returns {Promise<void>}
     * @abstract
     */
    async setState(sessionId, state, timeout) {
        throw new Error('Method setState() must be implemented');
    }

    /**
     * Get custom data for a session
     * @param {string} sessionId - Session identifier
     * @returns {Promise<Object|null>} Session data or null if not found
     * @abstract
     */
    async getData(sessionId) {
        throw new Error('Method getData() must be implemented');
    }

    /**
     * Set custom data for a session
     * @param {string} sessionId - Session identifier
     * @param {Object} data - Data to store (merged with existing data)
     * @param {number} timeout - Timeout in seconds
     * @returns {Promise<void>}
     * @abstract
     */
    async setData(sessionId, data, timeout) {
        throw new Error('Method setData() must be implemented');
    }

    /**
     * Get the full session object
     * @param {string} sessionId - Session identifier
     * @returns {Promise<Object|null>} Full session object or null
     */
    async getSession(sessionId) {
        // Default implementation using getState and getData
        const state = await this.getState(sessionId);
        if (!state) return null;

        const data = await this.getData(sessionId);
        const stateHistory = await this.getStateHistory(sessionId);

        return {
            state,
            data,
            stateHistory
        };
    }

    /**
     * Set the full session object
     * @param {string} sessionId - Session identifier
     * @param {Object} session - Session object
     * @param {number} [timeout=300] - Timeout in seconds
     * @returns {Promise<void>}
     */
    async setSession(sessionId, session, timeout = 300) {
        if (session.state) {
            await this.setState(sessionId, session.state, timeout);
        }
        if (session.data) {
            await this.setData(sessionId, session.data, timeout);
        }
    }

    /**
     * Get state history for back navigation
     * @param {string} sessionId - Session identifier
     * @returns {Promise<string[]>} Array of previous states
     */
    async getStateHistory(sessionId) {
        return [];
    }

    /**
     * Push a state to history
     * @param {string} sessionId - Session identifier
     * @param {string} state - State to push
     * @returns {Promise<void>}
     */
    async pushStateHistory(sessionId, state) {
        // Override in implementations that support back navigation
    }

    /**
     * Pop a state from history (for back navigation)
     * @param {string} sessionId - Session identifier
     * @returns {Promise<string|undefined>} Previous state or undefined
     */
    async popStateHistory(sessionId) {
        return undefined;
    }

    /**
     * Delete a session
     * @param {string} sessionId - Session identifier
     * @returns {Promise<void>}
     */
    async deleteSession(sessionId) {
        // Override in implementations
    }

    /**
     * Clean up expired sessions
     * @returns {Promise<void>}
     */
    async cleanup() {
        // Override in implementations that need manual cleanup
    }

    /**
     * Close storage connection
     * @returns {Promise<void>}
     */
    async close() {
        // Override in implementations with connections
    }

    /**
     * Check if storage is connected/ready
     * @returns {boolean}
     */
    isConnected() {
        return true;
    }

    /**
     * Get storage statistics
     * @returns {Promise<Object>} Statistics object
     */
    async getStats() {
        return {
            type: this.constructor.name,
            connected: this.isConnected()
        };
    }
}

module.exports = StorageInterface;
