/**
 * AppBuilder - Top-level fluent builder for USSD applications
 *
 * Provides a chainable API for defining states, middleware, storage,
 * and configuration. Compiles to a USSDStateMachine instance via build().
 */
const StateBuilder = require('./StateBuilder');
const { compile } = require('./compiler');

class AppBuilder {
  constructor() {
    this._states = new Map();
    this._initialState = null;
    this._storageAdapter = null;
    this._timeoutSeconds = undefined;
    this._middlewares = [];
    this._hooks = {};
    this._backNavigation = undefined;
    this._logger = undefined;
    this._maxInputLength = undefined;
  }

  /**
   * Define a state via callback
   * @param {string} name - State name
   * @param {(stateBuilder: import('./StateBuilder')) => void} configurator - State configurator callback
   * @returns {AppBuilder} this for chaining
   */
  state(name, configurator) {
    const builder = new StateBuilder(name);
    configurator(builder);
    this._states.set(name, builder);
    return this;
  }

  /**
   * Set the initial state
   * @param {string} name - State name to start from
   * @returns {AppBuilder} this for chaining
   */
  start(name) {
    this._initialState = name;
    return this;
  }

  /**
   * Set the storage adapter
   * @param {object} adapter - Storage adapter instance
   * @returns {AppBuilder} this for chaining
   */
  storage(adapter) {
    this._storageAdapter = adapter;
    return this;
  }

  /**
   * Set session timeout
   * @param {number} seconds - Timeout in seconds
   * @returns {AppBuilder} this for chaining
   */
  timeout(seconds) {
    this._timeoutSeconds = seconds;
    return this;
  }

  /**
   * Register middleware
   * @param {string} hook - Middleware hook name
   * @param {Function} fn - Middleware function
   * @returns {AppBuilder} this for chaining
   */
  use(hook, fn) {
    this._middlewares.push({ hook, fn });
    return this;
  }

  /**
   * Set lifecycle hooks
   * @param {object} obj - Hooks object { onStateEnter, onStateExit, onError, ... }
   * @returns {AppBuilder} this for chaining
   */
  hooks(obj) {
    Object.assign(this._hooks, obj);
    return this;
  }

  /**
   * Enable or disable back navigation
   * @param {boolean} [enabled=true] - Whether to enable back navigation
   * @returns {AppBuilder} this for chaining
   */
  backNavigation(enabled) {
    this._backNavigation = enabled !== false;
    return this;
  }

  /**
   * Set custom logger
   * @param {object|null} logger - Logger instance or null to disable
   * @returns {AppBuilder} this for chaining
   */
  logger(logger) {
    this._logger = logger;
    return this;
  }

  /**
   * Set maximum input length
   * @param {number} length - Max input length (0 to disable)
   * @returns {AppBuilder} this for chaining
   */
  maxInputLength(length) {
    this._maxInputLength = length;
    return this;
  }

  /**
   * Compile and return a USSDStateMachine instance
   * @returns {import('../USSDStateMachine')} Configured state machine
   */
  build() {
    return compile(this);
  }
}

module.exports = AppBuilder;
