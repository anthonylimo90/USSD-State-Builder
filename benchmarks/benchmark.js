/**
 * USSD State Machine Benchmark Suite
 *
 * Measures throughput and latency for different configurations.
 * Run: node benchmarks/benchmark.js
 */

const { createApp } = require('../lib/sdk');
const InMemoryStorage = require('../lib/InMemoryStorage');

class BenchmarkRunner {
    constructor() {
        this.results = [];
    }

    async run(name, fn, iterations = 10000) {
        // Warmup
        for (let i = 0; i < Math.min(100, iterations / 10); i++) {
            await fn(i);
        }

        // Actual benchmark
        const times = [];
        const startTotal = process.hrtime.bigint();

        for (let i = 0; i < iterations; i++) {
            const start = process.hrtime.bigint();
            await fn(i);
            const end = process.hrtime.bigint();
            times.push(Number(end - start) / 1e6); // Convert to ms
        }

        const endTotal = process.hrtime.bigint();
        const totalMs = Number(endTotal - startTotal) / 1e6;

        times.sort((a, b) => a - b);

        const result = {
            name,
            iterations,
            totalMs: Math.round(totalMs),
            opsPerSec: Math.round(iterations / (totalMs / 1000)),
            avgMs: (times.reduce((a, b) => a + b, 0) / times.length).toFixed(3),
            p50Ms: times[Math.floor(times.length * 0.5)].toFixed(3),
            p95Ms: times[Math.floor(times.length * 0.95)].toFixed(3),
            p99Ms: times[Math.floor(times.length * 0.99)].toFixed(3),
            minMs: times[0].toFixed(3),
            maxMs: times[times.length - 1].toFixed(3)
        };

        this.results.push(result);
        return result;
    }

    printResults() {
        console.log('\n' + '='.repeat(90));
        console.log('USSD State Machine Benchmark Results');
        console.log('='.repeat(90));
        console.log(
            'Benchmark'.padEnd(35),
            'ops/sec'.padStart(10),
            'avg'.padStart(10),
            'p50'.padStart(10),
            'p95'.padStart(10),
            'p99'.padStart(10)
        );
        console.log('-'.repeat(90));

        for (const r of this.results) {
            console.log(
                r.name.padEnd(35),
                String(r.opsPerSec).padStart(10),
                `${r.avgMs}ms`.padStart(10),
                `${r.p50Ms}ms`.padStart(10),
                `${r.p95Ms}ms`.padStart(10),
                `${r.p99Ms}ms`.padStart(10)
            );
        }

        console.log('='.repeat(90));
    }
}

