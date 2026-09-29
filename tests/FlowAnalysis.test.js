const { analyzeFlowDefinition, FlowDiagram, StateInspector, LocalWorkbench, createApp, USSDStateMachine } = require('..');
const { createDefinition } = require('../lib/FlowDefinition');
const { createSdkFlow, createTraditionalFlow } = require('../examples/workbench/flows');

function definition(states, options = {}) {
  return createDefinition({ initialState: 'HOME', enableBackNavigation: false, ...options,
    states: Object.fromEntries(Object.entries(states).map(([id, metadata]) => [id, {
      metadata: { dynamic: false, terminal: false, ...metadata }, localInputKeys: metadata.localInputKeys
    }])) });
}
const types = analysis => analysis.diagnostics.map(item => item.type);

test('traverses from entry rather than trusting incoming links in isolated cycles', () => {
  const result = analyzeFlowDefinition(definition({
    HOME: { transitions: [{ to: 'DONE' }] }, DONE: { terminal: true },
    ISLAND_A: { transitions: [{ to: 'ISLAND_B' }] }, ISLAND_B: { transitions: [{ to: 'ISLAND_A' }] }
  }));
  expect(result.valid).toBe(true);
  expect(result.nodes.map(node => [node.id, node.reachability])).toEqual([
    ['HOME', 'declared'], ['DONE', 'declared'], ['ISLAND_A', 'unreachable'], ['ISLAND_B', 'unreachable']
  ]);
  expect(result.diagnostics.filter(item => item.type === 'UNREACHABLE_STATE').map(item => item.state)).toEqual(['ISLAND_A', 'ISLAND_B']);
});

test('reports missing/ambiguous targets and input conflicts, but accepts identical duplicate declarations', () => {
  const result = analyzeFlowDefinition(definition({ HOME: { transitions: [
    { input: '1', to: 'ABSENT' }, { input: '2', to: 'DONE' }, { input: '2', terminal: true },
    { input: '3' }, { terminal: true, to: 'DONE' }
  ] }, DONE: { terminal: true } }));
  expect(result.valid).toBe(false);
  expect(types(result)).toEqual(expect.arrayContaining(['MISSING_TARGET', 'CONFLICTING_INPUT', 'INVALID_TRANSITION']));
  expect(result.edges[0]).toMatchObject({ missingTarget: true, to: 'ABSENT' });
  const duplicate = analyzeFlowDefinition(definition({ HOME: { transitions: [
    { input: '1', to: 'DONE' }, { input: '1', to: 'DONE', kind: 'goto' }
  ] }, DONE: { terminal: true } }));
  expect(duplicate.valid).toBe(true);
});

test('back precedence conflicts with an unreserved route; explicit local override and disabled back are valid', () => {
  const states = { HOME: { transitions: [{ input: '0', to: 'DONE' }] }, DONE: { terminal: true } };
  const conflict = analyzeFlowDefinition(definition(states, { enableBackNavigation: true }));
  expect(types(conflict)).toContain('NAVIGATION_CONFLICT');
  expect(conflict.edges[0].navigationConflict).toBe(true);
  expect(conflict.nodes[1].reachability).toBe('declared');
  expect(types(analyzeFlowDefinition(definition(states)))).not.toContain('NAVIGATION_CONFLICT');
  states.HOME.localInputKeys = ['0'];
  const override = analyzeFlowDefinition(definition(states, { enableBackNavigation: true }));
  expect(override.valid).toBe(true);
  expect(override.nodes[1].reachability).toBe('declared');
});

test('SDK zero routes and dynamic menu controls are intentional local keys', async () => {
  const machine = createApp().logger(null)
    .state('HOME', state => state.message('Home').on('0').goto('DONE'))
    .state('DONE', state => state.message('Done').end()).build();
  expect(machine.inspect().analyze().valid).toBe(true);
  await machine.processInput('override', '');
  expect(await machine.processInput('override', '0')).toBe('END Done');
  const menu = createApp().logger(null).state('HOME', state =>
    state.dynamicMenu(() => ['item'], { pageSize: 2, refresh: {} })).build();
  expect(menu.inspect().analyze().valid).toBe(true);
  expect(menu.inspect().analyze().nodes[0].localInputKeys).toEqual(['0', '99', '98']);
});

test('traditional zero routes can run without history but yield to back navigation with history', async () => {
  const create = initialState => new USSDStateMachine({ initialState, logger: null, states: {
    HOME: { handler: input => input === '1' ? { response: 'CON Inner', nextState: 'INNER' } : { response: 'CON Home' },
      metadata: { dynamic: false, terminal: false, transitions: [{ input: '1', to: 'INNER' }] } },
    INNER: { handler: input => ({ response: input === '0' ? 'END Local zero' : 'CON Inner' }),
      metadata: { dynamic: false, terminal: false, transitions: [{ input: '0', terminal: true }] } }
  } });
  const withHistory = create('HOME');
  await withHistory.processInput('history', '');
  await withHistory.processInput('history', '1');
  expect(await withHistory.processInput('history', '0')).toBe('CON Home');
  const emptyHistory = create('INNER');
  await emptyHistory.processInput('empty', '');
  expect(await emptyHistory.processInput('empty', '0')).toBe('END Local zero');
  expect(types(new StateInspector(withHistory).analyze())).toContain('NAVIGATION_CONFLICT');
});

