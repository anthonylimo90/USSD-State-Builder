/**
 * Health Check and Lifecycle Management for USSD State Machine
 * 
 * Provides health checks, graceful shutdown, and hot reloading support.
 */

/**
 * Health Check Manager
 * Monitors the health of USSD application components
 */
class HealthCheck {
    /**
     * Create a Health Check manager
     * @param {Object} options - Health check options
     * @param {Object} [options.stateMachine] - USSD State Machine instance
     * @param {Object} [options.storage] - Storage adapter
     * @param {Object} [options.checks] - Custom health checks
     */
    constructor(options = {}) {
        this.stateMachine = options.stateMachine;
        this.storage = options.storage;
        this.customChecks = options.checks || {};
        this.lastCheck = null;
        this.status = 'unknown';
    }

    /**
     * Add a custom health check
     * @param {string} name - Check name
     * @param {Function} checkFn - Async function returning { healthy: boolean, message: string }
     * @returns {HealthCheck} this for chaining
     */
    addCheck(name, checkFn) {
        this.customChecks[name] = checkFn;
        return this;
    }

    /**
     * Remove a health check
     * @param {string} name - Check name
     */
    removeCheck(name) {
        delete this.customChecks[name];
    }

    /**
     * Check storage health
     * @private
     */
    async _checkStorage() {
        if (!this.storage) {
            return { healthy: true, message: 'No storage configured' };
        }

        try {
            // Try to check connection status
            if (this.storage.isConnected) {
                const connected = this.storage.isConnected();
                return {
                    healthy: connected,
                    message: connected ? 'Storage connected' : 'Storage disconnected'
                };
            }

            // Try a simple operation
            const testKey = `_health_check_${Date.now()}`;
            await this.storage.setState(testKey, 'test', 1);
            const state = await this.storage.getState(testKey);

            if (this.storage.deleteSession) {
                await this.storage.deleteSession(testKey);
            }

            return {
                healthy: state === 'test',
                message: 'Storage operational'
            };
        } catch (error) {
            return {
                healthy: false,
                message: `Storage error: ${error.message}`
            };
        }
    }

    /**
     * Check state machine health
     * @private
     */
    async _checkStateMachine() {
        if (!this.stateMachine) {
            return { healthy: true, message: 'No state machine configured' };
        }

        try {
            const hasStates = Object.keys(this.stateMachine.states || {}).length > 0;
            const hasInitialState = !!this.stateMachine.initialState;

            return {
                healthy: hasStates && hasInitialState,
                message: hasStates && hasInitialState
                    ? `${Object.keys(this.stateMachine.states).length} states configured`
                    : 'State machine misconfigured'
            };
        } catch (error) {
            return {
                healthy: false,
                message: `State machine error: ${error.message}`
            };
        }
    }

    /**
     * Run all health checks
     * @returns {Promise<Object>} Health check result
     */
    async check() {
        const startTime = Date.now();
        const checks = {};
        let allHealthy = true;

        // Built-in checks
        checks.storage = await this._checkStorage();
        if (!checks.storage.healthy) allHealthy = false;

        checks.stateMachine = await this._checkStateMachine();
        if (!checks.stateMachine.healthy) allHealthy = false;

        // Custom checks
        for (const [name, checkFn] of Object.entries(this.customChecks)) {
            try {
                checks[name] = await checkFn();
                if (!checks[name].healthy) allHealthy = false;
            } catch (error) {
                checks[name] = { healthy: false, message: error.message };
                allHealthy = false;
            }
        }

        this.lastCheck = Date.now();
        this.status = allHealthy ? 'healthy' : 'unhealthy';

        return {
            status: this.status,
            timestamp: new Date().toISOString(),
            duration: Date.now() - startTime,
            checks
        };
    }

    /**
     * Get a simple health status (for load balancers)
     * @returns {Promise<Object>} Simple health status
     */
    async getStatus() {
        const result = await this.check();
        return {
            status: result.status,
            timestamp: result.timestamp
        };
    }

    /**
     * Create an Express/Koa compatible health check handler
     * @returns {Function} HTTP handler (req, res) => void
     */
    httpHandler() {
        return async (req, res) => {
            const result = await this.check();
            const statusCode = result.status === 'healthy' ? 200 : 503;

            res.status(statusCode).json(result);
        };
    }

