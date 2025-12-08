/**
 * Session Manager for USSD State Machine
 * 
 * Provides enhanced session management with metadata tracking and analytics.
 */

class SessionManager {
    /**
     * Create a new Session Manager
     * @param {Object} storage - Storage adapter instance
     * @param {Object} [options] - Session manager options
     * @param {number} [options.timeout=300] - Default session timeout in seconds
     * @param {boolean} [options.trackMetadata=true] - Track session metadata
     * @param {boolean} [options.trackAnalytics=true] - Track analytics data
     */
    constructor(storage, options = {}) {
        this.storage = storage;
        this.timeout = options.timeout || 300;
        this.trackMetadata = options.trackMetadata !== false;
        this.trackAnalytics = options.trackAnalytics !== false;

        // Analytics aggregation
        this.analytics = {
            sessions: {
                total: 0,
                active: 0,
                completed: 0,
                abandoned: 0
            },
            states: {},
            interactions: [],
            completionRates: {},
            averageDuration: 0,
            _durations: []
        };
    }

    /**
     * Start a new session
     * @param {string} sessionId - Session identifier
     * @param {Object} [metadata] - Initial metadata
     * @returns {Promise<Object>} Session object
     */
    async startSession(sessionId, metadata = {}) {
        const now = Date.now();
        const session = {
            sessionId,
            state: null,
            data: {},
            stateHistory: [],
            metadata: this.trackMetadata ? {
                startedAt: new Date(now).toISOString(),
                lastActiveAt: new Date(now).toISOString(),
                interactionCount: 0,
                deviceInfo: metadata.deviceInfo || null,
                phoneNumber: metadata.phoneNumber || null,
                channel: metadata.channel || 'ussd',
                language: metadata.language || 'en',
                ...metadata
            } : {},
            analytics: this.trackAnalytics ? {
                stateVisits: {},
                stateTimings: {},
                inputHistory: [],
                errors: []
            } : {}
        };

        if (this.storage.setSession) {
            await this.storage.setSession(sessionId, session);
        }

        // Update global analytics
        this.analytics.sessions.total++;
        this.analytics.sessions.active++;

        return session;
    }

    /**
     * Get or create a session
     * @param {string} sessionId - Session identifier
     * @param {Object} [metadata] - Metadata for new session
     * @returns {Promise<Object>} Session object
     */
    async getOrCreateSession(sessionId, metadata = {}) {
        let session = null;

        if (this.storage.getSession) {
            session = await this.storage.getSession(sessionId);
        }

        if (!session) {
            session = await this.startSession(sessionId, metadata);
        }

        return session;
    }

    /**
     * Update session metadata
     * @param {string} sessionId - Session identifier
     * @param {Object} metadata - Metadata to update
     */
    async updateMetadata(sessionId, metadata) {
        if (!this.trackMetadata) return;

        const session = await this.storage.getSession?.(sessionId);
        if (session) {
            session.metadata = {
                ...session.metadata,
                ...metadata,
                lastActiveAt: new Date().toISOString()
            };
            await this.storage.setSession?.(sessionId, session);
        }
    }

    /**
     * Record an interaction
     * @param {string} sessionId - Session identifier
     * @param {string} input - User input
     * @param {string} state - Current state
     * @param {string} [response] - Response sent
     */
    async recordInteraction(sessionId, input, state, response = null) {
        if (!this.trackAnalytics) return;

        const session = await this.storage.getSession?.(sessionId);
        if (!session) return;

        const now = Date.now();

        // Update metadata
        if (session.metadata) {
            session.metadata.interactionCount = (session.metadata.interactionCount || 0) + 1;
            session.metadata.lastActiveAt = new Date(now).toISOString();
        }

        // Update analytics
        if (session.analytics) {
            // State visits
            session.analytics.stateVisits[state] = (session.analytics.stateVisits[state] || 0) + 1;

            // Input history (limit to last 50)
            session.analytics.inputHistory.push({
                input,
                state,
                timestamp: now
            });
            if (session.analytics.inputHistory.length > 50) {
                session.analytics.inputHistory.shift();
            }

            // State timings
            if (!session.analytics.stateTimings[state]) {
                session.analytics.stateTimings[state] = {
                    firstVisit: now,
                    lastVisit: now,
                    visits: 1
                };
            } else {
                session.analytics.stateTimings[state].lastVisit = now;
                session.analytics.stateTimings[state].visits++;
            }
        }

        await this.storage.setSession?.(sessionId, session);

        // Update global analytics
        this.analytics.states[state] = (this.analytics.states[state] || 0) + 1;
    }

