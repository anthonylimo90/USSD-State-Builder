/**
 * Flow Diagram Generator
 *
 * Generates visual diagrams of USSD state machine flows in multiple formats:
 * - Mermaid (for GitHub/GitLab rendering)
 * - DOT (for Graphviz)
 * - ASCII (for terminal display)
 *
 * Works with both compiled state machines and AppBuilder instances.
 */

/**
 * Flow diagram generator for USSD state machines
 */
class FlowDiagram {
    /**
     * Create a new FlowDiagram
     * @param {Object} stateMachine - USSDStateMachine instance or config
     * @param {Object} [options] - Diagram options
     * @param {boolean} [options.showValidators=true] - Show validator indicators
     * @param {boolean} [options.showHooks=true] - Show lifecycle hook indicators
     * @param {string} [options.direction='TB'] - Graph direction (TB, LR, BT, RL)
     * @param {string} [options.theme='default'] - Color theme
     *
     * @example
     * const diagram = new FlowDiagram(machine);
     * console.log(diagram.toMermaid());
     */
    constructor(stateMachine, options = {}) {
        if (!stateMachine || !stateMachine.states) {
            throw new Error('FlowDiagram requires a state machine instance with states');
        }

        this.states = stateMachine.states;
        this.initialState = stateMachine.initialState;
        this.enableBackNavigation = stateMachine.enableBackNavigation !== false;
        this.showValidators = options.showValidators !== false;
        this.showHooks = options.showHooks !== false;
        this.direction = options.direction || 'TB';
        this.theme = options.theme || 'default';

        // Analyze transitions
        this._transitions = this._analyzeTransitions();
    }

    /**
     * Analyze state transitions by inspecting handler code
     * @private
     * @returns {Array<{from: string, to: string, label: string}>}
     */
    _analyzeTransitions() {
        const transitions = [];
        const stateNames = Object.keys(this.states);

        for (const [name, config] of Object.entries(this.states)) {
            const handlerStr = config.handler?.toString() || '';

            // Look for nextState references in handler code
            for (const targetState of stateNames) {
                if (name === targetState) continue;

                // Check for various patterns that indicate transitions
                const patterns = [
                    `'${targetState}'`,
                    `"${targetState}"`,
                    `\`${targetState}\``
                ];

                for (const pattern of patterns) {
                    if (handlerStr.includes(pattern)) {
                        // Try to determine the input that triggers this transition
                        const inputMatch = handlerStr.match(
                            new RegExp(`['"](?:\\()?(\\d+)(?:\\))?['"]\\s*[=:].+?['"]${targetState.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`)
                        );
                        const label = inputMatch ? inputMatch[1] : '';
                        transitions.push({ from: name, to: targetState, label });
                        break;
                    }
                }
            }
        }

        return transitions;
    }

    /**
     * Get state metadata for display
     * @private
     */
    _getStateMetadata(name) {
        const config = this.states[name];
        const meta = [];
        if (config.validator) meta.push('V');
        if (config.onEnter) meta.push('E');
        if (config.onExit) meta.push('X');
        return meta;
    }

    /**
     * Generate Mermaid diagram syntax
     * @returns {string} Mermaid diagram definition
     *
     * @example
     * const mermaid = diagram.toMermaid();
     * // Can be rendered in GitHub markdown:
     * // ```mermaid
     * // stateDiagram-v2
     * //   [*] --> welcome
     * //   welcome --> menu : 1
     * // ```
     */
    toMermaid() {
        const lines = [];
        lines.push(`stateDiagram-v2`);
        lines.push(`  direction ${this.direction}`);
        lines.push('');

        // Initial state transition
        lines.push(`  [*] --> ${this._sanitizeId(this.initialState)}`);
        lines.push('');

        // State definitions with notes
        for (const [name, config] of Object.entries(this.states)) {
            const id = this._sanitizeId(name);
            const meta = this._getStateMetadata(name);

            if (meta.length > 0 && this.showValidators) {
                lines.push(`  ${id} : ${name} [${meta.join(',')}]`);
            }

            // Check if terminal state
            const handlerStr = config.handler?.toString() || '';
            if (handlerStr.includes('END ')) {
                lines.push(`  ${id} --> [*]`);
            }
        }

        lines.push('');

        // Transitions
        for (const t of this._transitions) {
            const from = this._sanitizeId(t.from);
            const to = this._sanitizeId(t.to);
            if (t.label) {
                lines.push(`  ${from} --> ${to} : ${t.label}`);
            } else {
                lines.push(`  ${from} --> ${to}`);
            }
        }

        // Back navigation
        if (this.enableBackNavigation) {
            lines.push('');
            lines.push('  note right of ' + this._sanitizeId(this.initialState));
            lines.push('    Input "0" navigates back');
            lines.push('  end note');
        }

        return lines.join('\n');
    }