async function main() {
    const bench = new BenchmarkRunner();

    // === Benchmark 1: Simple state machine processing ===
    const simpleApp = createApp()
        .state('welcome', s => s
            .message('Welcome\n1. Next')
            .on('1').goto('menu')
        )
        .state('menu', s => s
            .message('Menu\n1. Option A')
            .on('1').end('Done')
        )
        .start('welcome')
        .logger(null)
        .build();

    await bench.run('Simple 2-state flow', async (i) => {
        const sid = `bench-simple-${i}`;
        await simpleApp.processInput(sid, '');
        await simpleApp.processInput(sid, '1');
    });

    // === Benchmark 2: State machine with validation ===
    const validatedApp = createApp()
        .state('input', s => s
            .message('Enter number:')
            .validate(input => {
                if (input && isNaN(parseInt(input))) throw new Error('Invalid');
            })
            .save('number')
            .next('done')
        )
        .state('done', s => s.message('OK').end())
        .start('input')
        .logger(null)
        .build();

    await bench.run('Validated input flow', async (i) => {
        const sid = `bench-valid-${i}`;
        await validatedApp.processInput(sid, '');
        await validatedApp.processInput(sid, '42');
    });

    // === Benchmark 3: Deep state chain (10 states) ===
    const deepBuilder = createApp();
    for (let j = 0; j < 10; j++) {
        const stateName = `state_${j}`;
        const nextState = j < 9 ? `state_${j + 1}` : null;
        deepBuilder.state(stateName, s => {
            s.message(`State ${j}\n1. Next`);
            if (nextState) {
                s.on('1').goto(nextState);
            } else {
                s.on('1').end('Complete');
            }
        });
    }
    const deepApp = deepBuilder.start('state_0').logger(null).build();

    await bench.run('Deep 10-state chain', async (i) => {
        const sid = `bench-deep-${i}`;
        await deepApp.processInput(sid, '');
        for (let j = 0; j < 10; j++) {
            await deepApp.processInput(sid, '1');
        }
    }, 1000);

    // === Benchmark 4: Middleware overhead ===
    const mwApp = createApp()
        .state('welcome', s => s
            .message('Welcome\n1. Next')
            .on('1').end('Done')
        )
        .start('welcome')
        .logger(null)
        .sanitize({ maxLength: 160, trim: true })
        .rateLimit({ maxRequests: 100000, windowMs: 60000 })
        .metrics()
        .build();

    await bench.run('With 3 middlewares', async (i) => {
        const sid = `bench-mw-${i}`;
        await mwApp.processInput(sid, '');
        await mwApp.processInput(sid, '1');
    });

    // === Benchmark 5: Back navigation ===
    const backApp = createApp()
        .state('s1', s => s.message('S1\n1. Next').on('1').goto('s2'))
        .state('s2', s => s.message('S2\n1. Next\n0. Back').on('1').goto('s3'))
        .state('s3', s => s.message('S3\n0. Back').on('1').end('Done'))
        .start('s1')
        .backNavigation(true)
        .logger(null)
        .build();

    await bench.run('Back navigation flow', async (i) => {
        const sid = `bench-back-${i}`;
        await backApp.processInput(sid, '');
        await backApp.processInput(sid, '1'); // -> s2
        await backApp.processInput(sid, '1'); // -> s3
        await backApp.processInput(sid, '0'); // back to s2
        await backApp.processInput(sid, '1'); // -> s3 again
    }, 2000);

    // === Benchmark 6: Session data operations ===
    const dataApp = createApp()
        .state('name', s => s.message('Name:').save('name').next('phone'))
        .state('phone', s => s.message('Phone:').save('phone').next('email'))
        .state('email', s => s.message('Email:').save('email').next('done'))
        .state('done', s => s
            .run(async (input, sid, ctx) => {
                return `${ctx.sessionData.name}, ${ctx.sessionData.phone}, ${ctx.sessionData.email}`;
            })
            .end()
        )
        .start('name')
        .logger(null)
        .build();

    await bench.run('Multi-field data collection', async (i) => {
        const sid = `bench-data-${i}`;
        await dataApp.processInput(sid, '');
        await dataApp.processInput(sid, 'John');
        await dataApp.processInput(sid, '254712345678');
        await dataApp.processInput(sid, 'john@example.com');
    }, 2000);

    // === Benchmark 7: Concurrent sessions ===
    const concurrentApp = createApp()
        .state('welcome', s => s.message('Welcome\n1. Go').on('1').end('Done'))
        .start('welcome')
        .logger(null)
        .build();

    await bench.run('100 concurrent sessions', async (i) => {
        const promises = [];
        for (let j = 0; j < 100; j++) {
            const sid = `bench-conc-${i}-${j}`;
            promises.push(
                concurrentApp.processInput(sid, '').then(() =>
                    concurrentApp.processInput(sid, '1')
                )
            );
        }
        await Promise.all(promises);
    }, 100);

    // Print results
    bench.printResults();

    // Memory usage
    const mem = process.memoryUsage();
    console.log('\nMemory Usage:');
    console.log(`  RSS: ${Math.round(mem.rss / 1024 / 1024)}MB`);
    console.log(`  Heap Used: ${Math.round(mem.heapUsed / 1024 / 1024)}MB`);
    console.log(`  Heap Total: ${Math.round(mem.heapTotal / 1024 / 1024)}MB`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