test('partial reachable handlers leave undeclared reachability unknown, never an error or dead end', () => {
  const result = analyzeFlowDefinition(definition({ HOME: { dynamic: true }, OTHER: { terminal: true } }));
  expect(result).toMatchObject({ valid: true, coverage: 'partial' });
  expect(result.nodes[1].reachability).toBe('unknown');
  expect(result.diagnostics.every(item => item.severity === 'info')).toBe(true);
  expect(types(result)).not.toContain('DEAD_END');
  const unknownTerminal = analyzeFlowDefinition(definition({ HOME: { terminal: null }, OTHER: { terminal: true } }));
  expect(unknownTerminal.nodes[1].reachability).toBe('unknown');
  expect(types(unknownTerminal)).not.toContain('DEAD_END');
});

test('unknown transitions in an unreachable island do not obscure entry-region reachability', () => {
  const result = analyzeFlowDefinition(definition({ HOME: { terminal: true }, ISLAND: { dynamic: true } }));
  expect(result.coverage).toBe('partial');
  expect(result.nodes[1].reachability).toBe('unreachable');
});

test('distinguishes true dead ends from history-based back exits, terminal states and self replies', () => {
  const result = analyzeFlowDefinition(definition({ HOME: { transitions: [{ to: 'BACK_ONLY' }, { to: 'TRAP' }] },
    BACK_ONLY: {}, TRAP: { localInputKeys: ['0'] }, END: { terminal: true },
    REPLY: { transitions: [{ input: '?', to: 'REPLY', kind: 'reply' }] }
  }, { enableBackNavigation: true }));
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ type: 'BACK_ONLY_EXIT', state: 'BACK_ONLY', severity: 'info' }));
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ type: 'DEAD_END', state: 'TRAP', severity: 'warning' }));
  expect(result.diagnostics.filter(item => item.type === 'DEAD_END').map(item => item.state)).toEqual(['TRAP']);
});

test('terminal state declarations cannot make their outgoing targets reachable', () => {
  const result = analyzeFlowDefinition(definition({ HOME: { terminal: true, transitions: [{ to: 'OTHER' }] }, OTHER: { terminal: true } }));
  expect(types(result)).toContain('TERMINAL_TRANSITION');
  expect(result.nodes[1].reachability).toBe('unreachable');
});

test('handles missing entry/empty flows and large cyclic graphs without recursive traversal', () => {
  expect(types(analyzeFlowDefinition(definition({})))).toEqual(expect.arrayContaining(['NO_STATES', 'INVALID_INITIAL_STATE']));
  const states = { HOME: { transitions: [{ to: 'S0' }] } };
  for (let i = 0; i < 12000; i++) states[`S${i}`] = { transitions: [{ to: `S${(i + 1) % 12000}` }] };
  const result = analyzeFlowDefinition(definition(states));
  expect(result.nodes.every(node => node.reachability === 'declared')).toBe(true);
});

test('analysis never runs handlers or reads their source, including legacy traditional flows', () => {
  const handler = jest.fn(() => { throw new Error('Private response'); });
  handler.toString = () => { throw new Error('No source inspection'); };
  const machine = new USSDStateMachine({ initialState: 'HOME', logger: null, states: { HOME: { handler } } });
  expect(new StateInspector(machine).analyze().coverage).toBe('partial');
  expect(new StateInspector(machine).validate().valid).toBe(true);
  expect(new FlowDiagram(machine).analyze().transitionSource).toBe('declared');
  expect(handler).not.toHaveBeenCalled();
  expect(JSON.stringify(new FlowDiagram(machine).analyze())).not.toMatch(/Private response|No source inspection/);
});

test.each([createSdkFlow, createTraditionalFlow])('workbench exposes isolated authoritative analysis with no session data', async factory => {
  const workbench = new LocalWorkbench({ flows: [{ id: 'flow', name: 'Flow', createMachine: factory }] });
  try {
    const session = await workbench.createSession();
    expect(session.analysis).toMatchObject({ coverage: 'complete', valid: true, summary: { errors: 0, warnings: 0 } });
    session.analysis.nodes[0].id = 'CORRUPTED';
    expect((await workbench.inspect(session.id)).analysis.nodes[0].id).toBe('MENU');
    await workbench.send(session.id, '');
    await workbench.send(session.id, '1');
    await workbench.send(session.id, '2');
    const done = await workbench.send(session.id, 'SECRET_PIN');
    expect(done.analysis).toEqual((await workbench.reset(session.id)).analysis);
    expect(JSON.stringify(done.analysis)).not.toMatch(/SECRET_PIN|quantity|pin|response/);
  } finally { await workbench.close(); }
});
