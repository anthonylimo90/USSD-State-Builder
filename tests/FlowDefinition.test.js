const { createApp } = require('../lib/sdk');
const USSDStateMachine = require('../lib/USSDStateMachine');
const InMemoryStorage = require('../lib/InMemoryStorage');
const { FlowDiagram } = require('../lib/FlowDiagram');
const { StateInspector } = require('../lib/StateInspector');

describe('explicit flow definitions', () => {
  test('R5: compiled routes, next edges, replies and terminal routes render without handler inspection', () => {
    const app = createApp().flowVersion('orders-v1')
      .state('home', s => s.message('Home').on('1').goto('name').on('9').end('Bye'))
      .state('name', s => s.message('Name').save('name').next('done').on('?').reply('Help'))
      .state('done', s => s.message('Done').end()).logger(null).build();
    for (const state of Object.values(app.states)) state.handler.toString = () => { throw new Error('No source inspection'); };
    const definition = app.getFlowDefinition();
    expect(definition).toMatchObject({ schemaVersion: 1, flowVersion: 'orders-v1', coverage: 'complete' });
    expect(definition.states.home.transitions).toEqual(expect.arrayContaining([
      { input: '1', to: 'name', kind: 'goto' }, { input: '9', terminal: true, kind: 'end' }
    ]));
    expect(definition.states.name.transitions).toContainEqual({ to: 'done', kind: 'next' });
    const diagram = new FlowDiagram(app);
    expect(diagram.toMermaid()).toContain('home --> name : 1');
    expect(diagram.toMermaid()).toContain('home --> [*] : 9');
    expect(diagram.toDot()).toContain('"home" -> "name"');
    expect(diagram.toAscii()).toContain('name (input: 1)');
    expect(app.inspect().getPotentialTransitionsTo('name')).toEqual(['home']);
    expect(app.inspect().validate().warnings.some(w => w.state === 'name' && w.type === 'POTENTIALLY_UNREACHABLE')).toBe(false);
  });

  test('snapshot metadata and compiled behavior do not change when a builder or exported copy is mutated', async () => {
    let home;
    const builder = createApp().state('home', s => { home = s; s.message('Original').on('1').goto('done'); })
      .state('done', s => s.message('Done').end()).logger(null);
    const app = builder.build();
    home.message('Changed').on('2').goto('home');
    builder.state('extra', s => s.end());
    const copy = app.getFlowDefinition();
    copy.states.home.transitions.length = 0;
    expect(app.getFlowDefinition().states.home.transitions).toHaveLength(1);
    expect(Object.keys(app.getFlowDefinition().states)).toEqual(['home', 'done']);
    expect(await app.processInput('snapshot', '')).toBe('CON Original');
    expect(await app.processInput('snapshot', '1')).toBe('END Done');
  });

  test('retains form relationships, transformed field names and declared sensitivity without values or code', () => {
    const app = createApp().form('signup', f => {
      f.field('pin', field => field.prompt('Private prompt').sensitivity('secret').transform(value => value.trim()));
      f.confirm(() => 'Private confirmation').onConfirm('1').end('Submitted');
    }).logger(null).build();
    const definition = app.getFlowDefinition();
    expect(definition.states.signup_pin.field).toEqual({ name: 'pin', sensitivity: 'secret' });
    expect(definition.states.signup_pin.form).toEqual({ name: 'signup', role: 'field' });
    expect(definition.states.signup_confirm.form).toEqual({ name: 'signup', role: 'confirm' });
    expect(definition.coverage).toBe('complete');
    expect(JSON.stringify(definition)).not.toMatch(/Private|trim|Submitted/);
  });

  test('labels arbitrary handlers as dynamic, preserves declared routes and dynamic-menu control keys', () => {
    const app = createApp().state('home', s => s.run(() => ({ response: 'CON Hello', nextState: 'items' })))
      .state('items', s => s.dynamicMenu(() => ['item'], { pageSize: 2, refresh: {} }).next('done'))
      .state('done', s => s.end()).logger(null).build();
    const definition = app.getFlowDefinition();
    expect(definition.coverage).toBe('partial');
    expect(definition.states.home.dynamic).toBe(true);
    expect(definition.states.home.transitions).toEqual([]);
    expect(definition.states.items.localInputKeys).toEqual(['0', '99', '98']);
    expect(new FlowDiagram(app).toMermaid()).toContain('Dynamic transitions');
    expect(app.inspect().validate().warnings).toContainEqual(expect.objectContaining({ type: 'INCOMPLETE_METADATA' }));
  });

  test('traditional metadata is additive and unannotated traditional graphs remain explicitly inferred', async () => {
    const app = new USSDStateMachine({ initialState: 'home', logger: null, states: {
      home: { handler: () => ({ response: 'CON Home', nextState: 'done' }), metadata: {
        dynamic: false, terminal: false, transitions: [{ to: 'done', kind: 'next' }]
      } }, done: { handler: () => ({ response: 'END Done' }), metadata: { dynamic: false, terminal: true } }
    } });
    expect(app.getFlowDefinition().coverage).toBe('complete');
    expect(new FlowDiagram(app).toJSON().transitionSource).toBe('declared');
    expect(await app.processInput('traditional', '')).toBe('CON Home');
    const legacy = new USSDStateMachine({ initialState: 'home', states: {
      home: { handler: () => ({ response: 'CON Home' }) }
    } });
    expect(legacy.getFlowDefinition().coverage).toBe('partial');
    expect(new StateInspector(legacy).getSummary().metadataCoverage).toBe('partial');
  });
});

