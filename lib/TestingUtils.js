/**
 * USSD Testing Utilities
 * 
 * Provides convenient helpers for testing USSD flows.
 */

/**
 * USSD Flow Tester
 * 
 * A fluent API for testing USSD state machine flows.
 * 
 * @example
 * const tester = new USSDTester(ussdStateMachine);
 * await tester
 *   .start()
 *   .expectResponse(/Welcome/)
 *   .input('1')
 *   .expectState('MENU')
 *   .input('2')
 *   .expectEnd();
 */
class USSDTester {
    /**
     * Create a new USSD Tester
     * @param {Object} stateMachine - USSDStateMachine instance
     * @param {Object} [options] - Tester options
     * @param {string} [options.sessionId] - Session ID to use (default: auto-generated)
     * @param {boolean} [options.verbose=false] - Log interactions to console
     */
    constructor(stateMachine, options = {}) {
        this.stateMachine = stateMachine;
        this.sessionId = options.sessionId || `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.verbose = options.verbose || false;
        this.lastResponse = null;
        this.lastInput = null;
        this.history = [];
        this.assertions = [];
        this._pendingPromise = Promise.resolve();
    }

    /**
     * Log a message if verbose mode is enabled
     * @private
     */
    _log(message) {
        if (this.verbose) {
            console.log(`[USSDTester] ${message}`);
        }
    }

    /**
     * Queue an action to be executed
     * @private
     */
    _queue(action) {
        this._pendingPromise = this._pendingPromise.then(action);
        return this;
    }

    /**
     * Start a new session with empty input
     * @returns {USSDTester} this for chaining
     */
    start() {
        return this._queue(async () => {
            this._log(`Starting session: ${this.sessionId}`);
            this.lastInput = '';
            this.lastResponse = await this.stateMachine.processInput(this.sessionId, '');
            this.history.push({ input: '', response: this.lastResponse, state: await this._getCurrentState() });
            this._log(`Response: ${this.lastResponse}`);
        });
    }

    /**
     * Send input to the USSD flow
     * @param {string} input - User input
     * @returns {USSDTester} this for chaining
     */
    input(input) {
        return this._queue(async () => {
            this._log(`Input: "${input}"`);
            this.lastInput = input;
            this.lastResponse = await this.stateMachine.processInput(this.sessionId, input);
            this.history.push({ input, response: this.lastResponse, state: await this._getCurrentState() });
            this._log(`Response: ${this.lastResponse}`);
        });
    }

    /**
     * Send multiple inputs in sequence
     * @param {...string} inputs - User inputs
     * @returns {USSDTester} this for chaining
     */
    inputs(...inputs) {
        for (const inp of inputs) {
            this.input(inp);
        }
        return this;
    }

    /**
     * Get current state
     * @private
     */
    async _getCurrentState() {
        if (this.stateMachine.getCurrentState) {
            return await this.stateMachine.getCurrentState(this.sessionId);
        }
        return null;
    }

    /**
     * Assert response matches expected value
     * @param {string|RegExp} expected - Expected response or pattern
     * @param {string} [message] - Custom assertion message
     * @returns {USSDTester} this for chaining
     */
    expectResponse(expected, message) {
        return this._queue(async () => {
            const assertion = { type: 'response', expected, actual: this.lastResponse, passed: false };

            if (typeof expected === 'string') {
                assertion.passed = this.lastResponse === expected;
            } else if (expected instanceof RegExp) {
                assertion.passed = expected.test(this.lastResponse);
            }

            this.assertions.push(assertion);

            if (!assertion.passed) {
                const msg = message || `Expected response to match "${expected}", got: "${this.lastResponse}"`;
                throw new Error(msg);
            }

            this._log(`✓ Response matches: ${expected}`);
        });
    }

    /**
     * Assert response contains a string
     * @param {string} substring - Expected substring
     * @param {string} [message] - Custom assertion message
     * @returns {USSDTester} this for chaining
     */
    expectResponseContains(substring, message) {
        return this._queue(async () => {
            const passed = this.lastResponse?.includes(substring);
            this.assertions.push({ type: 'contains', expected: substring, actual: this.lastResponse, passed });

            if (!passed) {
                const msg = message || `Expected response to contain "${substring}", got: "${this.lastResponse}"`;
                throw new Error(msg);
            }

            this._log(`✓ Response contains: "${substring}"`);
        });
    }

    /**
     * Assert current state
     * @param {string} expectedState - Expected state name
     * @param {string} [message] - Custom assertion message
     * @returns {USSDTester} this for chaining
     */
    expectState(expectedState, message) {
        return this._queue(async () => {
            const currentState = await this._getCurrentState();
            const passed = currentState === expectedState;
            this.assertions.push({ type: 'state', expected: expectedState, actual: currentState, passed });

            if (!passed) {
                const msg = message || `Expected state "${expectedState}", got: "${currentState}"`;
                throw new Error(msg);
            }

            this._log(`✓ State is: ${expectedState}`);
        });
    }

    /**
     * Assert response starts with CON (continue)
     * @returns {USSDTester} this for chaining
     */
    expectContinue() {
        return this._queue(async () => {
            const passed = this.lastResponse?.startsWith('CON');
            this.assertions.push({ type: 'continue', actual: this.lastResponse, passed });

            if (!passed) {
                throw new Error(`Expected CON response, got: "${this.lastResponse}"`);
            }

            this._log('✓ Response is CON (continue)');
        });
    }

    /**
     * Assert response starts with END (terminate)
     * @returns {USSDTester} this for chaining
     */
    expectEnd() {
        return this._queue(async () => {
            const passed = this.lastResponse?.startsWith('END');
            this.assertions.push({ type: 'end', actual: this.lastResponse, passed });

            if (!passed) {
                throw new Error(`Expected END response, got: "${this.lastResponse}"`);
            }

            this._log('✓ Response is END (terminate)');
        });
    }

    /**
     * Assert session data contains expected values
     * @param {Object} expected - Expected data object
     * @returns {USSDTester} this for chaining
     */
    expectSessionData(expected) {
        return this._queue(async () => {
            const data = await this.stateMachine.getSessionData(this.sessionId);

            for (const [key, value] of Object.entries(expected)) {
                if (data?.[key] !== value) {
                    throw new Error(`Expected session data "${key}" to be "${value}", got: "${data?.[key]}"`);
                }
            }

            this._log(`✓ Session data matches: ${JSON.stringify(expected)}`);
        });
    }

    /**
     * Run a custom assertion
     * @param {Function} assertFn - Async function (response, state, data) => throws if fails
     * @returns {USSDTester} this for chaining
     */
    expect(assertFn) {
        return this._queue(async () => {
            const state = await this._getCurrentState();
            const data = await this.stateMachine.getSessionData(this.sessionId);
            await assertFn(this.lastResponse, state, data);
            this._log('✓ Custom assertion passed');
        });
    }

    /**
     * Wait for a specified duration
     * @param {number} ms - Milliseconds to wait
     * @returns {USSDTester} this for chaining
     */
    wait(ms) {
        return this._queue(() => new Promise(resolve => setTimeout(resolve, ms)));
    }

    /**
     * Execute and return the result
     * @returns {Promise<Object>} Test result
     */
    async run() {
        await this._pendingPromise;
        return this.getResult();
    }

    /**
     * Alias for run()
     * @returns {Promise<Object>} Test result
     */
    async execute() {
        return this.run();
    }

    /**
     * Get test result summary
     * @returns {Object} Test result
     */
    getResult() {
        return {
            sessionId: this.sessionId,
            passed: this.assertions.every(a => a.passed),
            totalAssertions: this.assertions.length,
            passedAssertions: this.assertions.filter(a => a.passed).length,
            failedAssertions: this.assertions.filter(a => !a.passed).length,
            history: this.history,
            assertions: this.assertions
        };
    }

    /**
     * Get interaction history
     * @returns {Array} History of inputs and responses
     */
    getHistory() {
        return this.history;
    }

    /**
     * Reset the tester for a new test
     * @param {string} [newSessionId] - Optional new session ID
     * @returns {USSDTester} this for chaining
     */
    reset(newSessionId) {
        this.sessionId = newSessionId || `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.lastResponse = null;
        this.lastInput = null;
        this.history = [];
        this.assertions = [];
        this._pendingPromise = Promise.resolve();
        return this;
    }

