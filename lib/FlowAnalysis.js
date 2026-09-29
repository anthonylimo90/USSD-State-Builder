/** Analyze declarations only. Never inspect or execute application handlers. */
function analyzeFlowDefinition(definition) {
  const states = definition.states;
  const ids = Object.keys(states);
  const known = new Set(ids);
  const diagnostics = [];
  const edges = [];
  const outgoing = new Map(ids.map(id => [id, []]));
  const add = (type, severity, message, state) => {
    diagnostics.push({ type, severity, message, ...(state === undefined ? {} : { state }) });
  };
  if (!known.has(definition.initialState)) {
    add(definition.initialState ? 'INVALID_INITIAL_STATE' : 'MISSING_INITIAL_STATE', 'error', 'The initial state must name a configured state.');
  }
  if (!ids.length) add('NO_STATES', 'error', 'The flow has no states.');

  for (const id of ids) {
    const state = states[id];
    const inputs = new Map();
    for (const [index, transition] of state.transitions.entries()) {
      const terminal = transition.terminal === true;
      const missingTarget = !terminal && typeof transition.to === 'string' && !known.has(transition.to);
      const navigationConflict = definition.navigation.backKey !== null && transition.input === definition.navigation.backKey &&
        !state.localInputKeys.includes(transition.input);
      const edge = { id: `${id}:${index}`, from: id, terminal, missingTarget, navigationConflict,
        ...(transition.to === undefined ? {} : { to: transition.to }),
        ...(transition.input === undefined ? {} : { input: transition.input }),
        ...(transition.kind === undefined ? {} : { kind: transition.kind }) };
      edges.push(edge);
      if ((!terminal && typeof transition.to !== 'string') || (terminal && transition.to !== undefined)) {
        add('INVALID_TRANSITION', 'error', `State "${id}" declares a transition without a single state or END target.`, id);
      } else if (missingTarget) {
        add('MISSING_TARGET', 'error', `State "${id}" targets missing state "${transition.to}".`, id);
      } else if (state.terminal !== true) {
        outgoing.get(id).push(edge);
      }
      if (state.terminal === true && !terminal) {
        add('TERMINAL_TRANSITION', 'error', `Terminal state "${id}" declares an outgoing state transition.`, id);
      }
      if (typeof transition.input === 'string') {
        const destination = terminal ? 'END' : `state:${transition.to}`;
        if (inputs.has(transition.input) && inputs.get(transition.input) !== destination) {
          add('CONFLICTING_INPUT', 'error', `State "${id}" assigns input "${transition.input}" to different targets.`, id);
        }
        inputs.set(transition.input, destination);
        if (navigationConflict) {
          add('NAVIGATION_CONFLICT', 'error', `State "${id}" declares back key "${transition.input}" without a local override; back navigation takes precedence when history is available.`, id);
        }
      }
    }
  }

  // Traverse from the entry point, including self/cyclic edges. An incoming link
  // alone does not establish reachability. No inferred edges enter this graph.
  const reachable = new Set();
  const queue = known.has(definition.initialState) ? [definition.initialState] : [];
  if (queue.length) reachable.add(queue[0]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const edge of outgoing.get(queue[cursor])) {
      if (!edge.terminal && !reachable.has(edge.to)) {
        reachable.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  const reachabilityUnknown = queue.some(id => states[id].dynamic || states[id].terminal === null);
  const coverage = ids.every(id => !states[id].dynamic && states[id].terminal !== null) ? 'complete' : 'partial';
  if (coverage === 'partial') add('INCOMPLETE_METADATA', 'info', 'Dynamic or unannotated states may have undeclared transitions. Analysis is incomplete.');

  const nodes = ids.map(id => {
    const state = states[id];
    const reachability = reachable.has(id) ? 'declared' : reachabilityUnknown ? 'unknown' : 'unreachable';
    if (reachability === 'unreachable') add('UNREACHABLE_STATE', 'warning', `State "${id}" has no declared path from the initial state.`, id);
    if (reachability === 'unknown') add('POTENTIALLY_UNREACHABLE', 'info', `State "${id}" has no declared path; an unknown transition may reach it.`, id);
    if (!state.dynamic && state.terminal === false && outgoing.get(id).length === 0) {
      const backOnly = id !== definition.initialState && reachable.has(id) && definition.navigation.backKey !== null &&
        !state.localInputKeys.includes(definition.navigation.backKey);
      add(backOnly ? 'BACK_ONLY_EXIT' : 'DEAD_END', backOnly ? 'info' : 'warning',
        backOnly ? `State "${id}" has no declared forward or END exit; only history-based back navigation is available.` :
          `State "${id}" has no declared forward or END exit.`, id);
    }
    return { id, isInitial: id === definition.initialState, terminal: state.terminal,
      dynamic: state.dynamic, reachability, localInputKeys: [...state.localInputKeys] };
  });
  return { schemaVersion: 1, transitionSource: 'declared', coverage,
    initialState: definition.initialState, backKey: definition.navigation.backKey,
    valid: !diagnostics.some(item => item.severity === 'error'), nodes, edges, diagnostics,
    summary: { states: nodes.length, transitions: edges.length,
      errors: diagnostics.filter(item => item.severity === 'error').length,
      warnings: diagnostics.filter(item => item.severity === 'warning').length,
      unknownStates: nodes.filter(node => node.dynamic || node.terminal === null || node.reachability === 'unknown').length } };
}

module.exports = { analyzeFlowDefinition };
