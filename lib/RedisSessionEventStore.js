const RedisStorage = require('./RedisStorage');
const { ProviderRequestError } = require('./AfricasTalkingAdapter');

const ACCEPT = `
local existing = redis.call('GET', KEYS[1])
local revision = existing and cjson.decode(existing).revision or 0
if revision ~= tonumber(ARGV[1]) then return 0 end
local turn = redis.call('HGET', KEYS[2], '__ussdGateway')
if turn then
 local binding = cjson.decode(turn).binding
 local incoming = cjson.decode(ARGV[3])
 for _, field in ipairs({'provider','applicationId','sessionId','serviceCode','phoneNumber','networkCode'}) do
  if binding[field] ~= incoming[field] then return -1 end
 end
end
local hadTurn = redis.call('EXISTS', KEYS[2])
local accepted = cjson.decode(ARGV[2])
accepted.bindingSource = turn and 'turn' or 'event_only'
redis.call('SET', KEYS[1], cjson.encode(accepted), 'EX', ARGV[4])
redis.call('HSET', KEYS[2], 'providerClosed', '1')
if hadTurn == 0 or redis.call('PTTL', KEYS[2]) < 0 then redis.call('EXPIRE', KEYS[2], ARGV[4]) end
return 1
`;
class RedisSessionEventStore {
  constructor({ storage, retentionSeconds = 604800, maxEvents = 16 }) {
    if (!(storage instanceof RedisStorage) || storage._encryption || storage.withSessionLock) {
      throw new TypeError('RedisSessionEventStore requires raw RedisStorage');
    }
    if (!Number.isSafeInteger(retentionSeconds) || retentionSeconds < 1 || retentionSeconds > 2147483647 ||
        !Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 128) throw new TypeError('Invalid event retention limits');
    Object.assign(this, { storage, retentionSeconds, maxEvents });
  }
  _key(sessionKey) { return this.storage._getKey(`event:${sessionKey}`); }
  async read(sessionKey) {
    await this.storage._ensureConnected();
    const raw = await this.storage.client.get(this._key(sessionKey));
    return raw ? JSON.parse(raw) : null;
  }
  async accept(event) {
    await this.storage._ensureConnected();
    for (let attempt = 0; attempt < 8; attempt++) {
      const previous = await this.read(event.sessionKey);
      if (previous && Object.keys(event.binding).some(key => previous.binding[key] !== event.binding[key])) {
        throw new ProviderRequestError('EVENT_BINDING_CONFLICT', 409);
      }
      if (previous?.events.some(item => item.fingerprint === event.fingerprint)) {
        return { classification: 'duplicate', record: previous };
      }
      if ((previous?.events.length || 0) >= this.maxEvents) throw new ProviderRequestError('EVENT_CAPACITY', 503);
      const last = previous?.events.reduce((value, item) => Math.max(value, item.occurredAt), -Infinity) ?? -Infinity;
      const diverges = Boolean(previous?.events.some(item => item.status !== event.status || item.occurredAt === event.occurredAt));
      const classification = diverges ? 'conflict' : event.occurredAt < last ? 'stale' : 'accepted';
      const events = [...(previous?.events || []), { fingerprint: event.fingerprint, occurredAt: event.occurredAt,
        status: event.status }].sort((a, b) => a.occurredAt - b.occurredAt || a.fingerprint.localeCompare(b.fingerprint));
      const record = { schemaVersion: 1, revision: (previous?.revision || 0) + 1, binding: event.binding,
        events, outcome: diverges ? 'conflict' : previous?.outcome === 'conflict' ? 'conflict' : event.status };
      const result = await this.storage.client.eval(ACCEPT, { keys: [this._key(event.sessionKey), this.storage._getKey(event.sessionKey)],
        arguments: [String(previous?.revision || 0), JSON.stringify(record), JSON.stringify(event.binding), String(this.retentionSeconds)] });
      if (result === 1) return { classification, record: await this.read(event.sessionKey) };
      if (result === -1) throw new ProviderRequestError('EVENT_BINDING_CONFLICT', 409);
    }
    throw new ProviderRequestError('EVENT_CONTENTION', 503);
  }
}
module.exports = { RedisSessionEventStore };
