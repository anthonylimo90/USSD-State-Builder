# Support matrix for the 3.0 release candidate

This matrix describes the checks completed on 27 September 2026. It is evidence for a release candidate, not a promise of provider-level exactly-once processing. The [CI gate](PACKAGE-CI-GATES.md) and [storage conformance audit](STORAGE-CONFORMANCE.md) contain the commands and limits.

| Area | Verified configuration | Boundary |
| --- | --- | --- |
| Node.js | Candidate CI unit suite on 22, 24, and 26; packed CommonJS/ESM and TypeScript consumers on 22 and 24 | Node 22 is the minimum; other lines are not in the maintained matrix. |
| Package | npm tarball installed in an isolated consumer; root and `/sdk` imports; NodeNext and bundler declarations; packed Mavuno HTTP order and cancellation | Repeat these gates for the final commit before publication. |
| InMemory | Unit conformance | Development and tests; sessions do not survive restart or move between workers. |
| Redis | Integration conformance, Redis/HTTP Mavuno flow, and two-client lock/encryption checks | Session persistence and TTL are verified; complete turns are not atomic. A lease without commit fencing can be lost. |
| MongoDB | Integration conformance with the optional v6 driver | Expired reads are filtered; transaction helper does not wrap all adapter operations. |
| PostgreSQL | Integration conformance with the optional v8 driver | History pop and JSONB data merge use single statements; complete turns are not atomic. |
| HTTP demo | Mavuno order, restart, lookup, cancellation, validation, back navigation, and final-stock race | Local simulation, not a telecom provider integration or payment/fulfillment system. |

The current engine treats a completed `END` as a stored terminal response for the same session until expiry. Gateway request identity, durable per-turn receipts, stale-lease fencing, provider callbacks, and crash recovery remain Phase 2 work. Do not describe the current adapters or wrappers as providing exactly-once business effects. Use application-specific idempotency and reconciliation for external effects.

Before rolling out a new candidate, test your own gateway and adapter combinations, confirm active-session migration behavior, and compare latency and memory against the version you currently run on the same workload. No performance regression budget or provider certification is claimed here.
