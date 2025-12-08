const { HealthCheck, GracefulShutdown, HotReloader } = require('../lib/Lifecycle');

describe('HealthCheck', () => {
    describe('Basic health checks', () => {
        test('should return healthy when no components configured', async () => {
            const health = new HealthCheck();
            const result = await health.check();

            expect(result.status).toBe('healthy');
            expect(result.checks.storage.healthy).toBe(true);
            expect(result.checks.stateMachine.healthy).toBe(true);
        });

        test('should check storage health', async () => {
            const mockStorage = {
                isConnected: () => true
            };

            const health = new HealthCheck({ storage: mockStorage });
            const result = await health.check();

            expect(result.checks.storage.healthy).toBe(true);
        });

        test('should detect unhealthy storage', async () => {
            const mockStorage = {
                isConnected: () => false
            };

            const health = new HealthCheck({ storage: mockStorage });
            const result = await health.check();

            expect(result.checks.storage.healthy).toBe(false);
            expect(result.status).toBe('unhealthy');
        });

        test('should check state machine health', async () => {
            const mockStateMachine = {
                states: { WELCOME: {}, MENU: {} },
                initialState: 'WELCOME'
            };

            const health = new HealthCheck({ stateMachine: mockStateMachine });
            const result = await health.check();

            expect(result.checks.stateMachine.healthy).toBe(true);
            expect(result.checks.stateMachine.message).toContain('2 states');
        });
    });

    describe('Custom checks', () => {
        test('should run custom health checks', async () => {
            const health = new HealthCheck();

            health.addCheck('database', async () => ({
                healthy: true,
                message: 'Database connected'
            }));

            const result = await health.check();
            expect(result.checks.database.healthy).toBe(true);
        });

        test('should handle custom check failures', async () => {
            const health = new HealthCheck();

            health.addCheck('external', async () => {
                throw new Error('Connection failed');
            });

            const result = await health.check();
            expect(result.checks.external.healthy).toBe(false);
            expect(result.status).toBe('unhealthy');
        });
    });

    describe('getStatus', () => {
        test('should return simple status', async () => {
            const health = new HealthCheck();
            const status = await health.getStatus();

            expect(status.status).toBe('healthy');
            expect(status.timestamp).toBeDefined();
        });
    });
});

describe('GracefulShutdown', () => {
    describe('Request tracking', () => {
        test('should track pending requests', () => {
            const shutdown = new GracefulShutdown();

            expect(shutdown.pendingRequests).toBe(0);

            shutdown.requestStart();
            expect(shutdown.pendingRequests).toBe(1);

            shutdown.requestStart();
            expect(shutdown.pendingRequests).toBe(2);

            shutdown.requestEnd();
            expect(shutdown.pendingRequests).toBe(1);
        });

        test('should not go below zero', () => {
            const shutdown = new GracefulShutdown();

            shutdown.requestEnd();
            shutdown.requestEnd();

            expect(shutdown.pendingRequests).toBe(0);
        });
    });

    describe('Shutdown state', () => {
        test('should track shutdown state', async () => {
            const shutdown = new GracefulShutdown({ timeout: 100 });

            expect(shutdown.isShutdownInProgress()).toBe(false);

            await shutdown.shutdown();

            expect(shutdown.isShutdownInProgress()).toBe(true);
        });

        test('should only shutdown once', async () => {
            const shutdown = new GracefulShutdown({ timeout: 100 });
            let callCount = 0;

            shutdown.addHandler(async () => { callCount++; });

            await shutdown.shutdown();
            await shutdown.shutdown();

            expect(callCount).toBe(1);
        });
    });

    describe('Handlers', () => {
        test('should call shutdown handlers', async () => {
            const shutdown = new GracefulShutdown({ timeout: 100 });
            let called = false;

            shutdown.addHandler(async () => {
                called = true;
            });

            await shutdown.shutdown();
            expect(called).toBe(true);
        });

        test('should close storage on shutdown', async () => {
            let storageClosed = false;
            const mockStorage = {
                close: async () => { storageClosed = true; }
            };

            const shutdown = new GracefulShutdown({ storage: mockStorage, timeout: 100 });
            await shutdown.shutdown();

            expect(storageClosed).toBe(true);
        });
    });

    describe('Middleware', () => {
        test('should block requests during shutdown', async () => {
            const shutdown = new GracefulShutdown({ timeout: 100 });
            const middleware = shutdown.middleware();

            // Before shutdown
            let context = { response: null, blocked: false };
            await middleware(context, async () => { });
            expect(context.blocked).toBe(false);

            // After shutdown
            shutdown.isShuttingDown = true;
            context = { response: null, blocked: false };
            await middleware(context, async () => { });
            expect(context.blocked).toBe(true);
            expect(context.response).toContain('shutting down');
        });
    });
});