    /**
     * Record an error
     * @param {string} sessionId - Session identifier
     * @param {Error} error - Error object
     * @param {string} state - State where error occurred
     */
    async recordError(sessionId, error, state) {
        if (!this.trackAnalytics) return;

        const session = await this.storage.getSession?.(sessionId);
        if (!session || !session.analytics) return;

        session.analytics.errors.push({
            message: error.message,
            state,
            timestamp: Date.now()
        });

        // Limit to last 10 errors
        if (session.analytics.errors.length > 10) {
            session.analytics.errors.shift();
        }

        await this.storage.setSession?.(sessionId, session);
    }

    /**
     * End a session
     * @param {string} sessionId - Session identifier
     * @param {boolean} [completed=true] - Whether session completed normally
     */
    async endSession(sessionId, completed = true) {
        const session = await this.storage.getSession?.(sessionId);

        if (session && session.metadata) {
            const startTime = new Date(session.metadata.startedAt).getTime();
            const duration = Date.now() - startTime;

            // Track duration
            this.analytics._durations.push(duration);
            if (this.analytics._durations.length > 1000) {
                this.analytics._durations.shift();
            }
            this.analytics.averageDuration =
                this.analytics._durations.reduce((a, b) => a + b, 0) / this.analytics._durations.length;

            // Update completion stats
            this.analytics.sessions.active = Math.max(0, this.analytics.sessions.active - 1);
            if (completed) {
                this.analytics.sessions.completed++;
            } else {
                this.analytics.sessions.abandoned++;
            }
        }

        // Delete session
        if (this.storage.deleteSession) {
            await this.storage.deleteSession(sessionId);
        }
    }

    /**
     * Get session analytics
     * @param {string} sessionId - Session identifier
     * @returns {Promise<Object|null>} Session analytics
     */
    async getSessionAnalytics(sessionId) {
        const session = await this.storage.getSession?.(sessionId);
        if (!session) return null;

        const startTime = session.metadata?.startedAt
            ? new Date(session.metadata.startedAt).getTime()
            : null;

        return {
            sessionId,
            metadata: session.metadata || {},
            duration: startTime ? Date.now() - startTime : null,
            interactionCount: session.metadata?.interactionCount || 0,
            stateVisits: session.analytics?.stateVisits || {},
            currentState: session.state,
            stateHistory: session.stateHistory || [],
            errors: session.analytics?.errors || []
        };
    }

    /**
     * Get global analytics
     * @returns {Object} Global analytics summary
     */
    getGlobalAnalytics() {
        const { sessions, states, averageDuration } = this.analytics;

        return {
            sessions: {
                total: sessions.total,
                active: sessions.active,
                completed: sessions.completed,
                abandoned: sessions.abandoned,
                completionRate: sessions.total > 0
                    ? ((sessions.completed / sessions.total) * 100).toFixed(2) + '%'
                    : '0%'
            },
            states: { ...states },
            averageSessionDuration: Math.round(averageDuration / 1000) + 's',
            topStates: Object.entries(states)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([state, count]) => ({ state, count }))
        };
    }

    /**
     * Reset global analytics
     */
    resetAnalytics() {
        this.analytics = {
            sessions: { total: 0, active: 0, completed: 0, abandoned: 0 },
            states: {},
            interactions: [],
            completionRates: {},
            averageDuration: 0,
            _durations: []
        };
    }

    /**
     * Get active session count
     * @returns {number} Active session count
     */
    getActiveSessionCount() {
        return this.analytics.sessions.active;
    }

    /**
     * Export analytics data
     * @returns {Object} Exportable analytics data
     */
    exportAnalytics() {
        return {
            exportedAt: new Date().toISOString(),
            ...this.getGlobalAnalytics()
        };
    }
}

module.exports = SessionManager;
