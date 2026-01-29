/**
 * StateBuilder - Fluent builder for defining individual USSD states
 *
 * Provides chainable methods for configuring state behavior including
 * messages, routing, validation, data persistence, and lifecycle hooks.
 */
const RouteBuilder = require('./RouteBuilder');
const { DynamicMenu } = require('./DynamicMenuBuilder');

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
    this._menuItems = null; // For menu() method
  }

  /**
   * Create a numbered menu from title and items
   * Auto-generates message and routes for each item
   * @param {string} title - Menu title/header
   * @param {Array<{key: string, label: string, goto?: string, end?: string, reply?: string}>} items - Menu items
   * @returns {StateBuilder} this for chaining
   */
  menu(title, items) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Menu items must be a non-empty array');
    }

    // Build message from title and items
    const lines = [title];
    const validKeys = [];

    for (const item of items) {
      if (!item.key || !item.label) {
        throw new Error('Each menu item must have a key and label');
      }
      lines.push(`${item.key}. ${item.label}`);
      validKeys.push(item.key);

      // Create route for this item
      const route = new RouteBuilder(this, item.key);
      if (item.goto) {
        route._target = item.goto;
      } else if (item.end !== undefined) {
        route._isEnd = true;
        route._response = item.end || null;
      } else if (item.reply !== undefined) {
        route._response = item.reply;
      }
      this._routes.push(route);
    }

    this._message = lines.join('\n');
    this._menuItems = { validKeys };

    return this;
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

  /**
   * Configure a dynamic menu that fetches items at runtime
   * @param {(sessionId: string, context: object) => Promise<Array>} fetcher - Async function returning array of items
   * @param {Object} [options] - Configuration options
   * @param {(item: any, index: number) => string} [options.format] - Item formatter function
   * @param {(item: any) => any} [options.value] - Value extractor function
   * @param {string} [options.header] - Menu header text
   * @param {number} [options.pageSize] - Items per page (enables pagination)
   * @param {string} [options.moreKey='99'] - Key to show more items
   * @param {string} [options.backKey='98'] - Key for previous page
   * @param {string} [options.moreLabel='More'] - Label for more option
   * @param {string} [options.backLabel='Back'] - Label for back option
   * @param {Object} [options.empty] - Empty data configuration
   * @param {string} [options.empty.message] - Message when no items
   * @param {'end'|'continue'} [options.empty.action] - Session action on empty
   * @param {Function} [options.onError] - Error handler function
   * @param {number} [options.maxItems] - Maximum items to store in session (prevents memory issues)
   * @param {Object} [options.refresh] - Refresh configuration
   * @param {string} [options.refresh.key='0'] - Key to trigger refresh
   * @param {string} [options.refresh.label='Refresh'] - Label for refresh option
   * @returns {StateBuilder} this for chaining
   */
  dynamicMenu(fetcher, options = {}) {
    let builder = DynamicMenu.from(fetcher);

    if (options.format) {
      builder = builder.format(options.format);
    }
    if (options.value) {
      builder = builder.value(options.value);
    }
    if (options.header) {
      builder = builder.header(options.header);
    }
    if (options.pageSize) {
      const paginationOpts = { pageSize: options.pageSize };
      if (options.moreKey !== undefined) paginationOpts.moreKey = options.moreKey;
      if (options.backKey !== undefined) paginationOpts.backKey = options.backKey;
      if (options.moreLabel !== undefined) paginationOpts.moreLabel = options.moreLabel;
      if (options.backLabel !== undefined) paginationOpts.backLabel = options.backLabel;
      builder = builder.paginated(paginationOpts);
    }
    if (options.empty) {
      builder = builder.onEmpty(options.empty.message, options.empty.action);
    }
    if (options.onError) {
      builder = builder.onError(options.onError);
    }
    if (options.maxItems) {
      builder = builder.maxItems(options.maxItems);
    }
    if (options.refresh) {
      builder = builder.refreshable(options.refresh);
    }

    this._handler = builder.build();
    return this;
  }
}

module.exports = StateBuilder;
