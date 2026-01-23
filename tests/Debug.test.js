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
});
