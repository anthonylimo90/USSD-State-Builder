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
   * @param {string} [config.hookErrorStrategy='log'] - How to handle lifecycle hook errors.
   *   'log' - Log errors silently (default), 'throw' - Propagate errors to caller,
   *   'callback' - Call config.onHookError(hookName, error) if provided.
   * @param {Function} [config.onHookError] - Callback for hook errors when hookErrorStrategy is 'callback'.
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
    this.hookErrorStrategy = config.hookErrorStrategy || 'log';
    this.onHookError = config.onHookError || null;

    // Per-session locks serialize processing within this process.
    this._sessionLocks = new Map();
    this._turnObservers = [];

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

  /** Register an observer called once after each complete processInput turn. */
  useTurnObserver(observer) {
    if (typeof observer !== 'function') throw new TypeError('Turn observer must be a function');
    this._turnObservers.push(observer);
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
   * Acquire a lock for a complete session request to prevent race conditions.
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
    const startedAt = Date.now();
    const observation = { currentState: 'unknown', outcome: 'success' };
    let acquired = false;

    try {
      await this._acquireSessionLock(sessionId);
      acquired = true;
      const run = () => this._processInputUnlocked(sessionId, input, options, observation);
      const response = this.storage.withSessionLock
        ? await this.storage.withSessionLock(sessionId, run)
        : await run();
      return response;
    } catch (error) {
      observation.outcome = error instanceof ValidationError ? 'validation_error' : 'error';
      throw error;
    } finally {
      if (acquired) this._releaseSessionLock(sessionId);
      for (const observer of this._turnObservers) {
        try {
          observer({
            currentState: observation.currentState,
            outcome: observation.outcome,
            durationMs: Date.now() - startedAt
          });
        } catch (error) {
          this.logger?.error?.('Error recording turn metrics:', error);
        }
      }
    }
  }

  async _processInputUnlocked(sessionId, input, options, observation) {
    const existingState = await this.storage.getState(sessionId);
    const existingData = await this.storage.getData(sessionId);
    // Validate input length
    if (this.maxInputLength > 0 && input && input.length > this.maxInputLength) {
      throw new ValidationError(
        `Input too long. Maximum ${this.maxInputLength} characters allowed.`,
        'input',
        input.substring(0, 50) + '...'
      );
    }

    const currentState = existingState || this.initialState;
    observation.currentState = currentState;
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
      sessionData: existingData,
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
      observation.outcome = 'blocked';
      debug('request blocked by middleware', { sessionId, response: middlewareContext.response });
      return middlewareContext.response;
    }
    if (existingData?.__ussdLifecycle?.completedResponse) {
      observation.outcome = 'replay';
      return existingData.__ussdLifecycle.completedResponse;
    }

    // Use potentially modified input from middleware
    input = middlewareContext.input;

    try {
      // Handle back navigation
      // Note: Validators are intentionally NOT called during back navigation because
      // the previous state is re-entered with empty input to display its menu.
      // Validators are designed to check user-submitted input, not menu rendering.
      if (this.enableBackNavigation && input === '0' && !stateConfig.localInputKeys?.includes('0')) {
        debug('back navigation requested', { sessionId, currentState });
        const previousState = await this.goBack(sessionId);
        if (previousState) {
          debug('navigating back', { sessionId, from: currentState, to: previousState });
          // Re-enter the previous state with empty input to show its menu
          const prevStateConfig = this.states[previousState];
          if (prevStateConfig) {
            const result = await prevStateConfig.handler('', sessionId, {
              sessionData: await this.storage.getData(sessionId),
              previousState: currentState,
              language: options.language,
              currentState: previousState,
              isReentry: true
            });
            // Validate response format
            this._validateResponseFormat(result.response, previousState);
            if (result.data) {
              await this.storage.setData(sessionId, result.data, this.timeout);
            }
            middlewareContext.response = result.response;
            middlewareContext.nextState = previousState;
            await this.middleware.execute('afterProcess', middlewareContext);
            this._validateResponseFormat(middlewareContext.response, previousState);
            if (middlewareContext.response.startsWith('END ')) {
              await this._recordCompletion(sessionId, middlewareContext.response);
            }
            await this._notifyStateTransition(currentState, previousState, sessionId, middlewareContext);
            if (middlewareContext.response.startsWith('END ')) {
              await this._notifyLifecycle('onSessionEnd', { ...middlewareContext, reason: 'completed' });
            }
            return middlewareContext.response;
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
        language: options.language,
        currentState
      };

      // Process the input
      const result = await stateConfig.handler(input, sessionId, context);
      this._validateResponseFormat(result.response, currentState);

      // Handle state transition
      const isTerminalResponse = result.response && result.response.startsWith('END ');
      let transitionedTo = null;
      if (result.nextState && (!isTerminalResponse || this.states[result.nextState])) {
        if (!this.states[result.nextState]) {
          throw new StateNotFoundError(result.nextState, currentState);
        }

        debug('state transition', { sessionId, from: currentState, to: result.nextState });

        // Store current state in history for back navigation
        if (result.nextState !== currentState && this.enableBackNavigation && this.storage.pushStateHistory) {
          await this.storage.pushStateHistory(sessionId, currentState);
        }

        // Update to new state
        await this.storage.setState(sessionId, result.nextState, this.timeout);
        if (result.nextState !== currentState) transitionedTo = result.nextState;
      } else if (result.previousState && this.enableBackNavigation) {
        // Handle explicit back navigation request from handler
        transitionedTo = await this.goBack(sessionId);
      } else {
        // Static initial screens and same-state replies are active sessions too.
        await this.storage.setState(sessionId, currentState, this.timeout);
      }

      // Store any data if provided
      if (result.data) {
        await this.storage.setData(sessionId, result.data, this.timeout);
      }

      // Update middleware context with response
      middlewareContext.response = result.response;
      middlewareContext.nextState = result.nextState;

      // Execute afterProcess middleware
      debug('executing afterProcess middleware', { sessionId });
      await this.middleware.execute('afterProcess', middlewareContext);
      this._validateResponseFormat(middlewareContext.response, currentState);
      if (middlewareContext.response.startsWith('END ')) {
        await this._recordCompletion(sessionId, middlewareContext.response);
      }

      if (!existingState) {
        await this._notifyLifecycle('onSessionStart', { ...middlewareContext, reason: 'started' });
        await this._notifyStateEnter(currentState, sessionId);
      }
      if (transitionedTo) {
        await this._notifyStateTransition(currentState, transitionedTo, sessionId, middlewareContext);
      }
      if (middlewareContext.response.startsWith('END ')) {
        await this._notifyLifecycle('onSessionEnd', { ...middlewareContext, reason: 'completed' });
      }

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
        observation.outcome = 'validation_error';
        debug('validation error', { sessionId, message: error.message });
        await this.storage.setState(sessionId, currentState, this.timeout);
        if (!existingState) {
          await this._notifyLifecycle('onSessionStart', { ...middlewareContext, reason: 'started' });
          await this._notifyStateEnter(currentState, sessionId);
        }
        return `CON ${error.message}\nPlease try again.`;
      }
      throw error;
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
    await this._acquireSessionLock(sessionId);
    try {
      const run = async () => {
        const state = await this.storage.getState(sessionId);
        const data = await this.storage.getData(sessionId);
        if (!state && data == null) return;
        if (this.storage.deleteSession) await this.storage.deleteSession(sessionId);
        if (!data?.__ussdLifecycle?.completedResponse) {
          await this._notifyLifecycle('onSessionEnd', {
            sessionId, currentState: state || this.initialState, nextState: null,
            sessionData: data, reason: 'explicit'
          });
        }
      };
      if (this.storage.withSessionLock) {
        await this.storage.withSessionLock(sessionId, run);
      } else {
        await run();
      }
    } finally {
      this._releaseSessionLock(sessionId);
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
    if (state === null || state === undefined) return false;
    const data = await this.storage.getData(sessionId);
    return !data?.__ussdLifecycle?.completedResponse;
  }

  async _notifyLifecycle(hookName, context) {
    await this._notifyCallback(hookName, () => this.middleware.execute(hookName, context));
  }

  async _notifyStateEnter(state, sessionId) {
    await this._notifyCallback('state.onEnter', this.states[state]?.onEnter, sessionId);
    await this._notifyCallback('onStateEnter', this.hooks.onStateEnter, state, sessionId);
  }

  async _notifyStateExit(state, sessionId) {
    await this._notifyCallback('state.onExit', this.states[state]?.onExit, sessionId);
    await this._notifyCallback('onStateExit', this.hooks.onStateExit, state, sessionId);
  }

  async _notifyStateTransition(from, to, sessionId, context) {
    await this._notifyStateExit(from, sessionId);
    await this._notifyLifecycle('onStateChange', { ...context, currentState: from, nextState: to });
    await this._notifyStateEnter(to, sessionId);
  }

  async _recordCompletion(sessionId, response) {
    await this.storage.setData(sessionId, {
      __ussdLifecycle: { completedResponse: response, completedAt: Date.now() }
    }, this.timeout);
  }

  async _notifyCallback(hookName, callback, ...args) {
    try {
      await this._invokeHook(hookName, callback, ...args);
    } catch (error) {
      // A notification runs after the turn is committed. Reporting its error
      // must not make a caller retry the completed handler.
      this.logger?.error?.(`Error in post-commit ${hookName} hook:`, error);
    }
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
   * @param {string} hookName - Name of the hook
   * @param {...any} args - Arguments to pass to the hook
   */
  async _callHook(hookName, ...args) {
    await this._invokeHook(hookName, this.hooks[hookName], ...args);
  }

  async _invokeHook(hookName, callback, ...args) {
    if (callback) {
      try {
        await callback(...args);
      } catch (error) {
        switch (this.hookErrorStrategy) {
          case 'throw':
            throw error;
          case 'callback':
            if (this.onHookError && typeof this.onHookError === 'function') {
              this.onHookError(hookName, error);
            }
            break;
          case 'log':
          default:
            if (this.logger && typeof this.logger.error === 'function') {
              this.logger.error(`Error in ${hookName} hook:`, error);
            }
            break;
        }
      }
    }
  }
}

module.exports = USSDStateMachine;
