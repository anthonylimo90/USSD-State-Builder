/**
 * State Inspector - Introspection and Visualization Tools
 *
 * Provides tools to inspect, visualize, and validate USSD state machine configurations.
 */

/**
 * State machine introspection utility
 */
class StateInspector {
    /**
     * Create a new StateInspector
     * @param {Object} stateMachine - USSDStateMachine instance or config object
     */
    constructor(stateMachine) {
        if (stateMachine.states) {
            // If passed a state machine instance or config with states
            this.states = stateMachine.states;
            this.initialState = stateMachine.initialState;
            this.enableBackNavigation = stateMachine.enableBackNavigation !== false;
            this.timeout = stateMachine.timeout || 300;
        } else {
            throw new Error('StateInspector requires a state machine instance or config with states');
        }
    }

    /**
     * Get a summary of the state machine configuration
     * @returns {Object} Summary object with stats and state list
     */
    getSummary() {
        const stateNames = Object.keys(this.states);
        const statesWithValidators = stateNames.filter(name => this.states[name].validator);
        const statesWithOnEnter = stateNames.filter(name => this.states[name].onEnter);
        const statesWithOnExit = stateNames.filter(name => this.states[name].onExit);

        return {
            totalStates: stateNames.length,
            initialState: this.initialState,
            backNavigationEnabled: this.enableBackNavigation,
            sessionTimeout: this.timeout,
            states: stateNames,
            statesWithValidators: statesWithValidators.length,
            statesWithOnEnter: statesWithOnEnter.length,
            statesWithOnExit: statesWithOnExit.length
        };
    }

    /**
     * Get detailed information about a specific state
     * @param {string} stateName - Name of the state to inspect
     * @returns {Object|null} State info or null if not found
     */
    getStateInfo(stateName) {
        const state = this.states[stateName];
        if (!state) return null;

        return {
            name: stateName,
            isInitialState: stateName === this.initialState,
            hasHandler: typeof state.handler === 'function',
            hasValidator: typeof state.validator === 'function',
            hasOnEnter: typeof state.onEnter === 'function',
            hasOnExit: typeof state.onExit === 'function',
            handlerType: state.handler?.constructor?.name || 'unknown'
        };
    }

    /**
     * Get all states that reference a given state (potential transitions to it)
     * Note: This is a heuristic based on handler code inspection
     * @param {string} stateName - Target state name
     * @returns {string[]} Array of state names that might transition to the target
     */
    getPotentialTransitionsTo(stateName) {
        const references = [];

        for (const [name, config] of Object.entries(this.states)) {
            if (name === stateName) continue;

            // Check if handler code references the state name
            const handlerStr = config.handler?.toString() || '';
            if (handlerStr.includes(`'${stateName}'`) || handlerStr.includes(`"${stateName}"`)) {
                references.push(name);
            }
        }

        return references;
    }

    /**
     * Generate an ASCII diagram of the state machine
     * @returns {string} ASCII representation of states
     */
    toAsciiDiagram() {
        const stateNames = Object.keys(this.states);
        const lines = [];

        lines.push('┌─────────────────────────────────────────────┐');
        lines.push('│           USSD State Machine                │');
        lines.push('├─────────────────────────────────────────────┤');
        lines.push(`│ Initial State: ${this.initialState.padEnd(28)}│`);
        lines.push(`│ Total States: ${String(stateNames.length).padEnd(29)}│`);
        lines.push(`│ Back Navigation: ${(this.enableBackNavigation ? 'Yes' : 'No').padEnd(26)}│`);
        lines.push('├─────────────────────────────────────────────┤');
        lines.push('│ States:                                     │');

        for (const name of stateNames) {
            const state = this.states[name];
            const markers = [];
            if (name === this.initialState) markers.push('*');
            if (state.validator) markers.push('V');
            if (state.onEnter) markers.push('E');
            if (state.onExit) markers.push('X');

            const markerStr = markers.length > 0 ? ` [${markers.join('')}]` : '';
            const displayName = name + markerStr;
            const padding = Math.max(0, 42 - displayName.length);
            lines.push(`│  ${name === this.initialState ? '→' : ' '} ${displayName}${' '.repeat(padding)}│`);
        }

        lines.push('├─────────────────────────────────────────────┤');
        lines.push('│ Legend:                                     │');
        lines.push('│  → Initial  * Initial  V Validator          │');
        lines.push('│  E onEnter  X onExit                        │');
        lines.push('└─────────────────────────────────────────────┘');

        return lines.join('\n');
    }

