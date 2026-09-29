const { LocalWorkbench, WorkbenchError, USSDStateMachine, InMemoryStorage, createApp } = require('..');
const { createSdkFlow, createTraditionalFlow } = require('../examples/workbench/flows');

const shop = (createMachine = createSdkFlow, options = {}) => new LocalWorkbench({
  flows: [{ id: 'shop', name: 'Synthetic shop', createMachine }], ...options
});

describe.each([['SDK', createSdkFlow], ['traditional', createTraditionalFlow]])('%s workbench', (_name, factory) => {
  test('reports actual state, navigation, validation, timings and only public session data', async () => {
    const workbench = shop(factory);
    const session = await workbench.createSession();
    expect(session).toMatchObject({ status: 'idle', state: null, initialState: 'MENU' });
    expect((await workbench.send(session.id, '')).state).toBe('MENU');
    expect((await workbench.send(session.id, '1')).state).toBe('QUANTITY');
    const invalid = await workbench.send(session.id, 'bad');
    expect(invalid).toMatchObject({ state: 'QUANTITY', validationError: true });
    expect(invalid.response).toContain('Enter a quantity from 1 to 9');
    expect(invalid.history.at(-1)).toMatchObject({ outcome: 'validation_error', errorClass: 'validation', durationMs: expect.any(Number) });
    const pin = await workbench.send(session.id, '2');
    expect(pin).toMatchObject({ state: 'PIN', data: { values: { quantity: 2 }, hiddenFields: 0 } });
    expect(pin.stateHistory).toEqual(['MENU', 'QUANTITY']);
    const back = await workbench.send(session.id, '0');
    expect(back.state).toBe('QUANTITY');
    expect(back.history.at(-1)).toMatchObject({ previousState: 'PIN', nextState: 'QUANTITY' });
    await workbench.send(session.id, '3');
    const done = await workbench.send(session.id, 'SYNTHETIC_SECRET');
    expect(done).toMatchObject({ state: 'DONE', status: 'ended', data: { values: { quantity: 3 }, hiddenFields: 1 } });
    expect(done.history.at(-1).nextState).toBeNull();
    expect(JSON.stringify(done)).not.toMatch(/SYNTHETIC_SECRET|"sessionId":/);
    expect(JSON.stringify(done.history)).not.toMatch(/"input":|"response":/);
    await expect(workbench.send(session.id, '1')).rejects.toMatchObject({ code: 'SESSION_CLOSED' });
    await workbench.close();
  });
});

test('sessions and resets are isolated, even when factories share a storage adapter', async () => {
  const storage = new InMemoryStorage();
  const workbench = shop(() => createApp().storage(storage).logger(null)
    .state('MENU', state => state.message('Home').on('1').goto('NEXT'))
    .state('NEXT', state => state.message('Next')).build());
  const a = await workbench.createSession();
  const b = await workbench.createSession();
  await workbench.send(a.id, '');
  await workbench.send(b.id, '');
  await workbench.send(a.id, '1');
  expect((await workbench.inspect(b.id)).state).toBe('MENU');
  expect((await workbench.inspect(a.id)).state).toBe('NEXT');
  const reset = await workbench.reset(a.id);
  expect(reset).toMatchObject({ id: a.id, state: null, response: null, history: [], totalTurns: 0 });
  expect((await workbench.inspect(b.id)).history).toHaveLength(1);
  expect(storage.size()).toBe(1);
  await workbench.closeSession(a.id);
  await expect(workbench.inspect(a.id)).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
  await workbench.close();
  expect(storage.size()).toBe(0);
});

test('existing tester and simulator/CLI clients share managed state and trace history', async () => {
  const workbench = shop();
  const session = await workbench.createSession();
  await workbench.getTester(session.id).start().expectState('MENU').input('1').expectState('QUANTITY').run();
  const simulator = workbench.getSimulator(session.id);
  expect((await simulator.send('bad')).response).toContain('Please try again');
  expect((await workbench.inspect(session.id)).totalTurns).toBe(3);
  expect((await simulator.send('2')).state).toBe('PIN');
  await simulator.reset();
  expect((await simulator.send('')).state).toBe('MENU');
  expect((await workbench.inspect(session.id)).totalTurns).toBe(1);
  const tester = workbench.getTester(session.id);
  await tester.input('1').input('2').expectSessionData({ quantity: 2 }).run();
  await tester.reset().start().expectState('MENU').run();
  expect((await workbench.inspect(session.id)).totalTurns).toBe(1);
  await workbench.close();
});

