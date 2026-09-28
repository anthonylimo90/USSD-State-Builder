import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'ussd-packed-mavuno-'));
const consumer = join(temporary, 'consumer');
const prefix = `ussd:packed-demo:${randomUUID()}:`;
let app;

function run(command, args, cwd = consumer) {
  return execFileSync(command, args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, npm_config_cache: join(temporary, 'npm-cache') }
  });
}

function request(port, method, route, body, contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : contentType === 'application/json' ? JSON.stringify(body) : body;
    const req = http.request({
      host: '127.0.0.1', port, path: route, method,
      headers: payload ? { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(payload) } : {}
    }, res => {
      let output = '';
      res.on('data', chunk => { output += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: output }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

try {
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temporary], root));
  const tarball = join(temporary, packed[0].filename);
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'ussd-mavuno-consumer', private: true }));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock', tarball]);

  const require = createRequire(join(consumer, 'package.json'));
  const packageRoot = join(consumer, 'node_modules', 'ussd-state-builder');
  const installed = require(join(packageRoot, 'package.json'));
  assert.equal(installed.version, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version);
  const { createLiveMarket } = require(join(packageRoot, 'examples/live-market/server.js'));
  app = await createLiveMarket({ redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:16379', prefix, serviceCode: '*384*000#' });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const port = app.server.address().port;
  const phoneNumber = '0712345678';
  const dial = async (sessionId, input = '') => {
    const response = await request(port, 'POST', '/ussd', { sessionId, input, phoneNumber });
    assert.equal(response.status, 200, response.body);
    return response.body;
  };

  assert.equal(JSON.parse((await request(port, 'GET', '/health')).body).status, 'ok');
  assert.match(await dial('order'), /Mavuno Co-op/);
  assert.match(await dial('order', '1'), /Choose a category/);
  assert.match(await dial('order', '1'), /Maize seed/);
  assert.match(await dial('order', '1'), /Quantity/);
  assert.match(await dial('order', '2'), /Added Maize seed 2kg x2/);
  assert.match(await dial('order', '3'), /Pickup window/);
  assert.match(await dial('order', '1'), /Place order/);
  const placed = await dial('order', '1');
  assert.match(placed, /^END Order M00001 placed/);
  assert.equal(await dial('order', '1'), placed);
  assert.equal(await app.market.getStock('MAIZE'), 6);

  await dial('lookup');
  assert.match(await dial('lookup', '3'), /M00001 placed/);
  assert.match(await dial('lookup', 'M00001'), /KES 1300/);
  assert.equal(await dial('lookup', '1'), 'END Order M00001 cancelled.');
  assert.equal(await app.market.getStock('MAIZE'), 8);
  const providerDial = (sessionId, text = '') => request(port, 'POST', '/africas-talking/ussd',
    new URLSearchParams({ sessionId, text, phoneNumber: '+254712345678', networkCode: '99999', serviceCode: '*384*000#' }).toString(),
    'application/x-www-form-urlencoded');
  for (const text of ['', '1', '1*1', '1*1*1', '1*1*1*2', '1*1*1*2*3', '1*1*1*2*3*1']) {
    assert.equal((await providerDial('provider-order', text)).status, 200);
  }
  const providerOrder = await providerDial('provider-order', '1*1*1*2*3*1*1');
  assert.equal(providerOrder.status, 200);
  assert.match(providerOrder.body, /^END Order M00002 placed/);
  assert.deepEqual(await providerDial('provider-order', '1*1*1*2*3*1*1'), providerOrder);
  assert.equal(await app.market.getStock('MAIZE'), 6);
  await providerDial('provider-lookup');
  await providerDial('provider-lookup', '3');
  await providerDial('provider-lookup', '3*M00002');
  assert.equal((await providerDial('provider-lookup', '3*M00002*1')).body, 'END Order M00002 cancelled.');
  assert.equal(await app.market.getStock('MAIZE'), 8);
  console.log(`Packed ${packed[0].filename}: browser and provider Mavuno order, receipt replay, lookup, cancellation, and stock restoration passed.`);
} finally {
  if (app) {
    try {
      const keys = await app.storage.client.keys(`${prefix}*`);
      if (keys.length) await app.storage.client.del(keys);
    } finally {
      await app.close();
    }
  }
  rmSync(temporary, { recursive: true, force: true });
}
