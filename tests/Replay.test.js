const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync, cpSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ReplayClock, ReplayError, replayScenario, createReplayDraft, exportReplayTest, createApp,
  createTraceEvent, InMemoryStorage, LocalWorkbench } = require('..');
const { createReplayLab, createBrokenReplayLab, regressionFixture, fakeResponses } = require('../examples/workbench/replay-flows');
const { createDemoWorkbench } = require('../examples/workbench/server');
const reference = { modulePath: '../factory', factoryExport: 'createMachine', responsesExport: 'responses' };
const simple = () => ({ schemaVersion: 1, fixtureType: 'turn-sequence', provenance: 'synthetic', caseId: 'simple',
  flowVersion: null, clock: { startMs: 1780000000000 }, turns: [
    { atMs: 0, input: { kind: 'synthetic', value: '' }, external: [], expected: { outcome: 'success', state: 'HOME' } }
  ] });
const machine = ({ storage, clock }) => createApp().storage(storage).clock(clock).logger(null).state('HOME', s => s.message('Home')).build();

test('regression passes fixed behavior and fails when the same defect returns', async () => {
  const result = await replayScenario(regressionFixture(), { createMachine: createReplayLab, responses: fakeResponses });
  expect(result).toMatchObject({ passed: true, turns: [{ atMs: 0 }, { atMs: 100 }, { atMs: 220 }] });
  await expect(replayScenario(regressionFixture(), { createMachine: createBrokenReplayLab, responses: fakeResponses }))
    .rejects.toMatchObject({ code: 'EXPECTATION_MISMATCH', turn: 3 });
  expect(JSON.stringify(result)).not.toMatch(/response|input|Synthetic stock|available|session/);
});

test('virtual clocks advance without waiting, enforce bounds, and do not change global time', async () => {
  const before = Date.now();
  const clock = new ReplayClock(1000);
  await clock.sleep(3600000);
  expect(clock.now()).toBe(3601000);
  expect(() => clock.advanceTo(1)).toThrow('NON_MONOTONIC_CLOCK');
  expect(() => new ReplayClock(-1)).toThrow('INVALID_CLOCK');
  expect(Date.now() - before).toBeLessThan(1000);
  const clocks = [];
  const factory = async context => { clocks.push(context.clock); await Promise.resolve(); return machine(context); };
  const other = simple(); other.clock.startMs += 5000;
  await Promise.all([replayScenario(simple(), { createMachine: factory }), replayScenario(other, { createMachine: factory })]);
  expect(clocks.map(item => item.now())).toEqual([1780000000000, 1780000005000]);
});

test('injected runtime/storage clocks reproduce expiration and clear replay storage', async () => {
  const fixture = simple();
  fixture.turns.push({ atMs: 100, input: { kind: 'synthetic', value: '1' }, external: [], expected: { outcome: 'success', state: 'INNER' } },
    { atMs: 1200, input: { kind: 'synthetic', value: '2' }, external: [], expected: { outcome: 'success', state: 'HOME' } });
  let storage;
  const factory = context => { storage = context.storage; return createApp().storage(storage).clock(context.clock).timeout(1).logger(null)
    .state('HOME', s => s.message('Home').on('1').goto('INNER')).state('INNER', s => s.message('Inner').on('2').end('Done')).build(); };
  expect((await replayScenario(fixture, { createMachine: factory })).turns[2].state).toBe('HOME');
  expect(storage.size()).toBe(0);
});

test('capture drafts contain aliases, no inputs; unresolved and captured fixtures cannot run', async () => {
  const bench = createDemoWorkbench();
  try {
    const session = await bench.createSession('sdk-shop');
    for (const input of ['', '1', '2', 'PRIVATE_PIN_MARKER']) await bench.send(session.id, input);
    const exported = await bench.exportSession(session.id);
    expect(exported.draft.provenance).toBe('captured-redacted');
    expect(exported.fixture.turns.every(turn => turn.input.value.startsWith('__REPLACE_INPUT_'))).toBe(true);
    expect(exported.testSource).not.toContain('PRIVATE_PIN_MARKER');
    const factory = jest.fn(machine);
    for (const fixture of [exported.draft, exported.fixture]) {
      await expect(replayScenario(fixture, { createMachine: factory })).rejects.toMatchObject({ code: 'SYNTHETIC_REPLACEMENTS_REQUIRED' });
    }
    expect(factory).not.toHaveBeenCalled();
    const before = await bench.inspect(session.id);
    const synthetic = exported.fixture;
    synthetic.turns.forEach((turn, index) => { turn.input.value = ['', '1', '2', '1234'][index]; });
    expect((await bench.replay(session.id, synthetic)).passed).toBe(true);
    expect(await bench.inspect(session.id)).toEqual(before);
  } finally { await bench.close(); }
});

