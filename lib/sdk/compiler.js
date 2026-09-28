/**
 * Compiler - Converts builder graph into USSDStateMachine configuration
 *
 * Walks the AppBuilder's state definitions and produces a standard
 * { initialState, states, ... } config object. Handles CON/END auto-prefixing.
 */
const USSDStateMachine = require('../USSDStateMachine');
const {
  MiddlewareManager,
  createLoggingMiddleware,
  createRateLimitMiddleware,
  createSanitizationMiddleware,
  createMetricsMiddleware,
  createSessionTimeoutMiddleware
} = require('../Middleware');
const { Validators } = require('../ValidationLibrary');

/**
 * Check if a response string already has a CON/END prefix
 * @param {string} text
 * @returns {boolean}
 */
function hasPrefix(text) {
  return typeof text === 'string' && (text.startsWith('CON ') || text.startsWith('END '));
}

/**
 * Add the appropriate prefix to a response string
 * @param {string} text - Response text
 * @param {boolean} isEnd - Whether this is a terminal response
 * @returns {string}
 */
function addPrefix(text, isEnd) {
  if (hasPrefix(text)) {
    return text;
  }
  return isEnd ? `END ${text}` : `CON ${text}`;
}

/**
 * Determine if a state is terminal based on its builder definition
 * @param {import('./StateBuilder')} sb - StateBuilder instance
 * @returns {boolean}
 */
function isTerminal(sb) {
  // Explicitly marked as end
  if (sb._isEnd) return true;
  // Has a next state or routes with gotos -> not terminal
  if (sb._nextState) return false;
  if (sb._routes.some(r => r._target)) return false;
  // No continuation path -> terminal
  return true;
}

/**
 * Resolve the display response for a target state.
 * Called at runtime when a goto or next transition needs to show the target's content.
 * @param {import('./StateBuilder')} targetSb - Target state builder
 * @param {string} sessionId - Session ID
 * @param {object} context - Handler context
 * @returns {Promise<{text: string, isEnd: boolean}>}
 */
/**
 * Determine if a state should display as terminal when first shown.
 * Only states explicitly marked with .end() are terminal.
 * @param {import('./StateBuilder')} sb
 * @returns {boolean}
 */
function isDisplayTerminal(sb) {
  return sb._isEnd === true;
}

async function resolveTargetResponse(targetSb, sessionId, context, targetState) {
  if (targetSb._handler) {
    const result = await targetSb._handler('', sessionId, {
      ...context,
      currentState: targetState
    });
    if (typeof result === 'string') {
      return { text: result, isEnd: isDisplayTerminal(targetSb) };
    } else if (result && typeof result === 'object' && result.response) {
      if (hasPrefix(result.response)) {
        return { text: result.response, isEnd: result.response.startsWith('END '), data: result.data };
      }
      return { text: result.response, isEnd: isDisplayTerminal(targetSb), data: result.data };
    }
  }
  if (targetSb._message) {
    return { text: targetSb._message, isEnd: isDisplayTerminal(targetSb) };
  }
  return { text: '', isEnd: isDisplayTerminal(targetSb) };
}

/**
 * Build the handler function for a state from its builder definition
 * @param {import('./StateBuilder')} sb - StateBuilder instance
 * @param {Map<string, import('./StateBuilder')>} allStates - All state builders (for resolving goto targets)
 * @returns {Function} State handler function
 */
