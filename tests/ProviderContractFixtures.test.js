const { parseForm, createSanitizer, createCaptureServer } = require('../scripts/lib/sandbox-capture');
const fixtures = require('./fixtures/africas-talking/requests.json');
const http = require('node:http');

describe('Africa\'s Talking contract evidence', () => {
  test.each(fixtures.cases.filter(item => item.expected.fields))('$id decodes the provider form unchanged', fixture => {
    const fields = parseForm(fixture.request.body);
    expect({ ...fields }).toEqual(fixture.expected.fields);
    if (fixture.expected.segments) {
      expect(fields.text === '' ? [] : fields.text.split('*')).toEqual(fixture.expected.segments);
    }
    if (fixture.expected.eventStatus) expect(fields.status).toBe(fixture.expected.eventStatus);
  });

  test.each(fixtures.cases.filter(item => item.expected.captureReject))('$id is rejected before capture', fixture => {
    expect(() => parseForm(fixture.request.body)).toThrow();
  });

  test('identical choices at distinct positions differ from a retried transcript', () => {
    const body = id => parseForm(fixtures.cases.find(item => item.id === id).request.body);
    expect(body('repeated-choice')).toEqual(body('duplicate-repeated-choice'));
    expect(body('first-choice').text).not.toEqual(body('repeated-choice').text);
    expect(body('late-earlier-turn')).toEqual(body('first-choice'));
  });

  test('evidence is synthetic and cannot be counted as sandbox validation', () => {
    expect(fixtures.capturedFromSandbox).toBe(false);
    expect(fixtures.cases.every(item => item.provenance === 'synthetic')).toBe(true);
  });

  test('redacts identities, inputs, event values, unknown keys and values without losing transcript relationships', () => {
    const sanitize = createSanitizer();
    const raw = {
      sessionId: 'secret-session', phoneNumber: '+254712345678', serviceCode: '*123*456#',
      text: 'sensitive-pin*sensitive-pin*customer-name*',
      networkCode: 'provider-network', status: 'secret-status', cost: 'secret-cost',
      durationInMillis: 'secret-duration', date: 'secret-date', hopsCount: 'secret-count',
      hopsMetadata: 'secret-metadata', lastAppResponse: 'secret-response', errorMessage: 'secret-error',
      'secret-key': 'secret-token'
    };
    const evidence = sanitize('/ussd', raw);
    const encoded = JSON.stringify(evidence);
    Object.values(raw).filter(Boolean).forEach(value => expect(encoded).not.toContain(value));
    expect(encoded).not.toContain('secret-key');
    expect(evidence.unknownFieldCount).toBe(1);
    expect(evidence.providerAuthenticated).toBe(false);
    const segments = evidence.request.body.text.split('*');
    expect(segments[0]).toEqual(segments[1]);
    expect(segments[2]).not.toEqual(segments[1]);
    expect(segments[3]).toBe('');
    expect(sanitize('/ussd', raw).request.body).toEqual(evidence.request.body);
    expect(sanitize('/ussd', { ...raw, text: 'sensitive-pin' }).request.body.text).toBe(segments[0]);
    expect(sanitize('/events', raw).request.body.sessionId).toBe(evidence.request.body.sessionId);
    expect(sanitize('/events', { ...raw, status: 'Success' }).request.body.status).toBe('Success');
    expect(sanitize('/ussd', { ...raw, phoneNumber: 'different-person' }).request.body.phoneNumber)
      .not.toBe(evidence.request.body.phoneNumber);
  });

  test('limits form size and rejects ambiguous fields, including decoded duplicates and prototype keys', () => {
    expect(() => parseForm('text=' + 'a'.repeat(16384))).toThrow();
    expect(() => parseForm('text=1&%74ext=2')).toThrow();
    expect(() => parseForm('text')).toThrow();
    expect(() => parseForm('=secret')).toThrow();
    const fields = parseForm('__proto__=secret&constructor=hidden&text=1');
    expect(Object.getPrototypeOf(fields)).toBeNull();
    expect(JSON.stringify(createSanitizer()('/ussd', fields))).not.toContain('secret');
  });
});

describe('local sandbox capture probe over HTTP', () => {
  let server;
  let port;
  let records;
  beforeEach(async () => {
    records = [];
    server = createCaptureServer({ record: evidence => records.push(evidence), maxCaptures: 3 });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });
  afterEach(() => new Promise(resolve => server.close(resolve)));

  function request(route, body, contentType = 'application/x-www-form-urlencoded') {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: route,
        headers: { 'Content-Type': contentType } }, res => {
        let response = '';
        res.on('data', chunk => { response += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, contentType: res.headers['content-type'], response }));
      });
      req.on('error', reject);
      req.end(body);
    });
  }

  test('captures form traffic, emits plaintext CON/END, and associates an event with the session', async () => {
    const fields = { sessionId: 'real-session', phoneNumber: '+254712345678', text: '' };
    const form = body => new URLSearchParams(body).toString();
    expect(await request('/ussd', form(fields))).toMatchObject({ status: 200, contentType: 'text/plain; charset=utf-8', response: expect.stringMatching(/^CON /) });
    expect(await request('/ussd', form({ ...fields, text: '1*2' }))).toMatchObject({ status: 200, response: 'END Sandbox probe complete.' });
    expect(await request('/events', form({ ...fields, status: 'sensitive-status' }))).toMatchObject({ status: 200, response: 'OK' });
    expect(records[0].request.body.sessionId).toBe(records[2].request.body.sessionId);
    const captured = JSON.stringify(records);
    for (const secret of ['real-session', '+254712345678', 'sensitive-status', '1*2']) expect(captured).not.toContain(secret);
    expect(await request('/ussd', form(fields))).toMatchObject({ status: 503 });
    expect(records).toHaveLength(3);
  });

  test('rejects malformed/oversized/unexpected traffic without persisting payloads', async () => {
    expect(await request('/ussd', 'text=1&text=2')).toMatchObject({ status: 400 });
    expect(await request('/ussd', 'text=' + 'x'.repeat(16385))).toMatchObject({ status: 413 });
    expect(await request('/ussd', '{"secret": "value"}', 'application/json')).toMatchObject({ status: 415 });
    expect(await request('/wrong', 'text=')).toMatchObject({ status: 404 });
    expect(records).toEqual([]);
  });
});
