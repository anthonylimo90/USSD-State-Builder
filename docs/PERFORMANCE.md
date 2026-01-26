# Performance Tuning Guide

Caching, resilience patterns, metrics, and memory management for high-throughput USSD applications.

## Caching with createCachedStorage

Wrap your storage adapter with an LRU cache layer to reduce round-trips to Redis or your database.

```javascript
const { RedisStorage, createCachedStorage } = require('ussd-state-builder');

const storage = createCachedStorage(new RedisStorage({ url: process.env.REDIS_URL }), {
  maxSize: 5000,      // max cached sessions
  ttl: 10000          // cache entries expire after 10 seconds
});

// Monitor cache effectiveness
console.log(storage.getCacheStats());
// { hits, misses, evictions, size, maxSize, hitRate }
```

Reads (`getState`, `getData`) check the cache first. Writes update both. `setData` invalidates the cache because data is merged server-side. `deleteSession` clears both.

## Circuit Breaker Pattern

Prevent cascading failures when a storage backend goes down.

```javascript
const { createProtectedStorage, InMemoryStorage } = require('ussd-state-builder');

const storage = createProtectedStorage(redis, {
  failureThreshold: 5,        // open circuit after 5 failures
  resetTimeout: 30000,        // try recovery after 30 seconds
  halfOpenMaxAttempts: 1,
  fallbackStorage: new InMemoryStorage(),
  onStateChange: (from, to) => console.warn(`Circuit: ${from} -> ${to}`)
});

// States: CLOSED (normal) -> OPEN (failing fast) -> HALF_OPEN (testing) -> CLOSED
console.log(storage._circuitBreaker.getStats());
```

## Retry Strategy

Add automatic retry with exponential backoff for transient storage errors.

```javascript
const { createRetryStorage } = require('ussd-state-builder');

const storage = createRetryStorage(redis, {
  maxRetries: 3,
  baseDelay: 100,              // first retry after ~100ms
  maxDelay: 5000,
  backoffMultiplier: 2,        // 100ms, 200ms, 400ms (before jitter)
  jitter: true,                // randomize to avoid thundering herd
  onRetry: (error, attempt, delay) => {
    console.warn(`Retry ${attempt}: ${error.message} (${delay}ms)`);
  }
});
```

Non-retryable errors (ValidationError, ConfigurationError) are thrown immediately.

## Combining Resilience Layers

```javascript
const { createCachedStorage, createRetryStorage, createProtectedStorage } = require('ussd-state-builder');

let storage = createRetryStorage(redis, { maxRetries: 2 });
storage = createProtectedStorage(storage, {
  failureThreshold: 5, resetTimeout: 30000, fallbackStorage: new InMemoryStorage()
});
storage = createCachedStorage(storage, { maxSize: 5000, ttl: 10000 });
```

## Metrics Monitoring

```javascript
const { createMetricsMiddleware } = require('ussd-state-builder');

const metrics = createMetricsMiddleware({ bufferSize: 5000 });
stateMachine.use('beforeProcess', metrics.middleware);

// Uses a fixed-size circular buffer -- constant memory regardless of volume
console.log(metrics.getMetrics());
// { totalRequests, totalErrors, errorRate, requestsByState, averageResponseTime }
```

## PerformanceMonitor for Custom Timing

```javascript
const { PerformanceMonitor } = require('ussd-state-builder');
const monitor = new PerformanceMonitor();

await monitor.time('external-api', async () => fetchBalance(phone));
console.log(monitor.getMetrics());
// { 'external-api': { count, avg, min, max, total } }
```

## Memory Management

### State History Cap

Set `maxHistorySize` to prevent unbounded memory growth in navigation history.

```javascript
const storage = new RedisStorage({ maxHistorySize: 15 });
// or
const storage = new InMemoryStorage({ maxHistorySize: 15 });
```

### Session Cleanup (InMemoryStorage)

```javascript
const cleanupInterval = setInterval(() => storage.cleanup(), 60000);
cleanupInterval.unref();   // don't keep the process alive for cleanup
```

Redis handles expiration automatically via TTL.

### LRU Cache Pruning

Expired entries are evicted on access. For proactive cleanup:

```javascript
const { LRUCache } = require('ussd-state-builder');
const cache = new LRUCache({ maxSize: 1000, ttl: 30000 });
setInterval(() => cache.prune(), 60000);
```

## Batch Processing

Group multiple operations to reduce round-trips.

```javascript
const { BatchProcessor } = require('ussd-state-builder');

const batcher = new BatchProcessor(
  async (items) => db.bulkLookup(items),
  { maxSize: 20, maxWait: 50 }   // flush every 20 items or 50ms
);
const result = await batcher.add(sessionId);
```

## Checklist

- [ ] `createCachedStorage` for read-heavy workloads
- [ ] `maxHistorySize` set to 15-20
- [ ] `createRetryStorage` for transient failure handling
- [ ] `createProtectedStorage` with in-memory fallback
- [ ] `createMetricsMiddleware` for monitoring
- [ ] Periodic `cleanup()` for in-memory storage
- [ ] Short session `timeout` (180s recommended)
