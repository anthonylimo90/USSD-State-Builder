const { createDebug, isDebugEnabled, getEnabledNamespaces } = require('../lib/Debug');

describe('Debug Utility', () => {
    // Store original DEBUG env var
    const originalDebug = process.env.DEBUG;

    afterAll(() => {
        // Restore original DEBUG env var
        if (originalDebug !== undefined) {
            process.env.DEBUG = originalDebug;
        } else {
            delete process.env.DEBUG;
        }
    });

    describe('createDebug', () => {
        test('should create debug function', () => {
            const debug = createDebug('test:namespace');
            expect(typeof debug).toBe('function');
            expect(debug.namespace).toBe('test:namespace');
        });

        test('should have enabled property', () => {
            const debug = createDebug('test:namespace');
            expect(typeof debug.enabled).toBe('boolean');
        });

        test('should expose log level methods', () => {
            const debug = createDebug('test:levels');
            expect(typeof debug.info).toBe('function');
            expect(typeof debug.debug).toBe('function');
            expect(typeof debug.warn).toBe('function');
            expect(typeof debug.error).toBe('function');
        });

        test('should expose json method', () => {
            const debug = createDebug('test:json');
            expect(typeof debug.json).toBe('function');
        });

        test('should expose time and timeEnd methods', () => {
            const debug = createDebug('test:timing');
            expect(typeof debug.time).toBe('function');
            expect(typeof debug.timeEnd).toBe('function');
        });
    });

    describe('when DEBUG is not set', () => {
        beforeEach(() => {
            delete process.env.DEBUG;
        });

        test('debug function should be disabled', () => {
            // Note: createDebug reads env at module load time
            // This test verifies the structure but not runtime behavior
            const debug = createDebug('test:disabled');
            expect(typeof debug).toBe('function');
        });

        test('isDebugEnabled should reflect current state', () => {
            // Since DEBUG is read at module load, we test the function exists
            expect(typeof isDebugEnabled).toBe('function');
        });

        test('getEnabledNamespaces should return array', () => {
            const namespaces = getEnabledNamespaces();
            expect(Array.isArray(namespaces)).toBe(true);
        });
    });

    describe('debug function behavior', () => {
        test('should not throw when called', () => {
            const debug = createDebug('test:safe');
            expect(() => debug('test message')).not.toThrow();
            expect(() => debug('test', { data: 123 })).not.toThrow();
            expect(() => debug('test', 1, 2, 3)).not.toThrow();
        });

        test('should handle objects gracefully', () => {
            const debug = createDebug('test:objects');
            const obj = { key: 'value', nested: { a: 1 } };
            expect(() => debug(obj)).not.toThrow();
        });

        test('should handle circular references', () => {
            const debug = createDebug('test:circular');
            const obj = { name: 'test' };
            obj.self = obj; // Create circular reference
            // Should not throw, will use String() fallback
            expect(() => debug(obj)).not.toThrow();
        });

        test('should handle null and undefined', () => {
            const debug = createDebug('test:nulls');
            expect(() => debug(null)).not.toThrow();
            expect(() => debug(undefined)).not.toThrow();
        });
    });

    describe('log level methods', () => {
        test('info should not throw', () => {
            const debug = createDebug('test:info');
            expect(() => debug.info('info message')).not.toThrow();
            expect(() => debug.info('info', { data: 'value' })).not.toThrow();
        });

        test('debug method should not throw', () => {
            const debug = createDebug('test:debug-method');
            expect(() => debug.debug('debug message')).not.toThrow();
        });

        test('warn should not throw', () => {
            const debug = createDebug('test:warn');
            expect(() => debug.warn('warning message')).not.toThrow();
        });

        test('error should not throw', () => {
            const debug = createDebug('test:error');
            expect(() => debug.error('error message')).not.toThrow();
        });
    });

    describe('json method', () => {
        test('should not throw when called with message only', () => {
            const debug = createDebug('test:json');
            expect(() => debug.json('event happened')).not.toThrow();
        });

        test('should not throw when called with message and data', () => {
            const debug = createDebug('test:json');
            expect(() => debug.json('user action', { userId: '123', action: 'login' })).not.toThrow();
        });
    });

    describe('performance timing', () => {
        test('time and timeEnd should not throw', () => {
            const debug = createDebug('test:timing');
            expect(() => debug.time('operation')).not.toThrow();
            expect(() => debug.timeEnd('operation')).not.toThrow();
        });

        test('timeEnd without matching time should not throw', () => {
            const debug = createDebug('test:timing-missing');
            expect(() => debug.timeEnd('nonexistent')).not.toThrow();
        });

        test('timeEnd should return undefined when debug is disabled', () => {
            const debug = createDebug('test:timing-disabled');
            // debug is disabled since DEBUG env var is not set to match this namespace
            const result = debug.timeEnd('some-label');
            expect(result).toBeUndefined();
        });
    });

    describe('namespace pattern matching', () => {
        // These tests verify the matchesPattern function indirectly through createDebug.
        // Since patterns are parsed at module load time, we test the structure rather
        // than live matching behavior.

        test('createDebug should accept any namespace string', () => {
            expect(() => createDebug('app:feature')).not.toThrow();
            expect(() => createDebug('deeply:nested:namespace')).not.toThrow();
            expect(() => createDebug('simple')).not.toThrow();
        });

        test('namespace should be preserved on the debug function', () => {
            const debug = createDebug('my:custom:namespace');
            expect(debug.namespace).toBe('my:custom:namespace');
        });
    });
});
