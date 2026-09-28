const http = require('http');
const { randomUUID } = require('crypto');
const { createLiveMarket } = require('../../examples/live-market/server');
const describeLive = process.env.RUN_INTEGRATION ? describe : describe.skip;
describeLive('Mavuno HTTP request budget', () => {
  let app;
  let port;
  let prefix;
  const body = text => new URLSearchParams({ sessionId: 'deadline-http', phoneNumber: '+254712345678', networkCode: '99999', serviceCode: '*384*000#', text }).toString();
  beforeEach(async () => {
    prefix = `ussd:http-deadline:${randomUUID()}:`;
    app = await createLiveMarket({ redisUrl: process.env.REDIS_URL || 'redis://localhost:6379', prefix, serviceCode: '*384*000#', providerDeadlineMs: 200 });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    port = app.server.address().port;
  });
  afterEach(async () => {
    app.server.closeAllConnections();
    const keys = await app.storage.client.keys(`${prefix}*`);
    if (keys.length) await app.storage.client.del(keys);
    await app.close();
  });
  function request(text, response) {
    const data = body(text);
    return { data, req: http.request({ host: '127.0.0.1', port, path: '/africas-talking/ussd', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) } }, response) };
  }
  test('an unfinished request body consumes the deadline without reaching the machine', async () => {
    const handler = jest.spyOn(app.machine, 'prepareTurn');
    let req;
    const response = new Promise((resolve, reject) => {
      const pending = request('', res => { res.resume(); res.once('end', () => resolve(res.statusCode)); });
      req = pending.req;
      req.on('error', reject);
      req.write(pending.data.slice(0, 10));
    });
    try { expect(await response).toBe(503); }
    finally { req.destroy(); }
    expect(handler).not.toHaveBeenCalled();
  });
  test('a disconnected HTTP caller aborts the executing handler', async () => {
    await new Promise((resolve, reject) => {
      const { req, data } = request('', res => { res.resume(); res.once('end', resolve); });
      req.on('error', reject);
      req.end(data);
    });
    let started;
    let stopped;
    const ready = new Promise(resolve => { started = resolve; });
    const aborted = new Promise(resolve => { stopped = resolve; });
    app.machine.states.MENU.handler = async (input, id, context) => {
      started();
      await new Promise((resolve, reject) => context.signal.addEventListener('abort', () => { stopped(); reject(context.signal.reason); }, { once: true }));
      return { response: 'END Late' };
    };
    const { req, data } = request('1', res => res.resume());
    req.on('error', () => {});
    req.end(data);
    await ready;
    req.destroy();
    await aborted;
    const turn = app.providerAdapter.normalize({ method: 'POST', contentType: 'application/x-www-form-urlencoded', body: body('1') });
    expect((await app.providerGateway.store.read(turn.sessionKey)).revision).toBe(1);
  });
});
