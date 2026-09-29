const { AfricasTalkingAdapter, ProviderRequestError, normalizeUssdInput } = require('..');
const corpus = require('./fixtures/africas-talking/requests.json');
const fs = require('fs');
const path = require('path');

const config = { applicationId: 'test-app', serviceCode: '*384*000#' };
const form = overrides => new URLSearchParams({ sessionId: 's1', phoneNumber: '+254700000001',
  networkCode: '99999', serviceCode: config.serviceCode, text: '', ...overrides }).toString();
const request = overrides => ({ method: 'POST', contentType: 'application/x-www-form-urlencoded; charset=utf-8', body: form(overrides) });

describe('Africa’s Talking request normalization', () => {
  test.each(corpus.cases.filter(item => item.request.path === '/ussd' && item.expected.fields && item.id !== 'service-conflict'))('$id preserves exact decoded fields and transcript position', item => {
    const adapter = new AfricasTalkingAdapter(config);
    const turn = adapter.normalize(item.request);
    expect(turn).toMatchObject({ provider: 'africas-talking', applicationId: 'test-app',
      sessionId: item.expected.fields.sessionId, phoneNumber: item.expected.fields.phoneNumber,
      serviceCode: item.expected.fields.serviceCode, networkCode: item.expected.fields.networkCode,
      transcript: item.expected.fields.text, position: item.expected.segments.length,
      input: item.expected.segments.at(-1) || '', inputMode: 'cumulative' });
  });

  test('incremental input containing stars is not treated as a cumulative transcript', () => {
    expect(normalizeUssdInput('1*1', 'incremental')).toEqual({ inputMode: 'incremental', input: '1*1', transcript: null, position: null });
    expect(normalizeUssdInput('1*1', 'cumulative')).toEqual({ inputMode: 'cumulative', input: '1', transcript: '1*1', position: 2 });
    expect(() => normalizeUssdInput('1', 'automatic')).toThrow();
  });

  test('does not double-decode, trim, coerce choices, or silently repair caller identity', () => {
    const adapter = new AfricasTalkingAdapter(config);
    expect(adapter.normalize(request({ text: '01* A%2BB ' })).input).toBe(' A%2BB ');
    expect(adapter.normalize(request({ text: '01' })).input).toBe('01');
    expect(() => adapter.normalize({ ...request(), body: form().replace('%2B254', '+254') })).toThrow(ProviderRequestError);
  });

  test.each([
    [{ method: 'GET' }, 405], [{ contentType: 'application/json' }, 415], [{ contentType: 'application/x-www-form-urlencoded; charset=latin1' }, 415],
    [{ body: 'sessionId=x' }, 400], [{ body: `${form()}&text=1` }, 400],
    [{ body: `${form()}&unknown=%ZZ` }, 400], [{ body: `${form()}&%74ext=1` }, 400],
    [{ body: Buffer.from([0xff]) }, 400], [{ body: { text: '' } }, 400],
    [{ body: form({ phoneNumber: 'not-a-phone' }) }, 400],
    [{ body: form({ serviceCode: '*384*999#' }) }, 403],
    [{ body: form({ sessionId: '' }) }, 400]
  ])('rejects invalid wire requests before invoking an application (%j)', async (override, status) => {
    const process = jest.fn();
    const result = await new AfricasTalkingAdapter(config).handle({ ...request(), ...override }, process);
    expect(result.status).toBe(status);
    expect(result.headers['Content-Type']).toBe('text/plain; charset=utf-8');
    expect(result.body).toMatch(/^END /);
    expect(process).not.toHaveBeenCalled();
  });

  test('bounds raw bytes, field count, transcript and input independently', () => {
    expect(() => new AfricasTalkingAdapter({ ...config, maxBodyBytes: 16 }).normalize(request())).toThrow(expect.objectContaining({ status: 413 }));
    expect(() => new AfricasTalkingAdapter({ ...config, maxTranscriptLength: 2 }).normalize(request({ text: '1*1' }))).toThrow();
    expect(() => new AfricasTalkingAdapter({ ...config, maxInputLength: 2 }).normalize(request({ text: '1*123' }))).toThrow();
    expect(() => new AfricasTalkingAdapter(config).normalize({ ...request(), body: `${form()}${Array.from({ length: 40 }, (_, i) => `&x${i}=1`).join('')}` })).toThrow();
  });

  test('applies network output budgets to complete UTF-8 responses without clipping multilingual text', () => {
    const adapter = new AfricasTalkingAdapter({ ...config, responseBudgets: { default: 32, '63902': 36 } });
    const accented = `CON ${'a'.repeat(25)}é`;
    const emoji = `CON ${'a'.repeat(24)}😀`;
    const combining = `CON ${'a'.repeat(25)}e\u0301`;
    expect(Buffer.byteLength(accented)).toBe(31);
    expect(adapter.formatResponse(accented, { networkCode: '99999' }).body).toBe(accented);
    expect(adapter.formatResponse(emoji, { networkCode: '99999' }).body).toBe(emoji);
    expect(() => adapter.formatResponse(`${emoji}x`, { networkCode: '99999' })).toThrow('Invalid or oversized');
    expect(() => adapter.formatResponse(`${emoji}x`, { networkCode: 'constructor' })).toThrow('Invalid or oversized');
    expect(adapter.formatResponse(`${emoji}x`, { networkCode: '63902' }).body).toBe(`${emoji}x`);
    expect(() => adapter.formatResponse(`${combining}xx`, { networkCode: '99999' })).toThrow('Invalid or oversized');
    expect(() => new AfricasTalkingAdapter({ ...config, responseBudgets: { '63902': 160 } })).toThrow(TypeError);
  });

  test('normalizes sanitized captures as aliases without claiming they contain real subscriber identities', () => {
    const files = ['2026-09-28-sandbox.jsonl', '2026-09-28-diagnostic.jsonl'];
    for (const file of files) {
      const records = fs.readFileSync(path.join(__dirname, 'fixtures/africas-talking/captured', file), 'utf8').trim().split('\n').map(JSON.parse);
      const adapter = new AfricasTalkingAdapter({ applicationId: 'capture-alias-test', serviceCode: records[0].request.body.serviceCode,
        phonePattern: /^phoneNumber-\d+$/ });
      for (const record of records) {
        const turn = adapter.normalize({ ...record.request, body: new URLSearchParams(record.request.body).toString() });
        expect(turn.transcript).toBe(record.request.body.text);
        expect(turn.input).toBe(record.request.body.text.split('*').at(-1));
      }
    }
  });
});

