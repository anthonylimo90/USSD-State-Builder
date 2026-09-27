# 3.0.0-rc.1 release-candidate evidence

Prepared on 27 September 2026 from Phase 1 work after v2.7.0. This file records candidate evidence; it is not a publication record. The [migration guide](MIGRATING-TO-3.md), [support matrix](SUPPORT-MATRIX.md), and [changelog](../CHANGELOG.md) describe the contract and boundaries.

## Functional gates

- Unit suite: 912 passed, 20 skipped with open-handle detection.
- Redis/HTTP integration: 15 passed, including Mavuno order, restart, lookup, cancellation, validation, back navigation, and a final-stock race.
- Packed consumer: CommonJS and ESM root/SDK imports, declaration parity, NodeNext and bundler TypeScript compilation passed.
- Packed Mavuno: installed the `3.0.0-rc.1` tarball into a temporary consumer with its Redis dependency; placed an order over HTTP, replayed the terminal response, looked up and cancelled the order in a new session, and observed stock restoration. The test used an isolated Redis prefix and removed its keys.
- Lint and strict declaration checks passed. [Hosted CI for candidate commit `4d1d59c`](https://github.com/anthonylimo90/USSD-State-Builder/actions/runs/36338651164) passed Node 22/24/26 tests, package/types/lint, Redis/HTTP, the packed Mavuno gate, and four-adapter conformance. The npm publish job was skipped.

## Performance comparison

The unchanged `benchmarks/benchmark.js` was run four times per version, alternating order, on this macOS host with Node 24.18.0. The baseline was the local `v2.7.0` tag and the candidate was this checkout. These are in-memory microbenchmarks, not Redis or provider latency measurements. Representative ranges:

| Scenario | v2.7.0 ops/sec | 3.0.0-rc.1 ops/sec |
| --- | ---: | ---: |
| Simple two-state flow | 254k–266k | 169k–174k |
| Validated input flow | 232k–237k | 149k–156k |
| Back navigation | 121k–122k | 80k–83k |
| 100 concurrent sessions | 4.3k–4.4k | 1.7k–2.1k |

End-of-process RSS was 106–107 MB for v2.7.0 and 138–155 MB for the candidate. Heap-used readings varied substantially with garbage-collection timing, so RSS is only a directional signal. The runtime now persists static initial sessions and terminal responses and performs additional lifecycle work; these measurements do not isolate the exact cause of the change. No acceptable regression budget was agreed before this comparison. Treat the performance difference as an open release decision and measure a representative Redis/gateway workload before making a throughput or memory claim.

## Publication boundary

The candidate passed hosted CI and is ready for application compatibility review. Before tagging or publishing, decide whether the observed performance cost is acceptable or needs optimization; repeat the candidate gates at the final commit; test active-session drain and rollback in the adopting application. Tagging, npm publication, and documentation deployment are separate release actions. The current documentation CI job is a placeholder and does not deploy a site.
