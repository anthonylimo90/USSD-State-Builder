# USSD State Builder

[![npm version](https://badge.fury.io/js/ussd-state-builder.svg)](https://www.npmjs.com/package/ussd-state-builder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A modern, fluent SDK for building USSD applications in Node.js. Write declarative, readable code with automatic `CON`/`END` handling, built-in validation, and production-ready features like Redis storage, circuit breakers, and i18n support.

## Installation

```bash
npm install ussd-state-builder
```

## Quick Start

```javascript
const { createApp, Validators } = require('ussd-state-builder/sdk');

const app = createApp()
  .state('welcome', s => s
    .message('Welcome to MyBank\n1. Check Balance\n2. Send Money\n3. Exit')
    .on('1').goto('balance')
    .on('2').goto('sendMoney')
    .on('3').end('Goodbye!')
  )
  .state('balance', s => s
    .run(async () => 'Your balance is KES 15,000.00')
    .end()
  )
  .state('sendMoney', s => s
    .message('Enter recipient phone number:')
    .validate(Validators.phone({ country: 'KE' }))
    .save('phone')
    .next('enterAmount')
  )
  .state('enterAmount', s => s
    .message('Enter amount (KES):')
    .validate(Validators.amount({ min: 10, max: 70000 }))
    .save('amount')
    .next('confirm')
  )
  .state('confirm', s => s
    .run(async (input, sid, ctx) => {
      const { phone, amount } = ctx.sessionData;
      return `Send KES ${amount} to ${phone}?\n1. Confirm\n2. Cancel`;
    })
    .on('1').end('Transaction successful!')
    .on('2').end('Transaction cancelled.')
  )
  .start('welcome')
  .build();

// Express.js integration
app.post('/ussd', async (req, res) => {
  const { sessionId, text } = req.body;
  const response = await app.processInput(sessionId, text);
  res.send(response);
});
```

**That's it.** No manual `CON`/`END` prefixes, no boilerplate state configuration objects. Just clean, declarative code.

## Table of Contents

- [SDK API Reference](#sdk-api-reference)
  - [State Methods](#state-methods)
  - [Routing](#routing)
  - [App Configuration](#app-configuration)
- [Dynamic Menus](#dynamic-menus)
- [Validation](#validation)
- [Storage Adapters](#storage-adapters)
- [Integration Examples](#integration-examples)
- [Advanced Features](#advanced-features)
  - [Middleware](#middleware)
  - [Internationalization](#internationalization)
  - [Resilience Patterns](#resilience-patterns)
  - [Health Checks](#health-checks)
- [Testing](#testing)
- [Traditional API](#traditional-api)

---

## SDK API Reference

### State Methods

| Method | Description | Example |
|--------|-------------|---------|
| `.message(text)` | Display static text | `.message('Enter phone:')` |
| `.menu(title, items)` | Create numbered menu | See [Menu Builder](#menu-builder) |
| `.run(handler)` | Custom async handler | `.run(async (input, sid, ctx) => ...)` |
| `.validate(fn)` | Validate input before processing | `.validate(Validators.phone())` |
| `.save(key)` | Save input to session data | `.save('phoneNumber')` |
| `.next(state)` | Default transition after input | `.next('confirmScreen')` |
| `.end()` | Mark as terminal state (END prefix) | `.end()` |
| `.onEnter(fn)` | Lifecycle hook on state entry | `.onEnter(async (sid) => log(sid))` |
| `.onExit(fn)` | Lifecycle hook on state exit | `.onExit(async (sid) => cleanup(sid))` |
| `.dynamicMenu(fetcher, opts)` | Fetch menu items at runtime | See [Dynamic Menus](#dynamic-menus) |

### Menu Builder

Create numbered menus with automatic routing:

```javascript
.state('main', s => s
  .menu('Welcome to MyBank', [
    { key: '1', label: 'Check Balance', goto: 'balance' },
    { key: '2', label: 'Send Money', goto: 'sendMoney' },
    { key: '3', label: 'Buy Airtime', goto: 'airtime' },
    { key: '4', label: 'Exit', end: 'Goodbye!' }
  ])
)
// Output: "CON Welcome to MyBank\n1. Check Balance\n2. Send Money\n3. Buy Airtime\n4. Exit"
```

**Menu item actions:**
- `goto: 'state'` - Navigate to state
- `end: 'message'` - End session with message
- `reply: 'text'` - Reply without transitioning

### Routing

Use `.on(input)` to define input-based routing:

```javascript
.state('menu', s => s
  .message('Select option:\n1. Balance\n2. Transfer\n3. Exit')
  .on('1').goto('balance')      // Navigate to another state
  .on('2').goto('transfer')
  .on('3').end('Goodbye!')      // End session with message
  .on('*').reply('Invalid option')  // Catch-all for unmatched input
)
```

**Route actions:**
- `.goto(state)` - Transition to another state
- `.end(message?)` - End session with optional message
- `.reply(text)` - Reply without changing state (stay in same state)

**Wildcard route:** Use `.on('*')` as a catch-all for any unmatched input.

### App Configuration

```javascript
const app = createApp()
  .state('name', configurator)     // Define states
  .form('name', configurator)      // Define multi-step forms
  .start('initialState')           // Set starting state (defaults to first)
  .storage(redisStorage)           // Set storage adapter
  .timeout(300)                    // Session timeout in seconds
  .backNavigation(true)            // Enable '0' for back navigation
  .use('beforeProcess', fn)        // Add middleware
  .hooks({ onError: fn })          // Lifecycle hooks
  .logger(customLogger)            // Custom logger (null to disable)
  .maxInputLength(160)             // Max input length
  // Built-in middleware helpers:
  .logging({ logger: console.log })
  .rateLimit({ maxRequests: 10, windowMs: 60000 })
  .sanitize({ maxLength: 160, trim: true })
  .metrics()
  .build();                        // Compile to USSDStateMachine
```

### Form Builder

Create multi-step data collection flows with minimal boilerplate:

```javascript
const app = createApp()
  .form('sendMoney', f => f
    .field('phone', field => field
      .prompt('Enter recipient phone:')
      .validate(Validators.phone({ country: 'KE' }))
    )
    .field('amount', field => field
      .prompt('Enter amount (KES):')
      .validate(Validators.amount({ min: 10, max: 70000 }))
    )
    .confirm(ctx =>
      `Send KES ${ctx.sessionData.amount} to ${ctx.sessionData.phone}?\n1. Yes\n2. No`
    )
    .onConfirm('1').end('Transaction sent!')
    .onCancel('2').end('Cancelled.')
  )
  .start('sendMoney_phone')  // Form states are named: {formName}_{fieldName}
  .build();
```

**Field methods:**
- `.prompt(text)` - Display prompt for field
- `.validate(fn)` - Validate input
- `.transform(fn)` - Transform value before saving

**Form methods:**
- `.field(name, configurator)` - Add a field
- `.confirm(renderer)` - Add confirmation step
- `.onComplete(state)` - State to go to after form (without confirm)

---

## Dynamic Menus

Fetch and display data from external sources with automatic pagination:

```javascript
const { createApp, DynamicMenu } = require('ussd-state-builder/sdk');

const app = createApp()
  .state('selectAccount', s => s
    .run(
      DynamicMenu.from(async (sid, ctx) => {
        // Fetch from your API
        return await api.getAccounts(ctx.sessionData.userId);
      })
        .format(item => `${item.name} - ${item.currency} ${item.balance}`)
        .value(item => item.id)
        .header('Select account:')
        .paginated({ pageSize: 3, moreKey: '#', backKey: '*' })
        .onEmpty('No accounts found')
        .onError(err => `Error: ${err.message}`)
        .build()
    )
    .save('accountId')
    .next('accountDetails')
  )
  .build();
```

**Or use the convenience method:**

```javascript
.state('selectAccount', s => s
  .dynamicMenu(
    async () => api.getAccounts('user123'),
    {
      format: item => item.name,
      value: item => item.id,
      header: 'Select account:',
      pageSize: 4,
      refresh: { key: '*', label: 'Refresh' }
    }
  )
  .save('accountId')
  .next('details')
)
```

### Dynamic Menu Options

| Option | Description | Default |
|--------|-------------|---------|
| `format` | Format item for display | `String(item)` |
| `value` | Extract value from selection | `item` |
| `header` | Text above menu items | `''` |
| `pageSize` | Items per page | All items |
| `moreKey` | Key for next page | `'99'` |
| `backKey` | Key for previous page | `'98'` |
| `maxItems` | Limit stored items (memory) | Unlimited |
| `refresh` | `{ key, label }` for refresh | Disabled |
| `onEmpty` | Message when no items | `'No items available'` |
| `onError` | Error handler function | Default message |

---

## Validation

20+ built-in validators with composable chains:

```javascript
const { Validators, combineValidators, optional } = require('ussd-state-builder');

// Single validators
.state('enterPhone', s => s
  .message('Enter phone number:')
  .validate(Validators.phone({ country: 'KE' }))
  .save('phone')
  .next('enterPin')
)

.state('enterPin', s => s
  .message('Enter 4-digit PIN:')
  .validate(Validators.pin({ length: 4 }))
  .save('pin')
  .next('confirm')
)

// Combine multiple validators
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
| `numeric(opts)` | Number with optional min/max/integer |
| `phone(opts)` | Phone number (KE, UG, TZ, NG, GH, ZA, ET, RW) |
| `email()` | Email address format |
| `pin(opts)` | PIN code (length, numericOnly) |
| `amount(opts)` | Monetary amount with decimal control |
| `menuOption(opts)` | Menu selection within range |
| `minLength(n)` / `maxLength(n)` / `exactLength(n)` | String length |
| `pattern(regex)` | Custom regex pattern |
| `date(opts)` | Date format validation |
| `age(opts)` | Age range validation |
| `idNumber(opts)` | ID/passport number (KE, generic) |
| `password(opts)` | Password strength requirements |
| `alphanumeric()` | Letters and numbers only |
| `url()` | HTTP/HTTPS URL format |
| `ipAddress()` | IPv4 address |
| `oneOf(values)` | Whitelist validation |
| `custom(fn)` | Custom validation function |

---

## Storage Adapters

### InMemoryStorage (Default)

Best for development and testing:

```javascript
const { InMemoryStorage } = require('ussd-state-builder');

const app = createApp()
  .storage(new InMemoryStorage())
  .build();
```

### RedisStorage (Production)

Recommended for production with automatic expiration:

```javascript
const { RedisStorage } = require('ussd-state-builder');

const app = createApp()
  .storage(new RedisStorage({
    url: 'redis://localhost:6379',
    keyPrefix: 'ussd:',
    maxHistorySize: 20
  }))
  .timeout(300)
  .build();

// Graceful shutdown
process.on('SIGTERM', async () => {
  await app.storage.close();
});
```

### MongoDB Storage

```javascript
const { MongoDBStorage } = require('ussd-state-builder');

const storage = new MongoDBStorage({
  uri: 'mongodb://localhost:27017',
  database: 'ussd_app'
});
```

### PostgreSQL Storage

```javascript
const { PostgreSQLStorage } = require('ussd-state-builder');

const storage = new PostgreSQLStorage({
  host: 'localhost',
  database: 'ussd_app',
  user: 'user',
  password: 'password'
});
```

### Custom Storage

Extend `StorageInterface` for custom adapters:

```javascript
const { StorageInterface } = require('ussd-state-builder');

class MyStorage extends StorageInterface {
  async getState(sessionId) { /* return state string */ }
  async setState(sessionId, state, timeout) { /* store state */ }
  async getData(sessionId) { /* return data object */ }
  async setData(sessionId, data, timeout) { /* store data */ }
  // Optional: getStateHistory, pushStateHistory, popStateHistory
  // Optional: getStateBatch, getDataBatch, deleteSessionBatch
  // Optional: withTransaction, cleanup, close
}
```

---

## Integration Examples

### Express.js

```javascript
const express = require('express');
const { createApp, Validators } = require('ussd-state-builder/sdk');

const ussd = createApp()
  .state('welcome', s => s.message('Welcome!\n1. Continue').on('1').goto('next'))
  .state('next', s => s.run(async () => 'You selected continue').end())
  .build();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/ussd', async (req, res) => {
  const { sessionId, text, phoneNumber } = req.body;

  try {
    const response = await ussd.processInput(sessionId, text);
    res.send(response);
  } catch (error) {
    console.error('USSD Error:', error);
    res.send('END An error occurred. Please try again.');
  }
});

app.listen(3000);
```

### Africa's Talking Integration

```javascript
app.post('/ussd', async (req, res) => {
  const { sessionId, serviceCode, phoneNumber, text } = req.body;

  // Store phone number in session on first request
  if (!text) {
    await ussd.setSessionData(sessionId, { phoneNumber });
  }

  const response = await ussd.processInput(sessionId, text);
  res.set('Content-Type', 'text/plain');
  res.send(response);
});
```

### With Authentication Context

```javascript
const app = createApp()
  .state('welcome', s => s
    .run(async (input, sid, ctx) => {
      // Access session data set during request handling
      const phone = ctx.sessionData.phoneNumber;
      const user = await db.findUserByPhone(phone);

      if (user) {
        return `Welcome back, ${user.name}!\n1. Balance\n2. Transfer`;
      }
      return 'Welcome! Please register first.\n1. Register';
    })
    .on('1').goto('balance')
    .on('2').goto('transfer')
  )
  .build();
```

---

## Advanced Features

### Middleware

Add cross-cutting concerns like logging, rate limiting, and sanitization:

```javascript
const {
  createLoggingMiddleware,
  createRateLimitMiddleware,
  createSanitizationMiddleware,
  createMetricsMiddleware
} = require('ussd-state-builder');

const app = createApp()
  .use('beforeProcess', createLoggingMiddleware({ logger: console }))
  .use('beforeProcess', createRateLimitMiddleware({ maxRequests: 10, windowMs: 60000 }))
  .use('beforeProcess', createSanitizationMiddleware({ removeSpecialChars: true }))
  .use('afterProcess', createMetricsMiddleware())
  .build();
```

**Distributed Rate Limiting (for multi-instance deployments):**

```javascript
const { createDistributedRateLimitMiddleware } = require('ussd-state-builder');

const app = createApp()
  .use('beforeProcess', createDistributedRateLimitMiddleware({
    redisClient,
    maxRequests: 10,
    windowMs: 60000,
    keyPrefix: 'ussd:ratelimit:'
  }))
  .build();
```

### Internationalization

Built-in support for 8 languages:

```javascript
const { createUSSDI18n, LanguageDetector } = require('ussd-state-builder');

const i18n = createUSSDI18n({ defaultLanguage: 'en' });

const app = createApp()
  .state('welcome', s => s
    .run(async (input, sid, ctx) => {
      // Auto-detect language from phone number
      const lang = LanguageDetector.fromPhoneNumber(ctx.sessionData.phoneNumber);
      return i18n.t('common.welcome', { lang });
    })
    .next('menu')
  )
  .build();
```

**Supported languages:** English (en), Swahili (sw), French (fr), Amharic (am), Arabic (ar), Portuguese (pt), Hausa (ha), Somali (so)

### Resilience Patterns

**Circuit Breaker** - Protect against cascading failures:

```javascript
const { createProtectedStorage, RedisStorage } = require('ussd-state-builder');

const storage = createProtectedStorage(new RedisStorage({ url: 'redis://localhost' }), {
  failureThreshold: 5,
  resetTimeout: 30000,
  onStateChange: (from, to) => console.log(`Circuit: ${from} -> ${to}`)
});

const app = createApp()
  .storage(storage)
  .build();
```

**Retry with Backoff:**

```javascript
const { createRetryStorage, RedisStorage } = require('ussd-state-builder');

const storage = createRetryStorage(new RedisStorage({ url: 'redis://localhost' }), {
  maxRetries: 3,
  baseDelay: 100,
  maxDelay: 5000,
  jitter: true
});
```

**Combine resilience layers:**

```javascript
const { createRetryStorage, createProtectedStorage, createCachedStorage } = require('ussd-state-builder');

let storage = new RedisStorage(redisConfig);
storage = createRetryStorage(storage, { maxRetries: 3 });       // Retry transient errors
storage = createProtectedStorage(storage, { failureThreshold: 5 }); // Circuit breaker
storage = createCachedStorage(storage, { maxSize: 1000 });      // Cache for performance
```

### Health Checks

Kubernetes-style health probes:

```javascript
const { HealthCheck } = require('ussd-state-builder');

const health = new HealthCheck({
  storage,
  stateMachine: app,
  cacheTTL: 5000,
  startupChecks: {
    database: async () => { await db.ping(); }
  }
});

// Run startup checks before accepting traffic
await health.runStartupChecks();

// Kubernetes probes
expressApp.get('/healthz', async (req, res) => {
  const result = await health.liveness();
  res.status(200).json(result);
});

expressApp.get('/readyz', async (req, res) => {
  const result = await health.readiness();
  res.status(result.status === 'ready' ? 200 : 503).json(result);
});
```

---

## Testing

Built machines have a `.test()` method that returns a fluent tester:

```javascript
const app = createApp()
  .state('welcome', s => s.message('Welcome!\n1. Continue').on('1').goto('next'))
  .state('next', s => s.message('Done').end())
  .build();

// Test flows directly on the built app
await app.test()
  .start()
  .expectResponse(/Welcome/)
  .input('1')
  .expectResponse(/Done/)
  .run();

// Or use USSDTester directly
const { USSDTester } = require('ussd-state-builder');
const tester = new USSDTester(app);
```

### State Inspection

Built machines also have an `.inspect()` method for debugging:

```javascript
const inspector = app.inspect();

// Get state machine summary
console.log(inspector.getSummary());
// { totalStates: 2, initialState: 'welcome', ... }

// Validate configuration
const result = inspector.validate();
console.log(result.valid, result.errors, result.warnings);

// Generate ASCII diagram
console.log(inspector.toAsciiDiagram());

// Get specific state info
console.log(inspector.getStateInfo('welcome'));
```

**Run tests:**

```bash
npm test                 # Run all tests
npm run test:watch       # Watch mode
npm run test:coverage    # Coverage report
```

---

## Traditional API

The SDK compiles to the same `USSDStateMachine` class, which you can use directly if preferred:

```javascript
const { USSDStateMachine, ResponseBuilder } = require('ussd-state-builder');

const ussd = new USSDStateMachine({
  initialState: 'WELCOME',
  timeout: 300,
  states: {
    WELCOME: {
      handler: async (input) => ({
        response: ResponseBuilder.menu('Welcome', ['Balance', 'Transfer']),
        nextState: 'MENU'
      })
    },
    MENU: {
      handler: async (input, sessionId, context) => {
        if (input === '1') {
          return { response: 'END Your balance is KES 15,000', nextState: 'END' };
        }
        return { response: ResponseBuilder.error('Invalid option') };
      }
    }
  }
});
```

### ResponseBuilder Utilities

```javascript
const { ResponseBuilder } = require('ussd-state-builder');

ResponseBuilder.menu('Select Option', ['Balance', 'Transfer']);
// "CON Select Option\n1. Balance\n2. Transfer"

ResponseBuilder.confirm('Proceed with payment?');
// "CON Proceed with payment?\n1. Yes\n2. No"

ResponseBuilder.input('Enter phone number:');
// "CON Enter phone number:"

ResponseBuilder.error('Invalid input');
// "CON Invalid input\nPlease try again."

ResponseBuilder.end('Thank you!');
// "END Thank you!"

ResponseBuilder.paginate(items, page, pageSize, { title: 'Items' });
ResponseBuilder.withBack('CON Enter amount:');
ResponseBuilder.formatAmount(1234.5, 'KES ');  // "KES 1,234.50"
```

---

## TypeScript Support

Full TypeScript definitions included:

```typescript
import { createApp, Validators, DynamicMenu } from 'ussd-state-builder/sdk';
import type { StateContext, StateHandlerResult } from 'ussd-state-builder';

const app = createApp()
  .state('welcome', s => s
    .run(async (input: string, sid: string, ctx: StateContext): Promise<string> => {
      return 'Welcome!';
    })
    .next('menu')
  )
  .build();
```

---

## Documentation

- [Production Deployment Guide](./docs/PRODUCTION.md)
- [Security Best Practices](./docs/SECURITY.md)
- [Performance Tuning](./docs/PERFORMANCE.md)
- [Custom Storage Adapters](./docs/CUSTOM-STORAGE.md)
- [Troubleshooting](./docs/TROUBLESHOOTING.md)

## Examples

See the [examples](./examples) directory:

- [SDK Basic](./examples/sdk-basic.js) - Banking app with SDK
- [SDK Dynamic Menu](./examples/sdk-dynamic-menu.js) - Paginated dynamic menus
- [Express Integration](./examples/express-integration.js) - Full Express.js setup
- [Multi-language](./examples/multi-language.js) - i18n implementation
- [With Validation](./examples/with-validation.js) - Input validation patterns

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests.

## License

MIT © [Anthony Kiplimo](https://github.com/anthonylimo)
