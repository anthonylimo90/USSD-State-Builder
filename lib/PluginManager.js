/**
 * Plugin Manager - Reusable flow plugin system
 *
 * Enables packaging and sharing reusable USSD flows (e.g., airtime purchase,
 * balance check, PIN change) as installable plugins. Supports plugin
 * registration, dependency resolution, and namespace isolation.
 */

/**
 * Manages USSD flow plugins
 */
class PluginManager {
    /**
     * Create a new PluginManager
     * @param {Object} [options] - Manager options
     * @param {string} [options.namespace=''] - Default namespace prefix for plugin states
     * @param {boolean} [options.strict=false] - Strict mode: error on conflicts instead of warning
     * @param {Function} [options.logger=console.warn] - Logger for warnings
     *
     * @example
     * const plugins = new PluginManager({ namespace: 'app' });
     * plugins.register(airtimePlugin);
     * plugins.register(balancePlugin);
     * const states = plugins.getStates();
     */
    constructor(options = {}) {
        this.namespace = options.namespace || '';
        this.strict = options.strict || false;
        this.logger = options.logger !== undefined ? options.logger : console.warn;

        this._plugins = new Map();
        this._states = new Map();
        this._hooks = [];
        this._middlewares = [];
    }

    /**
     * Register a plugin
     * @param {Object} plugin - Plugin definition
     * @param {string} plugin.name - Plugin name (unique identifier)
     * @param {string} [plugin.version='1.0.0'] - Plugin version
     * @param {string} [plugin.description] - Plugin description
     * @param {string[]} [plugin.dependencies=[]] - Required plugin names
     * @param {Object} plugin.states - State definitions (name -> config)
     * @param {string} plugin.initialState - Entry point state for the plugin
     * @param {Function} [plugin.install] - Installation hook (called with plugin manager)
     * @param {Object[]} [plugin.middleware] - Middleware to register
     * @param {Object} [plugin.hooks] - Lifecycle hooks
     * @param {Object} [options] - Registration options
     * @param {string} [options.namespace] - Override namespace for this plugin
     * @param {Object} [options.config] - Plugin-specific configuration
     * @returns {PluginManager} this for chaining
     *
     * @example
     * plugins.register({
     *   name: 'airtime-purchase',
     *   version: '1.0.0',
     *   initialState: 'select_network',
     *   states: {
     *     select_network: {
     *       handler: async (input, sessionId, ctx) => ({
     *         response: 'CON Select network:\n1. Safaricom\n2. Airtel',
     *         nextState: 'enter_amount'
     *       })
     *     },
     *     enter_amount: { ... },
     *     confirm: { ... }
     *   }
     * });
     */
    register(plugin, options = {}) {
        if (!plugin || !plugin.name) {
            throw new Error('Plugin must have a name');
        }

        if (this._plugins.has(plugin.name)) {
            throw new Error(`Plugin "${plugin.name}" is already registered`);
        }

        // Check dependencies
        if (plugin.dependencies) {
            for (const dep of plugin.dependencies) {
                if (!this._plugins.has(dep)) {
                    throw new Error(`Plugin "${plugin.name}" requires "${dep}" which is not registered`);
                }
            }
        }

        // Determine namespace
        const ns = options.namespace || this.namespace;
        const prefix = ns ? `${ns}_${plugin.name}_` : `${plugin.name}_`;

        // Register states with namespace prefix
        const namespacedStates = {};
        const stateMapping = {};

        if (plugin.states) {
            for (const [stateName, stateConfig] of Object.entries(plugin.states)) {
                const fullName = `${prefix}${stateName}`;
                stateMapping[stateName] = fullName;

                // Check for conflicts
                if (this._states.has(fullName)) {
                    const msg = `State name conflict: "${fullName}" already exists`;
                    if (this.strict) {
                        throw new Error(msg);
                    }
                    if (this.logger) {
                        this.logger(msg);
                    }
                }

                // Wrap handler to remap state references
                const wrappedConfig = { ...stateConfig };
                if (stateConfig.handler) {
                    const originalHandler = stateConfig.handler;
                    wrappedConfig.handler = async (input, sessionId, context) => {
                        const result = await originalHandler(input, sessionId, {
                            ...context,
                            pluginName: plugin.name,
                            pluginConfig: options.config || {}
                        });

                        // Remap nextState if it matches a plugin state
                        if (result && result.nextState && stateMapping[result.nextState]) {
                            result.nextState = stateMapping[result.nextState];
                        }

                        return result;
                    };
                }

                namespacedStates[fullName] = wrappedConfig;
                this._states.set(fullName, wrappedConfig);
            }
        }

        // Register hooks
        if (plugin.hooks) {
            this._hooks.push({
                pluginName: plugin.name,
                hooks: plugin.hooks
            });
        }

        // Register middleware
        if (plugin.middleware) {
            for (const mw of plugin.middleware) {
                this._middlewares.push({
                    pluginName: plugin.name,
                    ...mw
                });
            }
        }

        // Run install hook
        if (plugin.install) {
            plugin.install(this, options.config || {});
        }

        // Store plugin info
        this._plugins.set(plugin.name, {
            ...plugin,
            namespacedStates,
            stateMapping,
            namespace: prefix,
            initialState: plugin.initialState ? `${prefix}${plugin.initialState}` : null,
            installedAt: Date.now()
        });

        return this;
    }