describe('session flow versions', () => {
  function flow(version, storage, options = {}, handler) {
    return createApp().flowVersion(version, options).storage(storage).logger(null)
      .state('home', s => s.message(`Home ${version}`).on('1').goto('same'))
      .state('same', s => s.run(handler || (() => ({ response: `CON ${version}` })))).build();
  }

  test('pins the version on initial input and keeps it when handlers replace session data', async () => {
    const storage = new InMemoryStorage();
    const app = flow('v1', storage, {}, () => ({ response: 'CON Saved', data: { value: 1, __ussdFlow: { version: 'forged' } } }));
    await app.processInput('pin', '');
    expect((await app.getSessionData('pin')).__ussdFlow).toEqual({ version: 'v1' });
    await app.processInput('pin', '1');
    expect((await app.getSessionData('pin')).__ussdFlow.version).toBe('v1');
    await app.setSessionData('pin', { __ussdFlow: { version: 'forged' } });
    expect((await app.getSessionData('pin')).__ussdFlow.version).toBe('v1');
  });

  test('does not execute new handlers, validators or middleware for an incompatible active session', async () => {
    const storage = new InMemoryStorage();
    await flow('v1', storage).processInput('incompatible', '');
    const handler = jest.fn(() => ({ response: 'END Incorrect' }));
    const app = flow('v2', storage, {}, handler);
    const middleware = jest.fn();
    app.use('beforeProcess', middleware);
    const response = await app.processInput('incompatible', '1');
    expect(response).toBe('END This service has changed. Please dial again to restart.');
    expect(await app.processInput('incompatible', '1')).toBe(response);
    expect(middleware).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(await storage.getState('incompatible')).toBe('home');
    expect((await storage.getData('incompatible')).__ussdFlow.version).toBe('v1');
    expect(await app.isSessionActive('incompatible')).toBe(false);
  });

  test('serves original handlers, navigation, data and hooks when an old definition is retained', async () => {
    const storage = new InMemoryStorage();
    const oldHandler = jest.fn(() => ({ response: 'CON Original flow', data: { order: 'original' } }));
    const old = flow('v1', storage, {}, oldHandler);
    await old.processInput('retained', '');
    const app = flow('v2', storage, { previousFlows: [old] }, () => { throw new Error('Wrong flow'); });
    expect(await app.processInput('retained', '1')).toBe('CON Original flow');
    expect(await app.getCurrentState('retained')).toBe('same');
    expect((await app.getSessionData('retained')).order).toBe('original');
    expect(await app.processInput('retained', '0')).toBe('CON Home v1');
    expect(await app.processInput('new', '')).toBe('CON Home v2');
  });

  test('rejects legacy active sessions when opting into versions and preserves completed receipts across deployment', async () => {
    const storage = new InMemoryStorage();
    const legacy = createApp().storage(storage).state('home', s => s.message('Legacy')).build();
    await legacy.processInput('legacy', '');
    const app = flow('v2', storage);
    expect(await app.processInput('legacy', '')).toMatch(/^END .*restart/);
    const terminal = createApp().flowVersion('v1').storage(storage).state('home', s => s.message('Receipt').end()).build();
    await terminal.processInput('completed', '');
    expect(await app.processInput('completed', 'anything')).toBe('END Receipt');
    await app.endSession('legacy');
    expect(await app.processInput('legacy', '')).toBe('CON Home v2');
  });

  test('an unversioned deployment cannot resume a versioned session', async () => {
    const storage = new InMemoryStorage();
    await flow('v1', storage).processInput('rollback', '');
    const legacy = createApp().storage(storage).state('home', s => s.message('Wrong flow')).build();
    expect(await legacy.processInput('rollback', '1')).toMatch(/^END .*restart/);
  });

  test('validates explicit versions, retained storage, duplicate versions and terminal restart responses', () => {
    const storage = new InMemoryStorage();
    expect(() => flow('', storage)).toThrow(/version/i);
    expect(() => flow('v2', storage, { restartResponse: 'CON Retry' })).toThrow(/END/);
    expect(() => flow('v2', storage, { previousFlows: [flow('v1', new InMemoryStorage())] })).toThrow(/storage/i);
    expect(() => flow('v2', storage, { previousFlows: [flow('v1', storage), flow('v1', storage)] })).toThrow(/duplicate/i);
  });
});