describe('scope, caller binding and transcript comparison', () => {
  const adapter = () => new AfricasTalkingAdapter(config);
  test('uses stable scoped session keys and rejects a changed caller or service binding', () => {
    const a = adapter();
    const initial = a.normalize(request());
    const binding = a.bindSession(initial);
    expect(a.bindSession(a.normalize(request({ text: '1' })), binding)).toEqual(binding);
    expect(() => a.bindSession(a.normalize(request({ phoneNumber: '+254700000002' })), binding)).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => a.bindSession(initial, { ...binding, serviceCode: '*384*001#' })).toThrow();
    expect(() => a.bindSession(initial, { ...binding, applicationId: 'other' })).toThrow();
    expect(new AfricasTalkingAdapter(config).normalize(request()).sessionKey).toBe(initial.sessionKey);
    expect(new AfricasTalkingAdapter({ ...config, applicationId: 'other' }).normalize(request()).sessionKey).not.toBe(initial.sessionKey);
    expect(initial.sessionKey).not.toContain(initial.phoneNumber);
  });

  test.each([
    ['', undefined, 'initial'], ['1', undefined, 'missing_initial'], ['', '', 'repeat'],
    ['1', '', 'next'], ['1*1', '1', 'next'], ['1*1', '1*1', 'repeat'],
    ['1', '1*1', 'stale'], ['1*1*2', '1', 'gap'], ['10', '1', 'conflict'],
    ['1*', '1', 'next'], ['1*2', '1*1', 'conflict']
  ])('classifies %j after %j as %s', (text, previous, kind) => {
    const a = adapter();
    expect(a.compareTranscript(a.normalize(request({ text })), previous)).toBe(kind);
  });
});

describe('framework-neutral provider responses', () => {
  test('returns raw UTF-8 menus and validates optional non-sensitive hop labels', async () => {
    const a = new AfricasTalkingAdapter(config);
    const result = await a.handle(request(), async turn => {
      expect(turn.input).toBe('');
      return { response: 'CON Karibu\n1. Endelea', hopMetadata: 'welcome' };
    });
    expect(result).toEqual({ status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
      'at-ussd-hop-metadata': 'welcome' }, body: 'CON Karibu\n1. Endelea' });
    for (const label of ['private|step', 'x\r\nHeader: evil', 'x'.repeat(100)]) {
      expect(() => a.formatResponse('CON Welcome', { hopMetadata: label })).toThrow();
    }
  });

  test.each(['', 'CON ', '\ufeffCON Menu', ' CON Menu', 'Menu', 'CON Bad\u0000'])('never sends invalid application response %j', async response => {
    const result = await new AfricasTalkingAdapter(config).handle(request(), () => response);
    expect(result).toMatchObject({ status: 500, body: 'END Service unavailable. Please try again.' });
  });

  test('bounds response bytes without clipping and conceals application errors', async () => {
    const a = new AfricasTalkingAdapter({ ...config, maxResponseBytes: 8 });
    expect(() => a.formatResponse('CON Too long')).toThrow();
    const result = await a.handle(request(), () => { throw new Error('secret credentials'); });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.status).toBe(500);
  });
});

test('configuration bounds are validated and untrusted application fields cannot change scope', () => {
  for (const override of [{ applicationId: '' }, { serviceCode: '' }, { maxBodyBytes: 0 },
    { maxInputLength: -1 }, { maxResponseBytes: 1.5 }, { maxFieldLength: '128' }, { phonePattern: '.*' }]) {
    expect(() => new AfricasTalkingAdapter({ ...config, ...override })).toThrow(TypeError);
  }
  const adapter = new AfricasTalkingAdapter(config);
  const normal = adapter.normalize(request());
  const forged = adapter.normalize({ ...request(), body: `${form()}&applicationId=other&inputMode=incremental` });
  expect(forged.sessionKey).toBe(normal.sessionKey);
  expect(forged.applicationId).toBe(config.applicationId);
  expect(forged.inputMode).toBe('cumulative');
  expect(() => new AfricasTalkingAdapter({ ...config, maxFieldLength: 2 }).normalize(request())).toThrow();
});

test('response bounds count UTF-8 bytes and binding mismatches never invoke a flow', async () => {
  const adapter = new AfricasTalkingAdapter({ ...config, maxResponseBytes: 6 });
  expect(adapter.formatResponse('CON é').body).toBe('CON é');
  expect(() => adapter.formatResponse('CON 😀')).toThrow();
  const initial = adapter.normalize(request());
  const binding = adapter.bindSession(initial);
  const process = jest.fn();
  const result = await adapter.handle(request({ phoneNumber: '+254700000002' }), turn => {
    adapter.bindSession(turn, binding);
    return process(turn);
  });
  expect(result.status).toBe(409);
  expect(process).not.toHaveBeenCalled();
});
