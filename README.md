# USSD State Builder

[![npm version](https://badge.fury.io/js/ussd-state-builder.svg)](https://www.npmjs.com/package/ussd-state-builder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A flexible and powerful state machine for building USSD applications in Node.js. Features include back navigation, lifecycle hooks, response builders, and multiple storage adapters.

## Features

- 🚀 **Simple API** - Easy to learn and use
- 🔙 **Back Navigation** - Built-in support for navigating to previous states
- 📦 **Pluggable Storage** - In-memory, Redis, or custom adapters
- 🪝 **Lifecycle Hooks** - onStateEnter, onStateExit, onError callbacks
- 🛠️ **Response Builder** - Utilities for common USSD patterns
- 📝 **TypeScript Support** - Full type definitions included
- ✅ **Validation Support** - Input validation with custom validators

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
    keyPrefix: 'ussd:'
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

Implement the `StorageAdapter` interface:

```javascript
class MyCustomStorage {
  async getState(sessionId) { /* return state string */ }
  async setState(sessionId, state, timeout) { /* store state */ }
  async getData(sessionId) { /* return data object */ }
  async setData(sessionId, data, timeout) { /* store data */ }
  
  // Optional: for back navigation
  async getStateHistory(sessionId) { /* return array */ }
  async pushStateHistory(sessionId, state) { /* add to history */ }
  async popStateHistory(sessionId) { /* remove and return last */ }
  
  // Optional: cleanup
  async cleanup() { /* remove expired sessions */ }
  async close() { /* close connections */ }
}
```

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

## Examples

See the [examples](./examples) directory for complete working examples:

- [Basic Event Registration](./examples/event-registration.js)
- [Banking USSD App](./examples/banking.js)
- [Multi-language Support](./examples/multi-language.js)

## Testing

```bash
npm test
npm run test:watch
```

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests.

## License

MIT © [Anthony Kiplimo](https://github.com/anthonylimo)
