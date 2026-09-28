const ValidationError = require('./ValidationError');
const { MiddlewareManager } = require('./Middleware');
const { debuggers } = require('./Debug');
const { StateNotFoundError, ResponseFormatError } = require('./Errors');

const debug = debuggers.state;
const storageLocks = new WeakMap();
const { AsyncLocalStorage } = require('node:async_hooks');
const preparedTurns = new AsyncLocalStorage();
const { createDefinition, freezeDefinition } = require('./FlowDefinition');

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
    this._baseStorage = config.storage || new (require('./InMemoryStorage'))();
    Object.defineProperty(this, 'storage', {
      enumerable: true,
      get: () => {
        const stage = preparedTurns.getStore();
        return stage?.base === this._baseStorage ? stage.storage : this._baseStorage;
      }
    });
    this.enableBackNavigation = config.enableBackNavigation !== false;
    this.hooks = config.hooks || {};
    this.middleware = config.middleware || new MiddlewareManager();
    this.logger = config.logger !== undefined ? config.logger : console;
    this.maxInputLength = config.maxInputLength !== undefined ? config.maxInputLength : 160;
    this.hookErrorStrategy = config.hookErrorStrategy || 'log';
    this.onHookError = config.onHookError || null;

    // Per-session locks serialize processing within this process.
    if (!storageLocks.has(this.storage)) storageLocks.set(this.storage, new Map());
    this._sessionLocks = storageLocks.get(this.storage);
    this._turnObservers = [];

    // Validate configuration
    this._validateConfig();
    if (config.flowVersion !== undefined &&
        (typeof config.flowVersion !== 'string' || !config.flowVersion.trim() || config.flowVersion.length > 128)) {
      throw new TypeError('Flow version must be a non-empty string of at most 128 characters');
    }
    Object.defineProperty(this, 'flowVersion', { value: config.flowVersion ?? null, enumerable: true });
    this.restartResponse = config.restartResponse ?? 'END This service has changed. Please dial again to restart.';
    if (typeof this.restartResponse !== 'string' || !this.restartResponse.startsWith('END ')) {
      throw new TypeError('Restart response must start with END ');
    }
    this._previousFlows = new Map();
    for (const flow of config.previousFlows || []) {
      if (!(flow instanceof USSDStateMachine) || !flow.flowVersion || !this.flowVersion) {
        throw new TypeError('Retained flows require explicit flow versions');
      }
      if (flow.storage !== this.storage) throw new TypeError('Retained flows must share the same storage instance');
      if (flow.flowVersion === this.flowVersion || this._previousFlows.has(flow.flowVersion)) {
        throw new TypeError('Duplicate retained flow version');
      }
      this._previousFlows.set(flow.flowVersion, flow);
    }
    this._flowDefinition = freezeDefinition(createDefinition(config, config.definitionSource));
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
    const hasObservers = this._turnObservers.length > 0;
    const startedAt = hasObservers ? Date.now() : 0;
    const observation = hasObservers ? { currentState: 'unknown', outcome: 'success' } : null;
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
      if (observation) observation.outcome = error instanceof ValidationError ? 'validation_error' : 'error';
      throw error;
    } finally {
      if (acquired) this._releaseSessionLock(sessionId);
      if (hasObservers) {
        for (const observer of this._turnObservers) {
          try {
            const event = { currentState: observation.currentState, outcome: observation.outcome,
              durationMs: Date.now() - startedAt };
            const stage = preparedTurns.getStore();
            if (stage?.base === this._baseStorage) stage.notifications.push(() => observer(event));
            else observer(event);
          } catch (error) {
            this.logger?.error?.('Error recording turn metrics:', error);
          }
        }
      }
    }
  }

  // Execute against an isolated session. No runtime writes or lifecycle
  // notifications escape before the gateway commits the prepared snapshot.
  async prepareTurn(sessionId, input, options = {}) {
    if (preparedTurns.getStore()) throw new Error('Nested prepared turns are unsupported');
    const staging = new (require('./InMemoryStorage'))({ maxHistorySize: this.storage.maxHistorySize });
    if (options.session) {
      staging.store.set(sessionId, JSON.parse(JSON.stringify(options.session)));
    }
    const notifications = [];
    const scoped = new Proxy(staging, {
      get(target, property) {
        const value = target[property];
        if (typeof value !== 'function') return value;
        return (...args) => {
          if (['getState', 'setState', 'getData', 'setData', 'getSession', 'setSession',
            'pushStateHistory', 'popStateHistory', 'getStateHistory', 'deleteSession'].includes(property) && args[0] !== sessionId) {
            throw new Error('Prepared storage is limited to one session');
          }
          const result = value.apply(target, args);
          return ['getData', 'getSession'].includes(property)
            ? Promise.resolve(result).then(data => data == null ? data : JSON.parse(JSON.stringify(data))) : result;
        };
      }
    });
    return preparedTurns.run({ base: this._baseStorage, storage: scoped, notifications }, async () => {
      if (options.sessionData) await this.setSessionData(sessionId, options.sessionData);
      const response = await this.processInput(sessionId, input, options);
      const session = await staging.getSession(sessionId);
      let notified = false;
      return {
        response, session: session ? JSON.parse(JSON.stringify(session)) : null,
        notify: async () => {
          if (notified) return;
          notified = true;
          await preparedTurns.run(undefined, async () => {
            for (const notification of notifications) {
              try { await notification(); }
              catch (error) {
                try { this.logger?.error?.('Error in committed turn notification:', error); } catch { /* Logging cannot invalidate a committed turn. */ }
              }
            }
          });
        }
      };
    });
  }

  getFlowDefinition() {
    return JSON.parse(JSON.stringify(this._flowDefinition));
  }

  async _processInputUnlocked(sessionId, input, options, observation, snapshot) {
    const existingState = snapshot ? snapshot.state : await this.storage.getState(sessionId);
    let existingData = snapshot ? snapshot.data : await this.storage.getData(sessionId);
    const version = existingData?.__ussdFlow?.version;
    const incompatible = (version && version !== this.flowVersion) ||
      (this.flowVersion && existingState && !version);
    if (incompatible) {
      if (existingData?.__ussdLifecycle?.completedResponse) {
        if (observation) observation.outcome = 'replay';
        return existingData.__ussdLifecycle.completedResponse;
      }
      const retained = this._previousFlows.get(version);
      if (retained) return retained._processInputUnlocked(sessionId, input, options, observation,
        { state: existingState, data: existingData });
      if (observation) observation.outcome = 'flow_restart';
      await this._recordCompletion(sessionId, this.restartResponse);
      return this.restartResponse;
    }
    if (this.flowVersion && existingData?.__ussdLifecycle?.completedResponse) {
      if (observation) observation.outcome = 'replay';
      return existingData.__ussdLifecycle.completedResponse;
    }
    // Validate input length
    if (this.maxInputLength > 0 && input && input.length > this.maxInputLength) {
      throw new ValidationError(
        `Input too long. Maximum ${this.maxInputLength} characters allowed.`,
        'input',
        input.substring(0, 50) + '...'
      );
    }

    const currentState = existingState || this.initialState;
    if (observation) observation.currentState = currentState;
    const stateConfig = this.states[currentState];

    debug('processInput', { sessionId, input, currentState, options });

    if (!stateConfig) {
      if (this.flowVersion) {
        await this._recordCompletion(sessionId, this.restartResponse);
        if (observation) observation.outcome = 'flow_restart';
        return this.restartResponse;
      }
      debug('invalid state', { currentState });
      throw new Error(`Invalid state: ${currentState}`);
    }

    // Avoid an extra storage read when no middleware can observe expiry metadata.
    const hasMiddleware = typeof this.middleware.count !== 'function' || this.middleware.count() > 0;
    const hasBeforeProcess = this._hasMiddlewareHook('beforeProcess');
    const hasAfterProcess = this._hasMiddlewareHook('afterProcess');
    const session = hasMiddleware && this.storage.getSession
      ? await this.storage.getSession(sessionId) : null;
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
    if (hasBeforeProcess) await this.middleware.execute('beforeProcess', middlewareContext);

    // Check if middleware blocked the request
    if (middlewareContext.blocked) {
      if (observation) observation.outcome = 'blocked';
      debug('request blocked by middleware', { sessionId, response: middlewareContext.response });
      return middlewareContext.response;
    }
    if (existingData?.__ussdLifecycle?.completedResponse) {
      if (observation) observation.outcome = 'replay';
      return existingData.__ussdLifecycle.completedResponse;
    }

    if (this.flowVersion && !version) {
      await this.storage.setData(sessionId, { __ussdFlow: { version: this.flowVersion } }, this.timeout);
      existingData = { ...existingData, __ussdFlow: { version: this.flowVersion } };
      middlewareContext.sessionData = existingData;
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
              isReentry: true,
              turn: options.turn
            });
            // Validate response format
            this._validateResponseFormat(result.response, previousState);
            if (result.data) {
              await this._setTurnData(sessionId, result.data);
            }
            middlewareContext.response = result.response;
            middlewareContext.nextState = previousState;
            await this.middleware.execute('afterProcess', middlewareContext);
            this._validateResponseFormat(middlewareContext.response, previousState);
            if (middlewareContext.response.startsWith('END ')) {
              await this._recordCompletion(sessionId, middlewareContext.response);
            }
            if (this._hasStateTransitionHooks(currentState, previousState)) {
              await this._notifyStateTransition(currentState, previousState, sessionId, middlewareContext);
            }
            if (middlewareContext.response.startsWith('END ') && this._hasMiddlewareHook('onSessionEnd')) {
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
        sessionData: hasBeforeProcess ? await this.storage.getData(sessionId) : existingData,
        previousState: null, // Set when navigating back, null for forward navigation
        language: options.language,
        currentState,
        turn: options.turn
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
      } else if (!isTerminalResponse || !existingState) {
        // Active same-state replies refresh TTL. For an existing terminal
        // session, _recordCompletion writes the response and refreshes TTL.
        await this.storage.setState(sessionId, currentState, this.timeout);
      }

      // Store any data if provided
      if (result.data) {
        await this._setTurnData(sessionId, result.data);
      }

      // Update middleware context with response
      middlewareContext.response = result.response;
      middlewareContext.nextState = result.nextState;

      // Execute afterProcess middleware
      debug('executing afterProcess middleware', { sessionId });
      if (hasAfterProcess) await this.middleware.execute('afterProcess', middlewareContext);
      this._validateResponseFormat(middlewareContext.response, currentState);
      if (middlewareContext.response.startsWith('END ')) {
        await this._recordCompletion(sessionId, middlewareContext.response);
      }

      if (!existingState) {
        if (this._hasMiddlewareHook('onSessionStart')) {
          await this._notifyLifecycle('onSessionStart', { ...middlewareContext, reason: 'started' });
        }
        if (stateConfig.onEnter || this.hooks.onStateEnter) {
          await this._notifyStateEnter(currentState, sessionId);
        }
      }
      if (transitionedTo && this._hasStateTransitionHooks(currentState, transitionedTo)) {
        await this._notifyStateTransition(currentState, transitionedTo, sessionId, middlewareContext);
      }
      if (middlewareContext.response.startsWith('END ') && this._hasMiddlewareHook('onSessionEnd')) {
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
        if (observation) observation.outcome = 'validation_error';
        debug('validation error', { sessionId, message: error.message });
        await this.storage.setState(sessionId, currentState, this.timeout);
        if (!existingState) {
          if (this._hasMiddlewareHook('onSessionStart')) {
            await this._notifyLifecycle('onSessionStart', { ...middlewareContext, reason: 'started' });
          }
          if (stateConfig.onEnter || this.hooks.onStateEnter) {
            await this._notifyStateEnter(currentState, sessionId);
          }
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
    const existing = await this.storage.getData(sessionId);
    const version = existing?.__ussdFlow?.version;
    const safe = { ...data };
    delete safe.__ussdFlow;
    if (version) safe.__ussdFlow = { version };
    await this.storage.setData(sessionId, safe, this.timeout);
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

  _hasMiddlewareHook(hookName) {
    // Custom middleware managers may not expose count(); preserve their hooks.
    return typeof this.middleware.count !== 'function' || this.middleware.count(hookName) > 0;
  }

  _hasStateTransitionHooks(from, to) {
    return Boolean(this.states[from]?.onExit || this.hooks.onStateExit ||
      this._hasMiddlewareHook('onStateChange') ||
      this.states[to]?.onEnter || this.hooks.onStateEnter);
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

  async _setTurnData(sessionId, data) {
    const safe = { ...data };
    delete safe.__ussdFlow;
    if (this.flowVersion) safe.__ussdFlow = { version: this.flowVersion };
    await this.storage.setData(sessionId, safe, this.timeout);
  }

  async _recordCompletion(sessionId, response) {
    await this.storage.setData(sessionId, {
      __ussdLifecycle: { completedResponse: response, completedAt: Date.now() }
    }, this.timeout);
  }

  async _notifyCallback(hookName, callback, ...args) {
    const stage = preparedTurns.getStore();
    if (stage?.base === this._baseStorage) {
      stage.notifications.push(() => this._notifyCallback(hookName, callback, ...args));
      return;
    }
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
