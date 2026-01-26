# Troubleshooting Guide

Common errors, debugging techniques, and diagnostic tools for USSD State Machine applications.

## Debug Utility

Enable debug logging via the `DEBUG` environment variable. No code changes required.

```bash
DEBUG=ussd:* node app.js              # all USSD debug output
DEBUG=ussd:state node app.js          # only state transitions
DEBUG=ussd:state,ussd:storage node app.js  # multiple namespaces
DEBUG=ussd:* DEBUG_LEVEL=warn node app.js  # warnings and errors only
```

Available namespaces: `ussd:state`, `ussd:middleware`, `ussd:storage`, `ussd:session`, `ussd:validation`, `ussd:i18n`, `ussd:lifecycle`, `ussd:performance`.

### Programmatic Debug

```javascript
const { isDebugEnabled, createDebug } = require('ussd-state-builder');

const debug = createDebug('myapp:payments');
debug('Processing payment for %s', sessionId);
debug.time('api-call');
await callPaymentAPI();
debug.timeEnd('api-call');   // logs elapsed time in ms
```

## Common Errors and Solutions

### "Initial state not found in states configuration"

The `initialState` value does not match any key in your `states` object. Ensure exact case match.

```javascript
// Wrong: initialState is 'WELCOME' but key is lowercase
new USSDStateMachine({ initialState: 'WELCOME', states: { welcome: { handler } } });
// Fix: use matching key
new USSDStateMachine({ initialState: 'WELCOME', states: { WELCOME: { handler } } });
```

### "Invalid state: STATE_NAME"

A session points to a state that was removed or renamed after a deploy. Clear stale sessions:

```javascript
const currentState = await stateMachine.getCurrentState(sessionId);
if (currentState && !states[currentState]) {
  await stateMachine.endSession(sessionId);
}
```

### ResponseFormatError

Every handler must return a `response` starting with `CON ` (continue) or `END ` (terminate).

```javascript
// Wrong:  { response: 'Welcome' }
// Correct: { response: 'CON Welcome' }
```

### "Redis package not found"

Install the optional dependency: `npm install redis`

### CircuitOpenError: "Circuit breaker is OPEN"

The storage backend has failed repeatedly. Check your Redis/DB connection. The circuit retries after `resetTimeout` ms. To force a reset:

```javascript
storage._circuitBreaker.reset();
```

## Storage Connection Issues

### Redis Connection Refused

Verify Redis is running (`redis-cli ping`), check host/port, and ensure Docker ports are mapped.

```javascript
const storage = new RedisStorage({
  url: 'redis://localhost:6379',
  pool: { connectionTimeout: 5000 }
});
```

### Connection Drops Mid-Session

Use `createRetryStorage` to handle transient failures:

```javascript
const { createRetryStorage } = require('ussd-state-builder');
const storage = createRetryStorage(new RedisStorage({ url: redisUrl }), {
  maxRetries: 3, baseDelay: 200, jitter: true
});
```

### Storage Health Monitoring

```javascript
const { HealthCheck } = require('ussd-state-builder');
const health = new HealthCheck({ storage });
const result = await health.check();
console.log(result.checks.storage);
// { healthy: true, message: 'Storage operational' }
```

## Session Management Issues

### Sessions Expire Too Quickly

Default timeout is 300 seconds. Adjust via `timeout` in the constructor. For Redis, TTL is set on every `setState` call.

### Back Navigation Not Working

1. `enableBackNavigation` must not be `false` (it defaults to `true`).
2. Your storage must implement `pushStateHistory` and `popStateHistory`.
3. The user must send `'0'` as input to go back.

### Race Conditions on New Sessions

The state machine uses internal locks to prevent duplicate initialization. Ensure all requests for the same session use the same `USSDStateMachine` instance.

## Performance Diagnostics

### Identifying Slow States

```javascript
const { createMetricsMiddleware } = require('ussd-state-builder');
const metrics = createMetricsMiddleware();
stateMachine.use('beforeProcess', metrics.middleware);
// Check: metrics.getMetrics().requestsByState
```

### Timing Individual Operations

```javascript
const { PerformanceMonitor } = require('ussd-state-builder');
const monitor = new PerformanceMonitor();
await monitor.time('db-query', () => db.query(...));
console.log(monitor.getMetrics());  // { count, avg, min, max }
```

### Cache Hit Rate

```javascript
// If using createCachedStorage
console.log(storage.getCacheStats());
// Low hitRate? Increase TTL or maxSize.
```

### Memory Growth (InMemoryStorage)

```javascript
console.log('Active sessions:', storage.size());
storage.cleanup();   // remove expired sessions
```

## Middleware Debugging

Middleware errors include context properties for diagnosis:

```javascript
try {
  await stateMachine.processInput(sessionId, input);
} catch (error) {
  if (error.middlewareHook) {
    console.error(`Failed in ${error.middlewareHook}[${error.middlewareIndex}]: ${error.middlewareName}`);
  }
}
```
