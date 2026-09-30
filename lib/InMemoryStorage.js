const StorageInterface = require('./StorageInterface');

/**
 * In-Memory Storage Adapter for USSD State Machine
 *
 * Simple in-memory storage for development and testing.
 * Supports state history for back navigation.
 *
 * Note: Data is lost when the process restarts.
 * Use RedisStorage for production deployments.
 *
 * @param {Object} [options] - Storage options
 * @param {number} [options.maxHistorySize=20] - Maximum number of states to keep in history.
 *   Prevents unbounded memory growth from repeated back/forward navigation.
 *   When exceeded, oldest states are removed (FIFO).
 */
class InMemoryStorage extends StorageInterface {
  constructor(options = {}) {
    super();
    if (options.now !== undefined && typeof options.now !== 'function') throw new TypeError('Storage clock must be a function');
    this.now = options.now || (() => Date.now());
    this.store = new Map();
    this.maxHistorySize = options.maxHistorySize ?? 20;
  }

  _getActiveSession(sessionId) {
    const session = this.store.get(sessionId);
    if (session && session.expiresAt != null && session.expiresAt <= this.now()) {
      this.store.delete(sessionId);
      return null;
    }
    return session || null;
  }

  /**
   * Get the current state for a session
   * @param {string} sessionId - Session identifier
   * @returns {Promise<string|null>} Current state or null
   */
  async getState(sessionId) {
    const session = this._getActiveSession(sessionId);
    return session ? (session.state ?? null) : null;
  }

  /**
   * Set the state for a session
   * @param {string} sessionId - Session identifier
   * @param {string} state - State to set
   * @param {number} timeout - Timeout in seconds
   */
  async setState(sessionId, state, timeout) {
    let session = this._getActiveSession(sessionId) || { stateHistory: [] };
    session.state = state;
    session.expiresAt = this.now() + timeout * 1000;
    this.store.set(sessionId, session);
  }

  /**
   * Get custom data for a session
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Object|null>} Session data or null
   */
  async getData(sessionId) {
    const session = this._getActiveSession(sessionId);
    return session ? session.data : null;
  }

  /**
   * Set custom data for a session
   * @param {string} sessionId - Session identifier
   * @param {Object} data - Data to store
   * @param {number} timeout - Timeout in seconds
   */
  async setData(sessionId, data, timeout) {
    let session = this._getActiveSession(sessionId) || { stateHistory: [] };
    session.data = { ...session.data, ...data };
    session.expiresAt = this.now() + timeout * 1000;
    this.store.set(sessionId, session);
  }

  async setDataIfStatus(sessionId, expectedStatus, data, timeout) {
    const session = this._getActiveSession(sessionId);
    if (!session || session.data?.status !== expectedStatus) return false;
    session.data = { ...data };
    session.expiresAt = this.now() + timeout * 1000;
    return true;
  }

  /**
   * Get the full session object
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Object|null>} Full session object or null
   */
  async getSession(sessionId) {
    return this._getActiveSession(sessionId);
  }

  /**
   * Set the full session object
   * @param {string} sessionId - Session identifier
   * @param {Object} session - Session object
   */
  async setSession(sessionId, session) {
    this.store.set(sessionId, session);
  }

  /**
   * Get state history for back navigation
   * @param {string} sessionId - Session identifier
   * @returns {Promise<string[]>} Array of previous states
   */
  async getStateHistory(sessionId) {
    const session = this._getActiveSession(sessionId);
    return session ? (session.stateHistory || []) : [];
  }

  /**
   * Push a state to history
   * @param {string} sessionId - Session identifier
   * @param {string} state - State to push
   */
  async pushStateHistory(sessionId, state) {
    let session = this._getActiveSession(sessionId) || { stateHistory: [] };
    if (!session.stateHistory) {
      session.stateHistory = [];
    }
    session.stateHistory.push(state);

    // Enforce maxHistorySize to prevent unbounded memory growth
    if (this.maxHistorySize > 0 && session.stateHistory.length > this.maxHistorySize) {
      session.stateHistory = session.stateHistory.slice(-this.maxHistorySize);
    }

    this.store.set(sessionId, session);
  }

  /**
   * Pop a state from history (for back navigation)
   * @param {string} sessionId - Session identifier
   * @returns {Promise<string|undefined>} Previous state or undefined
   */
  async popStateHistory(sessionId) {
    const session = this._getActiveSession(sessionId);
    if (session && session.stateHistory && session.stateHistory.length > 0) {
      return session.stateHistory.pop();
    }
    return undefined;
  }

  /**
   * Delete a session
   * @param {string} sessionId - Session identifier
   */
  async deleteSession(sessionId) {
    this.store.delete(sessionId);
  }

  /**
   * Clean up expired sessions
   */
  cleanup() {
    const now = this.now();
    for (let [sessionId, session] of this.store) {
      if (session.expiresAt <= now) {
        this.store.delete(sessionId);
      }
    }
  }

  /**
   * Get states for multiple sessions (optimized for in-memory)
   * @param {string[]} sessionIds - Array of session identifiers
   * @returns {Promise<Map<string, string|null>>} Map of sessionId to state
   */
  async getStateBatch(sessionIds) {
    const results = new Map();
    for (const id of sessionIds) {
      const session = this._getActiveSession(id);
      results.set(id, session ? session.state : null);
    }
    return results;
  }

  /**
   * Get data for multiple sessions (optimized for in-memory)
   * @param {string[]} sessionIds - Array of session identifiers
   * @returns {Promise<Map<string, Object|null>>} Map of sessionId to data
   */
  async getDataBatch(sessionIds) {
    const results = new Map();
    for (const id of sessionIds) {
      const session = this._getActiveSession(id);
      results.set(id, session ? session.data : null);
    }
    return results;
  }

  /**
   * Delete multiple sessions (optimized for in-memory)
   * @param {string[]} sessionIds - Array of session identifiers
   * @returns {Promise<number>} Number of sessions deleted
   */
  async deleteSessionBatch(sessionIds) {
    let count = 0;
    for (const id of sessionIds) {
      if (this.store.delete(id)) count++;
    }
    return count;
  }

  /**
   * Get the number of active sessions
   * @returns {number} Number of sessions
   */
  size() {
    this.cleanup();
    return this.store.size;
  }

  /**
   * Clear all sessions
   */
  clear() {
    this.store.clear();
  }
}

module.exports = InMemoryStorage;
