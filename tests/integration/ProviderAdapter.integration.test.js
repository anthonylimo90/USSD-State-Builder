const http = require('http');
const { randomUUID } = require('crypto');
const { createLiveMarket } = require('../../examples/live-market/server');
const { AfricasTalkingAdapter } = require('../..');
const describeProvider = process.env.RUN_INTEGRATION ? describe : describe.skip;

describeProvider('Africa’s Talking adapter with Mavuno over HTTP and Redis', () => {
  const prefix = `ussd:provider-test:${randomUUID()}:`;
  const serviceCode = '*384*000#';
  const phoneNumber = '+254712345678';
  let app;
  let port;
  const adapter = new AfricasTalkingAdapter({ applicationId: 'mavuno-demo', serviceCode });
  async function start() {
    app = await createLiveMarket({ redisUrl: process.env.REDIS_URL || 'redis://localhost:6379', prefix, serviceCode });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    port = app.server.address().port;
  }
  function raw(body, { method = 'POST', contentType = 'application/x-www-form-urlencoded' } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/africas-talking/ussd', method,
        headers: { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) } }, res => {
        let output = '';
        res.on('data', chunk => { output += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: output, headers: res.headers }));
      });
      req.on('error', reject);
      req.end(body);
    });
  }
  const fields = (sessionId, text = '', overrides = {}) => ({ sessionId, text, serviceCode, phoneNumber, networkCode: '99999', ...overrides });
  const callback = (sessionId, text = '', overrides = {}) => raw(new URLSearchParams(fields(sessionId, text, overrides)).toString());
  const key = sessionId => adapter.normalize({ method: 'POST', contentType: 'application/x-www-form-urlencoded', body: new URLSearchParams(fields(sessionId)).toString() }).sessionKey;
  beforeAll(start);
  afterAll(async () => {
    if (!app) return;
    const keys = await app.storage.client.keys(`${prefix}*`);
    if (keys.length) await app.storage.client.del(keys);
    await app.close();
  });

  test('orders with repeated cumulative choices, survives a server restart, then looks up and cancels the order', async () => {
    const responses = [];
    const choices = ['', '1', '1*1', '1*1*1', '1*1*1*2', '1*1*1*2*3', '1*1*1*2*3*1', '1*1*1*2*3*1*1'];
    for (const text of choices) {
      const response = await callback('order', text);
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('text/plain; charset=utf-8');
      responses.push(response.body);
    }
    expect(responses[1]).toContain('Choose a category');
    expect(responses[2]).toContain('Maize seed');
    expect(responses[3]).toContain('Quantity');
    expect(responses[4]).toContain('x2');
    expect(responses.at(-1)).toMatch(/^END Order M00001 placed/);
    expect(await app.market.getStock('MAIZE')).toBe(6);
    expect((await callback('order', choices.at(-1))).status).toBe(409);
    expect(await app.market.getStock('MAIZE')).toBe(6);
    await app.close();
    await start();
    expect((await callback('order', '1')).status).toBe(409);
    await callback('lookup');
    expect((await callback('lookup', '3')).body).toContain('M00001 placed');
    expect((await callback('lookup', '3*M00001')).body).toContain('M00001: placed');
    expect((await callback('lookup', '3*M00001*1')).body).toBe('END Order M00001 cancelled.');
    expect(await app.market.getStock('MAIZE')).toBe(8);
  });

  test('rejects caller/service changes, gaps, stale and divergent transcripts without moving state', async () => {
    await callback('bound');
    expect((await callback('bound', '1', { phoneNumber: '+254712345679' })).status).toBe(409);
    expect((await callback('bound', '1', { serviceCode: '*384*999#' })).status).toBe(403);
    expect((await callback('bound', '1*1')).status).toBe(409);
    expect(await app.machine.getCurrentState(key('bound'))).toBe('MENU');
    expect((await callback('bound', '1')).status).toBe(200);
    expect((await callback('bound', '')).status).toBe(409);
    expect((await callback('bound', '2')).status).toBe(409);
    expect(await app.machine.getCurrentState(key('bound'))).toBe('CATEGORY');
    expect((await callback('missing-initial', '1')).status).toBe(409);
    expect(await app.machine.getCurrentState(key('missing-initial'))).toBe(null);
  });

  test('concurrent repeats are rejected; empty segments and back navigation consume distinct transcript positions', async () => {
    const duplicate = await Promise.all([callback('repeat'), callback('repeat')]);
    expect(duplicate.map(result => result.status).sort()).toEqual([200, 409]);
    await callback('navigation');
    await callback('navigation', '1');
    expect((await callback('navigation', '1*')).body).toContain('Choose a category');
    expect((await callback('navigation', '1**1')).body).toContain('Maize seed');
    expect((await callback('navigation', '1**1*0')).body).toContain('Choose a category');
    expect(await app.machine.getCurrentState(key('navigation'))).toBe('CATEGORY');
  });

  test('uncertain turns are not rerun after a handler error or restart', async () => {
    await callback('uncertain');
    await callback('uncertain', '1');
    const handler = app.machine.states.CATEGORY.handler;
    const effect = jest.fn(async () => { throw new Error('private failure'); });
    app.machine.states.CATEGORY.handler = effect;
    const result = await callback('uncertain', '1*1');
    expect(result).toMatchObject({ status: 500, body: 'END Service unavailable. Please try again.' });
    expect(result.body).not.toContain('private');
    app.machine.states.CATEGORY.handler = handler;
    await app.close();
    await start();
    expect((await callback('uncertain', '1*1')).status).toBe(503);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  test('expired and orphaned session state cannot be silently recreated', async () => {
    await callback('expired');
    await app.storage.deleteSession(key('expired'));
    expect((await callback('expired', '1')).status).toBe(409);
    expect(await app.machine.getCurrentState(key('expired'))).toBe(null);
    await app.storage.setState(key('orphan'), 'CATEGORY', 300);
    expect((await callback('orphan')).status).toBe(409);
    expect(await app.machine.getCurrentState(key('orphan'))).toBe('CATEGORY');
  });

  test('rejects invalid media, malformed input and oversized wire bytes with plain terminal responses', async () => {
    expect((await raw('{}', { contentType: 'application/json' })).status).toBe(415);
    expect((await raw('', { method: 'GET' })).status).toBe(405);
    expect((await raw('text=1')).status).toBe(400);
    const response = await raw('x'.repeat(17000));
    expect(response.status).toBe(413);
    expect(response.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(response.body).toMatch(/^END /);
  });
});
