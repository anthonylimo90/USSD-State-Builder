/**
 * StateBuilder - Fluent builder for defining individual USSD states
 *
 * Provides chainable methods for configuring state behavior including
 * messages, routing, validation, data persistence, and lifecycle hooks.
 */
const RouteBuilder = require('./RouteBuilder');

class StateBuilder {
  /**
   * @param {string} name - State name
   */
  constructor(name) {
    this._name = name;
    this._message = null;
    this._routes = [];
    this._nextState = null;
    this._isEnd = false;
    this._handler = null;
    this._validator = null;
    this._saveKey = null;
    this._onEnterFn = null;
    this._onExitFn = null;
  }

  /**
   * Set a static display message for this state
   * @param {string} text - Message text (no CON/END prefix needed)
   * @returns {StateBuilder} this for chaining
   */
  message(text) {
    this._message = text;
    return this;
  }

  /**
   * Define input-based routing
   * @param {string} input - Input value to match
   * @returns {RouteBuilder} Route builder for this input
   */
  on(input) {
    const route = new RouteBuilder(this, input);
    this._routes.push(route);
    return route;
  }

  /**
   * Set the default next state
   * @param {string} stateName - Target state name
   * @returns {StateBuilder} this for chaining
   */
  next(stateName) {
    this._nextState = stateName;
    return this;
  }

  /**
   * Mark this state as terminal (END prefix)
   * @returns {StateBuilder} this for chaining
   */
  end() {
    this._isEnd = true;
    return this;
  }

  /**
   * Set a custom async handler
   * @param {(input: string, sessionId: string, context: object) => Promise<string|object>} handler
   * @returns {StateBuilder} this for chaining
   */
  run(handler) {
    this._handler = handler;
    return this;
  }

  /**
   * Attach a validator function
   * @param {Function} fn - Validator function (from Validators.* or custom)
   * @returns {StateBuilder} this for chaining
   */
  validate(fn) {
    this._validator = fn;
    return this;
  }

  /**
   * Map input to session data
   * @param {string|Function} keyOrMapper - String key to save input as, or function (input) => object
   * @returns {StateBuilder} this for chaining
   */
  save(keyOrMapper) {
    this._saveKey = keyOrMapper;
    return this;
  }

  /**
   * Lifecycle hook called when entering this state
   * @param {(sessionId: string) => Promise<void>|void} fn
   * @returns {StateBuilder} this for chaining
   */
  onEnter(fn) {
    this._onEnterFn = fn;
    return this;
  }

  /**
   * Lifecycle hook called when exiting this state
   * @param {(sessionId: string) => Promise<void>|void} fn
   * @returns {StateBuilder} this for chaining
   */
  onExit(fn) {
    this._onExitFn = fn;
    return this;
  }
}

module.exports = StateBuilder;
