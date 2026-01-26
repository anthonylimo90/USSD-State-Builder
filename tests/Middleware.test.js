const {
    MiddlewareManager,
    createLoggingMiddleware,
    createRateLimitMiddleware,
    createDistributedRateLimitMiddleware,
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

describe('createDistributedRateLimitMiddleware', () => {
    function createMockRedisClient() {
        const store = new Map();
        return {
            multi: () => {
                const commands = [];
                const multiObj = {
                    zRemRangeByScore: (key, min, max) => {
                        commands.push({ cmd: 'zRemRangeByScore', key, min, max });
                        return multiObj;
                    },
                    zAdd: (key, member) => {
                        commands.push({ cmd: 'zAdd', key, member });
                        return multiObj;
                    },
                    zCard: (key) => {
                        commands.push({ cmd: 'zCard', key });
                        return multiObj;
                    },
                    expire: (key, ttl) => {
                        commands.push({ cmd: 'expire', key, ttl });
                        return multiObj;
                    },
                    exec: async () => {
                        // Simulate sorted set behavior
                        const results = [];
                        for (const cmd of commands) {
                            if (cmd.cmd === 'zRemRangeByScore') {
                                results.push(0);
                            } else if (cmd.cmd === 'zAdd') {
                                const key = cmd.key;
                                if (!store.has(key)) store.set(key, []);
                                store.get(key).push(cmd.member);
                                results.push(1);
                            } else if (cmd.cmd === 'zCard') {
                                results.push(store.has(cmd.key) ? store.get(cmd.key).length : 0);
                            } else if (cmd.cmd === 'expire') {
                                results.push(1);
                            }
                        }
                        return results;
                    }
                };
                return multiObj;
            },
            del: async (key) => {
                store.delete(key);
            }
        };
    }

    test('should require redisClient option', () => {
        expect(() => {
            createDistributedRateLimitMiddleware();
        }).toThrow('requires a redisClient');
    });

    test('should allow requests under limit', async () => {
        const mockClient = createMockRedisClient();
        const { middleware } = createDistributedRateLimitMiddleware({
            redisClient: mockClient,
            maxRequests: 5
        });

        const context = { sessionId: 'dist-test' };
        for (let i = 0; i < 5; i++) {
            context.blocked = false;
            await middleware(context, async () => {});
            expect(context.blocked).toBeFalsy();
        }
    });

    test('should block requests over limit', async () => {
        const mockClient = createMockRedisClient();
        const { middleware } = createDistributedRateLimitMiddleware({
            redisClient: mockClient,
            maxRequests: 2
        });

        const context = { sessionId: 'dist-test-2' };
        await middleware(context, async () => {});
        await middleware(context, async () => {});

        context.blocked = false;
        await middleware(context, async () => {});
        expect(context.blocked).toBe(true);
        expect(context.response).toContain('END');
    });

    test('should fail open on Redis error', async () => {
        const failingClient = {
            multi: () => ({
                zRemRangeByScore: () => failingClient.multi(),
                zAdd: () => failingClient.multi(),
                zCard: () => failingClient.multi(),
                expire: () => failingClient.multi(),
                exec: async () => { throw new Error('Redis down'); }
            })
        };

        const { middleware } = createDistributedRateLimitMiddleware({
            redisClient: failingClient,
            maxRequests: 1
        });

        const context = { sessionId: 'fail-test' };
        let nextCalled = false;
        await middleware(context, async () => { nextCalled = true; });

        // Should allow request through on Redis failure
        expect(nextCalled).toBe(true);
        expect(context.blocked).toBeFalsy();
    });

    test('should provide reset method', async () => {
        const mockClient = createMockRedisClient();
        const delSpy = jest.spyOn(mockClient, 'del');

        const { reset } = createDistributedRateLimitMiddleware({
            redisClient: mockClient,
            maxRequests: 5
        });

        await reset('session-123');
        expect(delSpy).toHaveBeenCalledWith('ussd:ratelimit:session-123');
    });
});
