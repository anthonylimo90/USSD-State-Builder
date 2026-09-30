const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { ReplayError } = require('./Replay');
const { WorkbenchError } = require('./LocalWorkbench');

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/ui.js', ['ui.js', 'text/javascript; charset=utf-8']],
  ['/graph.js', ['graph.js', 'text/javascript; charset=utf-8']],
  ['/keypad.js', ['keypad.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']]
]);
const safeErrors = new Map([
  ['WORKBENCH_CLOSED', 503], ['SESSION_NOT_FOUND', 404], ['FLOW_NOT_FOUND', 404],
  ['SESSION_LIMIT', 409], ['SESSION_BUSY', 409], ['SESSION_CLOSED', 409],
  ['INVALID_INPUT', 400], ['JSON_REQUIRED', 415], ['BODY_TOO_LARGE', 413],
  ['REPLAY_NOT_CONFIGURED', 409], ['FLOW_VERSION_MISMATCH', 409], ['INVALID_JSON', 400], ['INVALID_FIELDS', 400], ['REQUEST_TIMEOUT', 408]
]);

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function readBody(req, maxBytes = 1024) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new WorkbenchError('JSON_REQUIRED', 415);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    const cleanup = () => {
      clearTimeout(timer);
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onError);
    };
    const fail = code => { cleanup(); req.resume(); reject(new WorkbenchError(code)); };
    const onData = chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) fail('BODY_TOO_LARGE');
      else chunks.push(chunk);
    };
    const onError = () => fail('INVALID_JSON');
    const onEnd = () => {
      cleanup();
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error();
        resolve(body);
      } catch { reject(new WorkbenchError('INVALID_JSON')); }
    };
    const timer = setTimeout(() => fail('REQUEST_TIMEOUT'), 5000);
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
    req.once('aborted', onError);
  });
}

/** A same-origin HTTP workbench that listens only on IPv4 loopback. */
function createWorkbenchServer({ workbench } = {}) {
  if (!workbench || typeof workbench.inspect !== 'function') throw new TypeError('A LocalWorkbench is required');
  const server = http.createServer(async (req, res) => {
    try {
      const port = server.address()?.port;
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      const origin = req.headers.origin;
      if (!hosts.includes(req.headers.host) || (origin && !hosts.some(host => origin === `http://${host}`)) ||
          req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, { error: 'LOCAL_ORIGIN_REQUIRED' });
      const asset = req.method === 'GET' && assets.get(req.url);
      if (asset) return send(res, 200, fs.readFileSync(path.join(__dirname, 'workbench', asset[0])), asset[1]);
      if (req.method === 'GET' && req.url === '/api/workbench') return send(res, 200, {
        ...workbench.describe(), sessions: workbench.listSessions()
      });
      if (req.method === 'POST' && req.url === '/api/sessions') {
        const body = await readBody(req);
        if (Object.keys(body).some(key => key !== 'flowId')) throw new WorkbenchError('INVALID_FIELDS');
        return send(res, 201, await workbench.createSession(body.flowId));
      }
      const match = /^\/api\/sessions\/([0-9a-f-]{36})(?:\/(turns|reset|export|replay))?$/.exec(req.url);
      if (!match) return send(res, 404, { error: 'NOT_FOUND' });
      const [, id, action] = match;
      if (req.method === 'GET' && action === 'export') return send(res, 200, await workbench.exportSession(id));
      if (req.method === 'GET' && !action) return send(res, 200, await workbench.inspect(id));
      if (req.method === 'DELETE' && !action) {
        await workbench.closeSession(id);
        return send(res, 200, { deleted: true });
      }
      if (req.method === 'POST' && ['export', 'replay'].includes(action)) {
        const body = await readBody(req, 66560);
        if (Object.keys(body).some(key => key !== 'fixture') || !Object.hasOwn(body, 'fixture')) throw new WorkbenchError('INVALID_FIELDS');
        return send(res, 200, action === 'export' ? await workbench.exportSession(id, body.fixture) : await workbench.replay(id, body.fixture));
      }
      if (req.method === 'POST' && action) {
        const body = await readBody(req);
        if (Object.keys(body).some(key => action === 'turns' ? key !== 'input' : true)) throw new WorkbenchError('INVALID_FIELDS');
        return send(res, 200, action === 'reset' ? await workbench.reset(id) : await workbench.send(id, body.input));
      }
      return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    } catch (error) {
      if (error instanceof ReplayError) return send(res, 400, { error: error.code, turn: error.turn });
      const code = error instanceof WorkbenchError && safeErrors.has(error.code) ? error.code : 'WORKBENCH_FAILED';
      return send(res, safeErrors.get(code) || 500, { error: code });
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  let closePromise;
  return {
    server, workbench,
    listen(port = 3200) {
      if (!Number.isSafeInteger(port) || port < 0 || port > 65535) return Promise.reject(new TypeError('Invalid workbench port'));
      return new Promise((resolve, reject) => {
        const fail = error => reject(error);
        server.once('error', fail);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', fail);
          resolve({ url: `http://127.0.0.1:${server.address().port}` });
        });
      });
    },
    close() {
      if (!closePromise) closePromise = (async () => {
        if (server.listening) await new Promise(resolve => {
          server.close(resolve);
          server.closeIdleConnections();
        });
        await workbench.close();
      })();
      return closePromise;
    }
  };
}

module.exports = { createWorkbenchServer };