function buildHandler(sb, allStates) {
  const routes = sb._routes;
  const defaultNext = sb._nextState;
  const end = sb._isEnd;
  const message = sb._message;
  const customHandler = sb._handler;
  const saveKey = sb._saveKey;

  return async function handler(input, sessionId, context) {
    let response;
    // Only apply defaultNext when there's actual user input (not on initial render)
    let nextState = (input && defaultNext) ? defaultNext : undefined;
    let data = undefined;
    let isEndResponse = end;
    let resolveRouteTarget = false;

    // Step 1: Run custom handler if defined (produces response text)
    if (customHandler) {
      const handlerResult = await customHandler(input, sessionId, context);
      if (typeof handlerResult === 'string') {
        response = handlerResult;
      } else if (handlerResult && typeof handlerResult === 'object') {
        // Check if handler wants compiler to resolve next state (response: null with data)
        if (handlerResult.response === null && handlerResult.data) {
          // Handler is signaling for compiler to handle state transition
          // Update context with handler's data for subsequent processing
          data = handlerResult.data;
          context = Object.assign({}, context, { sessionData: data });
          // Continue to normal flow - response will be resolved from next state
        } else if (handlerResult.response !== undefined) {
          // Handler returned a full result object with response - pass through directly
          return handlerResult;
        }
      }
    }

    // Step 2: Check routes for transition behavior (only on non-empty input)
    // First check exact matches, then fall back to wildcard '*'
    let matchedRoute = null;
    if (input) {
      matchedRoute = routes.find(r => r._input === input);
      if (!matchedRoute) {
        matchedRoute = routes.find(r => r._input === '*');
      }
    }
    if (matchedRoute) {
      if (matchedRoute._isEnd) {
        isEndResponse = true;
        nextState = undefined;
        if (matchedRoute._response != null) {
          response = matchedRoute._response;
        }
      } else if (matchedRoute._target) {
        nextState = matchedRoute._target;
        isEndResponse = false;
        if (matchedRoute._response != null) {
          response = matchedRoute._response;
        } else {
          // Resolve after saving input so the target sees the latest session data.
          resolveRouteTarget = true;
        }
      } else if (matchedRoute._response != null) {
        // Reply route (no transition)
        response = matchedRoute._response;
        nextState = undefined;
        isEndResponse = false;
      }
    }

    // Step 3: Handle save (only when there's input)
    if (saveKey && input) {
      const sessionData = (context && context.sessionData) || {};

      // Check if this is a dynamic menu selection
      if (sessionData._selectedItem !== undefined) {
        if (typeof saveKey === 'function') {
          data = saveKey(sessionData._selectedItem, context);
        } else {
          data = Object.assign({}, sessionData, { [saveKey]: sessionData._selectedItem });
        }
        // Storage adapters merge partial writes, so use explicit tombstones.
        data._selectedItem = null;
        data._dynamicMenu = null;
      } else {
        // Standard save behavior
        if (typeof saveKey === 'function') {
          data = saveKey(input, context);
        } else {
          data = Object.assign({}, sessionData, { [saveKey]: input });
        }
      }
    }

    // Step 4: When transitioning via next(), resolve target state response
    if (nextState && allStates && (resolveRouteTarget || response === undefined || response === null || response === message)) {
      const targetSb = allStates.get(nextState);
      if (targetSb) {
        // Build updated context with saved data
        const updatedContext = data
          ? Object.assign({}, context, { sessionData: Object.assign({}, context && context.sessionData, data) })
          : context;
        const target = await resolveTargetResponse(targetSb, sessionId, updatedContext, nextState);
        response = target.text;
        isEndResponse = target.isEnd;
        // Merge any data returned by target state's handler (e.g., _dynamicMenu state)
        if (target.data) {
          data = Object.assign({}, data || {}, target.data);
        }
      }
    }

    // Step 5: Fall back to message if no response yet
    if (response === undefined || response === null) {
      response = message || '';
    }

    // A selected item is only meaningful while this handler is resolving the
    // next screen. Never persist it for another menu to consume later.
    if (data && Object.prototype.hasOwnProperty.call(data, '_selectedItem')) {
      data._selectedItem = null;
    }

    // Step 6: Auto-prefix response
    response = addPrefix(response, isEndResponse);

    const result = { response };
    if (nextState) result.nextState = nextState;
    if (data) result.data = data;
    return result;
  };
}

/**
 * Compile an AppBuilder into a USSDStateMachine instance
 * @param {import('./AppBuilder')} appBuilder - AppBuilder instance
 * @returns {import('../USSDStateMachine')} Configured state machine
 */
