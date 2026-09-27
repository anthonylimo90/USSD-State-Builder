# 3.0.0-rc.1 release-candidate evidence

Prepared on 27 September 2026 from Phase 1 work after v2.7.0. This file records candidate evidence; it is not a publication record. The [migration guide](MIGRATING-TO-3.md), [support matrix](SUPPORT-MATRIX.md), and [changelog](../CHANGELOG.md) describe the contract and boundaries.

## Functional gates

- Unit suite: 914 passed, 20 skipped with open-handle detection after P1-08.
- Redis/HTTP integration: 15 passed, including Mavuno order, restart, lookup, cancellation, validation, back navigation, and a final-stock race.
- Packed consumer: CommonJS and ESM root/SDK imports, declaration parity, NodeNext and bundler TypeScript compilation passed.
- Packed Mavuno: installed the `3.0.0-rc.1` tarball into a temporary consumer with its Redis dependency; placed an order over HTTP, replayed the terminal response, looked up and cancelled the order in a new session, and observed stock restoration. The test used an isolated Redis prefix and removed its keys.
- Lint and strict declaration checks passed. [Hosted CI for optimized candidate commit `220fb87`](https://github.com/anthonylimo90/USSD-State-Builder/actions/runs/36340339892) passed Node 22/24/26 tests, package/types/lint, Redis/HTTP, the packed Mavuno gate, and four-adapter conformance. The npm publish job was skipped.

## Performance comparison

The unchanged `benchmarks/benchmark.js` was run four times per version, alternating order, on this macOS host with Node 24.18.0. The baseline was the local `v2.7.0` tag and the candidate was the first P1-07 commit (`4d1d59c`). These are in-memory microbenchmarks, not Redis or provider latency measurements. Representative ranges before P1-08:

| Scenario | v2.7.0 ops/sec | 3.0.0-rc.1 ops/sec |
| --- | ---: | ---: |
| Simple two-state flow | 254k–266k | 169k–174k |
| Validated input flow | 232k–237k | 149k–156k |
| Back navigation | 121k–122k | 80k–83k |
| 100 concurrent sessions | 4.3k–4.4k | 1.7k–2.1k |

End-of-process RSS was 106–107 MB for v2.7.0 and 138–155 MB for the first candidate. Heap-used readings varied substantially with garbage-collection timing, so RSS is only a directional signal.

P1-08 reproduced the regression with a three-run red/green comparison and a smaller static-turn probe. Targeted ablation showed that empty lifecycle dispatch, unnecessary session reads, and no-op middleware calls contributed avoidable async work. The engine now skips those paths when no hook is registered, skips turn timing when there is no observer, and relies on the terminal-response write to refresh TTL for an existing completed session. Hooks added after earlier turns and storage changes made by `beforeProcess` remain visible; focused tests cover those cases.

After the optimization, seven alternating runs of the unchanged in-memory benchmark gave these median values on the same Node 24.18.0 host:

| Scenario | v2.7.0 | First candidate | Optimized candidate |
| --- | ---: | ---: | ---: |
| Simple two-state flow, ops/sec | 264k | 172k | 322k |
| 100 concurrent sessions, batches/sec | 4.48k | 2.07k | 3.68k |
| End-of-process RSS | 107 MB | 141 MB | 126 MB |

An isolated Redis probe ran 100 batches of ten concurrent sessions per version, each with an initial and terminal turn, using separate prefixes that were removed afterward. Across five alternating runs, median throughput was 11.3k turns/sec for v2.7.0, 7.2k for the first candidate, and 10.2k for the optimized candidate. The baseline had one cold run at 7.1k; these short local measurements are directional and are not a provider or production capacity claim.

The remaining in-memory throughput and RSS difference is partly the cost of retaining static initial sessions and terminal responses, which v2.7.0 did not do reliably. No acceptable regression budget was agreed before this comparison. A representative gateway workload and application-specific latency budget remain a rollout decision; do not make a general throughput or memory promise from these microbenchmarks.

## Publication boundary

The optimized candidate passed hosted CI. Before tagging or publishing, agree an application-specific performance budget and test active-session drain and rollback in the adopting application. Tagging, npm publication, and documentation deployment are separate release actions. The current documentation CI job is a placeholder and does not deploy a site.
