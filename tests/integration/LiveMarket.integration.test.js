const http = require('http');
const { randomUUID } = require('crypto');
const { createLiveMarket } = require('../../examples/live-market/server');

const describeLive = process.env.RUN_INTEGRATION ? describe : describe.skip;

describeLive('Mavuno Co-op over HTTP and Redis', () => {
  const prefix = `ussd:live-test:${randomUUID()}:`;
  const phone = '0712345678';
  let app;
  let port;

  async function start() {
    app = await createLiveMarket({
      redisUrl: process.env.REDIS_URL || 'redis://localhost:6379', prefix
    });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    port = app.server.address().port;
  }

  function request(method, route, body) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? null : JSON.stringify(body);
      const req = http.request({
        host: '127.0.0.1', port, path: route, method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
      }, res => {
        let text = '';
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: text }));
      });
      req.on('error', reject);
      req.end(payload);
    });
  }

  async function dial(sessionId, input = '', phoneNumber = phone) {
    const result = await request('POST', '/ussd', { sessionId, phoneNumber, input });
    expect(result.status).toBe(200);
    return result.body;
  }

  async function buildMaizeCart(sessionId, quantity = '1') {
    expect(await dial(sessionId)).toContain('Mavuno Co-op');
    expect(await dial(sessionId, '1')).toContain('Choose a category');
    expect(await dial(sessionId, '1')).toContain('Maize seed');
    expect(await dial(sessionId, '1')).toContain('Quantity');
    expect(await dial(sessionId, quantity)).toContain('Added Maize seed 2kg');
    expect(await dial(sessionId, '3')).toContain('Pickup window');
    expect(await dial(sessionId, '1')).toContain('Place order');
  }

  beforeAll(start);

  afterAll(async () => {
    if (!app) return;
    const keys = await app.storage.client.keys(`${prefix}*`);
    if (keys.length) await app.storage.client.del(keys);
    await app.close();
  });

  test('runs a two-product order, survives restart, rejects replay, and restores stock on cancellation', async () => {
    const health = await request('GET', '/health');
    expect(JSON.parse(health.body).status).toBe('ok');
    const initialStock = JSON.parse((await request('GET', '/catalog')).body);
    expect(initialStock.seeds[0].available).toBe(8);

    const session = 'order-session';
    expect(await dial(session)).toContain('Mavuno Co-op');
    expect(await dial(session, '1')).toContain('Choose a category');
    expect(await dial(session, '1')).toContain('Maize seed');
    expect(await dial(session, '1')).toContain('Quantity');
    expect(await dial(session, '2')).toContain('Added Maize seed 2kg x2');
    expect(await dial(session, '1')).toContain('Choose a category');
    expect(await dial(session, '2')).toContain('Fertilizer');
    expect(await dial(session, '1')).toContain('Quantity');
    expect(await dial(session, '1')).toContain('Added Fertilizer 5kg x1');
    expect(await dial(session, '2')).toContain('Total KES 2250');
    expect(await dial(session, '2')).toContain('Pickup window');
    expect(await dial(session, '2')).toContain('Tomorrow 09:00-11:00');
    const confirmation = await dial(session, '1');
    expect(confirmation).toMatch(/^END Order M00001 placed\. KES 2250/);
    expect(await dial(session, '1')).toBe(confirmation);
    expect(await app.market.getStock('MAIZE')).toBe(6);
    expect(await app.market.getStock('FERT')).toBe(4);

    await app.close();
    await start();
    const lookup = 'lookup-session';
    await dial(lookup);
    expect(await dial(lookup, '3')).toContain('M00001 placed');
    expect(await dial(lookup, 'M00001')).toContain('KES 2250');
    expect(await dial(lookup, '1')).toBe('END Order M00001 cancelled.');
    expect(await app.market.getStock('MAIZE')).toBe(8);
    expect(await app.market.getStock('FERT')).toBe(5);
    expect(await dial(session, '1')).toBe('END Order M00001 was cancelled. Start a new session to order again.');
    expect(await app.market.getStock('MAIZE')).toBe(8);

    const stranger = 'stranger-session';
    await dial(stranger, '', '0712000000');
    await dial(stranger, '3', '0712000000');
    expect(await dial(stranger, 'M00001', '0712000000')).toContain('Order not found');
  });

  test('keeps the state on invalid quantity and supports back navigation', async () => {
    const session = 'validation-session';
    await dial(session);
    await dial(session, '1');
    await dial(session, '1');
    await dial(session, '1');
    expect(await dial(session, 'abc')).toContain('Enter a quantity from 1 to 9');
    expect(await app.storage.getState(session)).toBe('QUANTITY');
    expect(await dial(session, '0')).toContain('Maize seed 2kg KES 650');
    expect(await app.storage.getState(session)).toBe('ITEM');
    expect(await dial(session, '0')).toContain('Choose a category');
    expect(await app.storage.getState(session)).toBe('CATEGORY');
    expect((await request('POST', '/ussd', {
      sessionId: session, phoneNumber: '0712999999', input: '1'
    })).status).toBe(409);
  });

  test('atomically grants the last unit to only one competing order', async () => {
    await app.storage.client.hSet(app.market.stockKey, 'MAIZE', '1');
    await Promise.all([buildMaizeCart('race-a'), buildMaizeCart('race-b')]);
    const responses = await Promise.all([dial('race-a', '1'), dial('race-b', '1')]);
    expect(responses.filter(response => response.startsWith('END Order'))).toHaveLength(1);
    expect(responses.filter(response => response.includes('0 left'))).toHaveLength(1);
    expect(await app.market.getStock('MAIZE')).toBe(0);
  });
});
