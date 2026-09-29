const http = require('http');
const { randomUUID } = require('crypto');
const { createLiveMarket } = require('../../examples/live-market/server');
const describeLive = process.env.RUN_INTEGRATION ? describe : describe.skip;
describeLive('Mavuno async callbacks independent of handset sessions', () => {
  const prefix = `ussd:callbacks:${randomUUID()}:`;
  const serviceCode = '*384*000#';
  const phoneNumber = '+254712345678';
  const orderEventToken = 'test-order-token-123456789';
  const providerEventToken = 'test-provider-token-123456789';
  let app;
  let port;
  async function start() {
    app = await createLiveMarket({ redisUrl: process.env.REDIS_URL || 'redis://localhost:6379', prefix,
      serviceCode, orderEventToken, providerEventToken });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    port = app.server.address().port;
  }
  function request(path, body, contentType, token) {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: {
        'Content-Type': contentType, 'Content-Length': Buffer.byteLength(data),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      } }, res => {
        let output = '';
        res.on('data', chunk => { output += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: output }));
      });
      req.once('error', reject);
      req.end(data);
    });
  }
  const callback = (sessionId, text = '', caller = phoneNumber) => request('/africas-talking/ussd',
    new URLSearchParams({ sessionId, text, serviceCode, phoneNumber: caller, networkCode: '99999' }).toString(),
    'application/x-www-form-urlencoded');
  const endEvent = (sessionId, input, lastAppResponse, token = providerEventToken) => request('/africas-talking/events',
    new URLSearchParams({ date: '2026-09-29 10:11:12', sessionId, serviceCode, phoneNumber,
      networkCode: '99999', status: 'Success', cost: '0.00', durationInMillis: '1000', hopsCount: '8',
      hopsMetadata: '', input, lastAppResponse }).toString(), 'application/x-www-form-urlencoded', token);
  const orderEvent = (body, token = orderEventToken) => request('/demo/order-events', body, 'application/json', token);
  beforeAll(start);
  afterAll(async () => {
    if (!app) return;
    const keys = await app.storage.client.keys(`${prefix}*`);
    if (keys.length) await app.storage.client.del(keys);
    await app.close();
  });
  test('ingress secrets are required; business result arrives after restart and expiry, then a new bound caller retrieves it', async () => {
    const choices = ['', '1', '1*1', '1*1*1', '1*1*1*2', '1*1*1*2*3', '1*1*1*2*3*1', '1*1*1*2*3*1*1'];
    let final;
    for (const text of choices) {
      final = await callback('order-session', text);
      expect(final.status).toBe(200);
    }
    const orderId = final.body.match(/M\d+/)[0];
    expect((await endEvent('order-session', choices.at(-1), final.body, 'wrong-token-123456789')).status).toBe(401);
    expect((await orderEvent({ orderId, eventId: 'evt-1', version: 1, status: 'Ready' }, 'wrong-token-123456789')).status).toBe(401);
    await app.close();
    await start();
    const sessionKey = app.providerAdapter.normalize({ method: 'POST', contentType: 'application/x-www-form-urlencoded',
      body: new URLSearchParams({ sessionId: 'order-session', text: '', serviceCode, phoneNumber, networkCode: '99999' }).toString() }).sessionKey;
    await app.storage.client.del(app.storage._getKey(sessionKey));
    expect((await endEvent('order-session', choices.at(-1), final.body)).status).toBe(200);
    expect((await app.eventStore.read(sessionKey)).bindingSource).toBe('event_only');
    expect((await callback('order-session', '')).status).toBe(409);
    expect((await orderEvent({ orderId, eventId: 'evt-1', version: 1, status: 'Ready' })).body).toBe('{"classification":"accepted"}');
    expect(await app.market.getOrder(orderId, '254712345678')).toMatchObject({ fulfillment: { status: 'Ready', version: 1 } });
    expect(await app.market.getOrder(orderId, '254712345679')).toBe(null);
    await callback('new-lookup');
    const list = await callback('new-lookup', '3');
    expect(list.body).toContain(`${orderId} placed, Ready`);
    const detail = await callback('new-lookup', `3*${orderId}`);
    expect(detail.body).toContain(`${orderId}: placed, Ready`);
    await callback('wrong-lookup', '', '+254712345679');
    expect((await callback('wrong-lookup', '3', '+254712345679')).body).not.toContain(orderId);
  });
  test('business callback duplicates, older versions, conflicts and later versions are deterministic', async () => {
    const raw = await app.storage.client.hKeys(app.market.ordersKey);
    const orderId = raw[0];
    const event = { orderId, eventId: 'evt-2', version: 2, status: 'Delayed' };
    expect(JSON.parse((await orderEvent(event)).body).classification).toBe('accepted');
    expect(JSON.parse((await orderEvent(event)).body).classification).toBe('duplicate');
    expect(JSON.parse((await orderEvent({ ...event, eventId: 'older', version: 1 })).body).classification).toBe('stale');
    expect((await orderEvent({ ...event, eventId: 'changed', status: 'Ready' })).status).toBe(409);
    expect((await orderEvent({ ...event, version: 3, status: 'Ready' })).status).toBe(409);
    expect(JSON.parse((await orderEvent({ ...event, eventId: 'evt-3', version: 3, status: 'Ready' })).body).classification).toBe('accepted');
    expect((await app.market.getOrder(orderId, '254712345678')).fulfillment).toMatchObject({ status: 'Ready', version: 3 });
    expect(await app.market.cancelOrder(orderId, '254712345678')).toBe('cancelled');
    expect((await orderEvent({ ...event, eventId: 'evt-4', version: 4, status: 'Delayed' })).status).toBe(409);
    expect((await app.market.getOrder(orderId, '254712345678')).fulfillment).toBeUndefined();
  });
});
