# Support matrix for the prepared 4.0 package

This matrix covers local release preparation on 2 October 2026. See [4.0 release evidence](RELEASE-4.0.md), [migration](MIGRATING-TO-4.md), [package gates](PACKAGE-CI-GATES.md) and [runtime contract](RUNTIME-CONTRACT.md). It does not certify a provider, external deployment or exactly-once external business effects. Historical 3.0 evidence is retained in [RELEASE-3.0.md](RELEASE-3.0.md).

| Area | Verified configuration | Boundary |
| --- | --- | --- |
| Node.js | Full local suites on 22.21.1 and 24.18.0; Node 22 remains the package minimum | Node 26 is configured in hosted CI but not rerun locally for this package; fresh hosted checks are still required before publication. |
| Package | Exact 4.0.0 tarball, CJS/ESM root and `/sdk`, declaration parity, NodeNext/bundler TypeScript consumers | Local artifact validation; no 4.0 registry install, tag or provenance claim. |
| InMemoryStorage | Unit and four-adapter conformance | Development/tests; no process restart durability or cross-worker persistence. |
| RedisStorage | Redis 7 local conformance, multi-client lock/encryption checks and Redis/HTTP Mavuno | Ordinary adapter calls do not make a complete turn atomic. |
| MongoDBStorage | MongoDB 7 / optional v6 driver conformance | Expired reads filtered; helper transactions do not cover every adapter call; no Mongo-backed atomic TurnGateway receipt store. |
| PostgreSQLStorage | PostgreSQL 16 / optional v8 driver conformance | Single-statement history/data operations; no PostgreSQL-backed atomic TurnGateway receipt store. |
| TurnGateway + RedisTurnStore | Raw RedisStorage, staged turn preparation, atomic session/receipt commit, pending ownership, fencing and confirmed-effect recovery | Opt-in path only; storage wrappers are not supported by RedisTurnStore. Cannot atomically commit external effects. |
| TurnGateway + InMemoryTurnStore | In-process receipt replay and staged snapshots with InMemoryStorage | Not a durable production journal and not a multi-worker store. |
| Africa's Talking form adapter | Synthetic normalization/response/deadline/binding tests, packed Mavuno callbacks; earlier fixed-menu provider probe | Full Mavuno provider journey and actual end-event compatibility remain open. Saved URL/public control does not prove provider routing or authentication. |
| Local workbench / replay | SDK/traditional inspection, bounded redacted history, declared graphs, synthetic replay/Jest export; repeatable onboarding gate | Loopback developer tool; trusted factories/fake effects, no secure execution sandbox or public multi-tenant service. Independent-developer onboarding evidence is still pending. |
| Cohort metrics | Golden synthetic cohort, Prometheus promtool 3.5.0, actual OpenTelemetry SDK 2.6.0 gauge correction/deletion checks | Application-supplied event correlation and SDK; no automatically installed durable collector or verified external backend. |
| MetricEventBuffer | Bounded in-process retention, local deletion, static label rosters and one physical export slot | Lazy pruning; pseudonyms remain linkable; pending/caller/backend copies need separate cancellation, fencing and deletion. |
| Mavuno demo | Installed-package HTTP order/replay/new-session lookup/cancel/stock restoration and synthetic asynchronous results | No payments or fulfillment. Real provider deployment, language/network limits and origin assurance require separate evidence. |

4.0 keeps completed END responses replayable until session expiry. Opt-in versioned sessions preserve original definitions or return a controlled restart; they do not migrate application data. Fixed storage and builder snapshots require the migration steps above. Benchmarks in the release evidence are local microbenchmarks, not provider latency/capacity measurements. Use application-specific idempotency and reconciliation for external effects.
