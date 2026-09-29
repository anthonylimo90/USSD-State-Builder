import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'ussd-package-'));
const consumer = join(temporary, 'consumer');

function run(command, args, cwd = consumer) {
  return execFileSync(command, args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, npm_config_cache: join(temporary, 'npm-cache') }
  });
}

function declaredValues(file) {
  const program = ts.createProgram([file], {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext
  });
  const checker = program.getTypeChecker();
  const symbol = checker.getSymbolAtLocation(program.getSourceFile(file));
  return new Set(checker.getExportsOfModule(symbol)
    .filter(exported => {
      const target = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      return Boolean(target.flags & ts.SymbolFlags.Value);
    })
    .map(exported => exported.name));
}

try {
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temporary], root));
  const tarball = join(temporary, packed[0].filename);
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'ussd-package-consumer', private: true }));
  run('npm', ['install', '--offline', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund', '--no-package-lock', tarball]);

  writeFileSync(join(consumer, 'consumer.cjs'), `
const assert = require('node:assert/strict');
const root = require('ussd-state-builder');
const sdk = require('ussd-state-builder/sdk');
assert.equal(typeof root.USSDStateMachine, 'function');
assert.equal(typeof root.createApp, 'function');
const adapter = new root.AfricasTalkingAdapter({ applicationId: 'packed', serviceCode: '*384*000#' });
assert.equal(adapter.formatResponse('CON Welcome').headers['Content-Type'], 'text/plain; charset=utf-8');
assert.equal(root.normalizeUssdInput('1*1', 'cumulative').position, 2);
assert.equal(typeof sdk.createApp, 'function');
const events = new root.AfricasTalkingEventAdapter({ applicationId: 'packed', serviceCode: '*384*000#' });
const endEvent = events.normalize({ method: 'POST', contentType: 'application/x-www-form-urlencoded', body: new URLSearchParams({
  date: '2026-09-29 10:11:12', sessionId: 's1', serviceCode: '*384*000#', networkCode: '99999',
  phoneNumber: '+254700000001', status: 'Success', cost: '0.00', durationInMillis: '1234',
  hopsCount: '2', hopsMetadata: '', input: '1', lastAppResponse: 'END Done'
}).toString() });
assert.equal(endEvent.status, 'Success');
assert.equal(typeof root.RedisSessionEventStore, 'function');
assert.equal(typeof root.SessionEventGateway, 'function');
(async () => {
  const machine = sdk.createApp().flowVersion('packed-v1').state('START', state => state.message('Welcome')).build();
  assert.equal(await machine.processInput('cjs-session', ''), 'CON Welcome');
  assert.equal(machine.getFlowDefinition().flowVersion, 'packed-v1');
  assert.equal((await machine.getSessionData('cjs-session')).__ussdFlow.version, 'packed-v1');
  const workbench = new root.LocalWorkbench({ flows: [{ id: 'packed', name: 'Packed flow',
    createMachine: () => root.createApp().flowVersion('packed-v1').logger(null)
      .state('START', state => state.message('Welcome').on('1').goto('NEXT'))
      .state('NEXT', state => state.message('Next')).build() }] });
  const session = await workbench.createSession();
  assert.equal(session.analysis.transitionSource, 'declared');
  assert.equal(root.analyzeFlowDefinition(session.definition).nodes.length, 2);
  assert.deepEqual(new root.FlowDiagram(machine).analyze(), root.analyzeFlowDefinition(machine.getFlowDefinition()));
  await workbench.getTester(session.id).start().input('1').expectState('NEXT').run();
  assert.equal((await workbench.inspect(session.id)).totalTurns, 2);
  assert.equal((await workbench.reset(session.id)).state, null);
  const packageRoot = require('node:path').dirname(require.resolve('ussd-state-builder'));
  for (const asset of ['index.html', 'ui.js', 'graph.js', 'keypad.js', 'style.css']) {
    assert.ok(require('node:fs').statSync(require('node:path').join(packageRoot, 'lib/workbench', asset)).size > 0);
  }
  await workbench.close();
  console.log(JSON.stringify({ root: Object.keys(root).sort(), sdk: Object.keys(sdk).sort() }));
})().catch(error => { console.error(error); process.exitCode = 1; });
`);
  writeFileSync(join(consumer, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import root, * as rootNamed from 'ussd-state-builder';
import sdk, * as sdkNamed from 'ussd-state-builder/sdk';
assert.equal(rootNamed.USSDStateMachine, root.USSDStateMachine);
assert.equal(rootNamed.createApp, root.createApp);
assert.equal(sdkNamed.createApp, sdk.createApp);
const machine = sdkNamed.createApp().flowVersion('packed-v1').state('START', state => state.message('Welcome')).build();
assert.equal(await machine.processInput('esm-session', ''), 'CON Welcome');
assert.equal(machine.getFlowDefinition().flowVersion, 'packed-v1');
console.log(JSON.stringify({ root: Object.keys(rootNamed).filter(key => key !== 'default').sort(), sdk: Object.keys(sdkNamed).filter(key => key !== 'default').sort() }));
`);
  const cjs = JSON.parse(run(process.execPath, ['consumer.cjs']));
  const esm = JSON.parse(run(process.execPath, ['consumer.mjs']));
  assert.deepEqual(esm, cjs, 'CJS and ESM named exports must match');

  for (const entry of ['root', 'sdk']) {
    const file = join(consumer, 'node_modules', 'ussd-state-builder', 'types', entry === 'root' ? 'index.d.ts' : 'sdk.d.ts');
    const declared = declaredValues(file);
    declared.delete('default');
    assert.deepEqual([...declared].sort(), cjs[entry], `${entry} declaration values must match runtime exports`);
  }

  const consumerSource = `
import rootDefault, { createApp, InMemoryStorage, USSDStateMachine, createExportableMetrics, AfricasTalkingAdapter, ProviderRequestError, normalizeUssdInput, TurnGateway, InMemoryTurnStore, AfricasTalkingEventAdapter, RedisSessionEventStore, SessionEventGateway, RedisStorage, LocalWorkbench, createWorkbenchServer, analyzeFlowDefinition, FlowAnalysis, FlowDiagram, StateInspector } from 'ussd-state-builder';
import sdkDefault, { DynamicMenu } from 'ussd-state-builder/sdk';
const storage = new InMemoryStorage();
const machine: USSDStateMachine = createApp().flowVersion('typed-v1', { previousFlows: [] }).state('START', s => s.run((input, id, context) => { context.signal?.throwIfAborted(); void context.deadlineAt; return 'Welcome'; }).save('name').sensitivity('public').metadata({ dynamic: false })).storage(storage).build();
const analysis: FlowAnalysis = analyzeFlowDefinition(machine.getFlowDefinition());
const inspected: FlowAnalysis = new StateInspector(machine).analyze();
const diagramAnalysis: FlowAnalysis = new FlowDiagram(machine).analyze();
const sdkInspection: FlowAnalysis = createApp().state('HOME', s => s.end()).build().inspect().analyze();
void [analysis, inspected, diagramAnalysis, sdkInspection];
const menu = DynamicMenu.create<string>().fetch(() => ['a']).format(item => item).build();
const adapter = new AfricasTalkingAdapter({ applicationId: 'typed', serviceCode: '*384*000#' });
const gateway = new TurnGateway({ adapter, machine, store: new InMemoryTurnStore({ storage }), deadlineMs: 1000, leaseMs: 900, ownershipCheckMs: 50 });
void gateway.handle({ method: 'POST', contentType: 'application/x-www-form-urlencoded', body: 'text=' }, { signal: new AbortController().signal, deadlineAt: Date.now() + 1000 });
const eventAdapter = new AfricasTalkingEventAdapter({ applicationId: 'typed', serviceCode: '*384*000#' });
const eventStore = new RedisSessionEventStore({ storage: new RedisStorage() });
const eventGateway = new SessionEventGateway({ adapter: eventAdapter, store: eventStore });
void eventGateway.handle({ method: 'POST', contentType: 'application/x-www-form-urlencoded', body: 'date=' });
const turn = adapter.normalize({ method: 'POST', contentType: 'application/x-www-form-urlencoded', body: 'text=' });
const binding = adapter.bindSession(turn);
const metrics = createExportableMetrics();
void [binding, new ProviderRequestError('INVALID'), normalizeUssdInput('1*1', 'incremental')];
void [rootDefault, sdkDefault, machine, menu, metrics];
const workbench = new LocalWorkbench({ flows: [{ id: 'typed', name: 'Typed flow', createMachine: () => machine }] });
void workbench.createSession().then(session => workbench.getTester(session.id).start().run());
void createWorkbenchServer({ workbench }).listen(0);
`;
  writeFileSync(join(consumer, 'consumer.mts'), consumerSource);
  writeFileSync(join(consumer, 'consumer.ts'), consumerSource);
  for (const [name, module, resolution, file] of [
    ['nodenext', 'NodeNext', 'NodeNext', 'consumer.mts'],
    ['bundler', 'ESNext', 'Bundler', 'consumer.ts']
  ]) {
    writeFileSync(join(consumer, `tsconfig.${name}.json`), JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module, moduleResolution: resolution,
        strict: true, noEmit: true, skipLibCheck: true
      }, files: [file]
    }));
    run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', `tsconfig.${name}.json`]);
  }
  const manifest = JSON.parse(readFileSync(join(consumer, 'node_modules/ussd-state-builder/package.json'), 'utf8'));
  assert.equal(manifest.name, 'ussd-state-builder');
  console.log(`Packed ${packed[0].filename}: CJS, ESM, declaration parity, NodeNext, and bundler checks passed.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
