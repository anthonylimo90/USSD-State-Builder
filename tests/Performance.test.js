const {
    LRUCache,
    memoize,
    LazyLoader,
    debounce,
    throttle,
    BatchProcessor,
    PerformanceMonitor,
    createCachedStorage
} = require('../lib/Performance');

describe('LRUCache', () => {
    let cache;

    beforeEach(() => {
        cache = new LRUCache({ maxSize: 3 });
    });

    test('should store and retrieve values', () => {
        cache.set('key1', 'value1');
        expect(cache.get('key1')).toBe('value1');
    });

    test('should return undefined for missing keys', () => {
        expect(cache.get('missing')).toBeUndefined();
    });

    test('should evict oldest entry when full', () => {
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);
        cache.set('d', 4); // This should evict 'a'

        expect(cache.get('a')).toBeUndefined();
        expect(cache.get('d')).toBe(4);
    });

    test('should update LRU order on get', () => {
        cache.set('a', 1);
        cache.set('b', 2);
        cache.get('a'); // Access 'a', making 'b' oldest
        cache.set('c', 3);
        cache.set('d', 4); // Should evict 'b', not 'a'

        expect(cache.get('a')).toBe(1);
        expect(cache.get('b')).toBeUndefined();
    });

    test('should respect TTL', async () => {
        const ttlCache = new LRUCache({ maxSize: 10, ttl: 100 });
        ttlCache.set('key', 'value');

        expect(ttlCache.get('key')).toBe('value');

        await new Promise(resolve => setTimeout(resolve, 150));

        expect(ttlCache.get('key')).toBeUndefined();
    });

    test('should track cache stats', () => {
        cache.set('a', 1);
        cache.get('a'); // hit
        cache.get('b'); // miss

        const stats = cache.getStats();
        expect(stats.hits).toBe(1);
        expect(stats.misses).toBe(1);
    });

    test('should check if key exists', () => {
        cache.set('exists', true);
        expect(cache.has('exists')).toBe(true);
        expect(cache.has('missing')).toBe(false);
    });

    test('should delete keys', () => {
        cache.set('key', 'value');
        cache.delete('key');
        expect(cache.has('key')).toBe(false);
    });

    test('should clear all entries', () => {
        cache.set('a', 1);
        cache.set('b', 2);
        cache.clear();
        expect(cache.size).toBe(0);
    });
});

describe('memoize', () => {
    test('should cache function results', async () => {
        let callCount = 0;
        const fn = async (x) => {
            callCount++;
            return x * 2;
        };

        const memoized = memoize(fn);

        expect(await memoized(5)).toBe(10);
        expect(await memoized(5)).toBe(10);
        expect(callCount).toBe(1); // Only called once
    });

    test('should cache different arguments separately', async () => {
        const fn = async (x) => x * 2;
        const memoized = memoize(fn);

        expect(await memoized(5)).toBe(10);
        expect(await memoized(10)).toBe(20);
    });

    test('should allow clearing cache', async () => {
        let callCount = 0;
        const fn = async () => ++callCount;
        const memoized = memoize(fn);

        await memoized();
        await memoized();
        memoized.clear();
        await memoized();

        expect(callCount).toBe(2);
    });
});

describe('LazyLoader', () => {
    test('should load on first access', async () => {
        const loader = new LazyLoader();
        let loadCount = 0;

        loader.register('config', async () => {
            loadCount++;
            return { value: 'loaded' };
        });

        const result1 = await loader.get('config');
        const result2 = await loader.get('config');

        expect(result1.value).toBe('loaded');
        expect(result2.value).toBe('loaded');
        expect(loadCount).toBe(1);
    });

    test('should check if loaded', async () => {
        const loader = new LazyLoader();
        loader.register('lazy', async () => 'value');

        expect(loader.isLoaded('lazy')).toBe(false);
        await loader.get('lazy');
        expect(loader.isLoaded('lazy')).toBe(true);
    });

    test('should preload multiple keys', async () => {
        const loader = new LazyLoader();
        loader.register('a', async () => 'A');
        loader.register('b', async () => 'B');

        await loader.preload(['a', 'b']);

        expect(loader.isLoaded('a')).toBe(true);
        expect(loader.isLoaded('b')).toBe(true);
    });
});

describe('debounce', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('should delay execution', () => {
        const fn = jest.fn();
        const debounced = debounce(fn, 100);

        debounced();
        debounced();
        debounced();

        expect(fn).not.toHaveBeenCalled();

        jest.advanceTimersByTime(100);

        expect(fn).toHaveBeenCalledTimes(1);
    });
});

describe('throttle', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('should limit execution rate', () => {
        const fn = jest.fn();
        const throttled = throttle(fn, 100);

        throttled(); // Execute immediately
        throttled(); // Ignored (within window)
        throttled(); // Ignored (within window)

        expect(fn).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(100);
        throttled(); // Execute after window

        expect(fn).toHaveBeenCalledTimes(2);
    });
});

describe('BatchProcessor', () => {
    test('should batch items together', async () => {
        const processor = jest.fn(async (items) => items.map(i => i * 2));
        const batch = new BatchProcessor(processor, { maxSize: 3, maxWait: 100 });

        const results = await Promise.all([
            batch.add(1),
            batch.add(2),
            batch.add(3)
        ]);

        expect(results).toEqual([2, 4, 6]);
        expect(processor).toHaveBeenCalledWith([1, 2, 3]);
    });
});

describe('PerformanceMonitor', () => {
    test('should track timing', () => {
        const monitor = new PerformanceMonitor();

        monitor.startTimer('test');
        monitor.endTimer('test');

        const metrics = monitor.getMetrics('test');
        expect(metrics.count).toBe(1);
    });

    test('should aggregate multiple timings', async () => {
        const monitor = new PerformanceMonitor();

        for (let i = 0; i < 3; i++) {
            monitor.startTimer('op');
            monitor.endTimer('op');
        }

        const metrics = monitor.getMetrics('op');
        expect(metrics.count).toBe(3);
    });
});

describe('createCachedStorage', () => {
    test('should cache getState calls', async () => {
        let callCount = 0;
        const storage = {
            getState: async () => { callCount++; return 'MENU'; },
            setState: async () => { }
        };

        const cached = createCachedStorage(storage, { ttl: 1000 });

        await cached.getState('session1');
        await cached.getState('session1');

        expect(callCount).toBe(1);
    });

    test('should invalidate cache on setState', async () => {
        let state = 'MENU';
        const storage = {
            getState: async () => state,
            setState: async (_, s) => { state = s; }
        };

        const cached = createCachedStorage(storage);

        await cached.getState('session1');
        await cached.setState('session1', 'CONFIRM', 300);

        // setState updates cache
        expect(await cached.getState('session1')).toBe('CONFIRM');
    });
});
