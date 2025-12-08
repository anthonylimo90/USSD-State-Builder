# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/anthonylimo/ussd-state-machine/compare/v2.2.0...HEAD
[2.2.0]: https://github.com/anthonylimo/ussd-state-machine/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/anthonylimo/ussd-state-machine/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/anthonylimo/ussd-state-machine/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/anthonylimo/ussd-state-machine/releases/tag/v1.0.0