test('secret/unspecified fields override public declarations and large/nested values stay hidden', async () => {
  const machine = () => new USSDStateMachine({ initialState: 'HOME', logger: null, storage: new InMemoryStorage(), states: {
    HOME: { metadata: { field: { name: 'secret', sensitivity: 'public' } }, handler: () => ({ response: 'CON Home', data: {
      secret: 'DO_NOT_EXPORT', undeclared: 'OTHER_SECRET', large: 'x'.repeat(300), nested: { token: 'NESTED_SECRET' }, count: 2
    } }) },
    SECRET: { metadata: { field: { name: 'secret', sensitivity: 'secret' } }, handler: () => ({ response: 'END Done' }) },
    LARGE: { metadata: { field: { name: 'large', sensitivity: 'public' } }, handler: () => ({ response: 'END Done' }) },
    NESTED: { metadata: { field: { name: 'nested', sensitivity: 'public' } }, handler: () => ({ response: 'END Done' }) },
    COUNT: { metadata: { field: { name: 'count', sensitivity: 'public' } }, handler: () => ({ response: 'END Done' }) }
  } });
  const workbench = shop(machine);
  const session = await workbench.createSession();
  const result = await workbench.send(session.id, '');
  expect(result.data).toEqual({ values: { count: 2 }, hiddenFields: 4 });
  expect(result.definition.coverage).toBe('partial');
  expect(JSON.stringify(result)).not.toMatch(/DO_NOT_EXPORT|OTHER_SECRET|NESTED_SECRET/);
  result.definition.states.COUNT.field.sensitivity = 'secret';
  expect((await workbench.inspect(session.id)).data.values).toEqual({ count: 2 });
  await workbench.close();
});

test('errors are classified safely; sessions, history, input and response have bounds', async () => {
  const workbench = shop(() => createApp().logger(null).state('HOME', state => state.run(input => {
    if (input === 'error') throw new WorkbenchError('SECRET_ERROR', 599);
    return input === 'large' ? 'x'.repeat(9000) : 'Home';
  })).build(), { maxSessions: 1, maxHistory: 2 });
  const session = await workbench.createSession();
  await expect(workbench.createSession()).rejects.toMatchObject({ code: 'SESSION_LIMIT' });
  await expect(workbench.send(session.id, 'x'.repeat(161))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await workbench.send(session.id, '');
  await workbench.send(session.id, '1');
  const error = await workbench.send(session.id, 'error');
  expect(error).toMatchObject({ status: 'error', error: 'TURN_FAILED', response: null, totalTurns: 3 });
  expect(error.history).toHaveLength(2);
  expect(JSON.stringify(error)).not.toContain('SECRET_ERROR');
  expect((await workbench.send(session.id, 'large')).error).toBe('RESPONSE_TOO_LARGE');
  await workbench.close();
});

test('concurrent turns and resets are rejected while a session is running', async () => {
  let entered;
  let release;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const workbench = shop(() => createApp().logger(null).state('HOME', state => state.run(async () => {
    entered(); await held; return 'Done';
  })).build());
  const session = await workbench.createSession();
  const turn = workbench.send(session.id, '');
  await enteredPromise;
  await expect(workbench.send(session.id, '1')).rejects.toMatchObject({ code: 'SESSION_BUSY' });
  await expect(workbench.reset(session.id)).rejects.toMatchObject({ code: 'SESSION_BUSY' });
  await expect(workbench.closeSession(session.id)).rejects.toMatchObject({ code: 'SESSION_BUSY' });
  release();
  expect((await turn).totalTurns).toBe(1);
  await workbench.close();
});

test('factories must return fresh machines and in-flight creations count toward capacity', async () => {
  const shared = createSdkFlow();
  const workbench = shop(() => shared);
  await workbench.createSession();
  await expect(workbench.createSession()).rejects.toThrow('fresh state machine');
  expect(workbench.listSessions()).toHaveLength(1);
  await workbench.close();
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  const bounded = shop(async () => { await delayed; return createSdkFlow(); }, { maxSessions: 1 });
  const first = bounded.createSession();
  await expect(bounded.createSession()).rejects.toMatchObject({ code: 'SESSION_LIMIT' });
  release();
  await first;
  await bounded.close();
});

test('expired state is visible and a reset starts with a fresh runtime session', async () => {
  let now = 1000;
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
  const workbench = shop(() => createApp().logger(null).timeout(1).state('HOME', state => state.message('Home')).build());
  try {
    const session = await workbench.createSession();
    await workbench.send(session.id, '');
    now = 2001;
    expect(await workbench.inspect(session.id)).toMatchObject({ status: 'expired', state: null, response: null });
    await expect(workbench.send(session.id, '1')).rejects.toMatchObject({ code: 'SESSION_CLOSED' });
    await workbench.reset(session.id);
    expect((await workbench.send(session.id, '')).state).toBe('HOME');
    await workbench.close();
  } finally { clock.mockRestore(); }
});
