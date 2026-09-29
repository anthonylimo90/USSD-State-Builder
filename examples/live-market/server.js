const http = require('http');
const fs = require('fs');
const path = require('path');
const { timingSafeEqual } = require('crypto');
const { RedisStorage, AfricasTalkingAdapter, AfricasTalkingEventAdapter,
  RedisSessionEventStore, SessionEventGateway, ProviderRequestError } = require('ussd-state-builder');
const { createProviderGateway } = require('./provider');
const { CATALOG } = require('./catalog');
const { MarketStore } = require('./marketStore');
const { createMarketApp } = require('./app');

function normalizePhone(value) {
  const phone = String(value || '').replace(/[\s-]/g, '');
  if (/^07\d{8}$/.test(phone)) return `254${phone.slice(1)}`;
  if (/^\+?2547\d{8}$/.test(phone)) return phone.replace(/^\+/, '');
  return null;
}

function authorized(req, token) {
  const actual = Buffer.from(req.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(contentType.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) throw new Error('Request body too large');
  }
  return JSON.parse(body || '{}');
}

function readProviderBody(req, maxBytes, signal) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    const cleanup = () => {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAborted);
      signal.removeEventListener('abort', onAbort);
    };
    const fail = error => { cleanup(); req.resume(); reject(error); };
    const onData = chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) fail(new ProviderRequestError('BODY_TOO_LARGE', 413));
      else chunks.push(chunk);
    };
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const onError = error => fail(error);
    const onAborted = () => fail(new ProviderRequestError('ABORTED_REQUEST', 503));
    const onAbort = () => fail(new ProviderRequestError('REQUEST_DEADLINE', 503));
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
    req.once('aborted', onAborted);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