describe('HotReloader', () => {
    let stateMachine;
    let reloader;

    beforeEach(() => {
        stateMachine = {
            states: {
                WELCOME: { handler: () => { } },
                MENU: { handler: () => { } }
            },
            initialState: 'WELCOME'
        };
        reloader = new HotReloader(stateMachine);
    });

    describe('State management', () => {
        test('should add a new state', () => {
            const newState = { handler: () => { } };
            reloader.addState('NEW_STATE', newState);

            expect(stateMachine.states.NEW_STATE).toBe(newState);
            expect(reloader.getStateCount()).toBe(3);
        });

        test('should throw when adding existing state', () => {
            expect(() => {
                reloader.addState('WELCOME', {});
            }).toThrow('already exists');
        });

        test('should update existing state', () => {
            const newHandler = { handler: () => 'updated' };
            reloader.updateState('WELCOME', newHandler);

            expect(stateMachine.states.WELCOME).toBe(newHandler);
        });

        test('should remove a state', () => {
            const removed = reloader.removeState('MENU');

            expect(removed).toBe(true);
            expect(stateMachine.states.MENU).toBeUndefined();
            expect(reloader.getStateCount()).toBe(1);
        });

        test('should not remove initial state', () => {
            expect(() => {
                reloader.removeState('WELCOME');
            }).toThrow('Cannot remove initial state');
        });
    });

    describe('Reload all', () => {
        test('should reload all states', () => {
            const newStates = {
                STATE_A: { handler: () => { } },
                STATE_B: { handler: () => { } }
            };

            reloader.reloadAll(newStates);

            expect(stateMachine.states).toBe(newStates);
            expect(reloader.getStateCount()).toBe(2);
        });

        test('should merge states when specified', () => {
            const additionalStates = {
                NEW_STATE: { handler: () => { } }
            };

            reloader.reloadAll(additionalStates, { merge: true });

            expect(stateMachine.states.WELCOME).toBeDefined();
            expect(stateMachine.states.NEW_STATE).toBeDefined();
            expect(reloader.getStateCount()).toBe(3);
        });
    });

    describe('Initial state', () => {
        test('should change initial state', () => {
            reloader.setInitialState('MENU');
            expect(stateMachine.initialState).toBe('MENU');
        });

        test('should throw for non-existent state', () => {
            expect(() => {
                reloader.setInitialState('NONEXISTENT');
            }).toThrow('does not exist');
        });
    });

    describe('History', () => {
        test('should track reload history', () => {
            reloader.addState('STATE_A', {});
            reloader.updateState('STATE_A', {});
            reloader.removeState('STATE_A');

            const history = reloader.getHistory();
            expect(history).toHaveLength(3);
            expect(history[0].type).toBe('add');
            expect(history[1].type).toBe('update');
            expect(history[2].type).toBe('remove');
        });

        test('should clear history', () => {
            reloader.addState('STATE_A', {});
            reloader.clearHistory();

            expect(reloader.getHistory()).toHaveLength(0);
        });
    });

    describe('Validation', () => {
        test('should validate states', () => {
            const validStates = {
                STATE_A: { handler: () => { } }
            };
            const invalidStates = {
                STATE_B: {}
            };

            expect(reloader.validate(validStates).valid).toBe(true);
            expect(reloader.validate(invalidStates).valid).toBe(false);
        });
    });

    describe('Utilities', () => {
        test('should get state names', () => {
            const names = reloader.getStateNames();
            expect(names).toContain('WELCOME');
            expect(names).toContain('MENU');
        });
    });
});