    /**
     * Assert the full state history matches the expected path
     * @param {string[]} expectedPath - Array of state names in order
     * @param {string} [message] - Custom assertion message
     * @returns {USSDTester} this for chaining
     */
    expectStateHistory(expectedPath, message) {
        return this._queue(async () => {
            const actualPath = this.history.map(h => h.state).filter(Boolean);
            const passed = JSON.stringify(actualPath) === JSON.stringify(expectedPath);
            this.assertions.push({ type: 'stateHistory', expected: expectedPath, actual: actualPath, passed });

            if (!passed) {
                const msg = message || `Expected state path [${expectedPath.join(' → ')}], got: [${actualPath.join(' → ')}]`;
                throw new Error(msg);
            }

            this._log(`✓ State history matches: [${expectedPath.join(' → ')}]`);
        });
    }

    /**
     * Assert that processing input throws an error
     * @param {string} input - Input to send
     * @param {string|RegExp|Function} expected - Expected error message, pattern, or error class
     * @returns {USSDTester} this for chaining
     */
    expectError(input, expected) {
        return this._queue(async () => {
            let thrown = false;
            let error;

            try {
                await this.stateMachine.processInput(this.sessionId, input);
            } catch (e) {
                thrown = true;
                error = e;
            }

            if (!thrown) {
                throw new Error(`Expected error for input "${input}", but none was thrown`);
            }

            let passed = false;
            if (typeof expected === 'string') {
                passed = error.message === expected;
            } else if (expected instanceof RegExp) {
                passed = expected.test(error.message);
            } else if (typeof expected === 'function') {
                passed = error instanceof expected;
            }

            this.assertions.push({ type: 'error', expected: String(expected), actual: error.message, passed });

            if (!passed) {
                throw new Error(`Expected error matching "${expected}", got: "${error.message}"`);
            }

            this._log(`✓ Error matches: ${expected}`);
        });
    }

