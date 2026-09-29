const { AfricasTalkingEventAdapter, ProviderRequestError } = require('..');
const adapter = new AfricasTalkingEventAdapter({ applicationId: 'events-test', serviceCode: '*384*000#' });
const fields = overrides => ({ date: '2026-09-29 10:11:12', sessionId: 'one', serviceCode: '*384*000#',
  networkCode: '99999', phoneNumber: '+254700000001', status: 'Success', cost: '0.00', durationInMillis: '1234',
  hopsCount: '2', hopsMetadata: '', input: '1*1', lastAppResponse: 'END Done', ...overrides });
const wire = overrides => ({ method: 'POST', contentType: 'application/x-www-form-urlencoded; charset=utf-8',
  body: new URLSearchParams(fields(overrides)).toString() });
test('end event normalization preserves documented fields and stable scoped identity', () => {
  const a = adapter.normalize(wire());
  const b = adapter.normalize(wire());
  expect(a).toMatchObject({ status: 'Success', occurredAt: Date.UTC(2026, 8, 29, 10, 11, 12),
    binding: { phoneNumber: '+254700000001', sessionId: 'one' }, fields: { input: '1*1', lastAppResponse: 'END Done' } });
  expect(a.fingerprint).toBe(b.fingerprint);
  expect(a.sessionKey).toMatch(/^at:[a-f0-9]{64}$/);
  expect(a.sessionKey).not.toContain('one');
  expect(a.fingerprint).not.toContain('one');
  expect(adapter.normalize(wire({ status: 'Incomplete' })).fingerprint).not.toBe(a.fingerprint);
});
test('event fields remain raw strings; optional error and non-ASCII error text are bounded', () => {
  const event = adapter.normalize(wire({ status: 'Failed', errorMessage: 'Provider error é' }));
  expect(event.fields.cost).toBe('0.00');
  expect(event.fields.durationInMillis).toBe('1234');
  expect(event.fields.errorMessage).toBe('Provider error é');
});
test.each([
  [{ method: 'GET' }, 405], [{ contentType: 'application/json' }, 415],
  [{ body: `${wire().body}&status=Failed` }, 400], [{ body: Buffer.from([0xff]) }, 400],
  [{ body: 'sessionId=x' }, 400], [{ body: wire().body.replace('hopsCount=2', 'hopsCount=NaN') }, 400],
  [{ body: wire().body.replace('status=Success', 'status=Unknown') }, 400],
  [{ body: new URLSearchParams(fields({ date: '2026-02-30 00:00:00' })).toString() }, 400],
  [{ body: new URLSearchParams(fields({ serviceCode: '*384*999#' })).toString() }, 403],
  [{ body: new URLSearchParams(fields({ phoneNumber: 'invalid' })).toString() }, 400]
])('rejects malformed event wire requests (%j)', (overrides, status) => {
  expect(() => adapter.normalize({ ...wire(), ...overrides })).toThrow(expect.objectContaining({ status }));
});
test('limits byte size and exact identity without claiming provider authentication', () => {
  expect(() => new AfricasTalkingEventAdapter({ applicationId: 'x', serviceCode: '*1#', maxBodyBytes: 10 }).normalize(wire()))
    .toThrow(expect.objectContaining({ status: 413 }));
  expect(() => adapter.normalize(wire({ phoneNumber: '+254700000002' }))).not.toThrow();
  expect(ProviderRequestError).toBeDefined();
});