function compile(appBuilder) {
  // Copy declarations before creating closures: later builder edits cannot change a built flow.
  const stateEntries = new Map([...appBuilder._states].map(([name, sb]) => [name, {
    ...sb, _routes: sb._routes.map(route => ({ ...route })),
    _menuItems: sb._menuItems ? { validKeys: [...sb._menuItems.validKeys] } : null,
    _metadata: sb._metadata ? JSON.parse(JSON.stringify(sb._metadata)) : undefined
  }]));

  if (stateEntries.size === 0) {
    throw new Error('At least one state must be defined');
  }

  // Determine initial state
  const initialState = appBuilder._initialState || stateEntries.keys().next().value;

  if (!stateEntries.has(initialState)) {
    throw new Error(`Initial state "${initialState}" not found in defined states`);
  }

  // Compile states
  const states = {};
  for (const [name, sb] of stateEntries) {
    const stateConfig = {
      handler: buildHandler(sb, stateEntries)
    };
    const routeKeys = sb._routes.map(route => route._input).filter(key => key !== '*');
    if (new Set(routeKeys).size !== routeKeys.length) {
      throw new Error(`State "${name}" defines the same input route more than once`);
    }
    const localInputKeys = [
      ...routeKeys,
      ...(sb._handler?.ussdLocalInputKeys || [])
    ];
    if (localInputKeys.length) {
      stateConfig.localInputKeys = localInputKeys;
    }

    // Handle validators
    if (sb._validator) {
      stateConfig.validator = sb._validator;
    } else if (sb._menuItems) {
      // Auto-add menuOption validator for menu states (unless wildcard route exists)
      const hasWildcard = sb._routes.some(r => r._input === '*');
      if (!hasWildcard) {
        const validKeys = sb._menuItems.validKeys;
        // Use 'allowed' option to support custom keys (not just numbers)
        stateConfig.validator = Validators.menuOption({ allowed: validKeys });
      }
    }

    // Strict validation: warn if state saves data without validation
    if (sb._saveKey && !stateConfig.validator) {
      const warning = `[USSD Warning] State "${name}" saves user input (.save()) but has no validator. ` +
        `This may allow unvalidated data. Add .validate() for safety.`;
      if (appBuilder._strictValidation) {
        throw new Error(warning);
      } else if (appBuilder._logger && typeof appBuilder._logger.warn === 'function') {
        appBuilder._logger.warn(warning);
      }
    }

    if (sb._onEnterFn) {
      stateConfig.onEnter = sb._onEnterFn;
    }
    if (sb._onExitFn) {
      stateConfig.onExit = sb._onExitFn;
    }

    const transitions = sb._routes.map(route => route._isEnd
      ? { input: route._input, terminal: true, kind: 'end' }
      : { input: route._input, to: route._target || name, kind: route._target ? 'goto' : 'reply' });
    if (sb._nextState) transitions.push({ to: sb._nextState, kind: 'next' });
    stateConfig.metadata = {
      terminal: sb._isEnd === true || (typeof sb._message === 'string' && sb._message.startsWith('END ')), dynamic: Boolean(sb._handler), ...sb._metadata,
      transitions: [...transitions, ...(sb._metadata?.transitions || [])]
    };
    if (sb._form) stateConfig.metadata.form = sb._form;
    if (sb._field || typeof sb._saveKey === 'string') {
      stateConfig.metadata.field = sb._field || { name: sb._saveKey, sensitivity: sb._sensitivity };
    }
    states[name] = stateConfig;
  }

  // Build config
  const config = {
    initialState,
    states,
    definitionSource: 'sdk',
    flowVersion: appBuilder._flowVersion,
    previousFlows: appBuilder._flowOptions?.previousFlows,
    restartResponse: appBuilder._flowOptions?.restartResponse
  };

  if (appBuilder._storageAdapter) {
    config.storage = appBuilder._storageAdapter;
  }
  if (appBuilder._timeoutSeconds !== undefined) {
    config.timeout = appBuilder._timeoutSeconds;
  }
  if (Object.keys(appBuilder._hooks).length > 0) {
    config.hooks = appBuilder._hooks;
  }
  if (appBuilder._backNavigation !== undefined) {
    config.enableBackNavigation = appBuilder._backNavigation;
  }
  if (appBuilder._logger !== undefined) {
    config.logger = appBuilder._logger;
  }
  if (appBuilder._maxInputLength !== undefined) {
    config.maxInputLength = appBuilder._maxInputLength;
  }

  // Create state machine
  const machine = new USSDStateMachine(config);

  // Register middleware
  for (const mw of appBuilder._middlewares) {
    machine.use(mw.hook, mw.fn);
  }

  // Process middleware helper configs
  const cleanupFunctions = [];
  let metricsAccessor = null;

  if (appBuilder._middlewareConfigs) {
    for (const mwConfig of appBuilder._middlewareConfigs) {
      switch (mwConfig.type) {
        case 'logging': {
          const fn = createLoggingMiddleware(mwConfig.options);
          machine.use('beforeProcess', fn);
          break;
        }
        case 'rateLimit': {
          const result = createRateLimitMiddleware(mwConfig.options);
          machine.use('beforeProcess', result.middleware);
          cleanupFunctions.push(result.cleanup);
          break;
        }
        case 'sanitize': {
          const fn = createSanitizationMiddleware(mwConfig.options);
          machine.use('beforeProcess', fn);
          break;
        }
        case 'metrics': {
          const result = createMetricsMiddleware(mwConfig.options);
          machine.useTurnObserver(result.observeTurn);
          metricsAccessor = result;
          break;
        }
        case 'sessionTimeout': {
          const fn = createSessionTimeoutMiddleware(mwConfig.options);
          machine.use('afterProcess', fn);
          break;
        }
      }
    }
  }

  // Attach cleanup function
  machine.cleanup = function() {
    for (const cleanup of cleanupFunctions) {
      cleanup();
    }
  };

  // Attach metrics accessors if metrics middleware was added
  if (metricsAccessor) {
    machine.getMetrics = metricsAccessor.getMetrics;
    machine.resetMetrics = metricsAccessor.resetMetrics;
  }

  // Attach testing integration (lazy-loaded)
  machine.test = function(options) {
    const { USSDTester } = require('../TestingUtils');
    return new USSDTester(machine, options);
  };

  machine.inspect = function() {
    const { StateInspector } = require('../StateInspector');
    return new StateInspector(machine);
  };

  return machine;
}

module.exports = { compile, addPrefix, hasPrefix, isTerminal, buildHandler };
