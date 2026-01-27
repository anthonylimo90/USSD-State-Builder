/**
 * RouteBuilder - Input-to-state routing for a specific input value
 *
 * Created by StateBuilder.on(input) to define what happens when
 * a user provides a specific input in a given state.
 */
class RouteBuilder {
  /**
   * @param {import('./StateBuilder')} parent - Parent StateBuilder
   * @param {string} input - The input value this route handles
   */
  constructor(parent, input) {
    this._parent = parent;
    this._input = input;
    this._target = null;
    this._response = null;
    this._isEnd = false;
  }

  /**
   * Transition to another state when this input is received
   * @param {string} stateName - Target state name
   * @returns {import('./StateBuilder')} Parent StateBuilder for chaining
   */
  goto(stateName) {
    this._target = stateName;
    return this._parent;
  }

  /**
   * Send a response without transitioning (stays in same state)
   * @param {string} text - Response text (CON prefix auto-added)
   * @returns {import('./StateBuilder')} Parent StateBuilder for chaining
   */
  reply(text) {
    this._response = text;
    return this._parent;
  }

  /**
   * Send a terminal response for this route
   * @param {string} [text] - Response text (END prefix auto-added)
   * @returns {import('./StateBuilder')} Parent StateBuilder for chaining
   */
  end(text) {
    this._isEnd = true;
    this._response = text || null;
    return this._parent;
  }
}

module.exports = RouteBuilder;