    /**
     * Create a simple health endpoint handler
     * @returns {Function} Handler returning health JSON
     */
    handler() {
        return async () => {
            return await this.check();
        };
    }
}

/**
 * Graceful Shutdown Manager
 * Handles clean application shutdown
 */
class GracefulShutdown {
    /**
     * Create a Graceful Shutdown manager
     * @param {Object} options - Shutdown options
     * @param {number} [options.timeout=30000] - Shutdown timeout in ms
     * @param {Object} [options.storage] - Storage adapter to close
     * @param {Function} [options.onShutdown] - Callback before shutdown
     */
    constructor(options = {}) {
        this.timeout = options.timeout || 30000;
        this.storage = options.storage;
        this.onShutdown = options.onShutdown;
        this.isShuttingDown = false;
        this.pendingRequests = 0;
        this.shutdownHandlers = [];
        this.signals = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
    }

    /**
     * Register a shutdown handler
     * @param {Function} handler - Async shutdown handler
     * @returns {GracefulShutdown} this for chaining
     */
    addHandler(handler) {
        this.shutdownHandlers.push(handler);
        return this;
    }

    /**
     * Increment pending request count
     */
    requestStart() {
        this.pendingRequests++;
    }

    /**
     * Decrement pending request count
     */
    requestEnd() {
        this.pendingRequests = Math.max(0, this.pendingRequests - 1);
    }

    /**
     * Create middleware for tracking requests
     * @returns {Function} Middleware function
     */
    middleware() {
        return async (context, next) => {
            if (this.isShuttingDown) {
                context.response = 'END Service is shutting down. Please try again later.';
                context.blocked = true;
                return;
            }

            this.requestStart();
            try {
                await next();
            } finally {
                this.requestEnd();
            }
        };
    }