    /**
     * Simulate concurrent sessions and collect results
     * @param {number} count - Number of concurrent sessions
     * @param {Function} scenarioFn - Async function (tester, index) => void
     * @returns {Promise<Object[]>} Array of results from each session
     */
    static async simulateConcurrentSessions(stateMachine, count, scenarioFn, options = {}) {
        const testers = Array.from({ length: count }, (_, i) => {
            return new USSDTester(stateMachine, {
                ...options,
                sessionId: `concurrent_${i}_${Date.now()}`
            });
        });

        const results = await Promise.allSettled(
            testers.map((tester, i) => scenarioFn(tester, i).then(() => tester.run()))
        );

        return results.map((result, i) => ({
            sessionIndex: i,
            sessionId: testers[i].sessionId,
            status: result.status,
            result: result.status === 'fulfilled' ? result.value : null,
            error: result.status === 'rejected' ? result.reason.message : null
        }));
    }

    /**
     * Print a summary of the test
     */
    printSummary() {
        const result = this.getResult();
        console.log('\n=== USSD Test Summary ===');
        console.log(`Session: ${result.sessionId}`);
        console.log(`Status: ${result.passed ? '✅ PASSED' : '❌ FAILED'}`);
        console.log(`Assertions: ${result.passedAssertions}/${result.totalAssertions}`);
        console.log('\nInteraction History:');
        result.history.forEach((h, i) => {
            console.log(`  ${i + 1}. Input: "${h.input}" → State: ${h.state}`);
            console.log(`     Response: ${h.response.substring(0, 60)}${h.response.length > 60 ? '...' : ''}`);
        });
        console.log('========================\n');
    }
}

/**
 * Create a test scenario
 * @param {Object} stateMachine - USSDStateMachine instance
 * @param {Function} scenarioFn - Async function (tester) => void
 * @returns {Promise<Object>} Test result
 */
async function runScenario(stateMachine, scenarioFn, options = {}) {
    const tester = new USSDTester(stateMachine, options);
    await scenarioFn(tester);
    return tester.run();
}

/**
 * Create multiple test scenarios
 * @param {Object} stateMachine - USSDStateMachine instance
 * @param {Object} scenarios - Object of scenario name to scenario function
 * @returns {Promise<Object>} Test results
 */
async function runScenarios(stateMachine, scenarios, options = {}) {
    const results = {};

    for (const [name, scenarioFn] of Object.entries(scenarios)) {
        try {
            results[name] = await runScenario(stateMachine, scenarioFn, options);
            results[name].error = null;
        } catch (error) {
            results[name] = {
                passed: false,
                error: error.message
            };
        }
    }

    return {
        total: Object.keys(results).length,
        passed: Object.values(results).filter(r => r.passed).length,
        failed: Object.values(results).filter(r => !r.passed).length,
        results
    };
}

