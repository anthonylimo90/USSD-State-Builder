const { SlidingWindowRateLimit, createSlidingWindowRateLimit } = require('../lib/SlidingWindowRateLimit');

describe('SlidingWindowRateLimit', () => {
    let limiter;

    afterEach(() => {
        if (limiter) limiter.destroy();
    });

    test('should allow requests within limit', () => {
        limiter = new SlidingWindowRateLimit({ maxRequests: 5, windowMs: 1000 });

        for (let i = 0; i < 5; i++) {
            const result = limiter.check('session-1');
            expect(result.allowed).toBe(true);
        }
    });

    test('should block requests over limit', () => {
        limiter = new SlidingWindowRateLimit({ maxRequests: 3, windowMs: 1000 });

        for (let i = 0; i < 3; i++) {
            limiter.check('session-1');
        }

        const blocked = limiter.check('session-1');
        expect(blocked.allowed).toBe(false);
        expect(blocked.remaining).toBe(0);
        expect(blocked.retryAfter).toBeGreaterThan(0);
    });

    test('should track different keys independently', () => {
        limiter = new SlidingWindowRateLimit({ maxRequests: 2, windowMs: 1000 });

        limiter.check('session-a');
        limiter.check('session-a');
        const blockedA = limiter.check('session-a');
        expect(blockedA.allowed).toBe(false);

        const allowedB = limiter.check('session-b');
        expect(allowedB.allowed).toBe(true);
    });

    test('should reset a specific key', () => {
        limiter = new SlidingWindowRateLimit({ maxRequests: 2, windowMs: 1000 });

        limiter.check('session-1');
        limiter.check('session-1');
        expect(limiter.check('session-1').allowed).toBe(false);

        limiter.reset('session-1');
        expect(limiter.check('session-1').allowed).toBe(true);
    });

    test('should provide correct remaining count', () => {
        limiter = new SlidingWindowRateLimit({ maxRequests: 5, windowMs: 1000 });

        const r1 = limiter.check('s1');
        expect(r1.remaining).toBe(4);

        const r2 = limiter.check('s1');
        expect(r2.remaining).toBe(3);
    });

    test('should provide statistics', () => {
        limiter = new SlidingWindowRateLimit({ maxRequests: 10, windowMs: 60000, precision: 5 });

        limiter.check('a');
        limiter.check('b');

        const stats = limiter.getStats();
        expect(stats.trackedKeys).toBe(2);
        expect(stats.maxRequests).toBe(10);
        expect(stats.windowMs).toBe(60000);
        expect(stats.precision).toBe(5);
    });

    test('should allow requests after window expires', async () => {
        limiter = new SlidingWindowRateLimit({ maxRequests: 1, windowMs: 200 });

        limiter.check('s1');
        expect(limiter.check('s1').allowed).toBe(false);

        await new Promise(resolve => setTimeout(resolve, 300));

        expect(limiter.check('s1').allowed).toBe(true);
    }, 2000);
});

describe('createSlidingWindowRateLimit', () => {
    test('should create middleware that blocks excess requests', async () => {
        const { middleware, cleanup } = createSlidingWindowRateLimit({
            maxRequests: 2,
            windowMs: 1000
        });

        const context = { sessionId: 'test-session', input: '1' };
        let nextCalled = 0;
        const next = async () => { nextCalled++; };

        await middleware(context, next);
        expect(nextCalled).toBe(1);
        expect(context.blocked).toBeFalsy();

        await middleware(context, next);
        expect(nextCalled).toBe(2);

        await middleware(context, next);
        expect(context.blocked).toBe(true);
        expect(context.response).toContain('END');

        cleanup();
    });
});
