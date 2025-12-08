/**
 * In-Memory Storage Adapter for USSD State Machine
 * 
 * Simple in-memory storage for development and testing.
 * Supports state history for back navigation.
 * 
 * Note: Data is lost when the process restarts.
 * Use RedisStorage for production deployments.
 */
class InMemoryStorage {
  constructor() {
    this.store = new Map();
  }

  /**
   * Get the current state for a session
   * @param {string} sessionId - Session identifier
   * @returns {Promise<string|null>} Current state or null
   */
  async getState(sessionId) {
    const session = this.store.get(sessionId);
    return session ? session.state : null;
  }

  /**
   * Set the state for a session
   * @param {string} sessionId - Session identifier
   * @param {string} state - State to set
   * @param {number} timeout - Timeout in seconds
   */
  async setState(sessionId, state, timeout) {
    let session = this.store.get(sessionId) || { stateHistory: [] };
    session.state = state;
    session.expiresAt = Date.now() + timeout * 1000;
    this.store.set(sessionId, session);
  }

  /**
   * Get custom data for a session
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Object|null>} Session data or null
   */
  async getData(sessionId) {
    const session = this.store.get(sessionId);
    return session ? session.data : null;
  }

  /**
   * Set custom data for a session
   * @param {string} sessionId - Session identifier
   * @param {Object} data - Data to store
   * @param {number} timeout - Timeout in seconds
   */
  async setData(sessionId, data, timeout) {
    let session = this.store.get(sessionId) || { stateHistory: [] };
    session.data = { ...session.data, ...data };
    session.expiresAt = Date.now() + timeout * 1000;
    this.store.set(sessionId, session);
  }

  /**
   * Get the full session object
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Object|null>} Full session object or null
   */
  async getSession(sessionId) {
    return this.store.get(sessionId) || null;
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
    const session = this.store.get(sessionId);
    return session ? (session.stateHistory || []) : [];
  }

  /**
   * Push a state to history
   * @param {string} sessionId - Session identifier
   * @param {string} state - State to push
   */
  async pushStateHistory(sessionId, state) {
    let session = this.store.get(sessionId) || { stateHistory: [] };
    if (!session.stateHistory) {
      session.stateHistory = [];
    }
    session.stateHistory.push(state);
    this.store.set(sessionId, session);
  }

  /**
   * Pop a state from history (for back navigation)
   * @param {string} sessionId - Session identifier
   * @returns {Promise<string|undefined>} Previous state or undefined
   */
  async popStateHistory(sessionId) {
    const session = this.store.get(sessionId);
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
    const now = Date.now();
    for (let [sessionId, session] of this.store) {
      if (session.expiresAt <= now) {
        this.store.delete(sessionId);
      }
    }
  }

  /**
   * Get the number of active sessions
   * @returns {number} Number of sessions
   */
  size() {
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
