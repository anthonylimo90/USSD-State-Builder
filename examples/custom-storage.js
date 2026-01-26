/**
 * Custom Storage Adapter Example
 *
 * Shows how to create a custom storage adapter by extending StorageInterface.
 * This example implements a file-based storage using JSON files on disk,
 * suitable for low-traffic deployments or environments without Redis/DB.
 *
 * Run: node examples/custom-storage.js
 */

const fs = require('fs');
const path = require('path');
const {
    USSDStateMachine,
    ResponseBuilder,
    StorageInterface
} = require('../');

// --- Custom file-based storage adapter ---

class FileStorage extends StorageInterface {
    /**
     * @param {Object} options
     * @param {string} options.directory - Directory to store session files
     * @param {number} [options.maxHistorySize=20] - Max back-navigation history
     */
    constructor(options = {}) {
        super(); // Required: StorageInterface is abstract
        this.directory = options.directory || path.join(__dirname, '.sessions');
        this.maxHistorySize = options.maxHistorySize || 20;

        // Ensure the storage directory exists
        if (!fs.existsSync(this.directory)) {
            fs.mkdirSync(this.directory, { recursive: true });
        }
    }

    // Helper to build the file path for a session
    _filePath(sessionId) {
        // Sanitize sessionId to prevent directory traversal
        const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
        return path.join(this.directory, `${safe}.json`);
    }

    // Helper to read a session from disk
    _read(sessionId) {
        const filePath = this._filePath(sessionId);
        if (!fs.existsSync(filePath)) return null;
        const raw = fs.readFileSync(filePath, 'utf8');
        const session = JSON.parse(raw);
        // Check expiration
        if (session.expiresAt && Date.now() > session.expiresAt) {
            fs.unlinkSync(filePath);
            return null;
        }
        return session;
    }

    // Helper to write a session to disk
    _write(sessionId, session) {
        fs.writeFileSync(this._filePath(sessionId), JSON.stringify(session, null, 2));
    }

    // --- Required StorageInterface methods ---

    async getState(sessionId) {
        const session = this._read(sessionId);
        return session ? session.state : null;
    }

    async setState(sessionId, state, timeout) {
        const session = this._read(sessionId) || { data: {}, stateHistory: [] };
        session.state = state;
        session.expiresAt = Date.now() + timeout * 1000;
        this._write(sessionId, session);
    }

    async getData(sessionId) {
        const session = this._read(sessionId);
        return session ? session.data : null;
    }

    async setData(sessionId, data, timeout) {
        const session = this._read(sessionId) || { state: null, stateHistory: [] };
        session.data = { ...session.data, ...data };
        session.expiresAt = Date.now() + timeout * 1000;
        this._write(sessionId, session);
    }

    async getStateHistory(sessionId) {
        const session = this._read(sessionId);
        return session ? session.stateHistory || [] : [];
    }

    async pushStateHistory(sessionId, state) {
        const session = this._read(sessionId);
        if (!session) return;
        session.stateHistory = session.stateHistory || [];
        session.stateHistory.push(state);
        // Enforce maximum history size to prevent unbounded file growth
        if (session.stateHistory.length > this.maxHistorySize) {
            session.stateHistory = session.stateHistory.slice(-this.maxHistorySize);
        }
        this._write(sessionId, session);
    }

    async popStateHistory(sessionId) {
        const session = this._read(sessionId);
        if (!session || !session.stateHistory?.length) return undefined;
        const previous = session.stateHistory.pop();
        this._write(sessionId, session);
        return previous;
    }

    async deleteSession(sessionId) {
        const filePath = this._filePath(sessionId);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    // Optional: report connection readiness
    isConnected() {
        return fs.existsSync(this.directory);
    }

    async getStats() {
        const files = fs.readdirSync(this.directory).filter(f => f.endsWith('.json'));
        return { type: 'FileStorage', connected: true, activeSessions: files.length };
    }
}

// --- Use the custom storage in a state machine ---

const storage = new FileStorage({ directory: path.join(__dirname, '.demo-sessions') });

const ussd = new USSDStateMachine({
    initialState: 'WELCOME',
    storage,
    enableBackNavigation: true,
    states: {
        WELCOME: {
            handler: async () => ({
                response: ResponseBuilder.menu('File-backed USSD App', ['View Profile', 'Settings']),
                nextState: 'MENU'
            })
        },
        MENU: {
            handler: async (input, sessionId, ctx) => {
                if (input === '1') {
                    return {
                        response: ResponseBuilder.end('Name: Jane Doe\nPhone: +254700123456'),
                        data: { lastViewed: 'profile' }
                    };
                }
                return { response: ResponseBuilder.end('Settings page') };
            }
        }
    }
});

async function demo() {
    // Process a session -- data persists to disk between calls
    const res1 = await ussd.processInput('file-session-1', '');
    console.log('Step 1:', res1);

    const res2 = await ussd.processInput('file-session-1', '1');
    console.log('Step 2:', res2);

    // Inspect storage stats
    const stats = await storage.getStats();
    console.log('Storage stats:', stats);

    // Cleanup demo files
    await storage.deleteSession('file-session-1');
}

demo().catch(console.error);
