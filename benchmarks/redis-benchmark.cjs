const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.USSD_BENCHMARK_ROOT || path.resolve(__dirname, '..');
const { createApp } = require(path.join(root, 'lib/sdk'));
const RedisStorage = require(path.join(root, 'lib/RedisStorage'));
const scale = Number(process.env.USSD_BENCHMARK_SCALE || 1);
assert.ok(Number.isInteger(scale) && scale >= 1 && scale <= 20);
const storage = new RedisStorage({ url: process.env.REDIS_URL || 'redis://127.0.0.1:16379',
  keyPrefix: 'ussd:benchmark:' + randomUUID() + ':' });
const sessions = [];

async function main() {
  const app = createApp().storage(storage).logger(null)
    .state('INPUT', state => state.message('Number:').validate(input => {
      if (input && input !== '42') throw new Error('Unexpected synthetic input');
    }).save('number').next('DONE'))
    .state('DONE', state => state.message('Saved').end()).build();
  const execute = async index => {
    const id = 'sample-' + index;
    sessions.push(id);
    assert.equal(await app.processInput(id, ''), 'CON Number:');
    assert.equal(await app.processInput(id, '42'), 'END Saved');
  };
  await storage._ensureConnected();
  try {
    for (let i = 0; i < 100; i++) await execute(-i - 1);
    const times = [], iterations = 300 * scale, started = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
      const turnStart = process.hrtime.bigint();
      await execute(i);
      times.push(Number(process.hrtime.bigint() - turnStart) / 1e6);
    }
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    const saved = await app.getSessionData('sample-' + (iterations - 1));
    assert.equal(saved.number, '42');
    assert.equal(saved.__ussdLifecycle.completedResponse, 'END Saved');
    assert.equal(await app.processInput('sample-' + (iterations - 1), '42'), 'END Saved');
    times.sort((a, b) => a - b);
    const memory = process.memoryUsage();
    const result = { name: 'Redis validated terminal save', iterations, totalMs: elapsedMs,
      opsPerSec: Math.round(iterations / (elapsedMs / 1000)), avgMs: elapsedMs / iterations,
      p50Ms: times[Math.floor(times.length * 0.5)], p95Ms: times[Math.floor(times.length * 0.95)],
      p99Ms: times[Math.floor(times.length * 0.99)] };
    const evidence = { node: process.version, scale, results: [result],
      memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal } };
    if (process.env.USSD_BENCHMARK_OUTPUT) fs.writeFileSync(process.env.USSD_BENCHMARK_OUTPUT, JSON.stringify(evidence));
    console.log(JSON.stringify(result));
  } finally {
    try { if (sessions.length) await storage.client.del(sessions.map(id => storage._getKey(id))); }
    finally { await storage.close(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
