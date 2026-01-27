/**
 * Compiler - Converts builder graph into USSDStateMachine configuration
 *
 * Walks the AppBuilder's state definitions and produces a standard
 * { initialState, states, ... } config object. Handles CON/END auto-prefixing.
 */
const USSDStateMachine = require('../USSDStateMachine');
const { MiddlewareManager } = require('../Middleware');

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

async function resolveTargetResponse(targetSb, sessionId, context) {
  if (targetSb._handler) {
    const result = await targetSb._handler('', sessionId, context);
    if (typeof result === 'string') {
      return { text: result, isEnd: isDisplayTerminal(targetSb) };
    } else if (result && typeof result === 'object' && result.response) {
      if (hasPrefix(result.response)) {
        return { text: result.response, isEnd: result.response.startsWith('END ') };
      }
      return { text: result.response, isEnd: isDisplayTerminal(targetSb) };
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
    let resolved = false; // Whether response was resolved from target state

    // Step 1: Run custom handler if defined (produces response text)
    if (customHandler) {
      const handlerResult = await customHandler(input, sessionId, context);
      if (typeof handlerResult === 'string') {
        response = handlerResult;
      } else if (handlerResult && typeof handlerResult === 'object') {
        // Handler returned a full result object - pass through directly
        return handlerResult;
      }
    }

    // Step 2: Check routes for transition behavior (only on non-empty input)
    const matchedRoute = input ? routes.find(r => r._input === input) : null;
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
        } else if (response === undefined || response === null) {
          // Resolve target state's response for seamless transition
          const targetSb = allStates && allStates.get(matchedRoute._target);
          if (targetSb) {
            const target = await resolveTargetResponse(targetSb, sessionId, context);
            response = target.text;
            isEndResponse = target.isEnd;
            resolved = true;
          }
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
      if (typeof saveKey === 'function') {
        data = saveKey(input, context);
      } else {
        const existing = (context && context.sessionData) || {};
        data = Object.assign({}, existing, { [saveKey]: input });
      }
    }

    // Step 4: When transitioning via next(), resolve target state response
    if (nextState && !resolved && allStates && (response === undefined || response === null || response === message)) {
      const targetSb = allStates.get(nextState);
      if (targetSb) {
        // Build updated context with saved data
        const updatedContext = data
          ? Object.assign({}, context, { sessionData: Object.assign({}, context && context.sessionData, data) })
          : context;
        const target = await resolveTargetResponse(targetSb, sessionId, updatedContext);
        response = target.text;
        isEndResponse = target.isEnd;
        resolved = true;
      }
    }

    // Step 5: Fall back to message if no response yet
    if (response === undefined || response === null) {
      response = message || '';
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
  const stateEntries = appBuilder._states;

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

    if (sb._validator) {
      stateConfig.validator = sb._validator;
    }
    if (sb._onEnterFn) {
      stateConfig.onEnter = sb._onEnterFn;
    }
    if (sb._onExitFn) {
      stateConfig.onExit = sb._onExitFn;
    }

    states[name] = stateConfig;
  }

  // Build config
  const config = {
    initialState,
    states
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

  return machine;
}

module.exports = { compile, addPrefix, hasPrefix, isTerminal, buildHandler };
