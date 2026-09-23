const { FlowDiagram } = require('../lib/FlowDiagram');

describe('FlowDiagram', () => {
    let machine;

    beforeEach(() => {
        machine = {
            initialState: 'welcome',
            enableBackNavigation: true,
            states: {
                welcome: {
                    handler: async (input) => {
                        if (input === '1') return { response: 'CON Menu', nextState: 'menu' };
                        if (input === '2') return { response: 'END Goodbye', nextState: null };
                        return { response: 'CON Welcome\n1. Menu\n2. Exit' };
                    },
                    validator: (input) => { if (!['1', '2', ''].includes(input)) throw new Error('Invalid'); }
                },
                menu: {
                    handler: async (input) => {
                        if (input === '1') return { response: 'END Done', nextState: 'done' };
                        return { response: 'CON Choose:\n1. Action' };
                    }
                },
                done: {
                    handler: async () => ({ response: 'END Complete' }),
                    onEnter: () => {},
                    onExit: () => {}
                }
            }
        };
    });

    test('should require a state machine with states', () => {
        expect(() => new FlowDiagram({})).toThrow();
        expect(() => new FlowDiagram(null)).toThrow();
    });

    test('should generate Mermaid diagram', () => {
        const diagram = new FlowDiagram(machine);
        const mermaid = diagram.toMermaid();

        expect(mermaid).toContain('stateDiagram-v2');
        expect(mermaid).toContain('[*] --> welcome');
        expect(mermaid).toContain('welcome');
        expect(mermaid).toContain('menu');
        expect(mermaid).toContain('done');
    });

    test('should generate DOT graph', () => {
        const diagram = new FlowDiagram(machine);
        const dot = diagram.toDot();

        expect(dot).toContain('digraph USSDFlow');
        expect(dot).toContain('"welcome"');
        expect(dot).toContain('"menu"');
        expect(dot).toContain('__start__');
    });

    test('should generate ASCII diagram', () => {
        const diagram = new FlowDiagram(machine);
        const ascii = diagram.toAscii();

        expect(ascii).toContain('USSD State Flow Diagram');
        expect(ascii).toContain('welcome');
        expect(ascii).toContain('menu');
        expect(ascii).toContain('Initial');
    });

    test('should export JSON structure', () => {
        const diagram = new FlowDiagram(machine);
        const json = diagram.toJSON();

        expect(json.initialState).toBe('welcome');
        expect(json.backNavigation).toBe(true);
        expect(json.totalStates).toBe(3);
        expect(json.states.welcome.isInitial).toBe(true);
        expect(json.states.welcome.hasValidator).toBe(true);
        expect(json.states.done.hasOnEnter).toBe(true);
    });

    test('should detect transitions from handler code', () => {
        const diagram = new FlowDiagram(machine);
        const json = diagram.toJSON();

        const welcomeTransitions = json.states.welcome.transitions;
        expect(welcomeTransitions.length).toBeGreaterThan(0);
        expect(welcomeTransitions.some(t => t.to === 'menu')).toBe(true);
    });

    test('should support custom direction', () => {
        const diagram = new FlowDiagram(machine, { direction: 'LR' });
        const mermaid = diagram.toMermaid();
        expect(mermaid).toContain('direction LR');
    });
});