test('refuses truncated/oversized histories and permits an explicitly authored fresh fixture', async () => {
  const bench = new LocalWorkbench({ flows: [{ id: 'tiny', name: 'Tiny', createMachine: () => machine({ storage: new InMemoryStorage(), clock: { now: () => Date.now() } }),
    replay: { ...reference, createMachine: machine } }], maxHistory: 1 });
  try {
    const session = await bench.createSession();
    await bench.send(session.id, ''); await bench.send(session.id, 'x');
    await expect(bench.exportSession(session.id)).rejects.toMatchObject({ code: 'INCOMPLETE_HISTORY' });
    expect((await bench.exportSession(session.id, simple())).fixture.provenance).toBe('synthetic');
    expect(() => createReplayDraft([])).toThrow('EXPORT_NEEDS_1_TO_64_TURNS');
  } finally { await bench.close(); }
});

test('remote/shared storage, wrong clocks and incompatible versions are rejected before processing', async () => {
  const process = jest.fn();
  await expect(replayScenario(simple(), { createMachine: () => ({ storage: {}, processInput: process }) }))
    .rejects.toMatchObject({ code: 'ISOLATED_REPLAY_FACTORY_REQUIRED' });
  expect(process).not.toHaveBeenCalled();
  await expect(replayScenario(simple(), { createMachine: ({ storage }) => createApp().storage(storage).state('HOME', s => s.end()).build() }))
    .rejects.toMatchObject({ code: 'ISOLATED_REPLAY_FACTORY_REQUIRED' });
  const fixture = simple(); fixture.flowVersion = 'different';
  await expect(replayScenario(fixture, { createMachine: machine })).rejects.toMatchObject({ code: 'FLOW_VERSION_MISMATCH' });
});

test('fake effects require references, correct order, complete consumption and monotonic times', async () => {
  const fixture = regressionFixture();
  const factory = jest.fn(createReplayLab);
  await expect(replayScenario(fixture, { createMachine: factory })).rejects.toMatchObject({ code: 'FAKE_RESPONSE_REQUIRED' });
  expect(factory).not.toHaveBeenCalled();
  fixture.turns[2].external[0].operation = 'wrong-operation';
  await expect(replayScenario(fixture, { createMachine: factory, responses: fakeResponses })).rejects.toMatchObject({ code: 'UNSCRIPTED_EFFECT', turn: 3 });
  const unconsumed = simple(); unconsumed.turns[0].external = regressionFixture().turns[2].external;
  await expect(replayScenario(unconsumed, { createMachine: machine, responses: fakeResponses })).rejects.toMatchObject({ code: 'UNCONSUMED_EFFECT' });
  const backwards = regressionFixture(); backwards.turns[2].external[0].atMs = 199;
  await expect(replayScenario(backwards, { createMachine: factory, responses: fakeResponses })).rejects.toMatchObject({ code: 'NON_MONOTONIC_CLOCK' });
});

test('catching an unscripted effect in application code cannot turn replay into a passing test', async () => {
  const factory = ({ storage, clock, effects }) => createApp().storage(storage).clock(clock).logger(null)
    .state('HOME', s => s.run(async () => { try { await effects.call('undeclared'); } catch { /* handler recovery */ } return 'Recovered'; })).build();
  await expect(replayScenario(simple(), { createMachine: factory })).rejects.toMatchObject({ code: 'UNSCRIPTED_EFFECT' });
});

test('scripted dependency errors can reproduce error outcomes without exporting exceptions', async () => {
  const fixture = regressionFixture();
  fixture.turns[2].external[0].result = 'error'; fixture.turns[2].external[0].statusCode = 503;
  fixture.turns[2].expected.outcome = 'error';
  expect((await replayScenario(fixture, { createMachine: createReplayLab, responses: fakeResponses })).passed).toBe(true);
});

test('fake response values are bounded JSON and never invoke getters/toJSON/functions', async () => {
  const callable = jest.fn(() => ({ available: 2 }));
  const getter = {}; Object.defineProperty(getter, 'available', { enumerable: true, get: callable });
  const cyclic = {}; cyclic.self = cyclic;
  for (const value of [callable, getter, { toJSON: callable }, cyclic, new Array(2), 'x'.repeat(40000), undefined, NaN]) {
    await expect(replayScenario(regressionFixture(), { createMachine: createReplayLab, responses: { 'inventory-two': value } }))
      .rejects.toMatchObject({ code: 'INVALID_FAKE_RESPONSE' });
  }
  const registry = {}; Object.defineProperty(registry, 'inventory-two', { get: callable });
  for (const responses of [registry, null, []]) {
    await expect(replayScenario(regressionFixture(), { createMachine: createReplayLab, responses }))
      .rejects.toMatchObject({ code: 'INVALID_FAKE_RESPONSE' });
  }
  expect(callable).not.toHaveBeenCalled();
});