    /**
     * Generate enhanced DOT graph (for Graphviz)
     * @returns {string} DOT language graph
     *
     * @example
     * const dot = diagram.toDot();
     * // Render with: dot -Tpng -o flow.png
     */
    toDot() {
        const lines = [];
        lines.push('digraph USSDFlow {');
        lines.push(`  rankdir=${this.direction};`);
        lines.push('  node [shape=box, style="rounded,filled", fontname="Arial"];');
        lines.push('  edge [fontname="Arial", fontsize=10];');
        lines.push('');

        // Theme colors
        const colors = this._getThemeColors();

        // Start node
        lines.push('  __start__ [label="", shape=circle, width=0.3, style=filled, fillcolor="#333333"];');
        lines.push(`  __start__ -> "${this.initialState}" [style=bold];`);
        lines.push('');

        // State nodes
        for (const [name, config] of Object.entries(this.states)) {
            const meta = this._getStateMetadata(name);
            const label = meta.length > 0 ? `${name}\\n[${meta.join(',')}]` : name;
            const isInitial = name === this.initialState;
            const handlerStr = config.handler?.toString() || '';
            const isTerminal = handlerStr.includes('END ');

            let fillColor = colors.default;
            if (isInitial) fillColor = colors.initial;
            if (isTerminal) fillColor = colors.terminal;
            if (config.validator) fillColor = colors.validated;

            lines.push(`  "${name}" [label="${label}", fillcolor="${fillColor}"];`);

            if (isTerminal) {
                lines.push(`  "${name}" -> __end_${name}__ [style=bold];`);
                lines.push(`  __end_${name}__ [label="", shape=doublecircle, width=0.3, style=filled, fillcolor="#333333"];`);
            }
        }

        lines.push('');

        // Transitions
        for (const t of this._transitions) {
            if (t.label) {
                lines.push(`  "${t.from}" -> "${t.to}" [label="${t.label}"];`);
            } else {
                lines.push(`  "${t.from}" -> "${t.to}";`);
            }
        }

        // Legend
        lines.push('');
        lines.push('  subgraph cluster_legend {');
        lines.push('    label="Legend";');
        lines.push('    style=dashed;');
        lines.push('    fontname="Arial";');
        lines.push('    legend_v [label="V = Validator", shape=plaintext];');
        lines.push('    legend_e [label="E = onEnter hook", shape=plaintext];');
        lines.push('    legend_x [label="X = onExit hook", shape=plaintext];');
        lines.push('  }');

        lines.push('}');
        return lines.join('\n');
    }

    /**
     * Generate enhanced ASCII diagram
     * @returns {string} ASCII representation
     */
    toAscii() {
        const stateNames = Object.keys(this.states);
        const maxNameLen = Math.max(...stateNames.map(n => n.length), 20);
        const boxWidth = maxNameLen + 20;

        const lines = [];
        const border = '═'.repeat(boxWidth);

        lines.push(`╔${border}╗`);
        lines.push(`║${'USSD State Flow Diagram'.padStart(Math.floor((boxWidth + 23) / 2)).padEnd(boxWidth)}║`);
        lines.push(`╠${border}╣`);
        lines.push(`║ Initial: ${this.initialState.padEnd(boxWidth - 11)}║`);
        lines.push(`║ States:  ${String(stateNames.length).padEnd(boxWidth - 11)}║`);
        lines.push(`║ Back:    ${(this.enableBackNavigation ? 'Enabled (input: 0)' : 'Disabled').padEnd(boxWidth - 11)}║`);
        lines.push(`╠${border}╣`);

        for (const name of stateNames) {
            const meta = this._getStateMetadata(name);
            const indicator = name === this.initialState ? '▶' : ' ';
            const metaStr = meta.length > 0 ? ` [${meta.join(',')}]` : '';
            const display = `${indicator} ${name}${metaStr}`;

            lines.push(`║ ${display.padEnd(boxWidth - 2)}║`);

            // Show transitions from this state
            const outgoing = this._transitions.filter(t => t.from === name);
            for (const t of outgoing) {
                const arrow = `   └─→ ${t.to}${t.label ? ` (input: ${t.label})` : ''}`;
                lines.push(`║ ${arrow.padEnd(boxWidth - 2)}║`);
            }
        }

        lines.push(`╠${border}╣`);
        lines.push(`║ Legend: V=Validator E=onEnter X=onExit ▶=Initial${' '.repeat(Math.max(0, boxWidth - 50))}║`);
        lines.push(`╚${border}╝`);

        return lines.join('\n');
    }

    /**
     * Export the flow as a JSON structure
     * @returns {Object} JSON representation of the flow
     */
    toJSON() {
        const states = {};
        for (const [name, config] of Object.entries(this.states)) {
            const handlerStr = config.handler?.toString() || '';
            states[name] = {
                isInitial: name === this.initialState,
                isTerminal: handlerStr.includes('END '),
                hasValidator: !!config.validator,
                hasOnEnter: !!config.onEnter,
                hasOnExit: !!config.onExit,
                transitions: this._transitions
                    .filter(t => t.from === name)
                    .map(t => ({ to: t.to, label: t.label || undefined }))
            };
        }

        return {
            initialState: this.initialState,
            backNavigation: this.enableBackNavigation,
            totalStates: Object.keys(this.states).length,
            totalTransitions: this._transitions.length,
            states
        };
    }

    /**
     * Sanitize state name for Mermaid ID
     * @private
     */
    _sanitizeId(name) {
        return name.replace(/[^a-zA-Z0-9_]/g, '_');
    }

    /**
     * Get theme colors
     * @private
     */
    _getThemeColors() {
        const themes = {
            default: {
                initial: '#4CAF50',
                terminal: '#f44336',
                validated: '#2196F3',
                default: '#E8E8E8'
            },
            dark: {
                initial: '#66BB6A',
                terminal: '#EF5350',
                validated: '#42A5F5',
                default: '#424242'
            },
            minimal: {
                initial: '#FFFFFF',
                terminal: '#FFFFFF',
                validated: '#FFFFFF',
                default: '#FFFFFF'
            }
        };
        return themes[this.theme] || themes.default;
    }
}

module.exports = { FlowDiagram };