    /**
     * Wait for pending requests to complete
     * @private
     */
    async _waitForRequests() {
        const startTime = Date.now();

        while (this.pendingRequests > 0) {
            if (Date.now() - startTime > this.timeout) {
                console.warn(`Shutdown timeout: ${this.pendingRequests} requests still pending`);
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    /**
     * Perform graceful shutdown
     * @returns {Promise<void>}
     */
    async shutdown() {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;

        console.log('Initiating graceful shutdown...');

        // Call onShutdown callback
        if (this.onShutdown) {
            try {
                await this.onShutdown();
            } catch (error) {
                console.error('Error in onShutdown callback:', error);
            }
        }

        // Wait for pending requests
        await this._waitForRequests();

        // Run shutdown handlers
        for (const handler of this.shutdownHandlers) {
            try {
                await handler();
            } catch (error) {
                console.error('Error in shutdown handler:', error);
            }
        }

        // Close storage connection
        if (this.storage?.close) {
            try {
                await this.storage.close();
                console.log('Storage connection closed');
            } catch (error) {
                console.error('Error closing storage:', error);
            }
        }

        console.log('Graceful shutdown complete');
    }

    /**
     * Register signal handlers for graceful shutdown
     */
    registerSignalHandlers() {
        const shutdownHandler = async (signal) => {
            console.log(`Received ${signal}`);
            await this.shutdown();
            process.exit(0);
        };

        for (const signal of this.signals) {
            process.on(signal, () => shutdownHandler(signal));
        }

        // Handle uncaught exceptions
        process.on('uncaughtException', async (error) => {
            console.error('Uncaught exception:', error);
            await this.shutdown();
            process.exit(1);
        });

        // Handle unhandled rejections
        process.on('unhandledRejection', async (reason) => {
            console.error('Unhandled rejection:', reason);
            await this.shutdown();
            process.exit(1);
        });
    }

    /**
     * Check if shutdown is in progress
     * @returns {boolean} Whether shutdown is in progress
     */
    isShutdownInProgress() {
        return this.isShuttingDown;
    }
}

/**
 * Hot Reloader for State Machine
 * Allows updating states without restarting the application
 */
class HotReloader {
    /**
     * Create a Hot Reloader
     * @param {Object} stateMachine - USSD State Machine instance
     * @param {Object} [options] - Hot reload options
     * @param {Function} [options.onReload] - Callback after reload
     * @param {boolean} [options.preserveHistory=true] - Preserve state history
     */
    constructor(stateMachine, options = {}) {
        this.stateMachine = stateMachine;
        this.onReload = options.onReload;
        this.preserveHistory = options.preserveHistory !== false;
        this.reloadHistory = [];
    }

    /**
     * Update a single state
     * @param {string} stateName - State to update
     * @param {Object} stateConfig - New state configuration
     * @returns {Object} Updated state
     */
    updateState(stateName, stateConfig) {
        const previous = this.stateMachine.states[stateName];
        this.stateMachine.states[stateName] = stateConfig;

        this.reloadHistory.push({
            type: 'update',
            state: stateName,
            timestamp: new Date().toISOString(),
            hadPrevious: !!previous
        });

        if (this.onReload) {
            this.onReload('update', stateName, stateConfig);
        }

        return stateConfig;
    }

    /**
     * Add a new state
     * @param {string} stateName - State name
     * @param {Object} stateConfig - State configuration
     * @returns {Object} New state
     */
    addState(stateName, stateConfig) {
        if (this.stateMachine.states[stateName]) {
            throw new Error(`State "${stateName}" already exists. Use updateState instead.`);
        }

        this.stateMachine.states[stateName] = stateConfig;

        this.reloadHistory.push({
            type: 'add',
            state: stateName,
            timestamp: new Date().toISOString()
        });

        if (this.onReload) {
            this.onReload('add', stateName, stateConfig);
        }

        return stateConfig;
    }

    /**
     * Remove a state
     * @param {string} stateName - State to remove
     * @returns {boolean} Whether state was removed
     */
    removeState(stateName) {
        if (stateName === this.stateMachine.initialState) {
            throw new Error('Cannot remove initial state');
        }

        const existed = !!this.stateMachine.states[stateName];
        delete this.stateMachine.states[stateName];

        if (existed) {
            this.reloadHistory.push({
                type: 'remove',
                state: stateName,
                timestamp: new Date().toISOString()
            });

            if (this.onReload) {
                this.onReload('remove', stateName);
            }
        }

        return existed;
    }

    /**
     * Reload all states
     * @param {Object} newStates - New states configuration
     * @param {Object} [options] - Reload options
     * @param {boolean} [options.merge=false] - Merge with existing states
     */
    reloadAll(newStates, options = {}) {
        const merge = options.merge || false;

        if (merge) {
            this.stateMachine.states = {
                ...this.stateMachine.states,
                ...newStates
            };
        } else {
            this.stateMachine.states = newStates;
        }

        this.reloadHistory.push({
            type: 'reloadAll',
            timestamp: new Date().toISOString(),
            stateCount: Object.keys(newStates).length,
            merge
        });

        if (this.onReload) {
            this.onReload('reloadAll', null, newStates);
        }
    }

    /**
     * Update initial state
     * @param {string} stateName - New initial state
     */
    setInitialState(stateName) {
        if (!this.stateMachine.states[stateName]) {
            throw new Error(`State "${stateName}" does not exist`);
        }

        const previous = this.stateMachine.initialState;
        this.stateMachine.initialState = stateName;

        this.reloadHistory.push({
            type: 'setInitialState',
            from: previous,
            to: stateName,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Get reload history
     * @param {number} [limit=10] - Number of entries to return
     * @returns {Array} Reload history
     */
    getHistory(limit = 10) {
        return this.reloadHistory.slice(-limit);
    }

    /**
     * Clear reload history
     */
    clearHistory() {
        this.reloadHistory = [];
    }

    /**
     * Get current state count
     * @returns {number} Number of states
     */
    getStateCount() {
        return Object.keys(this.stateMachine.states).length;
    }

    /**
     * Get list of state names
     * @returns {string[]} State names
     */
    getStateNames() {
        return Object.keys(this.stateMachine.states);
    }

    /**
     * Validate states configuration
     * @param {Object} states - States to validate
     * @returns {Object} Validation result
     */
    validate(states) {
        const errors = [];
        const warnings = [];

        for (const [name, config] of Object.entries(states)) {
            if (!config.handler) {
                errors.push(`State "${name}" missing handler`);
            }
            if (typeof config.handler !== 'function') {
                errors.push(`State "${name}" handler is not a function`);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }
}

module.exports = {
    HealthCheck,
    GracefulShutdown,
    HotReloader
};
