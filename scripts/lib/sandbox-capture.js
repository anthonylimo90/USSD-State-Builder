const http = require('node:http');

// Evidence tooling only: this does not authenticate a provider or run a flow.
function parseForm(body) {
  const fields = Object.create(null);
  if (!body || Buffer.byteLength(body) > 16384) throw new Error('Invalid form body');
  const pairs = body.split('&');
  if (pairs.length > 32) throw new Error('Too many form fields');
  for (const pair of pairs) {
    const separator = pair.indexOf('=');
    if (separator < 0) throw new Error('Invalid form field');
    const decode = value => decodeURIComponent(value.replace(/\+/g, ' '));
    const key = decode(pair.slice(0, separator));
    if (!key || Object.hasOwn(fields, key)) throw new Error('Duplicate or empty form field');
    fields[key] = decode(pair.slice(separator + 1));
  }
  return fields;
}

function createSanitizer() {
  const identities = new Map();
  const values = new Map();
  function alias(store, kind, raw) {
    const key = JSON.stringify([kind, raw]);
    if (!store.has(key)) {
      if (store.size >= 5000) throw new Error('Capture identity limit reached');
      store.set(key, `${kind}-${store.size + 1}`);
    }
    return store.get(key);
  }
  return (route, fields) => {
    const body = {};
    const eventValues = ['status', 'durationInMillis', 'hopsCount', 'hopsMetadata',
      'lastAppResponse', 'errorMessage', 'cost', 'date'];
    const known = ['sessionId', 'serviceCode', 'phoneNumber', 'text', 'networkCode', 'input', ...eventValues];
    for (const key of ['sessionId', 'serviceCode', 'phoneNumber', 'networkCode']) {
      if (Object.hasOwn(fields, key)) body[key] = alias(identities, key, fields[key]);
    }
    // Aliases are stable for equal values, including equal choices at different
    // transcript positions. Empty segments remain empty. Nothing is hashed.
    for (const key of ['text', 'input']) {
      if (Object.hasOwn(fields, key)) {
        body[key] = fields[key].split('*').map(value => value === '' ? '' : alias(values, 'value', value)).join('*');
      }
    }
    for (const key of eventValues) {
      if (Object.hasOwn(fields, key)) body[key] = '[redacted]';
    }
    if (['Incomplete', 'Success', 'Failed'].includes(fields.status)) body.status = fields.status;
    return {
      schemaVersion: 1, provenance: 'sandbox-capture-unverified',
      receivedAt: new Date().toISOString(),
      request: { method: 'POST', route, contentType: 'application/x-www-form-urlencoded', body },
      unknownFieldCount: Object.keys(fields).filter(key => !known.includes(key)).length,
      // HTTP receipt is not evidence of provider authenticity. Reconcile this
      // record with the sandbox session before promoting it to a fixture.
      providerAuthenticated: false
    };
  };
}

function createCaptureServer({ record, maxCaptures = 500 }) {
  const sanitize = createSanitizer();
  let captured = 0;
  const outcomes = {};
  const server = http.createServer(async (req, res) => {
    // Fixed route labels and numeric statuses only; never retain arbitrary
    // paths, headers, identities, request bodies or error messages here.
    const route = ['/ussd', '/events'].includes(req.url) ? req.url : 'other';
    const send = (status, response) => {
      const key = `${route}:${status}`;
      outcomes[key] = (outcomes[key] || 0) + 1;
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(response);
    };
    if (req.method !== 'POST' || !['/ussd', '/events'].includes(req.url)) return send(404, 'Not found');
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') {
      return send(415, 'Unsupported media type');
    }
    if (captured >= maxCaptures) return send(503, 'Capture limit reached');
    try {
      const chunks = await new Promise((resolve, reject) => {
        const parts = [];
        let bytes = 0;
        req.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > 16384) {
            parts.length = 0;
            reject(Object.assign(new Error('Request too large'), { status: 413 }));
          } else parts.push(chunk);
        });
        req.once('end', () => resolve(parts));
        req.once('error', reject);
        req.once('aborted', () => reject(new Error('Aborted request')));
      });
      const fields = parseForm(Buffer.concat(chunks).toString('utf8'));
      const evidence = sanitize(req.url, fields);
      const response = req.url === '/events' ? 'OK' : fields.text === ''
        ? 'CON Sandbox contract probe\n1. Continue\n2. Finish'
        : fields.text?.split('*').at(-1) === '2' ? 'END Sandbox probe complete.'
          : 'CON Sandbox contract probe\n1. Continue\n2. Finish';
      evidence.response = { status: 200, contentType: 'text/plain; charset=utf-8', body: response };
      // The writer receives sanitized data only. Do not log raw requests/errors.
      if (captured >= maxCaptures) return send(503, 'Capture limit reached');
      record(evidence);
      captured += 1;
      return send(200, response);
    } catch (error) {
      return error.status === 413 ? send(413, 'Request too large') : send(400, 'Invalid capture request');
    }
  });
  server.getCaptureStats = () => ({ captured, outcomes: { ...outcomes } });
  return server;
}

module.exports = { parseForm, createSanitizer, createCaptureServer };
