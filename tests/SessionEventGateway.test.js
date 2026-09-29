const { AfricasTalkingEventAdapter, SessionEventGateway } = require('..');
const adapter = new AfricasTalkingEventAdapter({ applicationId: 'ack-test', serviceCode: '*384*000#' });
const wire = { method: 'POST', contentType: 'application/x-www-form-urlencoded',
  body: new URLSearchParams({ date: '2026-09-29 10:11:12', sessionId: 'one', serviceCode: '*384*000#',
    networkCode: '99999', phoneNumber: '+254700000001', status: 'Success', cost: '0.00',
    durationInMillis: '1000', hopsCount: '1', hopsMetadata: '', input: '1', lastAppResponse: 'END Done' }).toString() };
test('end events receive 200 only after durable acceptance resolves', async () => {
  let accept;
  const accepted = new Promise(resolve => { accept = resolve; });
  const store = { accept: jest.fn(() => accepted), read: jest.fn() };
  const gateway = new SessionEventGateway({ adapter, store });
  let settled = false;
  const response = gateway.handle(wire).then(result => { settled = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  expect(settled).toBe(false);
  accept({ classification: 'accepted' });
  expect(await response).toMatchObject({ status: 200, body: 'OK', classification: 'accepted' });
  expect(store.accept).toHaveBeenCalledTimes(1);
});
test('storage uncertainty and malformed forms are not acknowledged as success', async () => {
  const store = { accept: jest.fn(async () => { throw new Error('Redis unavailable'); }), read: jest.fn() };
  const gateway = new SessionEventGateway({ adapter, store });
  expect((await gateway.handle(wire)).status).toBe(503);
  expect((await gateway.handle({ ...wire, body: 'sessionId=one' })).status).toBe(400);
  expect(store.accept).toHaveBeenCalledTimes(1);
});
