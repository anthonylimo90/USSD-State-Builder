# Production Deployment Guide

This guide covers deployment considerations for USSD State Builder. The [support matrix](SUPPORT-MATRIX.md) separates verified configurations from planned gateway and durability work.

## Storage Adapter Selection

Use a persistent adapter such as `RedisStorage` when sessions must survive process restarts or be shared across instances. In-memory storage loses data on restart. Persistent storage alone does not serialize concurrent turns or commit a complete turn atomically; review the [lease and atomicity limits](STORAGE-CONFORMANCE.md).

```javascript
const { USSDStateMachine, RedisStorage } = require('ussd-state-builder');

const storage = new RedisStorage({
  url: process.env.REDIS_URL,           // e.g. redis://user:pass@host:6379
  keyPrefix: 'ussd:prod:',              // namespace keys to avoid collisions
  maxHistorySize: 15,                   // cap navigation history per session
  pool: {
    connectionTimeout: 5000,
  }
});

const stateMachine = new USSDStateMachine({
  initialState: 'WELCOME',
  states,
  storage,
  timeout: 180,                         // session TTL in seconds
  maxInputLength: 160,
  logger: productionLogger,             // pass Winston/Pino instance
});
```

## Session Timeout Configuration

Set `timeout` from your provider's actual session policy and your application needs. The following 180-second value is an example, not a universal provider limit.

```javascript
const stateMachine = new USSDStateMachine({
  timeout: 180,
  // Warn users 30 seconds before expiry
});

// Add session timeout warning middleware
const { createSessionTimeoutMiddleware } = require('ussd-state-builder');
stateMachine.use('afterProcess', createSessionTimeoutMiddleware({
  warningThreshold: 30,
  warningMessage: 'Session expiring soon. Please respond quickly.'
}));
```

## Graceful Shutdown

Register shutdown handlers to stop new requests and close storage connections. Confirm request draining behavior in your HTTP server; this helper alone does not guarantee it.

```javascript
const { GracefulShutdown } = require('ussd-state-builder');

const shutdown = new GracefulShutdown({
  timeout: 15000,           // max 15s to drain requests
  storage,
  onShutdown: async () => {
    console.log('Stopping acceptance of new USSD requests');
  }
});

// Block new requests during shutdown
stateMachine.use('beforeProcess', shutdown.middleware());

// Register OS signal handlers (SIGTERM, SIGINT)
shutdown.registerSignalHandlers();

// Or trigger manually
process.on('SIGTERM', () => shutdown.shutdown());
```

## Health Check Integration

Expose health endpoints for load balancers, Kubernetes probes, or monitoring systems.

```javascript
const { HealthCheck } = require('ussd-state-builder');
const express = require('express');
const app = express();

const health = new HealthCheck({
  stateMachine,
  storage,
  cacheTTL: 5000,   // cache results for 5s to avoid probe storms
});

// Add custom dependency checks
health.addCheck('database', async () => ({
  healthy: await checkDbConnection(),
  message: 'Primary database'
}));

// Kubernetes-style probes
app.get('/healthz', health.livenessHandler());
app.get('/readyz', health.readinessHandler());

// Detailed health for dashboards
app.get('/health', health.httpHandler());

// Run startup checks before accepting traffic
await health.runStartupChecks();
```

## Monitoring with Metrics Middleware

Track request volume, error rates, and response times in real time.

```javascript
const { createMetricsMiddleware } = require('ussd-state-builder');

const metrics = createMetricsMiddleware({ bufferSize: 5000 });
stateMachine.useTurnObserver(metrics.observeTurn);

// Expose metrics for Prometheus scraping or internal dashboards
app.get('/metrics', (req, res) => {
  res.json(metrics.getMetrics());
  // { totalRequests, totalErrors, errorRate, requestsByState, outcomes, averageResponseTime }
});
```

`useTurnObserver()` measures the entire `processInput()` call, including handlers, back navigation, validation failures, blocked requests, and replay. `totalErrors` includes validation failures and thrown errors. Observer failures are logged without changing the USSD response. For the fluent SDK, `.metrics()` installs this observer automatically.

## Logging Best Practices

Replace the default `console` logger with a structured logger. Set `logger: null` to suppress internal logging entirely if your middleware handles it.

```javascript
const pino = require('pino');
const logger = pino({ level: 'warn' });

const stateMachine = new USSDStateMachine({
  states,
  initialState: 'WELCOME',
  storage,
  logger,                               // must have an error() method
  hookErrorStrategy: 'callback',
  onHookError: (hookName, error) => {
    logger.error({ hookName, err: error }, 'Lifecycle hook failed');
  }
});
```

## Scaling Considerations

1. **Shared sessions** -- Redis makes session state visible to multiple instances. Concurrent turns for one session still require coordination; a healthy Redis lease serializes cooperative workers but does not fence a worker that resumes after losing the lease.
2. **Key prefix isolation** -- Use distinct `keyPrefix` values per environment (`ussd:staging:`, `ussd:prod:`) to share a Redis cluster safely.
3. **Rate limiting** -- Use `createDistributedRateLimitMiddleware` with a shared Redis client so limits apply across all instances.
4. **Redis clients** -- Pass a pre-connected client via `config.client` when sharing it with other Redis-backed helpers. Size and monitor connections for your deployment; this option is not itself a connection pool.
5. **History cap** -- Set `maxHistorySize` (default 20) to prevent unbounded memory growth in long-lived sessions.

```javascript
const { createDistributedRateLimitMiddleware } = require('ussd-state-builder');

const limiter = createDistributedRateLimitMiddleware({
  redisClient: sharedRedisClient,
  maxRequests: 10,
  windowMs: 60000,
  keyPrefix: 'ussd:ratelimit:'
});
stateMachine.use('beforeProcess', limiter.middleware);
```

Redis-backed rate limiting currently fails open when Redis is unavailable. Choose an application-level failure policy appropriate to your abuse risk. Business effects such as payment or order creation need their own idempotency key and reconciliation process; the engine's terminal response replay is bounded by the session TTL and is not a provider-aware receipt. See the [migration guide](MIGRATING-TO-3.md) for the changed runtime behavior.
