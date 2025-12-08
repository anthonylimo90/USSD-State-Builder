# USSD State Builder Examples

This directory contains example applications demonstrating various features of the USSD State Builder library.

## Examples

### 1. Basic Menu (`basic-menu.js`)

A simple USSD application demonstrating:
- Basic state navigation
- Menu creation with ResponseBuilder
- Session data storage
- Confirmation flows

```bash
node examples/basic-menu.js
```

### 2. Express Integration (`express-integration.js`)

Production-ready Express.js integration showing:
- REST API endpoint for USSD
- Health check endpoints
- Graceful shutdown handling
- Middleware integration

```bash
npm install express
node examples/express-integration.js
```

Endpoints:
- `POST /ussd` - USSD handler (Africa's Talking format)
- `GET /health` - Full health check
- `GET /health/live` - Liveness probe
- `GET /health/ready` - Readiness probe

### 3. Multi-Language (`multi-language.js`)

Demonstrates internationalization (i18n) support:
- Language selection flow
- Translation loading
- Dynamic language switching
- Multiple languages (English, Swahili, French)

```bash
node examples/multi-language.js
```

### 4. With Validation (`with-validation.js`)

Shows the rich validation library:
- Required fields
- Phone number validation (country-specific)
- Email validation
- Age validation
- PIN validation
- Combined validators

```bash
node examples/with-validation.js
```

## Running Examples

All examples can be run directly with Node.js:

```bash
# From the project root
node examples/basic-menu.js
node examples/multi-language.js
node examples/with-validation.js

# Express example (requires express)
npm install express
node examples/express-integration.js
```

## Creating Your Own USSD App

Here's a minimal template:

```javascript
const { USSDStateMachine, ResponseBuilder, InMemoryStorage } = require('ussd-state-builder');

const ussd = new USSDStateMachine({
  initialState: 'WELCOME',
  storage: new InMemoryStorage(),
  states: {
    WELCOME: {
      handler: async (input, sessionId, context) => {
        return {
          response: ResponseBuilder.menu('My USSD App', [
            'Option 1',
            'Option 2'
          ]),
          nextState: 'MENU'
        };
      }
    },
    MENU: {
      handler: async (input, sessionId, context) => {
        switch (input) {
          case '1':
            return { response: 'END You selected Option 1' };
          case '2':
            return { response: 'END You selected Option 2' };
          default:
            return { response: 'CON Invalid. Try again:', nextState: 'MENU' };
        }
      }
    }
  }
});

// Process a request
const response = await ussd.processInput('session-123', '');
console.log(response);
```

## More Resources

- [Full Documentation](../README.md)
- [API Reference](../README.md#api-reference)
- [TypeScript Types](../types/index.d.ts)
