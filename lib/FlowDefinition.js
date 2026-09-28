// Inspectable declarations only: never serialize handlers, prompts or session values.
function sensitivity(value = 'unspecified') {
  if (!['unspecified', 'public', 'sensitive', 'secret'].includes(value)) {
    throw new TypeError('Invalid field sensitivity');
  }
  return value;
}
function stateMetadata(id, metadata = {}, localInputKeys = []) {
  const result = {
    id, terminal: typeof metadata.terminal === 'boolean' ? metadata.terminal : null,
    dynamic: metadata.dynamic !== false,
    transitions: (metadata.transitions || []).map(edge => {
      const transition = {};
      if (typeof edge.input === 'string') transition.input = edge.input;
      if (typeof edge.to === 'string') transition.to = edge.to;
      if (edge.terminal === true) transition.terminal = true;
      if (typeof edge.kind === 'string') transition.kind = edge.kind;
      return transition;
    }),
    localInputKeys: [...new Set(localInputKeys.filter(key => typeof key === 'string'))]
  };
  if (metadata.field && typeof metadata.field.name !== 'string') throw new TypeError('Field name must be a string');
  if (metadata.form && (typeof metadata.form.name !== 'string' || !['field', 'confirm'].includes(metadata.form.role))) {
    throw new TypeError('Form metadata requires a name and field or confirm role');
  }
  if (metadata.field) result.field = { name: metadata.field.name, sensitivity: sensitivity(metadata.field.sensitivity) };
  if (metadata.form) result.form = { name: metadata.form.name, role: metadata.form.role };
  return result;
}
function createDefinition(config, source = 'traditional') {
  const states = Object.fromEntries(Object.entries(config.states).map(([id, state]) =>
    [id, stateMetadata(id, state.metadata, state.localInputKeys)]));
  return {
    schemaVersion: 1, source, flowVersion: config.flowVersion ?? null,
    initialState: config.initialState,
    navigation: { backKey: config.enableBackNavigation === false ? null : '0' },
    coverage: Object.values(states).every(state => !state.dynamic && state.terminal !== null) ? 'complete' : 'partial',
    states
  };
}
function freezeDefinition(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freezeDefinition(child);
  return Object.freeze(value);
}
function definitionOf(machine) {
  return typeof machine.getFlowDefinition === 'function' ? machine.getFlowDefinition() : createDefinition(machine);
}
module.exports = { sensitivity, createDefinition, freezeDefinition, definitionOf };
