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

    test('should track eviction stats', () => {
        cache.set('a', 1);
        cache.set('b', 2);
        cache.set('c', 3);
        cache.set('d', 4); // evicts 'a'
        cache.set('e', 5); // evicts 'b'

        const stats = cache.getStats();
        expect(stats.evictions).toBe(2);
    });

    test('should report hit rate as percentage', () => {
        cache.set('a', 1);
        cache.get('a'); // hit
        cache.get('a'); // hit
        cache.get('missing'); // miss

        const stats = cache.getStats();
        expect(stats.hitRate).toBe('66.67%');
    });

    test('should report 0% hit rate when no accesses', () => {
        const stats = cache.getStats();
        expect(stats.hitRate).toBe('0%');
    });

    test('should report size and maxSize in stats', () => {
        cache.set('a', 1);
        cache.set('b', 2);

        const stats = cache.getStats();
        expect(stats.size).toBe(2);
        expect(stats.maxSize).toBe(3);
    });

    test('should reset stats on clear', () => {
        cache.set('a', 1);
        cache.get('a');
        cache.get('missing');
        cache.clear();

        const stats = cache.getStats();
        expect(stats.hits).toBe(0);
        expect(stats.misses).toBe(0);
        expect(stats.evictions).toBe(0);
    });

    test('should use default maxSize when no options provided', () => {
        const defaultCache = new LRUCache();
        expect(defaultCache.maxSize).toBe(100);
    });

    test('should support per-item TTL override', async () => {
        const ttlCache = new LRUCache({ maxSize: 10, ttl: 5000 });
        ttlCache.set('short', 'value', 100);
        ttlCache.set('long', 'value');

        await new Promise(resolve => setTimeout(resolve, 150));

        expect(ttlCache.get('short')).toBeUndefined();
        expect(ttlCache.get('long')).toBe('value');
    });

    test('should prune expired entries', async () => {
        const ttlCache = new LRUCache({ maxSize: 10, ttl: 100 });
        ttlCache.set('a', 1);
        ttlCache.set('b', 2);
        ttlCache.set('c', 3);

        await new Promise(resolve => setTimeout(resolve, 150));

        const removed = ttlCache.prune();
        expect(removed).toBe(3);
        expect(ttlCache.size).toBe(0);
    });

    test('should return 0 from prune when no TTL configured', () => {
        cache.set('a', 1);
        cache.set('b', 2);

        const removed = cache.prune();
        expect(removed).toBe(0);
        expect(cache.size).toBe(2);
    });

    test('should not prune non-expired entries', async () => {
        const ttlCache = new LRUCache({ maxSize: 10, ttl: 5000 });
        ttlCache.set('a', 1);
        ttlCache.set('b', 2);

        const removed = ttlCache.prune();
        expect(removed).toBe(0);
        expect(ttlCache.size).toBe(2);
    });

    test('has should return false for expired keys', async () => {
        const ttlCache = new LRUCache({ maxSize: 10, ttl: 100 });
        ttlCache.set('key', 'value');

        expect(ttlCache.has('key')).toBe(true);

        await new Promise(resolve => setTimeout(resolve, 150));

        expect(ttlCache.has('key')).toBe(false);
    });

    test('should return false when deleting non-existent key', () => {
        expect(cache.delete('nonexistent')).toBe(false);
    });

    test('should return true when deleting existing key', () => {
        cache.set('key', 'value');
        expect(cache.delete('key')).toBe(true);
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

    test('should use custom key generator', async () => {
        let callCount = 0;
        const fn = async (obj) => {
            callCount++;
            return obj.value * 2;
        };

        const memoized = memoize(fn, {
            keyGenerator: (obj) => obj.id
        });

        expect(await memoized({ id: 'a', value: 5 })).toBe(10);
        expect(await memoized({ id: 'a', value: 99 })).toBe(10); // same key, cached
        expect(callCount).toBe(1);

        expect(await memoized({ id: 'b', value: 7 })).toBe(14); // different key
        expect(callCount).toBe(2);
    });

    test('should respect TTL option', async () => {
        let callCount = 0;
        const fn = async (x) => {
            callCount++;
            return x * 2;
        };

        const memoized = memoize(fn, { ttl: 100 });

        expect(await memoized(5)).toBe(10);
        expect(callCount).toBe(1);

        await new Promise(resolve => setTimeout(resolve, 150));

        expect(await memoized(5)).toBe(10);
        expect(callCount).toBe(2); // re-computed after TTL
    });

    test('should expose cache property', async () => {
        const fn = async (x) => x;
        const memoized = memoize(fn);

        await memoized(1);
        expect(memoized.cache).toBeInstanceOf(LRUCache);
        expect(memoized.cache.size).toBe(1);
    });

    test('should respect maxSize option', async () => {
        const fn = async (x) => x * 2;
        const memoized = memoize(fn, { maxSize: 2 });

        await memoized(1);
        await memoized(2);
        await memoized(3); // should evict key for arg 1

        expect(memoized.cache.size).toBe(2);
    });

    test('should handle multiple arguments', async () => {
        const fn = async (a, b) => a + b;
        const memoized = memoize(fn);

        expect(await memoized(1, 2)).toBe(3);
        expect(await memoized(3, 4)).toBe(7);
        expect(await memoized(1, 2)).toBe(3);
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

    test('should return undefined for unregistered keys', async () => {
        const loader = new LazyLoader();

        const result = await loader.get('nonexistent');
        expect(result).toBeUndefined();
    });

    test('should clear a specific loaded key', async () => {
        const loader = new LazyLoader();
        let loadCountA = 0;
        let loadCountB = 0;

        loader.register('a', async () => { loadCountA++; return 'A'; });
        loader.register('b', async () => { loadCountB++; return 'B'; });

        await loader.get('a');
        await loader.get('b');

        loader.clear('a');

        expect(loader.isLoaded('a')).toBe(false);
        expect(loader.isLoaded('b')).toBe(true);

        await loader.get('a');
        expect(loadCountA).toBe(2);
        expect(loadCountB).toBe(1);
    });

    test('should clear all loaded keys when no key specified', async () => {
        const loader = new LazyLoader();
        loader.register('a', async () => 'A');
        loader.register('b', async () => 'B');

        await loader.preload(['a', 'b']);
        loader.clear();

        expect(loader.isLoaded('a')).toBe(false);
        expect(loader.isLoaded('b')).toBe(false);
    });

    test('should handle loader that throws an error', async () => {
        const loader = new LazyLoader();
        loader.register('failing', async () => {
            throw new Error('Load failed');
        });

        await expect(loader.get('failing')).rejects.toThrow('Load failed');
        expect(loader.isLoaded('failing')).toBe(false);
    });

    test('should handle synchronous loader functions', async () => {
        const loader = new LazyLoader();
        loader.register('sync', () => 'sync-value');

        const result = await loader.get('sync');
        expect(result).toBe('sync-value');
        expect(loader.isLoaded('sync')).toBe(true);
    });

    test('should return preloaded values from cache', async () => {
        const loader = new LazyLoader();
        let callCount = 0;
        loader.register('data', async () => {
            callCount++;
            return 'loaded-data';
        });

        await loader.preload(['data']);
        const result = await loader.get('data');

        expect(result).toBe('loaded-data');
        expect(callCount).toBe(1);
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

    test('should pass arguments to the debounced function', () => {
        const fn = jest.fn();
        const debounced = debounce(fn, 100);

        debounced('arg1', 'arg2');

        jest.advanceTimersByTime(100);

        expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    });

    test('should reset timer on subsequent calls', () => {
        const fn = jest.fn();
        const debounced = debounce(fn, 100);

        debounced();
        jest.advanceTimersByTime(50);
        debounced(); // reset the timer
        jest.advanceTimersByTime(50);

        expect(fn).not.toHaveBeenCalled();

        jest.advanceTimersByTime(50);

        expect(fn).toHaveBeenCalledTimes(1);
    });

    test('should use the last arguments when called multiple times', () => {
        const fn = jest.fn();
        const debounced = debounce(fn, 100);

        debounced('first');
        debounced('second');
        debounced('third');

        jest.advanceTimersByTime(100);

        expect(fn).toHaveBeenCalledWith('third');
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

    test('should pass arguments to the throttled function', () => {
        const fn = jest.fn();
        const throttled = throttle(fn, 100);

        throttled('hello', 'world');

        expect(fn).toHaveBeenCalledWith('hello', 'world');
    });

    test('should schedule trailing call within throttle window', () => {
        const fn = jest.fn();
        const throttled = throttle(fn, 100);

        throttled('first'); // immediate
        throttled('second'); // scheduled as trailing

        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith('first');

        jest.advanceTimersByTime(100);

        expect(fn).toHaveBeenCalledTimes(2);
        expect(fn).toHaveBeenLastCalledWith('second');
    });

    test('should not schedule multiple trailing calls', () => {
        const fn = jest.fn();
        const throttled = throttle(fn, 100);

        throttled(); // immediate
        throttled(); // schedules trailing
        throttled(); // does not schedule another trailing (timeout exists)

        jest.advanceTimersByTime(100);

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

    test('should flush on maxWait timeout', async () => {
        const processor = jest.fn(async (items) => items.map(i => i * 2));
        const batch = new BatchProcessor(processor, { maxSize: 10, maxWait: 50 });

        const promise = batch.add(1);

        await new Promise(resolve => setTimeout(resolve, 100));

        const result = await promise;
        expect(result).toBe(2);
        expect(processor).toHaveBeenCalledWith([1]);
    });

    test('should propagate processor errors to all items in batch', async () => {
        const error = new Error('Processing failed');
        const processor = jest.fn(async () => { throw error; });
        const batch = new BatchProcessor(processor, { maxSize: 3, maxWait: 100 });

        const promises = [
            batch.add(1),
            batch.add(2),
            batch.add(3)
        ];

        await expect(Promise.all(promises)).rejects.toThrow('Processing failed');
    });

    test('should use default options when none provided', () => {
        const processor = jest.fn();
        const batch = new BatchProcessor(processor);

        expect(batch.maxSize).toBe(10);
        expect(batch.maxWait).toBe(50);
    });

    test('should process multiple batches independently', async () => {
        const processor = jest.fn(async (items) => items.map(i => i * 10));
        const batch = new BatchProcessor(processor, { maxSize: 2, maxWait: 1000 });

        const promise1 = Promise.all([batch.add(1), batch.add(2)]);

        const results1 = await promise1;
        expect(results1).toEqual([10, 20]);

        const promise2 = Promise.all([batch.add(3), batch.add(4)]);
        const results2 = await promise2;
        expect(results2).toEqual([30, 40]);

        expect(processor).toHaveBeenCalledTimes(2);
    });

    test('should handle partial batch when items less than maxSize', async () => {
        const processor = jest.fn(async (items) => items.map(i => i + 1));
        const batch = new BatchProcessor(processor, { maxSize: 5, maxWait: 50 });

        const promise = batch.add(10);

        await new Promise(resolve => setTimeout(resolve, 100));

        const result = await promise;
        expect(result).toBe(11);
        expect(processor).toHaveBeenCalledWith([10]);
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

    test('should return 0 when ending a timer that was not started', () => {
        const monitor = new PerformanceMonitor();

        const duration = monitor.endTimer('nonexistent');
        expect(duration).toBe(0);
    });

    test('should track min and max durations', async () => {
        const monitor = new PerformanceMonitor();

        monitor.startTimer('op');
        await new Promise(resolve => setTimeout(resolve, 10));
        monitor.endTimer('op');

        monitor.startTimer('op');
        monitor.endTimer('op');

        const metrics = monitor.getMetrics('op');
        expect(metrics.min).toBeLessThanOrEqual(metrics.max);
        expect(metrics.count).toBe(2);
    });

    test('should calculate average duration', () => {
        const monitor = new PerformanceMonitor();

        monitor.startTimer('op');
        monitor.endTimer('op');
        monitor.startTimer('op');
        monitor.endTimer('op');

        const metrics = monitor.getMetrics('op');
        expect(metrics.avg).toBe(metrics.total / metrics.count);
    });

    test('should time async function and return result', async () => {
        const monitor = new PerformanceMonitor();

        const result = await monitor.time('async-op', async () => {
            await new Promise(resolve => setTimeout(resolve, 10));
            return 'done';
        });

        expect(result).toBe('done');
        const metrics = monitor.getMetrics('async-op');
        expect(metrics.count).toBe(1);
        expect(metrics.total).toBeGreaterThan(0);
    });

    test('should record timing even when timed function throws', async () => {
        const monitor = new PerformanceMonitor();

        await expect(
            monitor.time('failing-op', async () => {
                throw new Error('Failed');
            })
        ).rejects.toThrow('Failed');

        const metrics = monitor.getMetrics('failing-op');
        expect(metrics.count).toBe(1);
    });

    test('should return null for unknown metric name', () => {
        const monitor = new PerformanceMonitor();

        expect(monitor.getMetrics('unknown')).toBeNull();
    });

    test('should return formatted metrics for all operations', () => {
        const monitor = new PerformanceMonitor();

        monitor.startTimer('op1');
        monitor.endTimer('op1');
        monitor.startTimer('op2');
        monitor.endTimer('op2');

        const allMetrics = monitor.getMetrics();
        expect(allMetrics).toHaveProperty('op1');
        expect(allMetrics).toHaveProperty('op2');
        expect(allMetrics.op1.count).toBe(1);
        expect(allMetrics.op1.avg).toContain('ms');
        expect(allMetrics.op1.min).toContain('ms');
        expect(allMetrics.op1.max).toContain('ms');
        expect(allMetrics.op1.total).toContain('ms');
    });

    test('should reset all metrics and timers', () => {
        const monitor = new PerformanceMonitor();

        monitor.startTimer('op');
        monitor.endTimer('op');

        monitor.reset();

        expect(monitor.getMetrics('op')).toBeNull();
        expect(monitor.getMetrics()).toEqual({});
    });

    test('should return duration in milliseconds from endTimer', async () => {
        const monitor = new PerformanceMonitor();

        monitor.startTimer('timed');
        await new Promise(resolve => setTimeout(resolve, 20));
        const duration = monitor.endTimer('timed');

        expect(typeof duration).toBe('number');
        expect(duration).toBeGreaterThan(0);
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

    test('should cache getData calls', async () => {
        let callCount = 0;
        const storage = {
            getData: async () => { callCount++; return { name: 'John' }; },
            setData: async () => {}
        };

        const cached = createCachedStorage(storage, { ttl: 1000 });

        const data1 = await cached.getData('session1');
        const data2 = await cached.getData('session1');

        expect(data1).toEqual({ name: 'John' });
        expect(data2).toEqual({ name: 'John' });
        expect(callCount).toBe(1);
    });

    test('should invalidate data cache on setData', async () => {
        let callCount = 0;
        const storage = {
            getData: async () => { callCount++; return { name: 'Updated' }; },
            setData: async () => {}
        };

        const cached = createCachedStorage(storage, { ttl: 1000 });

        await cached.getData('session1');
        expect(callCount).toBe(1);

        await cached.setData('session1', { name: 'New' });

        // Cache was invalidated, so this should call storage again
        await cached.getData('session1');
        expect(callCount).toBe(2);
    });

    test('should not cache null state values', async () => {
        let callCount = 0;
        const storage = {
            getState: async () => { callCount++; return null; },
            setState: async () => {}
        };

        const cached = createCachedStorage(storage);

        await cached.getState('session1');
        await cached.getState('session1');

        // Should call storage both times since null is not cached
        expect(callCount).toBe(2);
    });

    test('should not cache null data values', async () => {
        let callCount = 0;
        const storage = {
            getData: async () => { callCount++; return null; },
            setData: async () => {}
        };

        const cached = createCachedStorage(storage);

        await cached.getData('session1');
        await cached.getData('session1');

        expect(callCount).toBe(2);
    });

    test('should invalidate caches on deleteSession', async () => {
        let stateCallCount = 0;
        let dataCallCount = 0;
        const storage = {
            getState: async () => { stateCallCount++; return 'MENU'; },
            setState: async () => {},
            getData: async () => { dataCallCount++; return { key: 'val' }; },
            setData: async () => {},
            deleteSession: async () => {}
        };

        const cached = createCachedStorage(storage, { ttl: 1000 });

        await cached.getState('session1');
        await cached.getData('session1');
        expect(stateCallCount).toBe(1);
        expect(dataCallCount).toBe(1);

        await cached.deleteSession('session1');

        await cached.getState('session1');
        await cached.getData('session1');
        expect(stateCallCount).toBe(2);
        expect(dataCallCount).toBe(2);
    });

    test('should invalidate caches on setSession', async () => {
        let stateCallCount = 0;
        const storage = {
            getState: async () => { stateCallCount++; return 'MENU'; },
            setState: async () => {},
            setSession: async () => {}
        };

        const cached = createCachedStorage(storage, { ttl: 1000 });

        await cached.getState('session1');
        expect(stateCallCount).toBe(1);

        await cached.setSession('session1', { state: 'NEW' });

        await cached.getState('session1');
        expect(stateCallCount).toBe(2);
    });

    test('should expose clearCache and getCacheStats', async () => {
        const storage = {
            getState: async () => 'MENU',
            setState: async () => {}
        };

        const cached = createCachedStorage(storage, { ttl: 1000 });

        await cached.getState('session1');

        const stats = cached.getCacheStats();
        expect(stats.size).toBe(1);
        expect(stats.misses).toBe(1); // first access is a miss in the LRU cache

        cached.clearCache();

        const statsAfterClear = cached.getCacheStats();
        expect(statsAfterClear.size).toBe(0);
        expect(statsAfterClear.hits).toBe(0);
        expect(statsAfterClear.misses).toBe(0);
    });

    test('should pass through getStateHistory to storage', async () => {
        const storage = {
            getStateHistory: jest.fn(async () => ['MENU', 'INPUT']),
        };

        const cached = createCachedStorage(storage);

        const history = await cached.getStateHistory('session1');
        expect(history).toEqual(['MENU', 'INPUT']);
        expect(storage.getStateHistory).toHaveBeenCalledWith('session1');
    });

    test('should pass through pushStateHistory to storage', async () => {
        const storage = {
            pushStateHistory: jest.fn(async () => {}),
        };

        const cached = createCachedStorage(storage);

        await cached.pushStateHistory('session1', 'MENU');
        expect(storage.pushStateHistory).toHaveBeenCalledWith('session1', 'MENU');
    });

    test('should pass through popStateHistory to storage', async () => {
        const storage = {
            popStateHistory: jest.fn(async () => 'MENU'),
        };

        const cached = createCachedStorage(storage);

        const state = await cached.popStateHistory('session1');
        expect(state).toBe('MENU');
        expect(storage.popStateHistory).toHaveBeenCalledWith('session1');
    });

    test('should expose the internal cache object', () => {
        const storage = {
            getState: async () => 'MENU',
            setState: async () => {}
        };

        const cached = createCachedStorage(storage);
        expect(cached.cache).toBeInstanceOf(LRUCache);
    });

    test('should use default options when none provided', () => {
        const storage = {
            getState: async () => 'MENU',
            setState: async () => {}
        };

        const cached = createCachedStorage(storage);
        expect(cached.cache.maxSize).toBe(1000);
    });

    test('should cache state for different sessions independently', async () => {
        let callCount = 0;
        const storage = {
            getState: async (sessionId) => { callCount++; return sessionId === 's1' ? 'MENU' : 'INPUT'; },
            setState: async () => {}
        };

        const cached = createCachedStorage(storage, { ttl: 1000 });

        expect(await cached.getState('s1')).toBe('MENU');
        expect(await cached.getState('s2')).toBe('INPUT');
        expect(await cached.getState('s1')).toBe('MENU');
        expect(await cached.getState('s2')).toBe('INPUT');

        expect(callCount).toBe(2); // only 2 storage calls, rest from cache
    });
});