    /**
     * Validate the state machine configuration
     * @returns {Object} Validation result with errors and warnings
     */
    validate() {
        const errors = [];
        const warnings = [];
        const stateNames = Object.keys(this.states);

        // Check for initial state
        if (!this.initialState) {
            errors.push({
                type: 'MISSING_INITIAL_STATE',
                message: 'No initial state defined'
            });
        } else if (!this.states[this.initialState]) {
            errors.push({
                type: 'INVALID_INITIAL_STATE',
                message: `Initial state "${this.initialState}" not found in states`,
                state: this.initialState
            });
        }

        // Check each state
        for (const [name, config] of Object.entries(this.states)) {
            // Check for handler
            if (typeof config.handler !== 'function') {
                errors.push({
                    type: 'MISSING_HANDLER',
                    message: `State "${name}" is missing a handler function`,
                    state: name
                });
            }

            // Check for potential unreachable states
            if (name !== this.initialState) {
                const referencedBy = this.getPotentialTransitionsTo(name);
                if (referencedBy.length === 0) {
                    warnings.push({
                        type: 'POTENTIALLY_UNREACHABLE',
                        message: `State "${name}" may be unreachable (no detected transitions to it)`,
                        state: name
                    });
                }
            }

            // Check validator type
            if (config.validator && typeof config.validator !== 'function') {
                errors.push({
                    type: 'INVALID_VALIDATOR',
                    message: `State "${name}" has invalid validator (must be function)`,
                    state: name
                });
            }

            // Check lifecycle hooks
            if (config.onEnter && typeof config.onEnter !== 'function') {
                errors.push({
                    type: 'INVALID_ON_ENTER',
                    message: `State "${name}" has invalid onEnter (must be function)`,
                    state: name
                });
            }
            if (config.onExit && typeof config.onExit !== 'function') {
                errors.push({
                    type: 'INVALID_ON_EXIT',
                    message: `State "${name}" has invalid onExit (must be function)`,
                    state: name
                });
            }
        }

        // Check for reserved input handling
        if (this.enableBackNavigation) {
            warnings.push({
                type: 'RESERVED_INPUT',
                message: 'Input "0" is reserved for back navigation'
            });
        }

        // Check for empty state machine
        if (stateNames.length === 0) {
            errors.push({
                type: 'NO_STATES',
                message: 'State machine has no states defined'
            });
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            stateCount: stateNames.length
        };
    }

    /**
     * Export state machine structure as JSON
     * @returns {Object} JSON-serializable structure
     */
    toJSON() {
        const states = {};

        for (const [name, config] of Object.entries(this.states)) {
            states[name] = {
                hasHandler: typeof config.handler === 'function',
                hasValidator: typeof config.validator === 'function',
                hasOnEnter: typeof config.onEnter === 'function',
                hasOnExit: typeof config.onExit === 'function'
            };
        }

        return {
            initialState: this.initialState,
            backNavigationEnabled: this.enableBackNavigation,
            sessionTimeout: this.timeout,
            states
        };
    }

    /**
     * Generate a DOT graph representation (for Graphviz)
     * @returns {string} DOT language graph
     */
    toDotGraph() {
        const lines = ['digraph USSDStateMachine {'];
        lines.push('  rankdir=TB;');
        lines.push('  node [shape=box, style=rounded];');
        lines.push('');

        // Mark initial state
        lines.push(`  "${this.initialState}" [style="rounded,bold", peripheries=2];`);

        // Add nodes with styling based on features
        for (const [name, config] of Object.entries(this.states)) {
            const features = [];
            if (config.validator) features.push('V');
            if (config.onEnter) features.push('E');
            if (config.onExit) features.push('X');

            if (features.length > 0 && name !== this.initialState) {
                lines.push(`  "${name}" [xlabel="[${features.join('')}]"];`);
            }
        }

        // Note: Actual transitions would require runtime analysis
        lines.push('');
        lines.push('  // Note: Transitions require runtime analysis');
        lines.push('}');

        return lines.join('\n');
    }
}

module.exports = { StateInspector };
