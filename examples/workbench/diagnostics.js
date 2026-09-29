const { USSDStateMachine, InMemoryStorage, createApp } = require('ussd-state-builder');

// Deliberately invalid declarations for inspecting diagnostics, not a business flow.
function createDiagnosticsFixture() {
  const state = (metadata, localInputKeys = []) => ({ metadata: { dynamic: false, terminal: false, ...metadata },
    localInputKeys, handler: () => ({ response: 'CON Diagnostics fixture only. Choose a demo shop to exercise a valid flow.' }) });
  return new USSDStateMachine({ initialState: 'HOME', logger: null, storage: new InMemoryStorage(), states: {
    HOME: state({ transitions: [{ input: '1', to: 'DONE' }, { input: '9', to: 'MISSING' },
      { input: '0', to: 'TRAP' }, { input: '2', to: 'DONE' }, { input: '2', terminal: true }] }),
    DONE: { ...state({ terminal: true }), handler: () => ({ response: 'END Fixture ended.' }) },
    TRAP: state({}, ['0']),
    ISLAND_A: state({ transitions: [{ to: 'ISLAND_B' }] }),
    ISLAND_B: state({ transitions: [{ to: 'ISLAND_A' }] })
  } });
}

function createDynamicFixture() {
  return createApp().logger(null)
    .state('HOME', state => state.run(input => input === '1' ?
      { response: 'END Dynamic fixture ended.', nextState: 'DONE' } : 'Dynamic fixture\n1 Finish'))
    .state('DONE', state => state.message('Dynamic fixture ended.').end()).build();
}

module.exports = { createDiagnosticsFixture, createDynamicFixture };
