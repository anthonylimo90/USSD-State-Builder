import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const allowed = new Set(['baseline', 'reference', 'runs', 'scale', 'output', 'min-geomean-gain', 'suite']);
const options = Object.fromEntries(args.map(argument => {
  const match = /^--([^=]+)=(.+)$/.exec(argument);
  assert.ok(match && allowed.has(match[1]), 'Use --baseline=ref [--reference=ref] [--suite=memory|redis] [--runs=7] [--scale=10] [--output=file] [--min-geomean-gain=5]');
  return [match[1], match[2]];
}));
const runs = Number(options.runs || 7), scale = Number(options.scale || 10);
const minimumGain = Number(options['min-geomean-gain'] || 5);
const suite = options.suite || 'memory';
assert.ok(['memory', 'redis'].includes(suite), 'Suite must be memory or redis');
assert.ok(Number.isInteger(runs) && runs >= 3 && runs <= 21, 'Runs must be 3–21');
assert.ok(Number.isInteger(scale) && scale >= 1 && scale <= 20, 'Scale must be 1–20');
assert.ok(Number.isFinite(minimumGain) && minimumGain >= 0, 'Gain must be nonnegative');
const scenarios = suite === 'redis' ? ['Redis validated terminal save'] :
  ['Simple 2-state flow', 'Validated input flow', 'Deep 10-state chain',
    'With 3 middlewares', 'Back navigation flow', 'Multi-field data collection', '100 concurrent sessions'];
const harness = join(root, 'benchmarks', suite === 'redis' ? 'redis-benchmark.cjs' : 'benchmark.js');
const temporary = mkdtempSync(join(tmpdir(), 'ussd-benchmark-'));

function git(...arguments_) {
  return execFileSync('git', arguments_, { cwd: root, encoding: 'utf8' }).trim();
}
function fingerprint(directory) {
  const hash = createHash('sha256');
  function walk(relative) {
    for (const name of readdirSync(join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(relative, name.name);
      if (name.isDirectory()) walk(file);
      else { hash.update(file); hash.update(readFileSync(join(directory, file))); }
    }
  }
  walk('lib');
  return hash.digest('hex');
}
function archive(label, ref) {
  const directory = join(temporary, label);
  mkdirSync(directory);
  const tar = join(temporary, label + '.tar');
  execFileSync('git', ['archive', '--format=tar', '--output=' + tar, ref], { cwd: root });
  execFileSync('tar', ['-xf', tar, '-C', directory]);
  return { label, directory, ref, commit: git('rev-parse', ref + '^{}') };
}
function median(values) {
  const sorted = values.toSorted((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

try {
  const sources = [archive('baseline', options.baseline || 'v3.0.0')];
  if (options.reference) sources.push(archive('reference', options.reference));
  sources.push({ label: 'candidate', directory: root, commit: git('rev-parse', 'HEAD'),
    dirty: Boolean(git('status', '--porcelain')) });
  const sourceEvidence = Object.fromEntries(sources.map(source => [source.label, {
    ref: source.ref ?? null, commit: source.commit, dirty: source.dirty ?? false,
    version: JSON.parse(readFileSync(join(source.directory, 'package.json'), 'utf8')).version,
    runtimeSha256: fingerprint(source.directory)
  }]));
  const samples = [];
  for (const scenario of scenarios) {
    for (let iteration = 0; iteration < runs; iteration++) {
      // Rotate all sources so the same version does not always run first.
      const offset = iteration % sources.length;
      const order = [...sources.slice(offset), ...sources.slice(0, offset)];
      for (const source of order) {
        const output = join(temporary, 'sample.json');
        execFileSync(process.execPath, [harness], {
          cwd: root, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, DEBUG: '', NODE_PATH: join(root, 'node_modules'), USSD_BENCHMARK_ROOT: source.directory,
            USSD_BENCHMARK_SCALE: String(scale), USSD_BENCHMARK_SCENARIO: scenario, USSD_BENCHMARK_OUTPUT: output }
        });
        const sample = JSON.parse(readFileSync(output, 'utf8'));
        assert.equal(sample.results.length, 1);
        assert.equal(sample.results[0].name, scenario);
        samples.push({ source: source.label, iteration, scenario, ...sample.results[0], memory: sample.memory });
      }
    }
  }
  const summary = scenarios.map(scenario => {
    const medians = Object.fromEntries(sources.map(source => {
      const rows = samples.filter(sample => sample.source === source.label && sample.scenario === scenario);
      return [source.label, { operationsPerSecond: median(rows.map(row => row.opsPerSec)),
        p50Ms: median(rows.map(row => Number(row.p50Ms))), p95Ms: median(rows.map(row => Number(row.p95Ms))),
        p99Ms: median(rows.map(row => Number(row.p99Ms))), rssBytes: median(rows.map(row => row.memory.rssBytes)) }];
    }));
    const gainPercent = 100 * (medians.candidate.operationsPerSecond / medians.baseline.operationsPerSecond - 1);
    const referenceGainPercent = medians.reference ?
      100 * (medians.candidate.operationsPerSecond / medians.reference.operationsPerSecond - 1) : null;
    return { scenario, medians, gainPercent, referenceGainPercent };
  });
  const geomeanGainPercent = 100 * (Math.exp(summary.reduce((sum, row) =>
    sum + Math.log(row.medians.candidate.operationsPerSecond / row.medians.baseline.operationsPerSecond), 0) / summary.length) - 1);
  const failures = summary.filter(row => row.gainPercent < 0).map(row => row.scenario);
  const passed = failures.length === 0 && geomeanGainPercent >= minimumGain;
  const evidence = { schemaVersion: 1, node: process.version, sources: sourceEvidence,
    harnessSha256: createHash('sha256').update(readFileSync(harness)).digest('hex'),
    methodology: { suite, runsPerSourceAndScenario: runs, scale, isolatedProcesses: true,
      warmup: suite === 'redis' ? '100 separate sessions' : 'up to 200 × scale separate sessions', order: 'rotating sources',
      units: 'completed scenarios/s; concurrent scenario is a batch of 100 sessions',
      rss: 'end of scenario, not peak or retained-heap measurement' },
    budget: { noMedianThroughputRegression: true, minimumGeomeanGainPercent: minimumGain },
    passed, geomeanGainPercent, failures, summary, samples };
  if (options.output) writeFileSync(resolve(options.output), JSON.stringify(evidence, null, 2) + '\n');
  for (const row of summary) console.log(row.scenario + ': ' + row.gainPercent.toFixed(1) + '% vs baseline' +
    (row.referenceGainPercent === null ? '' : ', ' + row.referenceGainPercent.toFixed(1) + '% vs reference'));
  console.log('Geometric mean gain: ' + geomeanGainPercent.toFixed(1) + '%; budget ' + (passed ? 'PASS' : 'FAIL'));
  if (!passed) process.exitCode = 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
