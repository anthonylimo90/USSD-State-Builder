import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'ussd-onboarding-')));
let server;
const environment = { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH || ''}`, PORT: '0' };
function run(command, args) {
  const result = spawnSync(command, args, { cwd: temporary, env: environment, encoding: 'utf8', timeout: 120000 });
  if (result.error) throw result.error;
  return result;
}
function passed(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
async function start() {
  server = spawn(process.execPath, ['examples/workbench/onboarding/server.js'], { cwd: temporary, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Onboarding startup timed out')), 10000);
    server.stdout.on('data', chunk => {
      output += chunk;
      const match = /Onboarding workbench: (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', () => { clearTimeout(timer); reject(new Error('Onboarding server exited before startup')); });
  });
}
async function stop() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
    server.once('exit', () => { clearTimeout(timer); resolve(); });
    server.kill('SIGTERM');
  });
}
try {
  // Copy only the source and manifests needed by the exercise, never local secrets or installed dependencies.
  for (const entry of ['package.json', 'package-lock.json', 'index.js', 'index.mjs', 'sdk.js', 'sdk.mjs', 'lib', 'types']) {
    cpSync(join(root, entry), join(temporary, entry), { recursive: true });
  }
  for (const entry of ['docs/WORKBENCH-QUICKSTART.md', ...['flow.js', 'server.js', 'scenario.json'].map(file => `examples/workbench/onboarding/${file}`)]) {
    mkdirSync(dirname(join(temporary, entry)), { recursive: true });
    cpSync(join(root, entry), join(temporary, entry));
  }
  mkdirSync(join(temporary, 'tests'));
  passed(run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline']));
  const manifest = JSON.parse(readFileSync(join(temporary, 'package.json'), 'utf8'));
  assert.equal(manifest.scripts['workbench:onboarding'], 'node examples/workbench/onboarding/server.js');

  const guide = readFileSync(join(temporary, 'docs/WORKBENCH-QUICKSTART.md'), 'utf8');
  const blocks = [...guide.matchAll(/```js\n([\s\S]*?)\n```/g)].map(match => match[1]);
  assert.equal(blocks.length, 3, 'Walkthrough must contain the help path, defect and repair');
  const filename = join(temporary, 'examples/workbench/onboarding/flow.js');
  const original = readFileSync(filename, 'utf8');
  const home = original.split('\n').find(line => line.includes(".state('HOME'"));
  assert.ok(home && original.includes(blocks[1]), 'Documented edit must match the starter');
  const created = original.replace(home, blocks[0]);
  writeFileSync(filename, created);

  const url = await start();
  const config = await (await fetch(`${url}/api/workbench`)).json();
  assert.equal(config.flows[0].replayEnabled, true);
  const post = async (route, body) => {
    const response = await fetch(`${url}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json();
    assert.ok(response.ok, JSON.stringify(value));
    return value;
  };
  let session = await post('/api/sessions', { flowId: 'stock' });
  const turn = input => post(`/api/sessions/${session.id}/turns`, { input });
  await turn('');
  session = await turn('2');
  assert.equal(session.state, 'HELP');
  assert.equal(session.history[1].nextState, 'HELP');
  assert.ok(session.analysis.edges.some(edge => edge.from === 'HOME' && edge.to === 'HELP' && edge.input === '2'));
  assert.equal(session.analysis.coverage, 'partial');
  assert.equal((await turn('1')).state, 'HOME');
  await post(`/api/sessions/${session.id}/reset`, {});
  await turn(''); await turn('1');
  session = await turn('3');
  assert.equal(session.history[2].outcome, 'error');
  const draft = await (await fetch(`${url}/api/sessions/${session.id}/export`)).json();
  assert.equal(draft.fixture.turns[2].input.value, '__REPLACE_INPUT_3__');
  const fixture = JSON.parse(readFileSync(join(temporary, 'examples/workbench/onboarding/scenario.json'), 'utf8'));
  const exported = await post(`/api/sessions/${session.id}/export`, { fixture });
  const source = passed(run(process.execPath, ['examples/workbench/onboarding/server.js', '--export']));
  assert.equal(source, exported.testSource, 'CLI fallback must match browser export');
  writeFileSync(join(temporary, 'tests/onboarding-stock-regression.test.js'), source);
  await stop();

  const test = () => run('npm', ['test', '--', '--runInBand', '--runTestsByPath', 'tests/onboarding-stock-regression.test.js']);
  const red = test();
  assert.equal(red.status, 1, red.stderr);
  assert.match(red.stderr, /EXPECTATION_MISMATCH/);
  const repaired = created.replace(blocks[1], blocks[2]);
  assert.notEqual(repaired, created);
  writeFileSync(filename, repaired);
  passed(test());

  const require = createRequire(join(temporary, 'package.json'));
  const { createOnboardingWorkbench } = require('./examples/workbench/onboarding/server.js');
  const bench = createOnboardingWorkbench();
  try {
    const fixed = await bench.createSession();
    for (const input of ['', '1', '3']) await bench.send(fixed.id, input);
    const before = await bench.inspect(fixed.id);
    assert.match(before.response, /Only 2 available/);
    assert.equal((await bench.replay(fixed.id, fixture)).passed, true);
    assert.deepEqual(await bench.inspect(fixed.id), before);
    assert.equal((await bench.send(fixed.id, '2')).ended, true);
  } finally { await bench.close(); }
  writeFileSync(filename, created);
  assert.equal(test().status, 1, 'Reintroducing the defect must break the unchanged exported test');
  console.log('Fresh onboarding checkout: install, startup, help transition, failure, matching HTTP/CLI export, one-line fix, isolated replay and defect reintroduction passed.');
} finally {
  await stop();
  rmSync(temporary, { recursive: true, force: true });
}