/**
 * Mock storage for testing
 */
class MockStorage {
    constructor() {
        this.store = new Map();
    }

    async getState(sessionId) {
        const session = this.store.get(sessionId);
        return session?.state || null;
    }

    async setState(sessionId, state, timeout) {
        const session = this.store.get(sessionId) || { stateHistory: [] };
        session.state = state;
        session.expiresAt = Date.now() + timeout * 1000;
        this.store.set(sessionId, session);
    }

    async getData(sessionId) {
        const session = this.store.get(sessionId);
        return session?.data || null;
    }

    async setData(sessionId, data, timeout) {
        const session = this.store.get(sessionId) || { stateHistory: [] };
        session.data = { ...session.data, ...data };
        this.store.set(sessionId, session);
    }

    async getSession(sessionId) {
        return this.store.get(sessionId) || null;
    }

    async setSession(sessionId, session) {
        this.store.set(sessionId, session);
    }

    async getStateHistory(sessionId) {
        const session = this.store.get(sessionId);
        return session?.stateHistory || [];
    }

    async pushStateHistory(sessionId, state) {
        const session = this.store.get(sessionId) || { stateHistory: [] };
        session.stateHistory = session.stateHistory || [];
        session.stateHistory.push(state);
        this.store.set(sessionId, session);
    }

    async popStateHistory(sessionId) {
        const session = this.store.get(sessionId);
        if (session?.stateHistory?.length) {
            return session.stateHistory.pop();
        }
        return undefined;
    }

    async deleteSession(sessionId) {
        this.store.delete(sessionId);
    }

    clear() {
        this.store.clear();
    }
}

/**
 * Failing storage for testing error scenarios
 * Wraps a real storage and can be configured to fail on specific operations.
 */
class FailingStorage {
    /**
     * @param {Object} [realStorage] - Underlying storage (default: MockStorage)
     * @param {Object} [failConfig] - Which operations should fail
     * @param {boolean} [failConfig.getState=false] - Fail on getState
     * @param {boolean} [failConfig.setState=false] - Fail on setState
     * @param {boolean} [failConfig.getData=false] - Fail on getData
     * @param {boolean} [failConfig.setData=false] - Fail on setData
     * @param {string} [failConfig.errorMessage='Storage failure'] - Error message
     */
    constructor(realStorage, failConfig = {}) {
        this._storage = realStorage || new MockStorage();
        this._failConfig = failConfig;
        this._errorMessage = failConfig.errorMessage || 'Storage failure';
    }

    _shouldFail(operation) {
        if (this._failConfig[operation]) {
            throw new Error(`${this._errorMessage}: ${operation}`);
        }
    }

    async getState(sessionId) { this._shouldFail('getState'); return this._storage.getState(sessionId); }
    async setState(sessionId, state, timeout) { this._shouldFail('setState'); return this._storage.setState(sessionId, state, timeout); }
    async getData(sessionId) { this._shouldFail('getData'); return this._storage.getData(sessionId); }
    async setData(sessionId, data, timeout) { this._shouldFail('setData'); return this._storage.setData(sessionId, data, timeout); }
    async getSession(sessionId) { this._shouldFail('getSession'); return this._storage.getSession(sessionId); }
    async setSession(sessionId, session) { this._shouldFail('setSession'); return this._storage.setSession(sessionId, session); }
    async getStateHistory(sessionId) { this._shouldFail('getStateHistory'); return this._storage.getStateHistory(sessionId); }
    async pushStateHistory(sessionId, state) { this._shouldFail('pushStateHistory'); return this._storage.pushStateHistory(sessionId, state); }
    async popStateHistory(sessionId) { this._shouldFail('popStateHistory'); return this._storage.popStateHistory(sessionId); }
    async deleteSession(sessionId) { this._shouldFail('deleteSession'); return this._storage.deleteSession(sessionId); }

    /**
     * Configure which operations should fail
     * @param {Object} config - Fail configuration
     */
    setFailConfig(config) {
        Object.assign(this._failConfig, config);
    }

    /**
     * Reset to not fail on any operation
     */
    reset() {
        this._failConfig = {};
    }
}

module.exports = {
    USSDTester,
    runScenario,
    runScenarios,
    MockStorage,
    FailingStorage
};
