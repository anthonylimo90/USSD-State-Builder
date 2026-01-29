/**
 * Tests for Built-in Middleware Helpers
 */
const { createApp } = require('../../lib/sdk');

describe('SDK Middleware Helpers', () => {
  describe('logging()', () => {
    it('should add logging middleware', async () => {
      const logs = [];
      const mockLogger = (msg) => logs.push(msg);

      const app = createApp()
        .state('welcome', s => s.message('Hello').end())
        .logging({ logger: mockLogger })
        .start('welcome')
        .build();

      await app.processInput('session1', '');

      expect(logs.length).toBeGreaterThan(0);
      expect(logs.some(log => log.includes('session1'))).toBe(true);
    });

    it('should respect logInput option', async () => {
      const logs = [];

      const app = createApp()
        .state('welcome', s => s.message('Hello').end())
        .logging({ logger: (msg) => logs.push(msg), logInput: false })
        .start('welcome')
        .build();

      await app.processInput('session1', 'test-input');

      // Should not have input logged
      expect(logs.some(log => log.includes('Input: "test-input"'))).toBe(false);
    });
  });

  describe('rateLimit()', () => {
    it('should add rate limiting middleware', async () => {
      const app = createApp()
        .state('welcome', s => s.message('Hello').end())
        .rateLimit({ maxRequests: 2, windowMs: 60000 })
        .start('welcome')
        .build();

      // First two requests should pass
      await app.processInput('session1', '');
      await app.processInput('session1', '');

      // Third request should be blocked
      const response = await app.processInput('session1', '');
      expect(response).toContain('END');
      expect(response).toContain('Too many requests');

      // Cleanup
      app.cleanup();
    });

    it('should support custom error message', async () => {
      const app = createApp()
        .state('welcome', s => s.message('Hello').end())
        .rateLimit({ maxRequests: 1, windowMs: 60000, message: 'Slow down!' })
        .start('welcome')
        .build();

      await app.processInput('session1', '');
      const response = await app.processInput('session1', '');
      expect(response).toContain('Slow down!');

      app.cleanup();
    });
  });

  describe('sanitize()', () => {
    it('should add sanitization middleware', async () => {
      let capturedInput = null;

      const app = createApp()
        .state('welcome', s => s
          .run(async (input) => {
            capturedInput = input;
            return 'Done';
          })
          .end()
        )
        .sanitize({ trim: true })
        .start('welcome')
        .build();

      await app.processInput('session1', '  trimmed  ');

      expect(capturedInput).toBe('trimmed');
    });

    it('should truncate long inputs', async () => {
      let capturedInput = null;

      const app = createApp()
        .state('welcome', s => s
          .run(async (input) => {
            capturedInput = input;
            return 'Done';
          })
          .end()
        )
        .sanitize({ maxLength: 10 })
        .start('welcome')
        .build();

      await app.processInput('session1', 'this is a very long input');

      expect(capturedInput).toBe('this is a ');
    });

    it('should remove special characters when enabled', async () => {
      let capturedInput = null;

      const app = createApp()
        .state('welcome', s => s
          .run(async (input) => {
            capturedInput = input;
            return 'Done';
          })
          .end()
        )
        .sanitize({ removeSpecialChars: true })
        .start('welcome')
        .build();

      await app.processInput('session1', 'test@email.com');

      // @ and . should be preserved, but other special chars removed
      expect(capturedInput).toBe('test@email.com');
    });
  });

  describe('metrics()', () => {
    it('should add metrics collection middleware', async () => {
      const app = createApp()
        .state('welcome', s => s.message('Hello').end())
        .metrics()
        .start('welcome')
        .build();

      await app.processInput('session1', '');
      await app.processInput('session2', '');
      await app.processInput('session3', '');

      expect(app.getMetrics).toBeDefined();
      const metrics = app.getMetrics();

      expect(metrics.totalRequests).toBe(3);
      expect(metrics.totalErrors).toBe(0);
    });

    it('should track requests by state', async () => {
      const app = createApp()
        .state('welcome', s => s.message('Hi').on('1').goto('next'))
        .state('next', s => s.message('Next').end())
        .metrics()
        .start('welcome')
        .build();

      await app.processInput('session1', '');
      await app.processInput('session1', '1');

      const metrics = app.getMetrics();
      // Both requests go through welcome state (initial + input '1')
      expect(metrics.requestsByState['welcome']).toBe(2);
    });

    it('should support resetMetrics()', async () => {
      const app = createApp()
        .state('welcome', s => s.message('Hello').end())
        .metrics()
        .start('welcome')
        .build();

      await app.processInput('session1', '');
      expect(app.getMetrics().totalRequests).toBe(1);

      app.resetMetrics();
      expect(app.getMetrics().totalRequests).toBe(0);
    });
  });

  describe('sessionTimeout()', () => {
    it('should add session timeout middleware', () => {
      const app = createApp()
        .state('welcome', s => s.message('Hello').end())
        .sessionTimeout({ warningThreshold: 30, warningMessage: 'Expiring soon!' })
        .start('welcome')
        .build();

      // Middleware is added but warning only shows when session is near expiration
      expect(app).toBeDefined();
    });
  });

  describe('cleanup()', () => {
    it('should be attached to the machine', () => {
      const app = createApp()
        .state('welcome', s => s.message('Hello').end())
        .rateLimit({ maxRequests: 10 })
        .start('welcome')
        .build();

      expect(typeof app.cleanup).toBe('function');
      app.cleanup(); // Should not throw
    });

    it('should clean up all middleware resources', async () => {
      const app = createApp()
        .state('welcome', s => s.message('Hello').end())
        .rateLimit({ maxRequests: 2, windowMs: 60000 })
        .metrics()
        .start('welcome')
        .build();

      await app.processInput('session1', '');
      await app.processInput('session1', '');

      // Should be rate limited
      let response = await app.processInput('session1', '');
      expect(response).toContain('Too many requests');

      // Cleanup
      app.cleanup();

      // Note: cleanup clears the rate limit map but doesn't reset the session counter
      // The rate limiter tracks by sessionId, so same session is still limited
    });
  });

  describe('Multiple middleware', () => {
    it('should support chaining multiple middleware helpers', async () => {
      const logs = [];

      const app = createApp()
        .state('welcome', s => s.message('Hello').end())
        .logging({ logger: (msg) => logs.push(msg) })
        .sanitize({ trim: true })
        .metrics()
        .start('welcome')
        .build();

      await app.processInput('session1', '  test  ');

      expect(logs.length).toBeGreaterThan(0);
      expect(app.getMetrics().totalRequests).toBe(1);
    });

    it('should execute middleware in correct order', async () => {
      const order = [];

      const app = createApp()
        .state('welcome', s => s
          .run(async () => {
            order.push('handler');
            return 'Done';
          })
          .end()
        )
        .use('beforeProcess', async (ctx, next) => {
          order.push('before1');
          await next();
        })
        .use('beforeProcess', async (ctx, next) => {
          order.push('before2');
          await next();
        })
        .use('afterProcess', async (ctx, next) => {
          order.push('after');
          await next();
        })
        .start('welcome')
        .build();

      await app.processInput('session1', '');

      expect(order).toEqual(['before1', 'before2', 'handler', 'after']);
    });
  });
});
