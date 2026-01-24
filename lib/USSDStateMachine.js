const ValidationError = require('./ValidationError');
const { MiddlewareManager } = require('./Middleware');
const { debuggers } = require('./Debug');
const { StateNotFoundError, ResponseFormatError } = require('./Errors');

const debug = debuggers.state;

/**
 * USSD State Machine
 *
 * A flexible state machine for building USSD applications.
 * Supports back navigation, lifecycle hooks, middleware, and pluggable storage.
 */
class USSDStateMachine {
  /**
   * Create a new USSD State Machine
   * @param {Object} config - Configuration object
   * @param {string} config.initialState - The initial state when a new session starts
   * @param {number} [config.timeout=300] - Session timeout in seconds
   * @param {Object} config.states - Map of state names to state configurations
   * @param {Object} [config.storage] - Custom storage adapter (default: InMemoryStorage)
   * @param {boolean} [config.enableBackNavigation=true] - Enable back navigation support
   * @param {Object} [config.hooks] - Lifecycle hooks
   * @param {MiddlewareManager} [config.middleware] - Middleware manager instance
   * @param {Object} [config.logger] - Custom logger (default: console). Must have error() method.
   *   Set to null to disable logging. Useful for production environments where you want
   *   to integrate with your own logging infrastructure (e.g., Winston, Pino, Bunyan).
   * @param {number} [config.maxInputLength=160] - Maximum allowed input length. Set to 0 to disable.
   *   USSD typically supports ~160-180 characters per message.
   */
  constructor(config) {
    this.states = config.states;
    this.initialState = config.initialState;
    this.timeout = config.timeout || 300; // Default timeout of 5 minutes
    this.storage = config.storage || new (require('./InMemoryStorage'))();
    this.enableBackNavigation = config.enableBackNavigation !== false;
    this.hooks = config.hooks || {};
    this.middleware = config.middleware || new MiddlewareManager();
    this.logger = config.logger !== undefined ? config.logger : console;
    this.maxInputLength = config.maxInputLength !== undefined ? config.maxInputLength : 160;

    // Session initialization locks to prevent race conditions
    this._sessionLocks = new Map();

    // Validate configuration
    this._validateConfig();
  }

  /**
   * Register middleware
   * @param {string|Function} hook - Hook name or middleware function
   * @param {Function} [fn] - Middleware function (if hook is string)
   * @returns {USSDStateMachine} this for chaining
   */
  use(hook, fn) {
    this.middleware.use(hook, fn);
    return this;
  }

  /**
   * Validate the state machine configuration
   * @private
   */
  _validateConfig() {
    if (!this.states) {
      throw new Error('States configuration is required');
    }
    if (!this.initialState) {
      throw new Error('Initial state is required');
    }
    if (!this.states[this.initialState]) {
      throw new Error(`Initial state "${this.initialState}" not found in states configuration`);
    }
  }

  /**
   * Acquire a lock for session initialization to prevent race conditions.
   * Uses a simple mutex pattern - waits for any existing lock, then creates a new one.
   * @private
   * @param {string} sessionId - Session identifier
   * @returns {Promise<void>}
   */
  async _acquireSessionLock(sessionId) {
    // Wait for any existing lock to be released
    while (this._sessionLocks.has(sessionId)) {
      const lockData = this._sessionLocks.get(sessionId);
      if (lockData && lockData.promise) {
        await lockData.promise;
      } else {
        break;
      }
    }

    // Create a new lock that other requests will wait on
    let releaseLock;
    const lockPromise = new Promise(resolve => {
      releaseLock = resolve;
    });
    this._sessionLocks.set(sessionId, { promise: lockPromise, release: releaseLock });
    // Don't await the lock - the caller now holds it
  }

  /**
   * Release a session lock
   * @private
   * @param {string} sessionId - Session identifier
   */
  _releaseSessionLock(sessionId) {
    const lockData = this._sessionLocks.get(sessionId);
    if (lockData) {
      this._sessionLocks.delete(sessionId);
      if (lockData.release) {
        lockData.release();
      }
    }
  }

