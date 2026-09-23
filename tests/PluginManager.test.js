const { PluginManager, createPlugin } = require('../lib/PluginManager');

describe('PluginManager', () => {
    let plugins;

    beforeEach(() => {
        plugins = new PluginManager({ namespace: 'app' });
    });

    const samplePlugin = {
        name: 'balance',
        version: '1.0.0',
        initialState: 'check',
        states: {
            check: {
                handler: async (input, sessionId) => ({
                    response: 'END Balance: KES 1,000',
                })
            }
        }
    };

    test('should register a plugin', () => {
        plugins.register(samplePlugin);
        expect(plugins.has('balance')).toBe(true);
        expect(plugins.size).toBe(1);
    });

    test('should namespace plugin states', () => {
        plugins.register(samplePlugin);
        const states = plugins.getStates();
        expect(states['app_balance_check']).toBeDefined();
    });

    test('should reject duplicate plugins', () => {
        plugins.register(samplePlugin);
        expect(() => plugins.register(samplePlugin)).toThrow('already registered');
    });

    test('should require plugin name', () => {
        expect(() => plugins.register({})).toThrow('must have a name');
    });

    test('should check dependencies', () => {
        expect(() => plugins.register({
            name: 'dependent',
            dependencies: ['missing'],
            states: { s: { handler: async () => ({}) } }
        })).toThrow('missing');
    });

    test('should resolve dependencies', () => {
        plugins.register(samplePlugin);
        plugins.register({
            name: 'transfer',
            dependencies: ['balance'],
            initialState: 'start',
            states: {
                start: { handler: async () => ({ response: 'CON Transfer', nextState: 'check' }) }
            }
        });
        expect(plugins.size).toBe(2);
    });

    test('should unregister a plugin', () => {
        plugins.register(samplePlugin);
        const result = plugins.unregister('balance');
        expect(result).toBe(true);
        expect(plugins.has('balance')).toBe(false);
    });

    test('should prevent unregistering plugins with dependents', () => {
        plugins.register(samplePlugin);
        plugins.register({
            name: 'dependent',
            dependencies: ['balance'],
            states: { s: { handler: async () => ({}) } }
        });
        expect(() => plugins.unregister('balance')).toThrow('depends on it');
    });

    test('should get plugin entry state', () => {
        plugins.register(samplePlugin);
        expect(plugins.getPluginEntryState('balance')).toBe('app_balance_check');
    });

    test('should list plugins', () => {
        plugins.register(samplePlugin);
        const list = plugins.list();
        expect(list.length).toBe(1);
        expect(list[0].name).toBe('balance');
        expect(list[0].stateCount).toBe(1);
    });

    test('should remap nextState references', async () => {
        const plugin = {
            name: 'flow',
            initialState: 'step1',
            states: {
                step1: {
                    handler: async () => ({ response: 'CON Step 1', nextState: 'step2' })
                },
                step2: {
                    handler: async () => ({ response: 'END Done' })
                }
            }
        };

        plugins.register(plugin);
        const states = plugins.getStates();

        // Handler should remap nextState
        const result = await states['app_flow_step1'].handler('', 'sid', {});
        expect(result.nextState).toBe('app_flow_step2');
    });

    test('should detect conflicts in strict mode', () => {
        const strictPlugins = new PluginManager({ namespace: 'app', strict: true });
        strictPlugins.register(samplePlugin);

        // Register another plugin that would create the same state name
        const conflicting = { ...samplePlugin, name: 'balance' };
        expect(() => strictPlugins.register(conflicting)).toThrow('already registered');
    });
});

describe('createPlugin', () => {
    test('should create a valid plugin definition', () => {
        const plugin = createPlugin({
            name: 'test-plugin',
            states: {
                main: { handler: async () => ({ response: 'END Hello' }) }
            }
        });

        expect(plugin.name).toBe('test-plugin');
        expect(plugin.version).toBe('1.0.0');
        expect(plugin.initialState).toBe('main');
    });

    test('should require name and states', () => {
        expect(() => createPlugin({})).toThrow('must have a name');
        expect(() => createPlugin({ name: 'test' })).toThrow('at least one state');
    });
});
