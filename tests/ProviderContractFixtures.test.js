const { parseForm, createSanitizer, createCaptureServer } = require('../scripts/lib/sandbox-capture');
const fixtures = require('./fixtures/africas-talking/requests.json');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

describe('retained actual sandbox callback contracts', () => {
  const records = fs.readFileSync(path.join(__dirname,
    'fixtures/africas-talking/captured/2026-09-28-sandbox.jsonl'), 'utf8')
    .trim().split('\n').map(line => JSON.parse(line));

  test('observed forms survive sanitation and decoding without losing the five-field shape', () => {
    expect(records).toHaveLength(9);
    for (const record of records) {
      expect(record.provenance).toBe('sandbox-capture-verified');
      expect(record.providerAuthenticated).toBe(false);
      expect(record.request).toMatchObject({ method: 'POST', route: '/ussd',
        contentType: 'application/x-www-form-urlencoded' });
      expect(Object.keys(record.request.body).sort()).toEqual(
        ['sessionId', 'serviceCode', 'phoneNumber', 'networkCode', 'text'].sort());
      expect({ ...parseForm(new URLSearchParams(record.request.body).toString()) })
        .toEqual(record.request.body);
      expect(record.unknownFieldCount).toBe(0);
    }
  });

  test('actual repeated choices advance positions while retaining session and caller scope', () => {
    const turns = records.slice(0, 4);
    const bodies = turns.map(record => record.request.body);
    expect(bodies.map(body => body.text)).toEqual(
      ['', 'value-1', 'value-1*value-1', 'value-1*value-1*value-2']);
    for (const key of ['sessionId', 'serviceCode', 'phoneNumber', 'networkCode']) {
      expect(new Set(bodies.map(body => body[key])).size).toBe(1);
    }
    expect(turns.map(record => record.response.body.slice(0, 4))).toEqual(
      ['CON ', 'CON ', 'CON ', 'END ']);
    expect(records[4].request.body.sessionId).not.toBe(bodies[0].sessionId);
    expect(records[5].request.body.sessionId).not.toBe(bodies[0].sessionId);
    expect(records[5].request.body.text).toBe('');
  });

  test('back-token and free-text transport preserves the cumulative transcript', () => {
    const turns = records.slice(5);
    expect(turns.map(record => record.request.body.text)).toEqual(
      ['', 'value-3', 'value-3*value-4', 'value-3*value-4*value-2']);
    expect(turns.at(-1).response.body).toBe('END Sandbox probe complete.');
    // No end-event fixture exists yet; synthetic events must not fill that gap.
    expect(records.filter(record => record.request.route === '/events')).toEqual([]);
  });
});

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

  test('counts rejected event traffic without retaining arbitrary paths or payloads', async () => {
    await request('/events', '{"secret": "value"}', 'application/json');
    await request('/events', 'status=Success');
    await request('/private-secret-path', 'secret=private-value');
    expect(server.getCaptureStats()).toEqual({ captured: 1,
      outcomes: { '/events:415': 1, '/events:200': 1, 'other:404': 1 } });
    const copy = server.getCaptureStats();
    copy.outcomes['/events:415'] = 99;
    expect(server.getCaptureStats().outcomes['/events:415']).toBe(1);
    expect(JSON.stringify(server.getCaptureStats())).not.toContain('secret');
  });
});