  /**
   * Process user input and return the appropriate response
   * @param {string} sessionId - Unique session identifier
   * @param {string} input - User input string
   * @param {Object} [options] - Processing options
   * @param {string} [options.language] - Language preference
   * @returns {Promise<string>} USSD response string
   */
  async processInput(sessionId, input, options = {}) {
    // Acquire lock for new session initialization to prevent race conditions
    let existingState = await this.storage.getState(sessionId);
    let hasLock = false;

    if (!existingState) {
      // New session - acquire lock to prevent race condition
      await this._acquireSessionLock(sessionId);
      hasLock = true;

      // Double-check after acquiring lock (another request may have initialized)
      existingState = await this.storage.getState(sessionId);
    }

    try {
      // Validate input length
      if (this.maxInputLength > 0 && input && input.length > this.maxInputLength) {
        throw new ValidationError(
          `Input too long. Maximum ${this.maxInputLength} characters allowed.`,
          'input',
          input.substring(0, 50) + '...'
        );
      }

      const currentState = existingState || this.initialState;
      const stateConfig = this.states[currentState];

      debug('processInput', { sessionId, input, currentState, options });

      if (!stateConfig) {
        debug('invalid state', { currentState });
        throw new Error(`Invalid state: ${currentState}`);
      }

      // Build middleware context
      const session = await this.storage.getSession ? await this.storage.getSession(sessionId) : null;
      const middlewareContext = {
        sessionId,
        input,
        currentState,
        sessionData: await this.storage.getData(sessionId),
        sessionExpiresAt: session?.expiresAt || (Date.now() + this.timeout * 1000),
        metadata: options,
        response: null,
        nextState: null,
        blocked: false
      };

      // Execute beforeProcess middleware
      debug('executing beforeProcess middleware', { sessionId });
      await this.middleware.execute('beforeProcess', middlewareContext);

      // Check if middleware blocked the request
      if (middlewareContext.blocked) {
        debug('request blocked by middleware', { sessionId, response: middlewareContext.response });
        return middlewareContext.response;
      }

      // Use potentially modified input from middleware
      input = middlewareContext.input;

      try {
        // Handle back navigation
        if (this.enableBackNavigation && input === '0') {
          debug('back navigation requested', { sessionId, currentState });
          const previousState = await this.goBack(sessionId);
          if (previousState) {
            debug('navigating back', { sessionId, from: currentState, to: previousState });
            // Re-enter the previous state with empty input to show its menu
            const prevStateConfig = this.states[previousState];
            if (prevStateConfig) {
              // Call onStateEnter hook
              await this._callHook('onStateEnter', previousState, sessionId);

              const result = await prevStateConfig.handler('', sessionId, {
                sessionData: await this.storage.getData(sessionId),
                previousState: currentState,
                language: options.language
              });
              // Validate response format
              this._validateResponseFormat(result.response, previousState);
              return result.response;
            }
          }
        }

        // Validate input if a validator is provided
        if (stateConfig.validator) {
          await stateConfig.validator(input);
        }

        // Build context for handler (consistent structure for all handlers)
        const context = {
          sessionData: await this.storage.getData(sessionId),
          previousState: null, // Set when navigating back, null for forward navigation
          language: options.language
        };

        // Process the input
        const result = await stateConfig.handler(input, sessionId, context);

        // Handle state transition
        if (result.nextState) {
          // Validate that nextState exists (skip validation for terminal responses)
          const isTerminalResponse = result.response && result.response.startsWith('END ');
          if (!isTerminalResponse && !this.states[result.nextState]) {
            throw new StateNotFoundError(result.nextState, currentState);
          }

          debug('state transition', { sessionId, from: currentState, to: result.nextState });

          // Call onStateExit hook for current state
          await this._callHook('onStateExit', currentState, sessionId);

          // Store current state in history for back navigation
          if (this.enableBackNavigation && this.storage.pushStateHistory) {
            await this.storage.pushStateHistory(sessionId, currentState);
          }

          // Update to new state
          await this.storage.setState(sessionId, result.nextState, this.timeout);

          // Call onStateEnter hook for new state
          await this._callHook('onStateEnter', result.nextState, sessionId);
        } else if (result.previousState && this.enableBackNavigation) {
          // Handle explicit back navigation request from handler
          await this.goBack(sessionId);
        }

        // Store any data if provided
        if (result.data) {
          await this.storage.setData(sessionId, result.data, this.timeout);
        }

        // Validate response format
        this._validateResponseFormat(result.response, currentState);

        // Update middleware context with response
        middlewareContext.response = result.response;
        middlewareContext.nextState = result.nextState;

        // Execute afterProcess middleware
        debug('executing afterProcess middleware', { sessionId });
        await this.middleware.execute('afterProcess', middlewareContext);

        debug('returning response', { sessionId, responseLength: middlewareContext.response?.length });
        return middlewareContext.response;
      } catch (error) {
        debug('error occurred', { sessionId, currentState, error: error.message, type: error.constructor.name });

        // Call onError hook
        await this._callHook('onError', error, sessionId, currentState);

        // Execute onError middleware
        middlewareContext.error = error;
        await this.middleware.execute('onError', middlewareContext);

        if (error instanceof ValidationError) {
          debug('validation error', { sessionId, message: error.message });
          return `CON ${error.message}\nPlease try again.`;
        }
        throw error;
      }
    } finally {
      // Always release lock if we acquired one
      if (hasLock) {
        this._releaseSessionLock(sessionId);
      }
    }
  }

