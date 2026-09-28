const RedisStorage = require('./RedisStorage');
const InMemoryStorage = require('./InMemoryStorage');
const copy = value => JSON.parse(JSON.stringify(value));

function validateClaim(revision, ledger, ttl, leaseMs, deadlineAt) {
  if (!Number.isSafeInteger(revision) || revision < 0 || ledger?.revision !== revision ||
      typeof ledger?.pending?.token !== 'string' || !ledger.pending.token ||
      !Number.isSafeInteger(ttl) || ttl < 1 || ttl > 2147483647 ||
      (leaseMs !== undefined && (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 2147483647)) ||
      (deadlineAt !== undefined && (!Number.isSafeInteger(deadlineAt) || deadlineAt < 1))) {
    throw new TypeError('Invalid atomic turn claim');
  }
  JSON.stringify(ledger);
}
function validateCommit(revision, token, ledger, session, ttl, activeMs) {
  if (!Number.isSafeInteger(revision) || revision < 0 || typeof token !== 'string' || !token ||
      ledger?.revision !== revision + 1 || ledger.pending !== null ||
      !Number.isSafeInteger(ttl) || ttl < 1 || ttl > 2147483647 ||
      !Number.isSafeInteger(activeMs) || activeMs < 1 || activeMs > ttl * 1000 ||
      (session?.state != null && typeof session.state !== 'string') ||
      (session?.data != null && (typeof session.data !== 'object' || Array.isArray(session.data))) ||
      (session?.stateHistory != null && (!Array.isArray(session.stateHistory) || session.stateHistory.some(state => typeof state !== 'string')))) {
    throw new TypeError('Invalid atomic turn commit');
  }
  JSON.stringify({ ledger, session });
}

// Both implementations atomically check ownership/revision and install the
// complete snapshot plus receipt. Unsupported adapters are never simulated by
// StorageInterface.withTransaction's sequential fallback.
class InMemoryTurnStore {
  constructor({ storage }) {
    if (!(storage instanceof InMemoryStorage)) throw new TypeError('InMemoryTurnStore requires InMemoryStorage');
    this.storage = storage;
    this.supportsDeadlines = true;
    this.records = new Map();
  }
  async read(key, { withClock = false } = {}) {
    const record = this.records.get(key);
    if (record && record.receiptExpiresAt > Date.now()) return { ...copy(record), now: Date.now() };
    this.records.delete(key);
    const session = await this.storage.getSession(key);
    return session ? { orphan: true, session, now: Date.now() } : withClock ? { empty: true, now: Date.now() } : null;
  }
  async claim(key, expectedRevision, ledger, ttl, replaceToken = null, leaseMs, deadlineAt) {
    validateClaim(expectedRevision, ledger, ttl, leaseMs, deadlineAt);
    const record = this.records.get(key);
    const current = record?.receiptExpiresAt > Date.now() ? record : null;
    if ((current?.revision || 0) !== expectedRevision) return false;
    if (replaceToken ? current?.pending?.token !== replaceToken : Boolean(current?.pending)) return false;
    if (current && !replaceToken && current.activeExpiresAt <= Date.now()) return false;
    if (deadlineAt !== undefined && deadlineAt <= Date.now()) return false;
    const claimed = copy(ledger);
    if (leaseMs !== undefined || deadlineAt !== undefined) claimed.pending.deadlineAt = Math.min(leaseMs === undefined ? Infinity : Date.now() + leaseMs, deadlineAt ?? Infinity);
    this.records.set(key, { ...claimed, session: current?.session || null,
      activeExpiresAt: current?.activeExpiresAt || null, receiptExpiresAt: Date.now() + ttl * 1000 });
    return true;
  }
  async commit(key, expectedRevision, token, ledger, session, ttl, activeMs) {
    validateCommit(expectedRevision, token, ledger, session, ttl, activeMs);
    const record = this.records.get(key);
    if (!record || record.receiptExpiresAt <= Date.now() || record.revision !== expectedRevision || record.pending?.token !== token || (record.pending.deadlineAt && record.pending.deadlineAt <= Date.now())) return false;
    const snapshot = session ? copy(session) : { state: null, data: null, stateHistory: [] };
    snapshot.expiresAt = Date.now() + activeMs;
    const committed = { ...copy(ledger), session: snapshot, activeExpiresAt: snapshot.expiresAt, receiptExpiresAt: Date.now() + ttl * 1000 };
    this.storage.store.set(key, copy(snapshot));
    this.records.set(key, committed);
    return true;
  }
}

