const { StateInspector } = require('../lib/StateInspector');

describe('StateInspector', () => {
    const validConfig = {
        initialState: 'WELCOME',
        enableBackNavigation: true,
        timeout: 300,
        states: {
            WELCOME: {
                handler: (input) => ({ response: 'CON Welcome', nextState: 'MENU' }),
                validator: (input) => {},
                onEnter: () => {},
                onExit: () => {}
            },
            MENU: {
                handler: (input) => {
                    if (input === '1') return { response: 'CON Option 1', nextState: 'OPTION1' };
                    return { response: 'CON Menu', nextState: 'WELCOME' };
                }
            },
            OPTION1: {
                handler: (input) => ({ response: 'END Done' }),
                validator: (input) => {}
            },
            UNUSED: {
                handler: (input) => ({ response: 'END Unused' })
            }
        }
    };

    let inspector;

    beforeEach(() => {
        inspector = new StateInspector(validConfig);
    });

    describe('constructor', () => {
        test('should create inspector from config', () => {
            expect(inspector).toBeDefined();
        });

        test('should throw if no states provided', () => {
            expect(() => new StateInspector({})).toThrow();
        });
    });

    describe('getSummary', () => {
        test('should return summary object', () => {
            const summary = inspector.getSummary();
            expect(summary.totalStates).toBe(4);
            expect(summary.initialState).toBe('WELCOME');
            expect(summary.backNavigationEnabled).toBe(true);
            expect(summary.sessionTimeout).toBe(300);
            expect(summary.states).toEqual(['WELCOME', 'MENU', 'OPTION1', 'UNUSED']);
        });

        test('should count states with validators', () => {
            const summary = inspector.getSummary();
            expect(summary.statesWithValidators).toBe(2);
        });

        test('should count states with lifecycle hooks', () => {
            const summary = inspector.getSummary();
            expect(summary.statesWithOnEnter).toBe(1);
            expect(summary.statesWithOnExit).toBe(1);
        });
    });

    describe('getStateInfo', () => {
        test('should return state info for existing state', () => {
            const info = inspector.getStateInfo('WELCOME');
            expect(info.name).toBe('WELCOME');
            expect(info.isInitialState).toBe(true);
            expect(info.hasHandler).toBe(true);
            expect(info.hasValidator).toBe(true);
            expect(info.hasOnEnter).toBe(true);
            expect(info.hasOnExit).toBe(true);
        });

        test('should return null for non-existing state', () => {
            const info = inspector.getStateInfo('NONEXISTENT');
            expect(info).toBeNull();
        });

        test('should identify non-initial states', () => {
            const info = inspector.getStateInfo('MENU');
            expect(info.isInitialState).toBe(false);
        });
    });

    describe('getPotentialTransitionsTo', () => {
        test('should find states that reference target', () => {
            const refs = inspector.getPotentialTransitionsTo('MENU');
            expect(refs).toContain('WELCOME');
        });

        test('should return empty array for unreferenced state', () => {
            const refs = inspector.getPotentialTransitionsTo('UNUSED');
            expect(refs).toEqual([]);
        });
    });

    describe('toAsciiDiagram', () => {
        test('should generate ASCII diagram', () => {
            const diagram = inspector.toAsciiDiagram();
            expect(typeof diagram).toBe('string');
            expect(diagram).toContain('USSD State Machine');
            expect(diagram).toContain('WELCOME');
            expect(diagram).toContain('MENU');
            expect(diagram).toContain('Legend');
        });

        test('should mark initial state', () => {
            const diagram = inspector.toAsciiDiagram();
            expect(diagram).toContain('Initial State: WELCOME');
        });
    });

    describe('validate', () => {
        test('should return valid for correct config', () => {
            const result = inspector.validate();
            expect(result.valid).toBe(true);
            expect(result.errors).toEqual([]);
        });

        test('should detect unreachable states', () => {
            const result = inspector.validate();
            const unreachable = result.warnings.filter(w => w.type === 'POTENTIALLY_UNREACHABLE');
            expect(unreachable.length).toBeGreaterThan(0);
            expect(unreachable.some(w => w.state === 'UNUSED')).toBe(true);
        });

        test('should warn about reserved input', () => {
            const result = inspector.validate();
            const reserved = result.warnings.filter(w => w.type === 'RESERVED_INPUT');
            expect(reserved.length).toBe(1);
        });

        test('should detect missing handler', () => {
            const badConfig = {
                initialState: 'START',
                states: {
                    START: { validator: () => {} } // Missing handler
                }
            };
            const badInspector = new StateInspector(badConfig);
            const result = badInspector.validate();
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.type === 'MISSING_HANDLER')).toBe(true);
        });

        test('should detect invalid initial state', () => {
            const badConfig = {
                initialState: 'NONEXISTENT',
                states: {
                    START: { handler: () => ({}) }
                }
            };
            const badInspector = new StateInspector(badConfig);
            const result = badInspector.validate();
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.type === 'INVALID_INITIAL_STATE')).toBe(true);
        });
    });

    describe('toJSON', () => {
        test('should return JSON-serializable object', () => {
            const json = inspector.toJSON();
            expect(typeof json).toBe('object');
            expect(json.initialState).toBe('WELCOME');
            expect(json.states.WELCOME.hasHandler).toBe(true);
            expect(json.states.WELCOME.hasValidator).toBe(true);
        });

        test('should be serializable', () => {
            const json = inspector.toJSON();
            expect(() => JSON.stringify(json)).not.toThrow();
        });
    });

    describe('toDotGraph', () => {
        test('should generate DOT graph', () => {
            const dot = inspector.toDotGraph();
            expect(typeof dot).toBe('string');
            expect(dot).toContain('digraph USSDStateMachine');
            expect(dot).toContain('"WELCOME"');
        });

        test('should mark initial state with special style', () => {
            const dot = inspector.toDotGraph();
            expect(dot).toContain('"WELCOME" [style="rounded,bold"');
        });
    });
});
