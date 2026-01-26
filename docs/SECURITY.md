# Security Best Practices

Securing your USSD application against injection attacks, abuse, and data exposure.

## Input Sanitization

Apply the built-in sanitization middleware as the first `beforeProcess` hook.

```javascript
const { createSanitizationMiddleware } = require('ussd-state-builder');

stateMachine.use('beforeProcess', createSanitizationMiddleware({
  maxLength: 160,               // truncate oversized input
  trim: true,                   // remove leading/trailing whitespace
  removeSpecialChars: true      // strip characters outside [a-zA-Z0-9 @.-]
}));
```

The original input is preserved in `context.originalInput` for audit logging.

The state machine also enforces `maxInputLength` (default 160) at the framework level, throwing a `ValidationError` before the handler runs if exceeded.

## Rate Limiting

### Single Instance

```javascript
const { createRateLimitMiddleware } = require('ussd-state-builder');

const rateLimiter = createRateLimitMiddleware({
  maxRequests: 10, windowMs: 60000,
  message: 'Too many requests. Please try again later.'
});
stateMachine.use('beforeProcess', rateLimiter.middleware);

// Clean up on shutdown to stop the internal interval
process.on('SIGTERM', () => rateLimiter.cleanup());
```

### Distributed (Multi-Instance)

Use Redis-backed rate limiting so limits apply across all instances. Uses a sliding window algorithm. Fails open if Redis is unavailable.

```javascript
const { createDistributedRateLimitMiddleware } = require('ussd-state-builder');

const limiter = createDistributedRateLimitMiddleware({
  redisClient, maxRequests: 10, windowMs: 60000, keyPrefix: 'ussd:ratelimit:'
});
stateMachine.use('beforeProcess', limiter.middleware);
```

## Input Validation

Every state that accepts user input should have a validator. Unvalidated input flowing into queries or APIs is the primary injection risk.

```javascript
const { Validators, combineValidators } = require('ussd-state-builder');

const states = {
  ENTER_PHONE: {
    handler: async (input) => { /* ... */ },
    validator: Validators.phone({ country: 'KE' })
  },
  ENTER_AMOUNT: {
    handler: async (input) => { /* ... */ },
    validator: combineValidators(
      Validators.required('Amount is required'),
      Validators.amount({ min: 10, max: 100000 })
    )
  },
  ENTER_PIN: {
    handler: async (input) => { /* ... */ },
    validator: Validators.pin({ length: 4, numericOnly: true })
  },
  MAIN_MENU: {
    handler: async (input) => { /* ... */ },
    validator: Validators.menuOption({ min: 1, max: 4 })
  }
};
```

When a validator throws `ValidationError`, the framework returns `CON {message}\nPlease try again.` without running the handler.

## XSS and Injection Prevention

USSD is text-only, so browser XSS does not apply directly. However, if input is later displayed in web dashboards:

1. Enable `removeSpecialChars` in the sanitization middleware.
2. Use `Validators.alphanumeric()` or `Validators.pattern()` for free-text fields.
3. Always use parameterized database queries -- never interpolate USSD input into SQL.
4. Apply server-side escaping when rendering USSD data in HTML.

## Session Security

### Short Timeouts

```javascript
new USSDStateMachine({ timeout: 180 });  // 3 minutes
```

### Avoid Storing Sensitive Data

Do not store PINs or passwords in session data. Verify them immediately and discard.

```javascript
CONFIRM_PIN: {
  handler: async (input, sessionId, ctx) => {
    const valid = await verifyPin(ctx.sessionData.phone, input);
    return {
      response: valid ? 'END Transaction complete.' : 'CON Invalid PIN.\nPlease try again.'
    };
  }
}
```

### Session Cleanup

For in-memory storage, schedule periodic cleanup. Redis handles this via TTL.

```javascript
setInterval(() => storage.cleanup(), 60000).unref();
```

## Logging

Use the logging middleware for audit trails. Avoid logging sensitive input (PINs, passwords).

```javascript
const { createLoggingMiddleware } = require('ussd-state-builder');

stateMachine.use('beforeProcess', createLoggingMiddleware({
  logger: auditLogger.info.bind(auditLogger),
  logInput: true,
  logResponse: false,    // avoid logging sensitive response content
  logTiming: true
}));
```

## Checklist

- [ ] Sanitization middleware registered as the first `beforeProcess` hook
- [ ] Rate limiting enabled (distributed for multi-instance)
- [ ] Every user-input state has a validator
- [ ] Session timeout set to 3 minutes or less
- [ ] Sensitive data never stored in session
- [ ] Database queries use parameterized statements
- [ ] Structured logging with sensitive fields redacted