const READ = `
local record = redis.call('HGET', KEYS[1], '__ussdGateway')
local time = redis.call('TIME')
local now = time[1] * 1000 + math.floor(time[2] / 1000)
return {record or '', redis.call('HGET', KEYS[1], 'state') or '',
 redis.call('HGET', KEYS[1], 'data') or 'null', redis.call('HGET', KEYS[1], 'stateHistory') or '[]',
 redis.call('HGET', KEYS[1], 'turnExpiresAt') or '0', tostring(now), tostring(redis.call('PTTL', KEYS[1])), redis.call('HGET', KEYS[1], 'turnOwnerExpiresAt') or ''}
`;
const CLAIM = `
local current = redis.call('HGET', KEYS[1], '__ussdGateway')
local record = current and cjson.decode(current) or nil
local revision = record and record.revision or 0
if revision ~= tonumber(ARGV[1]) then return 0 end
local pending = record and record.pending
if ARGV[4] ~= '' then
 if not pending or pending == cjson.null or pending.token ~= ARGV[4] then return 0 end
else
 if pending and pending ~= cjson.null then return 0 end
 if record then
  local time = redis.call('TIME')
  local now = time[1] * 1000 + math.floor(time[2] / 1000)
  local expires = tonumber(redis.call('HGET', KEYS[1], 'turnExpiresAt') or '0')
  if expires <= now then return 0 end
 end
end
local time = redis.call('TIME')
local now = time[1] * 1000 + math.floor(time[2] / 1000)
if ARGV[6] ~= '' and tonumber(ARGV[6]) <= now then return 0 end
local deadline = ARGV[6]
if ARGV[5] ~= '' then
 local expires = now + tonumber(ARGV[5])
 if ARGV[6] ~= '' then expires = math.min(expires, tonumber(ARGV[6])) end
 deadline = tostring(expires)
end
redis.call('HSET', KEYS[1], '__ussdGateway', ARGV[2], 'turnOwnerExpiresAt', deadline)
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
`;
const COMMIT = `
local current = redis.call('HGET', KEYS[1], '__ussdGateway')
if not current then return 0 end
local record = cjson.decode(current)
if record.revision ~= tonumber(ARGV[1]) or not record.pending or record.pending == cjson.null or record.pending.token ~= ARGV[2] then return 0 end
local time = redis.call('TIME')
local now = time[1] * 1000 + math.floor(time[2] / 1000)
local deadline = tonumber(redis.call('HGET', KEYS[1], 'turnOwnerExpiresAt') or '')
if deadline and deadline <= now then return 0 end
local expires = now + tonumber(ARGV[8])
redis.call('HSET', KEYS[1], '__ussdGateway', ARGV[3], 'state', ARGV[4], 'data', ARGV[5], 'stateHistory', ARGV[6], 'turnExpiresAt', tostring(expires))
redis.call('EXPIRE', KEYS[1], ARGV[7])
return 1
`;
class RedisTurnStore {
  constructor({ storage }) {
    if (!(storage instanceof RedisStorage) || storage._encryption || storage.withSessionLock) {
      throw new TypeError('RedisTurnStore requires a raw RedisStorage; wrappers need an explicit atomic capability');
    }
    this.storage = storage;
    this.supportsDeadlines = true;
  }
  async read(key, { withClock = false } = {}) {
    await this.storage._ensureConnected();
    const [raw, state, data, history, expires, now, remaining, deadline] = await this.storage.client.eval(READ, { keys: [this.storage._getKey(key)], arguments: [] });
    const session = { state: state || null, data: JSON.parse(data), stateHistory: JSON.parse(history), expiresAt: Number(expires) || null };
    if (!raw) return state || session.data ? { orphan: true, session, now: Number(now) } : withClock ? { empty: true, now: Number(now) } : null;
    const ledger = JSON.parse(raw);
    if (ledger.pending && deadline) ledger.pending.deadlineAt = Number(deadline);
    return { ...ledger, session, activeExpiresAt: Number(expires), now: Number(now), receiptExpiresAt: Number(now) + Number(remaining) };
  }
  async claim(key, revision, ledger, ttl, replaceToken = null, leaseMs, deadlineAt) {
    validateClaim(revision, ledger, ttl, leaseMs, deadlineAt);
    await this.storage._ensureConnected();
    return Boolean(await this.storage.client.eval(CLAIM, { keys: [this.storage._getKey(key)],
      arguments: [String(revision), JSON.stringify(ledger), String(ttl), replaceToken || '', leaseMs === undefined ? '' : String(leaseMs), deadlineAt === undefined ? '' : String(deadlineAt)] }));
  }
  async commit(key, revision, token, ledger, session, ttl, activeMs) {
    validateCommit(revision, token, ledger, session, ttl, activeMs);
    await this.storage._ensureConnected();
    return Boolean(await this.storage.client.eval(COMMIT, { keys: [this.storage._getKey(key)], arguments: [
      String(revision), token, JSON.stringify(ledger), session?.state || '', JSON.stringify(session?.data || null),
      JSON.stringify(session?.stateHistory || []), String(ttl), String(activeMs)
    ] }));
  }
}
module.exports = { InMemoryTurnStore, RedisTurnStore };
