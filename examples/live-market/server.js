const http = require('http');
const fs = require('fs');
const path = require('path');
const { RedisStorage, AfricasTalkingAdapter, ProviderRequestError, createDistributedLockManager } = require('ussd-state-builder');
const { createProviderTurnHandler } = require('./provider');
const { CATALOG } = require('./catalog');
const { MarketStore } = require('./marketStore');
const { createMarketApp } = require('./app');

function normalizePhone(value) {
  const phone = String(value || '').replace(/[\s-]/g, '');
  if (/^07\d{8}$/.test(phone)) return `254${phone.slice(1)}`;
  if (/^\+?2547\d{8}$/.test(phone)) return phone.replace(/^\+/, '');
  return null;
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

function readProviderBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        chunks.length = 0;
        reject(new ProviderRequestError('BODY_TOO_LARGE', 413));
      } else chunks.push(chunk);
    });
    req.once('end', () => resolve(Buffer.concat(chunks)));
    req.once('error', reject);
    req.once('aborted', () => reject(new ProviderRequestError('ABORTED_REQUEST')));
  });
}

async function createLiveMarket({ redisUrl = 'redis://localhost:6379', prefix = 'ussd:live-market:',
  serviceCode, applicationId = 'mavuno-demo' } = {}) {
  const providerAdapter = serviceCode ? new AfricasTalkingAdapter({ applicationId, serviceCode }) : null;
  const storage = new RedisStorage({ url: redisUrl, keyPrefix: `${prefix}session:` });
  await storage._ensureConnected();
  const market = new MarketStore(storage.client, prefix);
  await market.seed();
  const machine = createMarketApp({ storage, market });
  const providerTurn = providerAdapter ? createProviderTurnHandler({
    adapter: providerAdapter, machine, storage, normalizePhone,
    lockedStorage: createDistributedLockManager(storage, { redisClient: storage.client, keyPrefix: `${prefix}provider-lock:` })
  }) : null;

  const server = http.createServer(async (req, res) => {
    try {
      if (providerAdapter && req.url === '/africas-talking/ussd') {
        let result;
        try {
          const body = await readProviderBody(req, providerAdapter.maxBodyBytes);
          result = await providerAdapter.handle({ method: req.method, contentType: req.headers['content-type'], body }, providerTurn);
        } catch (error) { result = providerAdapter.errorResponse(error); }
        res.writeHead(result.status, result.headers);
        return res.end(result.body);
      }
      if (req.method === 'GET' && req.url === '/') {
        return send(res, 200, fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && req.url === '/health') {
        await storage.client.ping();
        return send(res, 200, { status: 'ok', app: 'Mavuno Co-op demo' });
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

  return {
    server, storage, market, machine, providerAdapter,
    async close() {
      if (server.listening) await new Promise(resolve => server.close(resolve));
      await storage.close();
    }
  };
}

if (require.main === module) {
  createLiveMarket({
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    prefix: process.env.MARKET_PREFIX || 'ussd:live-market:',
    serviceCode: process.env.AT_SERVICE_CODE,
    applicationId: process.env.AT_APPLICATION_ID || 'mavuno-demo'
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
