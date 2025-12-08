const USSDStateMachine = require('../lib/USSDStateMachine');
const ValidationError = require('../lib/ValidationError');
const InMemoryStorage = require('../lib/InMemoryStorage');

describe('USSDStateMachine - Back Navigation', () => {
    let ussdConfig;
    let ussdStateMachine;

    beforeEach(() => {
        ussdConfig = {
            initialState: 'WELCOME',
            timeout: 300,
            enableBackNavigation: true,
            states: {
                WELCOME: {
                    handler: async (input) => {
                        if (input === '') {
                            return {
                                response: 'CON Welcome\n1. Continue',
                                nextState: 'MENU'
                            };
                        }
                        return { response: 'CON Welcome\n1. Continue' };
                    }
                },
                MENU: {
                    handler: async (input) => {
                        if (input === '1') {
                            return {
                                response: 'CON Sub Menu\n1. Option\n0. Back',
                                nextState: 'SUBMENU'
                            };
                        }
                        return {
                            response: 'CON Menu\n1. Sub Menu\n0. Back'
                        };
                    }
                },
                SUBMENU: {
                    handler: async (input) => {
                        if (input === '1') {
                            return {
                                response: 'CON Deep Level\n0. Back',
                                nextState: 'DEEP'
                            };
                        }
                        return {
                            response: 'CON Sub Menu\n1. Go Deeper\n0. Back'
                        };
                    }
                },
                DEEP: {
                    handler: async (input) => {
                        return {
                            response: 'CON Deepest Level\n0. Back'
                        };
                    }
                }
            }
        };
        ussdStateMachine = new USSDStateMachine(ussdConfig);
    });

    test('should navigate back to previous state', async () => {
        // Start - Welcome, auto-transitions to MENU
        await ussdStateMachine.processInput('session1', '');

        // From MENU, go to SUBMENU
        await ussdStateMachine.processInput('session1', '1');

        // Current state should be SUBMENU
        let currentState = await ussdStateMachine.getCurrentState('session1');
        expect(currentState).toBe('SUBMENU');

        // Go back (press 0)
        await ussdStateMachine.processInput('session1', '0');

        // Should be back at MENU
        currentState = await ussdStateMachine.getCurrentState('session1');
        expect(currentState).toBe('MENU');
    });

    test('should maintain state history', async () => {
        // Welcome -> MENU
        await ussdStateMachine.processInput('session1', '');

        // MENU -> SUBMENU
        await ussdStateMachine.processInput('session1', '1');

        // SUBMENU -> DEEP
        await ussdStateMachine.processInput('session1', '1');

        // Verify at DEEP
        let state = await ussdStateMachine.getCurrentState('session1');
        expect(state).toBe('DEEP');

        // Go back to SUBMENU
        await ussdStateMachine.processInput('session1', '0');
        state = await ussdStateMachine.getCurrentState('session1');
        expect(state).toBe('SUBMENU');

        // Go back to MENU
        await ussdStateMachine.processInput('session1', '0');
        state = await ussdStateMachine.getCurrentState('session1');
        expect(state).toBe('MENU');
    });

    test('should not go back when at initial state', async () => {
        // Just at initial state, no transitions yet
        const previousState = await ussdStateMachine.goBack('session1');

        // Should return null as we can't go back further
        expect(previousState).toBeNull();
    });

    test('should disable back navigation when configured', async () => {
        ussdConfig.enableBackNavigation = false;
        const noBackUssd = new USSDStateMachine(ussdConfig);

        await noBackUssd.processInput('session1', '');

        const previousState = await noBackUssd.goBack('session1');
        expect(previousState).toBeNull();
    });
});

describe('USSDStateMachine - Lifecycle Hooks', () => {
    test('should call onStateEnter hook', async () => {
        const onStateEnter = jest.fn();

        const ussd = new USSDStateMachine({
            initialState: 'START',
            states: {
                START: {
                    handler: async () => ({
                        response: 'CON Start',
                        nextState: 'NEXT'
                    })
                },
                NEXT: {
                    handler: async () => ({
                        response: 'END Done'
                    })
                }
            },
            hooks: { onStateEnter }
        });

        await ussd.processInput('session1', '');

        expect(onStateEnter).toHaveBeenCalledWith('NEXT', 'session1');
    });

    test('should call onStateExit hook', async () => {
        const onStateExit = jest.fn();

        const ussd = new USSDStateMachine({
            initialState: 'START',
            states: {
                START: {
                    handler: async () => ({
                        response: 'CON Start',
                        nextState: 'NEXT'
                    })
                },
                NEXT: {
                    handler: async () => ({
                        response: 'END Done'
                    })
                }
            },
            hooks: { onStateExit }
        });

        await ussd.processInput('session1', '');

        expect(onStateExit).toHaveBeenCalledWith('START', 'session1');
    });

    test('should call onError hook on validation error', async () => {
        const onError = jest.fn();

        const ussd = new USSDStateMachine({
            initialState: 'INPUT',
            states: {
                INPUT: {
                    validator: async (input) => {
                        if (input === 'bad') {
                            throw new ValidationError('Invalid input');
                        }
                    },
                    handler: async () => ({
                        response: 'CON Enter:',
                    })
                }
            },
            hooks: { onError }
        });

        await ussd.processInput('session1', 'bad');

        expect(onError).toHaveBeenCalled();
        expect(onError.mock.calls[0][0]).toBeInstanceOf(ValidationError);
        expect(onError.mock.calls[0][1]).toBe('session1');
        expect(onError.mock.calls[0][2]).toBe('INPUT');
    });
});

describe('USSDStateMachine - Configuration Validation', () => {
    test('should throw error if states not provided', () => {
        expect(() => {
            new USSDStateMachine({ initialState: 'START' });
        }).toThrow('States configuration is required');
    });

    test('should throw error if initialState not provided', () => {
        expect(() => {
            new USSDStateMachine({ states: {} });
        }).toThrow('Initial state is required');
    });

    test('should throw error if initialState not in states', () => {
        expect(() => {
            new USSDStateMachine({
                initialState: 'MISSING',
                states: { START: { handler: async () => ({}) } }
            });
        }).toThrow('Initial state "MISSING" not found in states configuration');
    });
});

describe('USSDStateMachine - Session Management', () => {
    let ussd;

    beforeEach(() => {
        ussd = new USSDStateMachine({
            initialState: 'START',
            states: {
                START: {
                    handler: async (input) => ({
                        response: 'CON Enter name:',
                        nextState: 'COLLECT',
                        data: { started: true }
                    })
                },
                COLLECT: {
                    handler: async (input) => ({
                        response: `END Hello, ${input}`,
                        data: { name: input }
                    })
                }
            }
        });
    });

    test('should store and retrieve session data', async () => {
        await ussd.processInput('session1', '');

        const data = await ussd.getSessionData('session1');
        expect(data).toEqual({ started: true });
    });

    test('should set custom session data', async () => {
        await ussd.setSessionData('session1', { custom: 'value' });

        const data = await ussd.getSessionData('session1');
        expect(data).toEqual({ custom: 'value' });
    });

    test('should end session and clean up', async () => {
        await ussd.processInput('session1', '');
        await ussd.endSession('session1');

        const state = await ussd.getCurrentState('session1');
        expect(state).toBeNull();
    });
});