async function createLiveMarket({ redisUrl = 'redis://localhost:6379', prefix = 'ussd:live-market:',
  serviceCode, applicationId = 'mavuno-demo', providerDeadlineMs = 5000,
  providerEventToken, orderEventToken, responseBudgets = { default: 160 } } = {}) {
  if (serviceCode && (!Number.isSafeInteger(providerDeadlineMs) || providerDeadlineMs < 1 || providerDeadlineMs > 2147483647)) {
    throw new TypeError('Invalid provider request deadline');
  }
  for (const token of [providerEventToken, orderEventToken]) {
    if (token !== undefined && (typeof token !== 'string' || token.length < 16 || token.length > 256)) {
      throw new TypeError('Event ingress tokens must be 16–256 characters');
    }
  }
  const providerAdapter = serviceCode ? new AfricasTalkingAdapter({ applicationId, serviceCode, responseBudgets }) : null;
  const eventAdapter = serviceCode ? new AfricasTalkingEventAdapter({ applicationId, serviceCode }) : null;
  const storage = new RedisStorage({ url: redisUrl, keyPrefix: `${prefix}session:` });
  await storage._ensureConnected();
  const market = new MarketStore(storage.client, prefix);
  await market.seed();
  const machine = createMarketApp({ storage, market });
  const eventStore = providerAdapter ? new RedisSessionEventStore({ storage }) : null;
  const eventGateway = eventAdapter ? new SessionEventGateway({ adapter: eventAdapter, store: eventStore }) : null;
  const providerGateway = providerAdapter ? createProviderGateway({
    adapter: providerAdapter, machine, storage, normalizePhone, market, eventStore, deadlineMs: providerDeadlineMs
  }) : null;

  let draining = false;
  let closePromise;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/live') return send(res, 200, { status: 'alive' });
      if (draining) {
        res.setHeader('Connection', 'close');
        return req.url === '/africas-talking/ussd'
          ? send(res, 503, 'END Service unavailable. Please try again.', 'text/plain; charset=utf-8')
          : send(res, 503, { status: 'draining' });
      }
      if (req.method === 'GET' && (req.url === '/ready' || req.url === '/health')) {
        try {
          await storage.client.ping();
          return send(res, draining ? 503 : 200, { status: draining ? 'draining' : 'ok', app: 'Mavuno Co-op demo' });
        } catch { return send(res, 503, { status: 'unready' }); }
      }
      if (providerAdapter && providerEventToken && req.url === '/africas-talking/events') {
        if (!authorized(req, providerEventToken)) return send(res, 401, 'Unavailable', 'text/plain; charset=utf-8');
        let result;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), providerDeadlineMs);
        try {
          const body = await readProviderBody(req, eventAdapter.maxBodyBytes, controller.signal);
          result = await eventGateway.handle({ method: req.method, contentType: req.headers['content-type'], body });
        } catch (error) { result = { status: error instanceof ProviderRequestError ? error.status : 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Unavailable' }; }
        finally { clearTimeout(timer); }
        res.writeHead(result.status, result.headers);
        return res.end(result.body);
      }
      if (orderEventToken && req.url === '/demo/order-events') {
        if (!authorized(req, orderEventToken)) return send(res, 401, { error: 'Unauthorized' });
        if (req.method !== 'POST') return send(res, 405, { error: 'POST required' });
        let event;
        try { event = await readJson(req); }
        catch { return send(res, 400, { error: 'Invalid event' }); }
        try {
          const classification = await market.acceptOrderEvent(event);
          return send(res, classification === 'missing' ? 404 : ['conflict', 'closed'].includes(classification) ? 409 : 200,
            { classification });
        } catch (error) {
          if (error instanceof TypeError) return send(res, 400, { error: 'Invalid event' });
          throw error;
        }
      }
      if (providerAdapter && req.url === '/africas-talking/ussd') {
        let result;
        const controller = new AbortController();
        const deadlineAt = Date.now() + providerDeadlineMs;
        const timer = setTimeout(() => controller.abort(), providerDeadlineMs);
        const onClose = () => { if (!res.writableFinished) controller.abort(); };
        res.once('close', onClose);
        try {
          const body = await readProviderBody(req, providerAdapter.maxBodyBytes, controller.signal);
          result = await providerGateway.handle({ method: req.method, contentType: req.headers['content-type'], body },
            { signal: controller.signal, deadlineAt });
        } catch (error) { result = providerAdapter.errorResponse(error); }
        finally { clearTimeout(timer); res.removeListener('close', onClose); }
        res.writeHead(result.status, result.headers);
        return res.end(result.body);
      }
      if (req.method === 'GET' && req.url === '/') {
        return send(res, 200, fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/keypad.js') {
        return send(res, 200, fs.readFileSync(path.join(path.dirname(require.resolve('ussd-state-builder')),
          'lib/workbench/keypad.js'), 'utf8'), 'text/javascript; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/catalog') {
        const categories = await Promise.all(Object.entries(CATALOG).map(async ([name, products]) => [
          name,
          await Promise.all(products.map(async product => ({
            sku: product.sku, name: product.name, price: product.price,
            available: await market.getStock(product.sku)
          })))
        ]));
        return send(res, 200, Object.fromEntries(categories));
      }
      if (req.method === 'POST' && req.url === '/ussd') {
        let body;
        try {
          body = await readJson(req);
        } catch (error) {
          return send(res, 400, { error: 'Invalid JSON or request too large' });
        }
        const { sessionId, input = '' } = body;
        const phone = normalizePhone(body.phoneNumber);
        if (typeof sessionId !== 'string' || !/^[\w-]{1,80}$/.test(sessionId) ||
            typeof input !== 'string' || input.length > 160 || !phone) {
          return send(res, 400, { error: 'Valid sessionId, Kenyan phoneNumber, and input are required' });
        }

        const data = await storage.getData(sessionId);
        if (data?.phone && data.phone !== phone) {
          return send(res, 409, { error: 'Session belongs to another phone number' });
        }
        if (!data?.phone) await storage.setData(sessionId, { phone }, 300);
        const response = await machine.processInput(sessionId, input);
        return send(res, 200, response, 'text/plain; charset=utf-8');
      }
      return send(res, 404, { error: 'Not found' });
    } catch (error) {
      console.error('Live market request failed:', error);
      return send(res, 500, 'END Service unavailable. Please try again.', 'text/plain; charset=utf-8');
    }
  });

  const drain = () => { draining = true; };
  return {
    server, storage, market, machine, providerAdapter, providerGateway, eventAdapter, eventStore, eventGateway,
    drain,
    async close() {
      if (closePromise) return closePromise;
      drain();
      closePromise = (async () => {
        if (server.listening) {
          await new Promise(resolve => {
            const timer = setTimeout(() => server.closeAllConnections(), Math.max(10000, providerDeadlineMs + 1000));
            server.close(() => { clearTimeout(timer); resolve(); });
          });
        }
        await storage.close();
      })();
      return closePromise;
    }
  };
}

if (require.main === module) {
  createLiveMarket({
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    prefix: process.env.MARKET_PREFIX || 'ussd:live-market:',
    serviceCode: process.env.AT_SERVICE_CODE,
    applicationId: process.env.AT_APPLICATION_ID || 'mavuno-demo',
    providerDeadlineMs: Number(process.env.AT_DEADLINE_MS || 5000),
    providerEventToken: process.env.AT_EVENT_TOKEN,
    orderEventToken: process.env.MARKET_ORDER_EVENT_TOKEN,
    responseBudgets: process.env.AT_RESPONSE_BUDGETS ? JSON.parse(process.env.AT_RESPONSE_BUDGETS) : { default: 160 }
  }).then(app => {
    const port = Number(process.env.PORT || 3100);
    app.server.listen(port, '127.0.0.1', () => {
      console.log(`Mavuno Co-op demo: http://localhost:${port}`);
    });
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => app.close().then(() => process.exit(0)));
    }
  }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { createLiveMarket, normalizePhone };