describe('flow version concurrency and declarations', () => {
  test('old and new entrypoints sharing storage serialize a terminal effect exactly once', async () => {
    const storage = new InMemoryStorage();
    let finish;
    let entered;
    const gate = new Promise(resolve => { finish = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    const effect = jest.fn(async () => {
      entered();
      await gate;
      return { response: 'END Committed', data: { committed: true } };
    });
    const ended = jest.fn();
    const old = createApp().flowVersion('v1').storage(storage).logger(null)
      .state('home', s => s.message('Home').on('1').goto('done'))
      .state('done', s => s.run(effect)).use('onSessionEnd', ended).build();
    const current = createApp().flowVersion('v2', { previousFlows: [old] }).storage(storage)
      .state('home', s => s.message('New')).build();
    await old.processInput('concurrent', '');
    const first = old.processInput('concurrent', '1');
    await started;
    const second = current.processInput('concurrent', '1');
    finish();
    expect(await Promise.all([first, second])).toEqual(['END Committed', 'END Committed']);
    expect(effect).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledTimes(1);
    expect((await storage.getData('concurrent')).__ussdFlow.version).toBe('v1');
    expect(old._sessionLocks.size).toBe(0);
  });

  test('custom declarations render without inspecting source and sensitivity is validated', () => {
    const app = createApp().state('home', s => s.run(() => ({ response: 'CON Home' }))
      .metadata({ dynamic: false, transitions: [{ to: 'done', kind: 'next' }] }))
      .state('done', s => s.message('END Goodbye')).build();
    expect(app.getFlowDefinition().coverage).toBe('complete');
    expect(app.getFlowDefinition().states.done.terminal).toBe(true);
    app.states.home.handler.toString = () => { throw new Error('Source inspection'); };
    expect(app.inspect().toDotGraph()).toContain('"home" -> "done"');
    expect(() => createApp().state('home', s => s.save('pin').sensitivity('invalid'))).toThrow(/sensitivity/);
  });

  test('initial validation failures are pinned and cannot execute a later definition', async () => {
    const storage = new InMemoryStorage();
    const ValidationError = require('../lib/ValidationError');
    const old = createApp().flowVersion('v1').storage(storage).logger(null)
      .state('home', s => s.message('Home').validate(() => { throw new ValidationError('Invalid'); })).build();
    expect(await old.processInput('invalid', 'x')).toMatch(/^CON Invalid/);
    expect((await storage.getData('invalid')).__ussdFlow.version).toBe('v1');
    const next = createApp().flowVersion('v2').storage(storage).state('home', s => s.message('New')).build();
    expect(await next.processInput('invalid', '')).toMatch(/^END .*restart/);
  });
});

test('public data writes cannot adopt a legacy session, and completed receipts survive removed states', async () => {
  const storage = new InMemoryStorage();
  const legacy = createApp().storage(storage).state('old', s => s.message('Old')).build();
  await legacy.processInput('legacy-write', '');
  const current = createApp().flowVersion('v2').storage(storage).state('home', s => s.message('New')).build();
  await current.setSessionData('legacy-write', { value: 1, __ussdFlow: { version: 'v2' } });
  expect(await current.processInput('legacy-write', '')).toMatch(/^END .*restart/);
  await storage.setState('receipt', 'removed', 300);
  await storage.setData('receipt', { __ussdFlow: { version: 'v2' }, __ussdLifecycle: { completedResponse: 'END Paid' } }, 300);
  expect(await current.processInput('receipt', '')).toBe('END Paid');
});
