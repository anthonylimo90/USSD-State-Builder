# Production Deployment Guide

This guide covers best practices for deploying USSD State Machine applications in production environments.

## Storage Adapter Selection

Use `RedisStorage` for production. In-memory storage loses data on restart and does not work across multiple instances.

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

Set `timeout` based on your USSD gateway. Most telcos drop sessions after 2-3 minutes of inactivity. A 180-second timeout is a safe default.

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

Always register shutdown handlers to drain in-flight requests and close storage connections cleanly.

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
stateMachine.use('beforeProcess', metrics.middleware);

// Expose metrics for Prometheus scraping or internal dashboards
app.get('/metrics', (req, res) => {
  res.json(metrics.getMetrics());
  // { totalRequests, totalErrors, errorRate, requestsByState, averageResponseTime }
});
```

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

1. **Stateless application instances** -- All session state lives in Redis, so you can run many instances behind a load balancer without sticky sessions.
2. **Key prefix isolation** -- Use distinct `keyPrefix` values per environment (`ussd:staging:`, `ussd:prod:`) to share a Redis cluster safely.
3. **Rate limiting** -- Use `createDistributedRateLimitMiddleware` with a shared Redis client so limits apply across all instances.
4. **Connection pooling** -- Pass a pre-connected Redis client via `config.client` to share a single connection pool across storage and rate limiting.
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
