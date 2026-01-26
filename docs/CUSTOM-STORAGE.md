# Custom Storage Adapter Tutorial

This guide walks you through building a custom storage adapter by extending `StorageInterface`.

## StorageInterface Overview

All storage adapters extend `StorageInterface`. It has **required** abstract methods and **optional** methods with default implementations.

```
Required (must override):
  getState(sessionId)              -> string | null
  setState(sessionId, state, timeout)
  getData(sessionId)               -> object | null
  setData(sessionId, data, timeout)

Optional (have default implementations):
  getSession / setSession          -- full session object access
  getStateHistory / pushStateHistory / popStateHistory  -- back navigation
  deleteSession / cleanup / close  -- lifecycle
  isConnected()                    -- health checks
  getStateBatch / getDataBatch / deleteSessionBatch    -- bulk operations
  withTransaction(fn)              -- atomic operations
```

## Step-by-Step: SQLite Adapter

### 1. Extend StorageInterface and Set Up Connection

```javascript
const { StorageInterface } = require('ussd-state-builder');
const Database = require('better-sqlite3');

class SQLiteStorage extends StorageInterface {
  constructor(options = {}) {
    super();
    this.dbPath = options.dbPath || ':memory:';
    this.maxHistorySize = options.maxHistorySize ?? 20;
    this.db = null;
  }

  async _ensureConnected() {
    if (this.db) return;
    this.db = new Database(this.dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY, state TEXT,
        data TEXT, state_history TEXT DEFAULT '[]', expires_at INTEGER
      )
    `);
  }

  isConnected() { return this.db !== null && this.db.open; }
  async close() { if (this.db) { this.db.close(); this.db = null; } }
```

### 2. Implement Required Methods

```javascript
  async getState(sessionId) {
    await this._ensureConnected();
    const row = this.db.prepare(
      'SELECT state FROM sessions WHERE session_id = ? AND expires_at > ?'
    ).get(sessionId, Date.now());
    return row ? row.state : null;
  }

  async setState(sessionId, state, timeout) {
    await this._ensureConnected();
    const expiresAt = Date.now() + timeout * 1000;
    this.db.prepare(`
      INSERT INTO sessions (session_id, state, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET state = ?, expires_at = ?
    `).run(sessionId, state, expiresAt, state, expiresAt);
  }

  async getData(sessionId) {
    await this._ensureConnected();
    const row = this.db.prepare(
      'SELECT data FROM sessions WHERE session_id = ? AND expires_at > ?'
    ).get(sessionId, Date.now());
    return row && row.data ? JSON.parse(row.data) : null;
  }

  async setData(sessionId, data, timeout) {
    await this._ensureConnected();
    const existing = await this.getData(sessionId);
    const merged = { ...existing, ...data };
    const expiresAt = Date.now() + timeout * 1000;
    this.db.prepare('UPDATE sessions SET data = ?, expires_at = ? WHERE session_id = ?')
      .run(JSON.stringify(merged), expiresAt, sessionId);
  }
```

### 3. Implement Back Navigation (Optional but Recommended)

```javascript
  async pushStateHistory(sessionId, state) {
    const history = await this.getStateHistory(sessionId);
    history.push(state);
    if (this.maxHistorySize > 0 && history.length > this.maxHistorySize) {
      history.splice(0, history.length - this.maxHistorySize);
    }
    this.db.prepare('UPDATE sessions SET state_history = ? WHERE session_id = ?')
      .run(JSON.stringify(history), sessionId);
  }

  async popStateHistory(sessionId) {
    const history = await this.getStateHistory(sessionId);
    const previous = history.pop();
    this.db.prepare('UPDATE sessions SET state_history = ? WHERE session_id = ?')
      .run(JSON.stringify(history), sessionId);
    return previous;
  }
```

### 4. Cleanup and Deletion

```javascript
  async deleteSession(sessionId) {
    await this._ensureConnected();
    this.db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
  }

  async cleanup() {
    await this._ensureConnected();
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  }
}
```

## Batch Operations and Transactions

Override batch methods when your backend supports multi-key operations. The default implementations loop through IDs sequentially.

```javascript
async deleteSessionBatch(sessionIds) {
  const placeholders = sessionIds.map(() => '?').join(',');
  const result = this.db.prepare(
    `DELETE FROM sessions WHERE session_id IN (${placeholders})`
  ).run(...sessionIds);
  return result.changes;
}

async withTransaction(fn) {
  await this._ensureConnected();
  return this.db.transaction(() => fn(this))();
}
```

For Redis, see `RedisStorage.withTransaction()` which uses `MULTI/EXEC`.

## Testing Your Adapter

```javascript
const { USSDStateMachine, USSDTester } = require('ussd-state-builder');
const SQLiteStorage = require('./SQLiteStorage');

describe('SQLiteStorage', () => {
  let storage;
  beforeEach(() => { storage = new SQLiteStorage({ dbPath: ':memory:' }); });
  afterEach(async () => { await storage.close(); });

  it('should persist and retrieve state', async () => {
    await storage.setState('s1', 'WELCOME', 300);
    expect(await storage.getState('s1')).toBe('WELCOME');
  });

  it('should merge session data', async () => {
    await storage.setState('s1', 'WELCOME', 300);
    await storage.setData('s1', { name: 'Alice' }, 300);
    await storage.setData('s1', { phone: '0712345678' }, 300);
    expect(await storage.getData('s1')).toEqual({ name: 'Alice', phone: '0712345678' });
  });

  it('should integrate with USSDStateMachine', async () => {
    const sm = new USSDStateMachine({
      initialState: 'START', storage,
      states: {
        START: { handler: async () => ({ response: 'CON Welcome', nextState: 'MENU' }) },
        MENU: { handler: async () => ({ response: 'END Done' }) }
      }
    });
    const tester = new USSDTester(sm);
    await tester.start().expectResponse(/Welcome/).input('1').expectState('MENU').run();
  });
});
```
