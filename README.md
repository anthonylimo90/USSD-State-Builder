# USSD State Builder

[![npm version](https://badge.fury.io/js/ussd-state-builder.svg)](https://www.npmjs.com/package/ussd-state-builder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A flexible and powerful state machine for building USSD applications in Node.js. Features include back navigation, lifecycle hooks, response builders, resilience patterns, and multiple storage adapters.

## Features

- **Simple API** - Easy to learn and use
- **Back Navigation** - Built-in support for navigating to previous states
- **Pluggable Storage** - In-memory, Redis, MongoDB, PostgreSQL adapters
- **Lifecycle Hooks** - onStateEnter, onStateExit, onError callbacks
- **Response Builder** - Utilities for common USSD patterns
- **TypeScript Support** - Full type definitions included
- **Validation Library** - 20+ validators (phone, email, PIN, amount, password, URL, IP, etc.)
- **Middleware System** - Pluggable middleware for logging, rate limiting, sanitization, metrics
- **Internationalization** - Built-in i18n with 8 languages (EN, SW, FR, AM, AR, PT, HA, SO)
- **Resilience Patterns** - Circuit breaker, retry with backoff, distributed rate limiting
- **Health Checks** - Kubernetes-style liveness/readiness probes with startup checks
- **State Inspector** - Visualize and debug state machines
- **Debug Utility** - Namespace-based debug logging with log levels and structured JSON output
- **Performance Utilities** - LRU cache, memoize, batch processing, cached storage
- **Testing Utilities** - Fluent API for testing USSD flows
- **Hot Reload** - Update states at runtime without restart
- **ESM Support** - Works with CommonJS and ES modules

## Installation

```bash
npm install ussd-state-builder
```

For Redis storage support:
```bash
npm install ussd-state-builder redis
```

## Quick Start

```javascript
const { USSDStateMachine, ResponseBuilder } = require('ussd-state-builder');

const ussdConfig = {
  initialState: 'WELCOME',
  timeout: 300, // 5 minutes
  states: {
    WELCOME: {
      handler: async (input) => {
        return {
          response: ResponseBuilder.menu('Welcome to Our Service', [
            'Check Balance',
            'Buy Airtime',
            'Exit'
          ]),
          nextState: 'MENU'
        };
      }
    },
    MENU: {
      handler: async (input, sessionId, context) => {
        switch (input) {
          case '1':
            return {
              response: 'END Your balance is $50.00',
              nextState: 'END'
            };
          case '2':
            return {
              response: ResponseBuilder.input('Enter amount:'),
              nextState: 'ENTER_AMOUNT'
            };
          case '3':
            return {
              response: ResponseBuilder.end('Goodbye!'),
              nextState: 'END'
            };
          default:
            return {
              response: ResponseBuilder.error('Invalid option')
            };
        }
      }
    },
    ENTER_AMOUNT: {
      validator: async (input) => {
        if (isNaN(input) || parseFloat(input) <= 0) {
          throw new (require('ussd-state-builder').ValidationError)('Invalid amount');
        }
      },
      handler: async (input, sessionId) => {
        return {
          response: `END You purchased $${input} airtime successfully!`,
          nextState: 'END',
          data: { amount: parseFloat(input) }
        };
      }
    }
  }
};

const ussd = new USSDStateMachine(ussdConfig);

// Express.js example
app.post('/ussd', async (req, res) => {
  const { sessionId, text } = req.body;
  try {
    const response = await ussd.processInput(sessionId, text);
    res.send(response);
  } catch (error) {
    console.error('USSD Error:', error);
    res.send('END An error occurred. Please try again.');
  }
});
```

## Configuration

### USSDStateMachine Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `initialState` | string | *required* | The starting state for new sessions |
| `timeout` | number | 300 | Session timeout in seconds |
| `states` | object | *required* | Map of state names to configurations |
| `storage` | StorageAdapter | InMemoryStorage | Session storage adapter |
| `enableBackNavigation` | boolean | true | Enable back navigation (input '0') |
| `hooks` | object | {} | Lifecycle hooks |
| `hookErrorStrategy` | string | 'log' | How to handle hook errors ('log', 'throw', 'ignore', 'callback') |
| `maxHistorySize` | number | 20 | Maximum back-navigation history depth |

### State Configuration

```javascript
{
  STATENAME: {
    // Required: Handle input and return response
    handler: async (input, sessionId, context) => {
      // context contains: { sessionData, language }
      return {
        response: 'CON or END message',
        nextState: 'NEXT_STATE', // Optional
        data: { /* data to store */ }, // Optional
        previousState: true // Go back (optional)
      };
    },

    // Optional: Validate input before handler
    validator: async (input) => {
      if (!isValid(input)) {
        throw new ValidationError('Invalid input');
      }
    },

    // Optional: Called when entering this state
    onEnter: async (sessionId) => {},

    // Optional: Called when exiting this state
    onExit: async (sessionId) => {}
  }
}
```

## Validation Library

20+ built-in validators with composable validation chains:

```javascript
const { Validators, combineValidators, optional } = require('ussd-state-builder');

// Single validators
const states = {
  ENTER_PHONE: {
    validator: Validators.phone({ country: 'KE' }),
    handler: async (input) => { /* ... */ }
  },
  ENTER_PIN: {
    validator: Validators.pin({ length: 4 }),
    handler: async (input) => { /* ... */ }
  }
};

// Compose multiple validators
const validateAmount = combineValidators([
  Validators.required(),
  Validators.numeric({ min: 10, max: 70000 }),
  Validators.amount({ maxDecimals: 2 })
]);

// Optional fields (skip validation on empty input)
const validateEmail = optional(Validators.email());
```

### Available Validators

| Validator | Description |
|-----------|-------------|
| `required()` | Non-empty input |
| `numeric(options)` | Number with optional min/max/integer |
| `phone(options)` | Phone number (KE, UG, TZ, NG, GH, ZA, ET, RW) |
| `email()` | Email address format |
| `pin(options)` | PIN code (length, numericOnly) |
| `amount(options)` | Monetary amount with decimal control |
| `menuOption(options)` | Menu selection within range |
| `minLength(n)` / `maxLength(n)` / `exactLength(n)` | String length |
| `pattern(regex)` | Custom regex pattern |
| `date(options)` | Date format validation |
| `age(options)` | Age range validation |
| `idNumber(options)` | ID/passport number (KE, generic) |
| `password(options)` | Password strength (uppercase, lowercase, number, special) |
| `alphanumeric()` | Letters and numbers only |
| `url()` | HTTP/HTTPS URL format |
| `ipAddress()` | IPv4 address |
| `oneOf(values)` | Whitelist validation |
| `custom(fn)` | Custom validation function |

## Middleware System

```javascript
const {
  USSDStateMachine,
  createLoggingMiddleware,
  createRateLimitMiddleware,
  createSanitizationMiddleware,
  createMetricsMiddleware
} = require('ussd-state-builder');

const ussd = new USSDStateMachine(config);

// Add middleware
ussd.use(createLoggingMiddleware({ logger: console }));
ussd.use(createRateLimitMiddleware({ maxRequests: 10, windowMs: 60000 }));
ussd.use(createSanitizationMiddleware({ removeSpecialChars: true }));
ussd.use(createMetricsMiddleware());
```

### Distributed Rate Limiting

For multi-instance deployments, use Redis-backed rate limiting:

```javascript
const { createDistributedRateLimitMiddleware } = require('ussd-state-builder');
const { createClient } = require('redis');

const redisClient = createClient({ url: 'redis://localhost:6379' });
await redisClient.connect();

ussd.use(createDistributedRateLimitMiddleware({
  redisClient,
  maxRequests: 10,
  windowMs: 60000,
  keyPrefix: 'ussd:ratelimit:'
}));
```

## Resilience Patterns

### Circuit Breaker

Protect against cascading failures when storage is unavailable:

```javascript
const { createProtectedStorage, RedisStorage } = require('ussd-state-builder');

const storage = createProtectedStorage(new RedisStorage({ url: 'redis://localhost' }), {
  failureThreshold: 5,    // Open circuit after 5 failures
  resetTimeout: 30000,    // Try again after 30s
  onStateChange: (from, to) => console.log(`Circuit: ${from} -> ${to}`)
});

const ussd = new USSDStateMachine({ ...config, storage });
```

### Retry Strategy

Automatically retry transient failures with exponential backoff:

```javascript
const { createRetryStorage, RedisStorage } = require('ussd-state-builder');

const storage = createRetryStorage(new RedisStorage({ url: 'redis://localhost' }), {
  maxRetries: 3,
  baseDelay: 100,
  maxDelay: 5000,
  jitter: true
});
```

### Combining Resilience Layers

```javascript
const { createRetryStorage, createProtectedStorage, createCachedStorage } = require('ussd-state-builder');

// Layer 1: Retry transient errors
let storage = createRetryStorage(new RedisStorage(redisConfig), { maxRetries: 3 });
// Layer 2: Circuit breaker for persistent failures
storage = createProtectedStorage(storage, { failureThreshold: 5 });
// Layer 3: Cache for performance
storage = createCachedStorage(storage, { maxSize: 1000 });
```

## Health Checks

Kubernetes-style health probes for production deployments:

```javascript
const { HealthCheck } = require('ussd-state-builder');

const health = new HealthCheck({
  storage,
  stateMachine: ussd,
  cacheTTL: 5000, // Cache results for 5s
  startupChecks: {
    database: async () => { await db.ping(); }
  }
});

// Run startup checks before accepting traffic
await health.runStartupChecks();

// Kubernetes probes
app.get('/healthz', async (req, res) => {
  const result = await health.liveness();
  res.status(200).json(result);
});

app.get('/readyz', async (req, res) => {
  const result = await health.readiness();
  res.status(result.status === 'ready' ? 200 : 503).json(result);
});

// Detailed health check
app.get('/health', health.httpHandler());
```

## Internationalization (i18n)

Built-in support for 8 languages with formatter and pluralization:

```javascript
const { createUSSDI18n, LanguageDetector } = require('ussd-state-builder');

const i18n = createUSSDI18n({ defaultLanguage: 'en' });

// Translate
i18n.t('common.welcome', { lang: 'sw' }); // "Karibu"
i18n.t('common.welcome', { lang: 'am' }); // "እንኳን ደህና መጡ"
i18n.t('common.welcome', { lang: 'ar' }); // "مرحباً"

// Auto-detect language from phone number
const lang = LanguageDetector.fromPhoneNumber('+254712345678'); // 'sw'

// Use in state handler
handler: async (input, sessionId, context) => {
  const lang = context.language || 'en';
  return {
    response: ResponseBuilder.menu(i18n.t('common.welcome', { lang }), [
      i18n.t('menu.balance', { lang }),
      i18n.t('menu.airtime', { lang })
    ]),
    nextState: 'MENU'
  };
}
```

### Supported Languages

| Code | Language | Region |
|------|----------|--------|
| `en` | English | East/West/Southern Africa |
| `sw` | Swahili | Kenya, Tanzania, Uganda |
| `fr` | French | DRC, Cameroon, Ivory Coast |
| `am` | Amharic | Ethiopia |
| `ar` | Arabic | Egypt, Sudan, Saudi Arabia, UAE |
| `pt` | Portuguese | Mozambique, Angola |
| `ha` | Hausa | Nigeria |
| `so` | Somali | Somalia |

## Back Navigation

Back navigation is enabled by default. Users can press `0` to go back to the previous state.

```javascript
// Disable back navigation
const ussd = new USSDStateMachine({
  ...config,
  enableBackNavigation: false
});

// Or handle it explicitly in your handler
handler: async (input) => {
  if (input === '0') {
    return { previousState: true, response: '' };
  }
  // ...
}
```

## Response Builder

The `ResponseBuilder` utility provides convenient methods for common USSD patterns:

```javascript
const { ResponseBuilder } = require('ussd-state-builder');

// Create a menu
ResponseBuilder.menu('Select Option', ['Option 1', 'Option 2', 'Option 3']);
// Output: "CON Select Option\n1. Option 1\n2. Option 2\n3. Option 3"

// Confirmation prompt
ResponseBuilder.confirm('Proceed with payment?');
// Output: "CON Proceed with payment?\n1. Yes\n2. No"

// Input prompt
ResponseBuilder.input('Enter your phone number:');
// Output: "CON Enter your phone number:"

// Error with retry
ResponseBuilder.error('Invalid input');
// Output: "CON Invalid input\nPlease try again."

// End message
ResponseBuilder.end('Thank you for using our service!');
// Output: "END Thank you for using our service!"

// Paginated list
ResponseBuilder.paginate(['A', 'B', 'C', 'D', 'E', 'F'], 1, 3, { title: 'Items' });
// Output: "CON Items\n1. A\n2. B\n3. C\n99. More"

// Add back option
ResponseBuilder.withBack('CON Enter amount:');
// Output: "CON Enter amount:\n0. Back"

// Format currency
ResponseBuilder.formatAmount(1234.5, 'KES ');
// Output: "KES 1,234.50"

// Receipt/Summary
ResponseBuilder.receipt('Transaction Complete', {
  'Amount': '$100.00',
  'Reference': 'TXN123',
  'Date': '2024-01-15'
});

// Progress indicator
ResponseBuilder.progress(2, 4, 'Enter email:');
// Output: "CON [Step 2/4]\nEnter email:"
```

## Storage Adapters

### InMemoryStorage (Default)

Best for development and testing. Data is lost when the process restarts.

```javascript
const { USSDStateMachine, InMemoryStorage } = require('ussd-state-builder');

const ussd = new USSDStateMachine({
  ...config,
  storage: new InMemoryStorage()
});

// Cleanup expired sessions periodically
setInterval(() => ussd.storage.cleanup(), 15 * 60 * 1000);
```

### RedisStorage (Production)

Recommended for production. Supports automatic expiration and distributed deployments.

```javascript
const { USSDStateMachine, RedisStorage } = require('ussd-state-builder');

const ussd = new USSDStateMachine({
  ...config,
  storage: new RedisStorage({
    host: 'localhost',
    port: 6379,
    password: 'your-password',
    keyPrefix: 'ussd:',
    maxHistorySize: 20
  })
});

// Or use a Redis URL
const storage = new RedisStorage({
  url: 'redis://user:password@host:6379'
});

// Close connection when done
process.on('SIGTERM', async () => {
  await ussd.storage.close();
});
```

### Custom Storage

Implement the `StorageInterface` base class:

```javascript
const { StorageInterface } = require('ussd-state-builder');

class MyCustomStorage extends StorageInterface {
  async getState(sessionId) { /* return state string */ }
  async setState(sessionId, state, timeout) { /* store state */ }
  async getData(sessionId) { /* return data object */ }
  async setData(sessionId, data, timeout) { /* store data */ }

  // Optional: for back navigation
  async getStateHistory(sessionId) { /* return array */ }
  async pushStateHistory(sessionId, state) { /* add to history */ }
  async popStateHistory(sessionId) { /* remove and return last */ }

  // Optional: batch operations
  async getStateBatch(sessionIds) { /* return Map */ }
  async getDataBatch(sessionIds) { /* return Map */ }
  async deleteSessionBatch(sessionIds) { /* return count */ }

  // Optional: transactions
  async withTransaction(fn) { /* execute fn atomically */ }

  // Optional: cleanup
  async cleanup() { /* remove expired sessions */ }
  async close() { /* close connections */ }
}
```

See [Custom Storage Guide](./docs/CUSTOM-STORAGE.md) for a complete tutorial.

## Lifecycle Hooks

```javascript
const ussd = new USSDStateMachine({
  ...config,
  hooks: {
    onStateEnter: async (state, sessionId) => {
      console.log(`Session ${sessionId} entered state ${state}`);
      // Track analytics, log events, etc.
    },

    onStateExit: async (state, sessionId) => {
      console.log(`Session ${sessionId} exited state ${state}`);
    },

    onError: async (error, sessionId, state) => {
      console.error(`Error in session ${sessionId}, state ${state}:`, error);
      // Send to error tracking service
    },

    onSessionExpire: async (sessionId) => {
      console.log(`Session ${sessionId} expired`);
    }
  }
});
```

## Testing Utilities

Fluent API for testing USSD flows:

```javascript
const { USSDTester } = require('ussd-state-builder');

const tester = new USSDTester(ussd);

// Test a complete flow
await tester
  .start()
  .expectResponse(/Welcome/)
  .input('1')
  .expectState('MENU')
  .expectResponse(/Check Balance/)
  .input('1')
  .expectResponse(/Your balance/)
  .run();
```

## Debug Utility

Enable debug logging with namespace support and log levels:

```bash
# Enable all USSD debug logs
DEBUG=ussd:* node app.js

# Enable specific namespaces
DEBUG=ussd:state,ussd:middleware node app.js

# Set minimum log level
DEBUG=ussd:* DEBUG_LEVEL=warn node app.js
```

```javascript
const { createDebug } = require('ussd-state-builder');

const debug = createDebug('ussd:myapp');

// Log levels
debug('Processing request', { sessionId: '123' });
debug.info('Session started', { sessionId: '123' });
debug.warn('Session expiring soon');
debug.error('Failed to connect', error);

// Structured JSON output
debug.json('user action', { userId: '123', action: 'login' });

// Performance timing
debug.time('db-query');
await db.query('SELECT ...');
const elapsed = debug.timeEnd('db-query'); // logs: "db-query: 42.5ms"
```

## State Inspector

Inspect and visualize your state machine:

```javascript
const { StateInspector } = require('ussd-state-builder');

const inspector = new StateInspector(ussd);

// Get state machine summary
console.log(inspector.getSummary());
// { totalStates: 5, initialState: 'WELCOME', ... }

// Get detailed state info
console.log(inspector.getStateInfo('MENU'));
// { hasHandler: true, hasValidator: false, ... }

// Generate ASCII diagram
console.log(inspector.toAsciiDiagram());
// WELCOME -> MENU -> CHECKOUT -> END

// Export to GraphViz DOT format
console.log(inspector.toDotGraph());

// Validate configuration
const issues = inspector.validate();
```

## Performance Utilities

```javascript
const { LRUCache, createCachedStorage, PerformanceMonitor, BatchProcessor } = require('ussd-state-builder');

// LRU cache with TTL
const cache = new LRUCache({ maxSize: 1000, ttl: 60000 });
cache.set('key', 'value');
cache.get('key'); // 'value'
cache.getStats(); // { hits, misses, hitRate, evictions, size, maxSize }

// Cache storage adapter for performance
const cachedStorage = createCachedStorage(storage, { maxSize: 1000 });

// Performance monitoring
const monitor = new PerformanceMonitor();
monitor.startTimer('processInput');
// ... do work ...
monitor.endTimer('processInput');
console.log(monitor.getMetrics('processInput'));
// { count, total, average, min, max }

// Batch processing
const batch = new BatchProcessor({
  maxSize: 10,
  maxWait: 100,
  processor: async (items) => { /* process batch */ }
});
await batch.add(item);
```

## API Reference

### USSDStateMachine

#### `constructor(config)`
Create a new state machine instance.

#### `processInput(sessionId, input, options?)`
Process user input and return response.
- `sessionId`: Unique session identifier
- `input`: User input string
- `options.language`: Optional language preference
- Returns: `Promise<string>` - USSD response

#### `getSessionData(sessionId)`
Get stored session data.
- Returns: `Promise<object|null>`

#### `setSessionData(sessionId, data)`
Store session data.

#### `getCurrentState(sessionId)`
Get current state for a session.
- Returns: `Promise<string|null>`

#### `goBack(sessionId)`
Navigate to previous state.
- Returns: `Promise<string|null>` - Previous state name

#### `endSession(sessionId)`
End and cleanup a session.

#### `use(middleware)`
Add middleware to the processing pipeline.

### ValidationError

Custom error class for input validation.

```javascript
const { ValidationError } = require('ussd-state-builder');

throw new ValidationError('Phone number must be 10 digits');
// User sees: "CON Phone number must be 10 digits\nPlease try again."
```

## TypeScript Support

Full TypeScript definitions are included:

```typescript
import {
  USSDStateMachine,
  USSDConfig,
  StateConfig,
  ResponseBuilder,
  StorageAdapter
} from 'ussd-state-builder';

const config: USSDConfig = {
  initialState: 'WELCOME',
  states: {
    WELCOME: {
      handler: async (input, sessionId, context) => ({
        response: 'CON Welcome!',
        nextState: 'MENU'
      })
    }
  }
};

const ussd = new USSDStateMachine(config);
```

## ESM Support

The package supports both CommonJS and ES modules:

```javascript
// CommonJS
const { USSDStateMachine } = require('ussd-state-builder');

// ES Modules
import { USSDStateMachine } from 'ussd-state-builder';
```

## Examples

See the [examples](./examples) directory for complete working examples:

- [Basic Menu](./examples/basic-menu.js) - Simple USSD menu flow
- [Express Integration](./examples/express-integration.js) - Full Express.js setup
- [Multi-language Support](./examples/multi-language.js) - i18n implementation
- [With Validation](./examples/with-validation.js) - Input validation patterns
- [Hot Reload](./examples/hot-reload.js) - Dynamic state updates at runtime
- [Custom Storage](./examples/custom-storage.js) - File-based storage adapter
- [Error Recovery](./examples/error-recovery.js) - Circuit breaker and retry patterns
- [Health Checks](./examples/health-checks.js) - Kubernetes-style probes

## Documentation

- [Production Deployment Guide](./docs/PRODUCTION.md) - Storage, scaling, monitoring
- [Security Best Practices](./docs/SECURITY.md) - Input sanitization, rate limiting
- [Performance Tuning](./docs/PERFORMANCE.md) - Caching, circuit breakers, batch processing
- [Custom Storage Adapters](./docs/CUSTOM-STORAGE.md) - Building your own adapter
- [Troubleshooting](./docs/TROUBLESHOOTING.md) - Debug logging, common errors

## Testing

```bash
npm test                 # Run all tests (644 tests across 15 suites)
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage report
```

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests.

## License

MIT © [Anthony Kiplimo](https://github.com/anthonylimo)
