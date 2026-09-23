/**
 * USSD Simulator - Interactive testing tool
 *
 * Provides a CLI-based USSD simulator for testing flows locally
 * without requiring a telecom gateway. Supports both interactive
 * (readline) and programmatic modes.
 */

/**
 * USSD flow simulator for local testing
 */
class USSDSimulator {
    /**
     * Create a new USSDSimulator
     * @param {Object} stateMachine - USSDStateMachine instance
     * @param {Object} [options] - Simulator options
     * @param {string} [options.sessionId] - Custom session ID (default: auto-generated)
     * @param {boolean} [options.showDebug=false] - Show debug information
     * @param {boolean} [options.showTimings=true] - Show response times
     * @param {boolean} [options.autoEnd=true] - Auto-end on END response
     * @param {Function} [options.onResponse] - Callback for responses
     * @param {Function} [options.onError] - Callback for errors
     *
     * @example
     * const simulator = new USSDSimulator(machine, { showDebug: true });
     * await simulator.startInteractive();
     */
    constructor(stateMachine, options = {}) {
        this.machine = stateMachine;
        this.sessionId = options.sessionId || `sim_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        this.showDebug = options.showDebug || false;
        this.showTimings = options.showTimings !== false;
        this.autoEnd = options.autoEnd !== false;
        this.onResponse = options.onResponse || null;
        this.onError = options.onError || null;

        this._history = [];
        this._running = false;
    }

    /**
     * Send input and get response (programmatic mode)
     * @param {string} input - User input
     * @param {Object} [options] - Processing options
     * @returns {Promise<Object>} Response object
     *
     * @example
     * const result = await simulator.send('1');
     * console.log(result.response); // "CON Choose option..."
     * console.log(result.isEnd);    // false
     */
    async send(input) {
        const startTime = Date.now();

        try {
            const response = await this.machine.processInput(this.sessionId, input);
            const duration = Date.now() - startTime;
            const isEnd = response.startsWith('END ');
            const displayText = response.replace(/^(CON |END )/, '');

            const entry = {
                input,
                response,
                displayText,
                isEnd,
                duration,
                timestamp: new Date().toISOString(),
                state: await this.machine.getCurrentState?.(this.sessionId) || 'unknown'
            };

            this._history.push(entry);

            if (this.onResponse) {
                this.onResponse(entry);
            }

            return entry;
        } catch (error) {
            const entry = {
                input,
                error: error.message,
                errorType: error.constructor.name,
                duration: Date.now() - startTime,
                timestamp: new Date().toISOString()
            };

            this._history.push(entry);

            if (this.onError) {
                this.onError(error, entry);
            }

            throw error;
        }
    }

    /**
     * Run a complete scenario (list of inputs)
     * @param {string[]} inputs - Array of inputs to send sequentially
     * @returns {Promise<Object[]>} Array of response objects
     *
     * @example
     * const results = await simulator.runScenario(['', '1', '254712345678', '1']);
     * results.forEach(r => console.log(`${r.input} -> ${r.displayText}`));
     */
    async runScenario(inputs) {
        const results = [];

        for (const input of inputs) {
            try {
                const result = await this.send(input);
                results.push(result);

                if (result.isEnd && this.autoEnd) {
                    break;
                }
            } catch (error) {
                results.push({
                    input,
                    error: error.message,
                    errorType: error.constructor.name
                });
                break;
            }
        }

        return results;
    }

    /**
     * Start interactive CLI mode using readline
     * @returns {Promise<void>} Resolves when session ends
     *
     * @example
     * const simulator = new USSDSimulator(machine);
     * await simulator.startInteractive();
     */
    async startInteractive() {
        const readline = require('readline');

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        this._running = true;

        console.log('╔══════════════════════════════════════════╗');
        console.log('║         USSD Simulator v1.0              ║');
        console.log('║  Type input and press Enter              ║');
        console.log('║  Commands: /quit /reset /history /state  ║');
        console.log('╚══════════════════════════════════════════╝');
        console.log('');

        // Send initial empty input to start session
        try {
            const initial = await this.send('');
            this._printResponse(initial);
        } catch (error) {
            console.log(`Error: ${error.message}`);
        }

        const prompt = () => {
            rl.question('USSD> ', async (input) => {
                input = input.trim();

                // Handle simulator commands
                if (input.startsWith('/')) {
                    switch (input) {
                        case '/quit':
                        case '/exit':
                            this._running = false;
                            rl.close();
                            console.log('\nSession ended.');
                            return;

                        case '/reset':
                            await this.reset();
                            console.log('Session reset. Starting new session...');
                            try {
                                const initial = await this.send('');
                                this._printResponse(initial);
                            } catch (error) {
                                console.log(`Error: ${error.message}`);
                            }
                            prompt();
                            return;

                        case '/history':
                            this._printHistory();
                            prompt();
                            return;

                        case '/state':
                            const state = await this.machine.getCurrentState?.(this.sessionId);
                            console.log(`Current state: ${state || 'unknown'}`);
                            prompt();
                            return;

                        case '/debug':
                            this.showDebug = !this.showDebug;
                            console.log(`Debug mode: ${this.showDebug ? 'ON' : 'OFF'}`);
                            prompt();
                            return;

                        default:
                            console.log('Unknown command. Available: /quit /reset /history /state /debug');
                            prompt();
                            return;
                    }
                }

                // Send input to state machine
                try {
                    const result = await this.send(input);
                    this._printResponse(result);

                    if (result.isEnd && this.autoEnd) {
                        console.log('\n--- Session ended ---');
                        this._running = false;
                        rl.close();
                        return;
                    }
                } catch (error) {
                    console.log(`\nError: ${error.message}`);
                    if (this.showDebug) {
                        console.log(`Type: ${error.constructor.name}`);
                    }
                }

                prompt();
            });
        };

        return new Promise((resolve) => {
            rl.on('close', () => {
                this._running = false;
                resolve();
            });
            prompt();
        });
    }

    /**
     * Print a formatted response to console
     * @private
     */
    _printResponse(entry) {
        console.log('');
        console.log('┌──────────────────────────────────────────┐');
        const lines = entry.displayText.split('\n');
        for (const line of lines) {
            const padded = line.padEnd(42);
            console.log(`│ ${padded}│`);
        }
        console.log('└──────────────────────────────────────────┘');

        if (this.showTimings) {
            console.log(`  Response time: ${entry.duration}ms`);
        }
        if (this.showDebug) {
            console.log(`  State: ${entry.state} | End: ${entry.isEnd}`);
        }
    }

    /**
     * Print session history
     * @private
     */
    _printHistory() {
        console.log('\n--- Session History ---');
        for (let i = 0; i < this._history.length; i++) {
            const entry = this._history[i];
            if (entry.error) {
                console.log(`  ${i + 1}. [${entry.input || '(empty)'}] → ERROR: ${entry.error}`);
            } else {
                const preview = entry.displayText.substring(0, 50).replace(/\n/g, ' ');
                console.log(`  ${i + 1}. [${entry.input || '(empty)'}] → ${preview}${entry.displayText.length > 50 ? '...' : ''} (${entry.duration}ms)`);
            }
        }
        console.log('');
    }

    /**
     * Reset the simulator (new session)
     * @returns {Promise<void>}
     */
    async reset() {
        if (this.machine.endSession) {
            await this.machine.endSession(this.sessionId);
        }
        this.sessionId = `sim_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        this._history = [];
    }

    /**
     * Get the full interaction history
     * @returns {Object[]} Array of interaction entries
     */
    getHistory() {
        return [...this._history];
    }

    /**
     * Get a summary of the session
     * @returns {Object} Session summary
     */
    getSummary() {
        const totalDuration = this._history.reduce((sum, e) => sum + (e.duration || 0), 0);
        const errors = this._history.filter(e => e.error);

        return {
            sessionId: this.sessionId,
            totalInteractions: this._history.length,
            totalDuration,
            averageResponseTime: this._history.length > 0
                ? Math.round(totalDuration / this._history.length)
                : 0,
            errors: errors.length,
            completed: this._history.some(e => e.isEnd)
        };
    }
}

module.exports = { USSDSimulator };
