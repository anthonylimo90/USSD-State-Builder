# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
npm install              # Install dependencies
npm test                 # Run tests (uses jest --forceExit)
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Run tests with coverage report
```

Run a single test file:
```bash
npx jest tests/USSDStateMachine.test.js --forceExit
```

Run a specific test by name:
```bash
npx jest --testNamePattern="should handle validation errors" --forceExit
```

## Architecture

This is a state machine library for building USSD (Unstructured Supplementary Service Data) applications. USSD is a protocol used by mobile phones for interactive text-based services.

### Core Components

**USSDStateMachine** (`lib/USSDStateMachine.js`): The main class that processes user input through defined states. Key flow:
1. `processInput(sessionId, input)` receives user input
2. Retrieves current state from storage (or uses `initialState` for new sessions)
3. Runs middleware `beforeProcess` hooks
4. Handles back navigation if input is '0' and `enableBackNavigation` is true
5. Runs state validator (if defined), throws `ValidationError` on failure
6. Executes state handler, which returns `{ response, nextState?, data? }`
7. Manages state transitions and calls lifecycle hooks (`onStateEnter`, `onStateExit`)
8. Runs middleware `afterProcess` hooks

**Storage Adapters** (`lib/*Storage.js`): Session persistence layer implementing `StorageAdapter` interface:
- `InMemoryStorage` - Development/testing (default)
- `RedisStorage` - Production with automatic expiration
- `MongoDBStorage` - Document-based persistence
- `PostgreSQLStorage` - SQL-based persistence

**ResponseBuilder** (`lib/ResponseBuilder.js`): Static utility for USSD response formatting. Responses must start with `CON` (continue session) or `END` (terminate session).

**Middleware** (`lib/Middleware.js`): Pluggable middleware system with hooks: `beforeProcess`, `afterProcess`, `onError`, `onStateChange`, `onSessionStart`, `onSessionEnd`. Includes factory functions for common middleware (rate limiting, logging, sanitization, metrics).

**ValidationLibrary** (`lib/ValidationLibrary.js`): Pre-built validators (`Validators.phone()`, `Validators.numeric()`, `Validators.pin()`, etc.) with `combineValidators()` for composing multiple validators.

### State Configuration Pattern

States are defined as objects with:
- `handler(input, sessionId, context)` - Returns `{ response, nextState?, data?, previousState? }`
- `validator(input)` - Optional, throws `ValidationError` on invalid input
- `onEnter(sessionId)` / `onExit(sessionId)` - Optional lifecycle callbacks

### Testing Utilities

`USSDTester` (`lib/TestingUtils.js`) provides a fluent API for testing USSD flows:
```javascript
const tester = new USSDTester(stateMachine);
await tester
  .start()
  .expectResponse(/Welcome/)
  .input('1')
  .expectState('MENU')
  .run();
```

## Key Patterns

- USSD responses always start with `CON ` (continue) or `END ` (terminate)
- Input '0' is reserved for back navigation when `enableBackNavigation: true`
- Session data persists across state transitions via storage adapter
- State history stack enables navigation to previous states
- Validators throw `ValidationError` with user-friendly message shown as `CON {message}\nPlease try again.`