    /**
     * Unregister a plugin
     * @param {string} name - Plugin name
     * @returns {boolean} Whether the plugin was removed
     */
    unregister(name) {
        const plugin = this._plugins.get(name);
        if (!plugin) return false;

        // Check if other plugins depend on this one
        for (const [otherName, otherPlugin] of this._plugins) {
            if (otherName === name) continue;
            if (otherPlugin.dependencies && otherPlugin.dependencies.includes(name)) {
                throw new Error(`Cannot unregister "${name}": "${otherName}" depends on it`);
            }
        }

        // Remove states
        for (const stateName of Object.keys(plugin.namespacedStates)) {
            this._states.delete(stateName);
        }

        // Remove hooks and middleware
        this._hooks = this._hooks.filter(h => h.pluginName !== name);
        this._middlewares = this._middlewares.filter(m => m.pluginName !== name);

        this._plugins.delete(name);
        return true;
    }

    /**
     * Get all registered states from all plugins
     * @returns {Object} Combined state map
     */
    getStates() {
        const states = {};
        for (const [name, config] of this._states) {
            states[name] = config;
        }
        return states;
    }

    /**
     * Get the entry state for a plugin
     * @param {string} pluginName - Plugin name
     * @returns {string|null} Namespaced initial state name
     */
    getPluginEntryState(pluginName) {
        const plugin = this._plugins.get(pluginName);
        return plugin ? plugin.initialState : null;
    }

    /**
     * Get all registered hooks
     * @returns {Object} Merged hooks from all plugins
     */
    getHooks() {
        const merged = {};
        for (const { hooks } of this._hooks) {
            for (const [hookName, hookFn] of Object.entries(hooks)) {
                if (!merged[hookName]) {
                    merged[hookName] = [];
                }
                merged[hookName].push(hookFn);
            }
        }

        // Combine multiple hooks into single functions
        const combined = {};
        for (const [hookName, fns] of Object.entries(merged)) {
            combined[hookName] = async (...args) => {
                for (const fn of fns) {
                    await fn(...args);
                }
            };
        }

        return combined;
    }

    /**
     * Get all registered middlewares
     * @returns {Object[]} Array of middleware configs
     */
    getMiddlewares() {
        return [...this._middlewares];
    }

    /**
     * Apply all plugins to an AppBuilder or state machine config
     * @param {Object} target - AppBuilder instance or config object
     * @returns {Object} Modified target
     *
     * @example
     * const app = createApp();
     * plugins.applyTo(app);
     * // Plugin states are now available in the app
     */
    applyTo(target) {
        const states = this.getStates();

        // If target is an AppBuilder-like object with state()
        if (typeof target.state === 'function') {
            // Can't directly inject pre-compiled states into AppBuilder
            // Instead, return the states for manual integration
            return states;
        }

        // If target is a config object
        if (target.states) {
            Object.assign(target.states, states);
        }

        // Apply hooks
        const hooks = this.getHooks();
        if (target.hooks) {
            Object.assign(target.hooks, hooks);
        }

        return target;
    }

    /**
     * List all registered plugins
     * @returns {Object[]} Array of plugin info
     */
    list() {
        const plugins = [];
        for (const [name, plugin] of this._plugins) {
            plugins.push({
                name,
                version: plugin.version || '1.0.0',
                description: plugin.description || '',
                stateCount: Object.keys(plugin.namespacedStates).length,
                initialState: plugin.initialState,
                dependencies: plugin.dependencies || [],
                installedAt: new Date(plugin.installedAt).toISOString()
            });
        }
        return plugins;
    }

    /**
     * Check if a plugin is registered
     * @param {string} name - Plugin name
     * @returns {boolean}
     */
    has(name) {
        return this._plugins.has(name);
    }

    /**
     * Get plugin count
     * @returns {number}
     */
    get size() {
        return this._plugins.size;
    }
}

/**
 * Helper to create a plugin definition
 * @param {Object} config - Plugin configuration
 * @returns {Object} Plugin definition
 *
 * @example
 * const myPlugin = createPlugin({
 *   name: 'balance-check',
 *   version: '1.0.0',
 *   initialState: 'check',
 *   states: {
 *     check: {
 *       handler: async (input, sessionId) => ({
 *         response: 'END Your balance is KES 1,234.00',
 *       })
 *     }
 *   }
 * });
 */
function createPlugin(config) {
    if (!config.name) {
        throw new Error('Plugin must have a name');
    }
    if (!config.states || Object.keys(config.states).length === 0) {
        throw new Error('Plugin must define at least one state');
    }

    return {
        name: config.name,
        version: config.version || '1.0.0',
        description: config.description || '',
        dependencies: config.dependencies || [],
        states: config.states,
        initialState: config.initialState || Object.keys(config.states)[0],
        install: config.install || null,
        middleware: config.middleware || [],
        hooks: config.hooks || {}
    };
}

module.exports = { PluginManager, createPlugin };
