# 4.0 performance follow-up

The optimized 4.0 tree improves the local benchmark index over 3.0 on both maintained runtimes and reduces the Redis terminal-save workload's round trips. This is local engineering evidence, not a live-provider or production-capacity claim.

## Causes and changes

The prepared release at `38244ba` created an own storage getter closure per machine. A V8 `%HaveSameMap` diagnostic on Node 24 returned false for two original machines and true for two optimized machines; their getter identities likewise changed from distinct to shared. The shared-getter-only ablation improved several short workloads by 15–31%, while bypassing staged storage itself yielded only small gains. The fix shares the getter function and keeps AsyncLocalStorage staging, fixed storage and retained-flow isolation intact.

Uncontended locks no longer allocate an unused promise, release closure and waiter set or add an acquisition await. Waiters are created only on contention; queued cancellation and shared-adapter serialization remain enforced. Default clock functions are shared without capturing Date.now, so injected clocks and later Date.now replacement still work.

Disabled debug calls avoid constructing unused payloads. Back navigation skips empty afterProcess dispatch but still checks newly registered hooks at dispatch time. Static SDK target messages avoid an unnecessary asynchronous resolver; custom target handlers remain awaited. Pure write helpers return the storage promise directly.

When no afterProcess hook exists, a terminal handler's data and completion receipt share one setData call. Middleware that reads the saved data keeps the prior data-before-hook order, including when it changes END to CON. Reserved flow metadata and replay receipts remain protected, and handler data is not mutated. This combines one data write; it does not make ordinary state/history/data updates or external effects a complete-turn transaction.

## Measurement method and budget

The initial [short benchmark](release-4.0/benchmark.json) recorded a 7–26% regression. Those runs were useful diagnosis signals, but low warmup, reused warmup session IDs and garbage collection from earlier retained workloads made individual results noisy. The new comparator runs the same seven flow definitions and input sequences through the same harness for all sources. Warmup uses separate session IDs; each measured scenario runs in a fresh process. Memory scenarios use ten times the default iterations and up to 2,000 warmup sessions. Seven samples per source/scenario rotate source order.

The three sources are 3.0 (`v3.0.0`, peeled commit `4dddf1063f398501767a9e9d02f64a4f16bbc1d9`), the original prepared 4.0 (`38244bae94384110a4d8fa19fd894937b6831a89`) and the optimized working tree. Reports retain commit IDs, library/harness SHA-256 fingerprints, parameters and every sample. Final artifact validation checks the optimized runtime; fingerprints identify the measured code even though its final commit is created afterward.

The local budget is no lower per-scenario median throughput than 3.0 plus at least 5% geometric-mean gain across the suite. The initial 5%-per-scenario aspiration is not achieved in every case; small positive differences can be within measurement noise. The geometric mean is an equally weighted comparison index, not aggregate sessions/second or a workload-specific SLA. Hosted CI does not assert these timings on shared runners.

## In-memory results

| Same workload | Node 22.21.1 vs 3.0 | Node 24.18.0 vs 3.0 |
| --- | ---: | ---: |
| Simple 2-state flow | +5.3% | +6.7% |
| Validated input flow | +6.6% | +1.2% |
| Deep 10-state chain | +10.0% | +10.8% |
| With 3 middlewares | +3.8% | +5.0% |
| Back navigation flow | +12.8% | +10.2% |
| Multi-field data collection | +4.8% | +0.7% |
| 100 concurrent sessions | +19.5% | +18.3% |

The geometric-mean gains are **8.8% on Node 22** and **7.4% on Node 24**; both budgets pass. The original prepared release fails the same comparison: its geometric-mean index is about 19% below 3.0 on both runtimes. The concurrent scenario counts completed batches of 100 sessions, not individual turns.

Median end-of-scenario RSS changes range from −2.9% to +3.8% on Node 22 and −10.5% to +10.5% on Node 24. RSS varies with allocation/GC and includes new library features; this work does not establish a universal memory reduction, peak RSS or a retained-heap bound. Sub-millisecond printed percentiles are rounded, so tiny latency differences are not interpreted as precise gains.

Raw evidence: [Node 22](release-4.0/performance/memory-node22.json), [Node 24](release-4.0/performance/memory-node24.json).

## Redis results

A synthetic, unversioned SDK flow renders a numeric field then saves `42` and ends. Redis 7 runs on loopback. Each source has a disposable prefix, 100 warmup sessions and 900 measured two-turn sessions; nine samples rotate source order. The same installed Redis driver and server are used for every source. Cleanup deletes only that process's exact keys. Saved data and terminal replay are asserted outside the timed section. This measures ordinary RedisStorage turns, not gateway receipt or Mavuno provider latency.

| Runtime | 3.0 scenarios/s | Optimized 4.0 scenarios/s | Gain |
| --- | ---: | ---: | ---: |
| Node 22 | 518 | 636 | +22.8% |
| Node 24 | 514 | 626 | +21.8% |

Both Redis budgets pass. A regression test demonstrates one terminal data/receipt setData call instead of two; in the ordinary Redis adapter this removes one data-read/hash-write/expiry sequence. It does not bypass expiry, distributed locking, cancellation or external-effect checks.

The first 300-session samples were noisy: Node 22 showed only +3.9% and failed the 5% budget, while Node 24 showed +22.0%. Both runtimes then used the longer fixed protocol above. Those earlier samples remain available: [Node 22 preflight](release-4.0/performance/redis-node22-preflight.json), [Node 24 preflight](release-4.0/performance/redis-node24-preflight.json). No samples from the final protocol were dropped.

Final evidence: [Node 22](release-4.0/performance/redis-node22.json), [Node 24](release-4.0/performance/redis-node24.json).

## Repeat the comparison

Use this Git checkout with the comparison refs present and a quiet host. These commands execute trusted repository code and temporarily archive refs; they do not push or publish. Do not use production Redis for benchmarks.

```bash
mkdir -p dist
npm run benchmark:compare -- --baseline=v3.0.0 --reference=38244ba --runs=7 --scale=10 --output=dist/performance-memory.json
REDIS_URL=redis://127.0.0.1:16379 npm run benchmark:compare -- --suite=redis --baseline=v3.0.0 --reference=38244ba --runs=9 --scale=3 --output=dist/performance-redis.json
```

Select the intended Node binary before each run. The command exits nonzero if the median-based budget fails; investigate rather than discarding samples or relaxing the budget to fit a result. Fresh hosted functional CI, application-specific concurrency/latency/memory budgets, real provider evidence and deployment checks remain separate gates.
