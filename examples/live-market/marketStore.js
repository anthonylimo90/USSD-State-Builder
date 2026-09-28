const { PRODUCTS } = require('./catalog');

const PLACE_ORDER = `
local operation = ARGV[3] ~= '' and redis.call('GET', KEYS[6]) or nil
if operation then return cjson.decode(operation) end
local function finish(result)
 if ARGV[3] ~= '' then redis.call('SET', KEYS[6], cjson.encode(result), 'EX', 86400) end
 return result
end
local previous = redis.call('GET', KEYS[4])
if previous then
 local raw = redis.call('HGET', KEYS[2], previous)
 local status = raw and cjson.decode(raw).status or 'missing'
 return finish({2, previous, status})
end
local items = cjson.decode(ARGV[2])
for _, item in ipairs(items) do
  local available = tonumber(redis.call('HGET', KEYS[1], item.sku) or '0')
  if available < item.quantity then return finish({0, item.sku, available}) end
end
local number = redis.call('INCR', KEYS[3])
local orderId = string.format('M%05d', number)
local order = cjson.decode(ARGV[1])
order.id = orderId
for _, item in ipairs(items) do
  redis.call('HINCRBY', KEYS[1], item.sku, -item.quantity)
end
redis.call('HSET', KEYS[2], orderId, cjson.encode(order))
redis.call('LPUSH', KEYS[5], orderId)
redis.call('SET', KEYS[4], orderId, 'EX', 86400)
return finish({1, orderId})
`;

const CANCEL_ORDER = `
local previous = ARGV[4] ~= '' and redis.call('GET', KEYS[3]) or nil
if previous then return previous end
local function finish(result)
 if ARGV[4] ~= '' then redis.call('SET', KEYS[3], result, 'EX', 86400) end
 return result
end
local raw = redis.call('HGET', KEYS[2], ARGV[1])
if not raw then return finish('missing') end
local order = cjson.decode(raw)
if order.phone ~= ARGV[2] then return finish('missing') end
if order.status ~= 'placed' then return finish('already') end
for _, item in ipairs(order.items) do
  redis.call('HINCRBY', KEYS[1], item.sku, item.quantity)
end
order.status = 'cancelled'
order.cancelledAt = ARGV[3]
redis.call('HSET', KEYS[2], ARGV[1], cjson.encode(order))
return finish('cancelled')
`;

class MarketStore {
  constructor(client, prefix = 'ussd:live-market:') {
    this.client = client;
    this.prefix = prefix;
    this.stockKey = `${prefix}stock`;
    this.ordersKey = `${prefix}orders`;
    this.sequenceKey = `${prefix}order-sequence`;
  }

  async seed() {
    for (const product of Object.values(PRODUCTS)) {
      await this.client.hSetNX(this.stockKey, product.sku, String(product.stock));
    }
  }

  async getStock(sku) {
    return Number(await this.client.hGet(this.stockKey, sku) || 0);
  }

  async placeOrder(sessionId, phone, cart, pickup, { signal, idempotencyKey } = {}) {
    signal?.throwIfAborted();
    const items = Object.entries(cart || {}).map(([sku, quantity]) => ({ sku, quantity }));
    if (!items.length || items.some(item => !PRODUCTS[item.sku] || !Number.isInteger(item.quantity) || item.quantity < 1)) {
      throw new Error('Invalid cart');
    }
    const total = items.reduce((sum, item) => sum + PRODUCTS[item.sku].price * item.quantity, 0);
    const order = {
      phone, items, pickup, total, status: 'placed', createdAt: new Date().toISOString()
    };
    const result = await this.client.eval(PLACE_ORDER, {
      keys: [this.stockKey, this.ordersKey, this.sequenceKey,
        `${this.prefix}checkout:${sessionId}`, `${this.prefix}phone:${phone}:orders`, this.operationKey(idempotencyKey)],
      arguments: [JSON.stringify(order), JSON.stringify(items), idempotencyKey || '']
    });
    if (result[0] === 0) return { status: 'out_of_stock', sku: result[1], available: Number(result[2]) };
    if (result[0] === 2) {
      const existing = await this.getOrder(result[1], phone);
      if (!existing) throw new Error('Existing order could not be read');
      return {
        status: (idempotencyKey ? result[2] : existing.status) === 'placed' ? 'existing' : (idempotencyKey ? result[2] : existing.status),
        id: existing.id,
        total: existing.total
      };
    }
    return { status: 'created', id: result[1], total };
  }

  async getOrder(orderId, phone) {
    const raw = await this.client.hGet(this.ordersKey, orderId);
    if (!raw) return null;
    const order = JSON.parse(raw);
    return order.phone === phone ? order : null;
  }

  async listOrders(phone) {
    const ids = await this.client.lRange(`${this.prefix}phone:${phone}:orders`, 0, 4);
    const orders = await Promise.all(ids.map(id => this.getOrder(id, phone)));
    return orders.filter(Boolean);
  }

  operationKey(idempotencyKey) { return `${this.prefix}operation:${idempotencyKey || 'legacy'}`; }

  async readOperation(idempotencyKey, state, phone) {
    const raw = await this.client.get(this.operationKey(idempotencyKey));
    if (!raw) return null;
    if (state === 'ORDER_DETAIL') return { status: raw };
    if (state !== 'CONFIRM') return null;
    const result = JSON.parse(raw);
    if (result[0] === 0) return null; // A nonterminal cart correction needs an explicit reconstruction policy.
    const order = await this.getOrder(result[1], phone);
    if (!order) return null;
    return { status: result[0] === 1 ? 'created' : result[2] === 'placed' ? 'existing' : result[2], id: result[1], total: order.total };
  }

  async cancelOrder(orderId, phone, { signal, idempotencyKey } = {}) {
    signal?.throwIfAborted();
    return this.client.eval(CANCEL_ORDER, {
      keys: [this.stockKey, this.ordersKey, this.operationKey(idempotencyKey)],
      arguments: [orderId, phone, new Date().toISOString(), idempotencyKey || '']
    });
  }
}

module.exports = { MarketStore };
