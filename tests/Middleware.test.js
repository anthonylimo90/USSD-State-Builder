const {
    MiddlewareManager,
    createLoggingMiddleware,
    createRateLimitMiddleware,
    createSanitizationMiddleware,
    createMetricsMiddleware
} = require('../lib/Middleware');

describe('MiddlewareManager', () => {
    let manager;

    beforeEach(() => {
        manager = new MiddlewareManager();
    });

    test('should register middleware for default hook', async () => {
        const fn = jest.fn(async (ctx, next) => next());
        manager.use(fn);

        expect(manager.count('beforeProcess')).toBe(1);
    });

    test('should register middleware for specific hook', async () => {
        const fn = jest.fn(async (ctx, next) => next());
        manager.use('afterProcess', fn);

        expect(manager.count('afterProcess')).toBe(1);
    });

    test('should throw for unknown hook', () => {
        expect(() => {
            manager.use('unknownHook', () => { });
        }).toThrow('Unknown middleware hook');
    });

    test('should throw for non-function middleware', () => {
        expect(() => {
            manager.use('beforeProcess', 'not a function');
        }).toThrow('Middleware must be a function');
    });

    test('should execute middleware in order', async () => {
        const order = [];

        manager.use(async (ctx, next) => {
            order.push(1);
            await next();
            order.push(4);
        });

        manager.use(async (ctx, next) => {
            order.push(2);
            await next();
            order.push(3);
        });

        const context = { input: 'test' };
        await manager.execute('beforeProcess', context);

        expect(order).toEqual([1, 2, 3, 4]);
    });

    test('should modify context', async () => {
        manager.use(async (ctx, next) => {
            ctx.input = ctx.input.toUpperCase();
            await next();
        });

        const context = { input: 'hello' };
        await manager.execute('beforeProcess', context);

        expect(context.input).toBe('HELLO');
    });

    test('should clear all middlewares', () => {
        manager.use(() => { });
        manager.use('afterProcess', () => { });

        manager.clear();

        expect(manager.count()).toBe(0);
    });

    test('should clear middlewares for specific hook', () => {
        manager.use(() => { });
        manager.use('afterProcess', () => { });

        manager.clear('beforeProcess');

        expect(manager.count('beforeProcess')).toBe(0);
        expect(manager.count('afterProcess')).toBe(1);
    });
});

describe('createLoggingMiddleware', () => {
    test('should log input and response', async () => {
        const logs = [];
        const logger = (msg) => logs.push(msg);

        const middleware = createLoggingMiddleware({ logger });
        const context = {
            sessionId: 'test123',
            currentState: 'MENU',
            input: '1',
            response: 'CON Select option'
        };

        await middleware(context, async () => { });

        expect(logs.length).toBeGreaterThan(0);
        expect(logs[0]).toContain('test123');
        expect(logs[0]).toContain('MENU');
    });
});

describe('createRateLimitMiddleware', () => {
    test('should allow requests under limit', async () => {
        const { middleware, cleanup } = createRateLimitMiddleware({ maxRequests: 5 });
        const context = { sessionId: 'rate-test' };

        for (let i = 0; i < 5; i++) {
            await middleware(context, async () => { });
            expect(context.blocked).toBeFalsy();
        }

        cleanup();
    });

    test('should block requests over limit', async () => {
        const { middleware, cleanup } = createRateLimitMiddleware({ maxRequests: 2 });
        const context = { sessionId: 'rate-test-2' };

        await middleware(context, async () => { });
        await middleware(context, async () => { });
        await middleware(context, async () => { });

        expect(context.blocked).toBe(true);
        expect(context.response).toContain('END');

        cleanup();
    });

    test('should provide cleanup method to stop interval', () => {
        const { middleware, cleanup, reset } = createRateLimitMiddleware({ maxRequests: 5 });

        expect(typeof middleware).toBe('function');
        expect(typeof cleanup).toBe('function');
        expect(typeof reset).toBe('function');

        // Cleanup should not throw
        expect(() => cleanup()).not.toThrow();
    });

    test('should reset counters with reset method', async () => {
        const { middleware, cleanup, reset } = createRateLimitMiddleware({ maxRequests: 2 });
        const context = { sessionId: 'rate-reset-test' };

        await middleware(context, async () => { });
        await middleware(context, async () => { });
        await middleware(context, async () => { });

        expect(context.blocked).toBe(true);

        // Reset and try again
        reset();
        context.blocked = false;

        await middleware(context, async () => { });
        expect(context.blocked).toBeFalsy();

        cleanup();
    });
});

describe('createSanitizationMiddleware', () => {
    test('should trim input', async () => {
        const middleware = createSanitizationMiddleware({ trim: true });
        const context = { input: '  hello  ' };

        await middleware(context, async () => { });

        expect(context.input).toBe('hello');
    });

    test('should truncate long input', async () => {
        const middleware = createSanitizationMiddleware({ maxLength: 5 });
        const context = { input: 'hello world' };

        await middleware(context, async () => { });

        expect(context.input).toBe('hello');
    });

    test('should remove special characters when enabled', async () => {
        const middleware = createSanitizationMiddleware({ removeSpecialChars: true });
        const context = { input: 'hello!#$%^&*()' };

        await middleware(context, async () => { });

        expect(context.input).toBe('hello');
    });
});

describe('createMetricsMiddleware', () => {
    test('should track request count', async () => {
        const { middleware, getMetrics, resetMetrics } = createMetricsMiddleware();
        resetMetrics();

        const context = { currentState: 'MENU' };
        await middleware(context, async () => { });
        await middleware(context, async () => { });

        const metrics = getMetrics();
        expect(metrics.totalRequests).toBe(2);
    });

    test('should track requests by state', async () => {
        const { middleware, getMetrics, resetMetrics } = createMetricsMiddleware();
        resetMetrics();

        await middleware({ currentState: 'MENU' }, async () => { });
        await middleware({ currentState: 'MENU' }, async () => { });
        await middleware({ currentState: 'SUBMIT' }, async () => { });

        const metrics = getMetrics();
        expect(metrics.requestsByState['MENU']).toBe(2);
        expect(metrics.requestsByState['SUBMIT']).toBe(1);
    });

    test('should track errors', async () => {
        const { middleware, getMetrics, resetMetrics } = createMetricsMiddleware();
        resetMetrics();

        const context = { currentState: 'MENU' };

        try {
            await middleware(context, async () => {
                throw new Error('Test error');
            });
        } catch (e) {
            // Expected
        }

        const metrics = getMetrics();
        expect(metrics.totalErrors).toBe(1);
    });

    test('should calculate average response time', async () => {
        const { middleware, getMetrics, resetMetrics } = createMetricsMiddleware();
        resetMetrics();

        const context = { currentState: 'MENU' };
        await middleware(context, async () => {
            // Simulate some processing time
            await new Promise(resolve => setTimeout(resolve, 10));
        });

        const metrics = getMetrics();
        expect(metrics.averageResponseTime).toMatch(/\d+ms/);
    });
});
