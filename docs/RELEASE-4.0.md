# 4.0.0 release evidence

Prepared locally on 2 October 2026 from the Phase 2–4 implementation. This document records validation before publication; hosted CI and registry results belong to the [GitHub release](https://github.com/anthonylimo90/USSD-State-Builder/releases/tag/v4.0.0). It does not establish an application deployment. The major version reflects the getter-only storage contract and compiled builder snapshots; see [migration](MIGRATING-TO-4.md), [support matrix](SUPPORT-MATRIX.md) and [changelog](../CHANGELOG.md).

## Scope

- Provider form adapter, scoped caller/session bindings, atomic turn receipts/replay, deadlines, ownership fencing and explicit external-effect recovery.
- Session-end normalization/reconciliation and Mavuno order-result callbacks.
- Inspectable/versioned flow definitions, retained versions and controlled restart behavior.
- Loopback workbench, declared graphs/diagnostics, redacted traces, synthetic replay and Jest export.
- Repeatable developer onboarding, cohort metrics/reporting, verified Prometheus exposition, actual OpenTelemetry SDK bridge and bounded in-process evidence retention.
- External pilot preparation; participants, feedback and deployments remain unassigned/unverified.
- Performance follow-up: shared storage getter/clock functions, lazy uncontended locks, static target rendering and combined terminal data/receipt writes. [Measured results](PERFORMANCE-4.0.md) retain the original regression and final comparisons.

The npm allowlist includes runtime, types, runnable examples, documentation, verification scripts, benchmarks and MIT license text. It excludes tests/provider capture fixtures, agent configuration, CI configuration, coverage, installed dependencies and generated archives. No new runtime dependency is introduced by this packaging change.

## Local validation

| Gate | Result |
| --- | --- |
| Node 22.21.1 and 24.18.0 full Jest suites | Each: 1,181 passed, 50 opt-in tests skipped; open-handle detection, no forced exit. |
| Four-adapter conformance plus Redis/HTTP integration | 63 passed: 18 conformance and 45 integration. Redis 7, MongoDB 7, PostgreSQL 16 local services. |
| Exact retained 4.0.0 tarball consumers, Node 22/24 | CJS/ESM root and SDK, runtime/declaration value parity, NodeNext/bundler compilation, release inventory and readonly storage contract. |
| Exact retained tarball Mavuno, Node 24 + Redis | HTTP order, terminal receipt replay, new-session lookup, cancellation/stock restoration, synthetic provider end-event acknowledgement and asynchronous result lookup. |
| Disposable-checkout onboarding, Node 24 | Help path, original exported test failure, guide's one-line fix, unchanged test passing, defect reintroduction failing; browser/CLI exports agree. |
| Prometheus 3.5.0 promtool | Baseline, both late corrections, 1,000-turn latency cohort and empty exposition accepted. |
| OpenTelemetry SDK 2.6.0 / API 1.9.0 | Actual gauge correction, deletion/expiry, admission/series bounds and cleanup checks included in the full suites. |
| Strict declarations, ESLint and retention demo | Local checks pass; retention demo on Node 22 and 24. |
| npm advisory audit, production/optional dependency graph | `npm audit --omit=dev --audit-level=high`: zero reported vulnerabilities on this date; not a security certification or development-dependency audit. |

Service-dependent checks run separately from the default suites in the integration/conformance and Prometheus gates above. These are local facts. Node 26 and hosted CI have not been rerun for this release preparation. Local callback fixtures and installed-package HTTP journeys do not establish live provider routing, end-event compatibility or production readiness.

## Compatibility and review findings

**Standards review:** package payload, declarations and teaching docs needed release alignment. The runtime's fixed storage getter now has a matching readonly declaration and consumer compile assertion. The allowlist and inventory gate exclude private/generated material and require migration/evidence/license/demo configuration assets. Migration and support documentation describe the major-version contract. These findings are corrected in this preparation.

**Specification review:** mutating a captured form field after compilation could change its transform despite the flow snapshot contract. Compiled save closures now capture the configured field name/transform; a regression verifies the built application keeps the original behavior. The complete provider walkthrough, actual end-event evidence, independent onboarding/pilots and hosted release checks remain open. Preparation does not close those gates.

User callbacks can still refer to their own mutable external state; snapshot compilation does not freeze application dependencies. Ordinary storage is not a complete-turn transaction. Gateway receipts cannot atomically commit remote side effects; idempotency and reconciliation remain application responsibilities.

## Performance comparison

The completed [performance follow-up](PERFORMANCE-4.0.md) passes the local comparison budget on Node 22/24: no lower per-scenario median throughput and at least 5% geometric-mean gain against 3.0. The final in-memory indices improve 8.8%/7.4%, and the Redis terminal-save flow improves 22.8%/21.8%, respectively. Small per-case differences and RSS remain subject to measurement noise; this is not a production-capacity claim. The original short comparison below is retained as diagnosis evidence before optimization.

The unchanged `benchmarks/benchmark.js` ran on this macOS host with Node 24.18.0. Baseline: annotated tag `v3.0.0`, peeled commit `4dddf1063f398501767a9e9d02f64a4f16bbc1d9`. Candidate: the 4.0 preparation tree including the form transform fix. Three fresh-process runs per version alternated ordering; the final comparison ran after validation jobs completed. Background local services remained running. [Raw samples and medians](release-4.0/benchmark.json) are retained.

| Scenario | 3.0 median operations/s | 4.0 median operations/s | Change |
| --- | ---: | ---: | ---: |
| Simple two-state flow | 315,067 | 292,766 | −7.1% |
| Validated input | 231,871 | 179,294 | −22.7% |
| Ten-state chain | 72,912 | 58,695 | −19.5% |
| Three middlewares | 245,247 | 205,183 | −16.3% |
| Back navigation | 146,143 | 114,218 | −21.8% |
| Multi-field collection | 113,915 | 89,382 | −21.5% |
| 100 concurrent sessions | 3,763 | 2,771 | −26.4% |

The concurrent scenario measures completed batches of 100 sessions per second, not individual session throughput. Before optimization, median end-of-run RSS rose from 125 MB to 147 MB (+17.6%). These short in-memory microbenchmarks were directional regression evidence. The follow-up uses longer isolated scenarios, separate warmup sessions and retained raw samples; the per-instance getter shape and unnecessary per-turn work were corrected. An application-specific latency/memory/concurrency budget remains necessary before production rollout.

## Retained package and repeatable checks

The local artifact is `dist/ussd-state-builder-4.0.0.tgz`; `dist/release-manifest.json` records its file inventory, byte sizes, SHA-256 and npm SHA-512 integrity. Generated archives are ignored by Git. The manifest is outside the tarball to avoid embedding a self-referential checksum.

```bash
mkdir -p dist
npm pack --json --pack-destination dist
USSD_PACKAGE_TARBALL="$PWD/dist/ussd-state-builder-4.0.0.tgz" npm run test:package
REDIS_URL=redis://127.0.0.1:16379 \
  USSD_PACKAGE_TARBALL="$PWD/dist/ussd-state-builder-4.0.0.tgz" npm run test:packed-demo
```

To evaluate from a separate application, install the absolute tarball path with `npm install /absolute/path/to/dist/ussd-state-builder-4.0.0.tgz`. Choose storage before building, pin the application/package version and test active-session retention/restart and rollback. The [migration guide](MIGRATING-TO-4.md) describes session/schema and pending-effect considerations.

## Remaining release decisions

1. Local throughput follow-up passes its benchmark budget; establish application-specific latency, memory and concurrency limits before a production rollout.
2. Run fresh hosted push CI including Node 26 and required package/storage gates against the final commit.
3. Keep P2-01/P2-07 provider claims gated until a real Mavuno order/lookup/cancellation journey and actual end-event evidence are retained. Public synthetic controls and the earlier fixed-menu probe do not establish this.
4. Choose external pilot participants and collect independent setup, repeat-use and owner-permitted deployment evidence. P4-04/P4-05 remain open.
5. When separately authorized to publish, finalize the dated changelog, tag `v4.0.0`, use the existing release-triggered trusted-publishing workflow, then verify registry metadata/integrity, provenance and fresh registry consumers. Prior 3.0 trusted publication does not prove a new 4.0 publication.

## Published release verification — 2026-10-02

- Stable tag `v4.0.0` points to release commit `b05e9cfa74c9a13027f80c3644a49a99f3ec2e44`. [Push CI](https://github.com/anthonylimo90/USSD-State-Builder/actions/runs/37045762194) and [release CI](https://github.com/anthonylimo90/USSD-State-Builder/actions/runs/37045999875) passed the Node 22/24/26, package/type/onboarding/Prometheus, lint, Redis/HTTP, installed Mavuno and four-adapter gates. Trusted npm publication succeeded.
- The [GitHub release](https://github.com/anthonylimo90/USSD-State-Builder/releases/tag/v4.0.0) is stable. [npm 4.0.0](https://www.npmjs.com/package/ussd-state-builder/v/4.0.0) is under `latest`, with registry `gitHead` matching the release commit. Registry tarball SHA-1: `cef706b5d41b2f6acf05d91f3c99721768e624da`. All 155 published files match the validated local file bytes; archive hashes differ because packaging modes differ between hosts.
- A fresh temporary consumer installed `ussd-state-builder@4.0.0` directly from npm. Node 22/24 CJS/ESM root and SDK turns, terminal replay and readonly storage passed. `npm audit signatures` verified the package's registry signature and provenance attestation.
- The downloaded registry tarball passed export/declaration parity, NodeNext/bundler compilation and inventory checks. Its installed Mavuno demo passed HTTP ordering, terminal replay, new-session lookup, cancellation/stock restoration, synthetic provider event acknowledgement and asynchronous result lookup against an isolated Redis prefix; the verification script removed its test keys.
- These publication checks do not close the live provider, external pilot or application deployment boundaries above. The documentation CI step remains a placeholder rather than a site deployment.