  /**
   * Navigate to the previous state
   * @param {string} sessionId - Unique session identifier
   * @returns {Promise<string|null>} Previous state name or null
   */
  async goBack(sessionId) {
    if (!this.enableBackNavigation || !this.storage.popStateHistory) {
      return null;
    }

    const previousState = await this.storage.popStateHistory(sessionId);
    if (previousState) {
      await this.storage.setState(sessionId, previousState, this.timeout);
      return previousState;
    }
    return null;
  }

  /**
   * Get session data for a given session ID
   * @param {string} sessionId - Unique session identifier
   * @returns {Promise<Object|null>} Session data object or null
   */
  async getSessionData(sessionId) {
    return this.storage.getData(sessionId);
  }

  /**
   * Set session data
   * @param {string} sessionId - Unique session identifier
   * @param {Object} data - Data to store
   */
  async setSessionData(sessionId, data) {
    await this.storage.setData(sessionId, data, this.timeout);
  }

  /**
   * End a session and clean up
   * @param {string} sessionId - Unique session identifier
   */
  async endSession(sessionId) {
    if (this.storage.deleteSession) {
      await this.storage.deleteSession(sessionId);
    }
  }

  /**
   * Get the current state for a session
   * @param {string} sessionId - Unique session identifier
   * @returns {Promise<string|null>} Current state or null
   */
  async getCurrentState(sessionId) {
    return this.storage.getState(sessionId);
  }

  /**
   * Check if a session exists and is active
   * @param {string} sessionId - Unique session identifier
   * @returns {Promise<boolean>} True if session exists and is active
   */
  async isSessionActive(sessionId) {
    const state = await this.storage.getState(sessionId);
    return state !== null && state !== undefined;
  }

  /**
   * Validate that a response has the correct USSD format
   * @private
   * @param {string} response - Response to validate
   * @param {string} state - State that generated the response
   * @throws {ResponseFormatError} If response format is invalid
   */
  _validateResponseFormat(response, state) {
    if (!response || typeof response !== 'string') {
      throw new ResponseFormatError(response, state);
    }
    if (!response.startsWith('CON ') && !response.startsWith('END ')) {
      throw new ResponseFormatError(response, state);
    }
  }

  /**
   * Call a lifecycle hook if it exists
   * @private
   */
  async _callHook(hookName, ...args) {
    if (this.hooks[hookName]) {
      try {
        await this.hooks[hookName](...args);
      } catch (error) {
        if (this.logger && typeof this.logger.error === 'function') {
          this.logger.error(`Error in ${hookName} hook:`, error);
        }
      }
    }
  }
}

module.exports = USSDStateMachine;