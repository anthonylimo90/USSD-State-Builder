# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.5.0] - 2026-01-26

### Added
- **Circuit Breaker** - `CircuitBreaker` class and `createProtectedStorage` for storage resilience with CLOSED/OPEN/HALF_OPEN states
- **Retry Strategy** - `RetryStrategy` class and `createRetryStorage` with exponential backoff, jitter, and configurable retry conditions
- **Distributed Rate Limiting** - `createDistributedRateLimitMiddleware` using Redis sorted sets with sliding window algorithm
- **Enhanced Health Checks** - Kubernetes-style `liveness()` and `readiness()` probes, startup checks with `runStartupChecks()`, result caching with `cacheTTL`, HTTP handlers
- **Batch Storage Operations** - `getStateBatch()`, `getDataBatch()`, `deleteSessionBatch()` across all storage adapters
- **Atomic Transactions** - `withTransaction()` support: Redis MULTI/EXEC, MongoDB sessions, PostgreSQL BEGIN/COMMIT
- **Connection Pooling** - Documented pool configuration for Redis, MongoDB, and PostgreSQL adapters
- **New Validators** - `password()`, `alphanumeric()`, `url()`, `ipAddress()` validators
- **New i18n Languages** - Amharic (am), Arabic (ar), Portuguese (pt), Hausa (ha), Somali (so)
- **Debug Log Levels** - `debug.info()`, `debug.warn()`, `debug.error()` with `DEBUG_LEVEL` env var
- **Debug Structured Output** - `debug.json()` for structured JSON logging
- **Debug Timing** - `debug.time()` / `debug.timeEnd()` for performance measurement
- **Documentation** - Production, Security, Performance, Custom Storage, and Troubleshooting guides
- **Examples** - Hot reload, custom storage, error recovery, and health check examples
- **Edge Case Tests** - Concurrent sessions, circular states, middleware ordering, storage failure recovery

### Changed
- Test suite expanded from 258 to 644 tests across 15 test suites
- `LanguageDetector` phone prefix map expanded with Ethiopian, Arabic, Portuguese, and Hausa country codes

## [2.4.0] - 2026-01-23

### Added
- **Debug Utility** - Lightweight debug logging with namespace support (`DEBUG=ussd:*`)
- **StateInspector** - State machine introspection tools
  - `getSummary()` - Overview of state machine configuration
  - `getStateInfo(state)` - Detailed state information
  - `toAsciiDiagram()` - ASCII visualization of state transitions
  - `toDotGraph()` - GraphViz DOT format export
  - `validate()` - Configuration validation
- **ESM Support** - Native ES modules with `index.mjs` wrapper
- **Tree-shaking** - Added `sideEffects: false` for better bundler optimization
- **I18n Caching** - LRU cache for translation lookups with `getCacheStats()`

### Fixed
- **Memory leak** in rate limiting middleware - now returns cleanup functions
- **Unbounded history growth** - Added `maxHistorySize` option to InMemoryStorage (default: 20)
- **Hardcoded logging** - USSDStateMachine now accepts injectable logger

### Security
- Added security documentation for input validation requirements
- Documented rate limiting limitations for distributed systems

## [2.3.0] - 2025-12-08

### Added
- Complete implementation of all 30 improvement items
- All features from 2.0.0-2.2.0 fully integrated and tested
- 201 passing tests across 10 test suites
- Published to npm as ussd-state-builder

### Changed
- Consolidated all features into stable release
- Enhanced documentation and examples

## [2.2.0] - 2025-12-08

### Added
- **Session Manager** - Enhanced session management with metadata tracking and analytics
- **Testing Utilities** - USSDTester with fluent API for testing USSD flows
- **Internationalization (i18n)** - Full i18n support with 3 built-in languages (English, Swahili, French)
- **Custom Error Types** - 10+ specialized error classes (StateNotFoundError, SessionExpiredError, etc.)
- **Performance Utilities** - LRU cache, memoize, lazy loading, batch processing
- **Health Check Support** - Built-in health check manager
- **Graceful Shutdown** - Clean application shutdown handling
- **Hot Reloader** - Dynamic state updates without restart
- **Example Applications** - 4 example apps demonstrating various features
- **CI/CD Pipeline** - GitHub Actions workflow for testing and publishing

### Changed
- Updated TypeScript definitions for all new modules
- Enhanced package.json with additional keywords

## [2.1.0] - 2025-12-08

### Added
- **Middleware System** - Pluggable middleware with 6 built-in factories
  - Logging middleware
  - Rate limiting middleware
  - Session timeout middleware
  - Analytics middleware
  - Sanitization middleware
  - Metrics middleware
- **MongoDB Storage Adapter** - Production-ready MongoDB support with TTL indexes
- **PostgreSQL Storage Adapter** - PostgreSQL support with connection pooling
- **Storage Interface** - Abstract base class for custom storage adapters
- **Rich Validation Library** - 15+ validators for common input patterns
  - Phone validation (country-specific)
  - Email validation
  - Age/date validation
  - PIN validation
  - Amount validation
  - Menu option validation
  - ID number validation

### Changed
- Integrated middleware execution into USSDStateMachine
- Added `use()` method to USSDStateMachine for easy middleware registration

## [2.0.0] - 2025-12-07

### Added
- **TypeScript Support** - Complete type definitions (types/index.d.ts)
- **Redis Storage Adapter** - Production-ready Redis storage with lazy connection
- **Back Navigation** - Allow users to navigate back in USSD flows
- **Response Builder** - Utility functions for common USSD response patterns
  - Menu builder
  - Confirmation prompts
  - Error messages
  - Pagination support
- **Lifecycle Hooks** - State-level onEnter/onExit hooks
- **Configuration Validation** - Validate config on initialization

### Changed
- Package renamed from `ussd-state-machine` to `ussd-state-builder`
- Enhanced InMemoryStorage with state history support
- Improved error handling throughout

### Breaking Changes
- Package name changed (update your imports)
- State handlers now receive a context object with sessionData

## [1.0.0] - 2025-12-01

### Added
- Initial release
- Core USSDStateMachine class
- InMemoryStorage adapter
- ValidationError class
- Basic state transitions
- Session timeout support

---

## Migration Guide

### From 1.x to 2.x

1. Update package name in imports:
```javascript
// Before
const { USSDStateMachine } = require('ussd-state-machine');

// After
const { USSDStateMachine } = require('ussd-state-builder');
```

2. Update package.json:
```json
{
  "dependencies": {
    "ussd-state-builder": "^2.0.0"
  }
}
```

3. State handlers now receive context:
```javascript
// Before
handler: async (input, sessionId) => { ... }

// After (recommended)
handler: async (input, sessionId, context) => {
  const { sessionData, previousState } = context;
  ...
}
```

### From 2.0 to 2.1

No breaking changes. New features are additive.

### From 2.1 to 2.2

No breaking changes. New features are additive.

---

[Unreleased]: https://github.com/anthonylimo/ussd-state-machine/compare/v2.5.0...HEAD
[2.5.0]: https://github.com/anthonylimo/ussd-state-machine/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/anthonylimo/ussd-state-machine/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/anthonylimo/ussd-state-machine/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/anthonylimo/ussd-state-machine/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/anthonylimo/ussd-state-machine/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/anthonylimo/ussd-state-machine/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/anthonylimo/ussd-state-machine/releases/tag/v1.0.0