test('factory, cleanup and malformed fixture failures remain safe and exports validate references', async () => {
  await expect(replayScenario(simple(), { createMachine: () => { throw new Error('PRIVATE_TOKEN'); } })).rejects.toThrow('REPLAY_FAILED');
  await expect(replayScenario({ ...simple(), secret: 'PRIVATE' }, { createMachine: machine })).rejects.toThrow('INVALID_FIXTURE');
  const error = new ReplayError('PRIVATE_TOKEN'); expect(error.code).toBe('REPLAY_FAILED');
  expect(() => exportReplayTest(simple(), { ...reference, factoryExport: 'x); throw 1;' })).toThrow('EXPORT_FACTORY_REFERENCE_REQUIRED');
  const captured = JSON.parse(JSON.stringify(simple()));
  captured.provenance = 'captured-redacted'; captured.turns[0].input = { kind: 'redacted', alias: 'missing-input' };
  captured.turns[0].external = [{ operation: 'inventory', atMs: 20, result: 'success', statusCode: 200, responseRef: null }];
  expect(exportReplayTest(captured, reference)).toContain('REPLACE_RESPONSE_1_1');
});

test('generated Jest file runs outside the workbench and fails when the defect is reintroduced', () => {
  const temporary = realpathSync(mkdtempSync(path.join(tmpdir(), 'ussd-replay-jest-')));
  const project = path.resolve(__dirname, '..');
  try {
    mkdirSync(path.join(temporary, 'tests')); mkdirSync(path.join(temporary, 'node_modules'));
    symlinkSync(project, path.join(temporary, 'node_modules/ussd-state-builder'), 'dir');
    cpSync(path.join(project, 'examples/workbench'), path.join(temporary, 'examples/workbench'), { recursive: true });
    writeFileSync(path.join(temporary, 'factory.js'), `const factories = require('./examples/workbench/replay-flows');
const broken = require('./toggle.json').broken;
exports.createMachine = broken ? factories.createBrokenReplayLab : factories.createReplayLab;
exports.responses = factories.fakeResponses;`);
    const filename = path.join(temporary, 'tests/stock.test.js');
    writeFileSync(filename, exportReplayTest(regressionFixture(), reference));
    const run = broken => {
      writeFileSync(path.join(temporary, 'toggle.json'), JSON.stringify({ broken }));
      return spawnSync(process.execPath, [path.join(project, 'node_modules/jest/bin/jest.js'), '--runInBand', '--runTestsByPath', filename,
        '--config', JSON.stringify({ rootDir: temporary, testEnvironment: 'node' })], { encoding: 'utf8', timeout: 15000 });
    };
    const fixed = run(false); expect(fixed.error).toBeUndefined();
    if (fixed.status !== 0) throw new Error(fixed.stderr || fixed.stdout);
    const broken = run(true); expect(broken.status).toBe(1); expect(broken.stderr).toContain('EXPECTATION_MISMATCH');
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test('replay serializes the source session and unlocks after safe cleanup failures', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const bench = new LocalWorkbench({ flows: [{ id: 'locked', name: 'Locked',
    createMachine: () => machine({ storage: new InMemoryStorage(), clock: { now: () => Date.now() } }),
    replay: { ...reference, createMachine: async context => { await gate; return machine(context); } } }] });
  try {
    const session = await bench.createSession();
    const replay = bench.replay(session.id, simple());
    await expect(bench.send(session.id, '')).rejects.toMatchObject({ code: 'SESSION_BUSY' });
    await expect(bench.reset(session.id)).rejects.toMatchObject({ code: 'SESSION_BUSY' });
    await expect(bench.exportSession(session.id, simple())).rejects.toMatchObject({ code: 'SESSION_BUSY' });
    release(); await replay;
    expect((await bench.inspect(session.id)).totalTurns).toBe(0);
    const factory = context => { const result = machine(context); result.cleanup = () => { throw new Error('PRIVATE_CLEANUP'); }; return result; };
    await expect(replayScenario(simple(), { createMachine: factory })).rejects.toMatchObject({ code: 'REPLAY_CLEANUP_FAILED' });
    expect((await bench.send(session.id, '')).totalTurns).toBe(1);
  } finally { release(); await bench.close(); }
});
