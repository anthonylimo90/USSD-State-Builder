# USSD State Builder: implementation and product plan

Status: implementation underway; see [delivery task list](TASKS.md) for current progress.
Prepared: 27 September 2026.
Review baseline: `8ee06ca`, package version `2.7.0`.

## 1. Direction and intended users

Build a dependable toolkit for developing, deploying, debugging, and improving real USSD services. Keep the fluent JavaScript SDK as the primary authoring interface, with verified TypeScript consumption and the traditional state-machine API supported.

The initial audience is developers delivering ordering, registration, account-service, and other structured workflows through USSD. Their first success should be a working, inspectable application connected to a gateway sandbox. Their continuing benefit should be predictable behavior under retries, changing data, expired sessions, restarts, and multiple application instances.

Working product assumptions:

- The open-source toolkit comes first. A hosted workbench or analytics service is a later commercial hypothesis.
- Redis is the first fully verified deployment path. Other advertised adapters retain support, with clearly documented and tested capabilities.
- Africa's Talking is the first gateway integration. Additional providers must be justified by user demand.
- Mavuno Co-op is the reference application and end-to-end acceptance fixture. It remains a simulated ordering service without payment or fulfillment.
- Prefer improving existing modules over adding overlapping abstractions or rewriting the project in TypeScript.

## 2. Baseline and evidence

The repository already includes the fluent SDK, forms, dynamic menus, validation, middleware, four storage adapters, encryption, locking, metrics exporters, diagrams, a CLI simulator, testing helpers, framework examples, and a browser ordering demo.

The 27 September review ran 888 passing unit tests and 15 passing Redis/HTTP integration tests against local Redis. This establishes a local baseline, not live telecom validation or proof of MongoDB/PostgreSQL behavior.

Confirmed reproductions to turn into regression tests:

| ID | Finding | Relevant implementation | Required regression |
| --- | --- | --- | --- |
| R1 | A dynamic menu entered through `.goto()` loses the target handler's returned data; selection can refetch and choose an item different from the displayed item. | `lib/sdk/compiler.js`, `lib/sdk/DynamicMenuBuilder.js` | Change the fetch result between display and selection; the original displayed item must be selected. |
| R2 | State `.onEnter()` and `.onExit()` callbacks are stored by the compiler but not invoked by the engine. Middleware session-start, state-change, and session-end hooks are also not emitted. | `lib/USSDStateMachine.js`, `lib/sdk/compiler.js`, `lib/Middleware.js` | Assert documented callback ordering on initial entry, forward transition, back navigation, completion, and explicit termination. |
| R3 | The dynamic menu's default `0. Refresh` conflicts with enabled back navigation; pressing it navigates back. | `lib/sdk/DynamicMenuBuilder.js`, `lib/USSDStateMachine.js` | Validate reserved-key conflicts and prove the displayed action matches the executed action. |
| R4 | Prometheus histogram export cumulatively adds buckets that were already cumulative. One observation can generate bucket counts greater than the total. | `lib/MetricsExporter.js` | One 3 ms observation with boundaries 5/10/25 produces counts 1/1/1 and total 1; also cover multiple labels and observations. |
| R5 | Diagram generation searches handler source strings and misses explicit transitions in compiled SDK handlers. | `lib/FlowDiagram.js`, `lib/sdk/compiler.js` | A two-state SDK flow renders its declared edge without inspecting function source. |

Additional areas requiring investigation, not yet established as complete defects: atomic state/data/history updates, distributed lock loss, storage expiry parity, response deadline behavior, webhook recovery after restart, and package/type compatibility.

## 3. Scope boundaries

Include reliable runtime semantics, one gateway, local developer tools, shared trace/event contracts, and useful operational measurements.

Defer visual drag-and-drop authoring, arbitrary hosted code execution, payment processing, multi-channel bots, AI-generated flows, a plugin marketplace, and more storage adapters. Reconsider these only when a pilot exposes a specific need.

A USSD session and a business operation are separate lifecycles. An order or payment can outlive a handset session. A callback must not imply that an expired handset session can be resumed; any provider-specific resume capability requires separate verification.

## 4. Architecture and behavior contracts

### 4.1 Preserve an explicit flow definition

Have the SDK compiler retain a versioned, inspectable definition containing state IDs, the initial state, declared routes, terminal markers, form relationships, navigation keys, and declared field sensitivity. Runtime functions remain local code references; the exported definition is metadata, not an executable serialization format.

Use this definition for validation, diagrams, simulator navigation, and trace interpretation. Mark transitions returned by arbitrary handlers as dynamic or unknown unless the author declares them. Do not invent a complete graph from source-string matching.

Provide additive metadata support for the traditional API. Existing applications without metadata can run, while inspection clearly reports incomplete coverage.

### 4.2 Define the turn lifecycle

Before changing behavior, write a contract covering:

1. Request validation and normalization at the gateway boundary.
2. Session acquisition, duplicate detection, and expiry checks.
3. Middleware, input validation, and handler execution.
4. Rendering the destination and preserving its returned data.
5. Committing state, session data, history, revision, and replay response.
6. Lifecycle notification, completion handling, and final response delivery.

Define precisely where state hooks and global hooks run, which may veto processing, and which are post-commit notifications. Test hook failures explicitly: a notification failure must not cause an already committed business action to run again.

Distinguish rendering from business effects. Initial display, back navigation, replay, and inspection must not accidentally repeat checkout or another external mutation. Preserve existing `.run()` usage through an explicit compatibility path; introduce separate render/action APIs only if the contract cannot be made clear with existing APIs.

### 4.3 Make session lifecycle explicit

Define active, completed, expired, and explicitly terminated outcomes. Create the session on the initial request, including static menus. Decide and document inactivity refresh behavior for invalid input and replies that remain in the same state.

Retain a bounded terminal receipt for duplicate-response replay, independently from active session data. Completed sessions must not silently reopen when the same gateway session ID is retried. Emit app-observed completion separately from provider-confirmed session termination.

Record a flow version with each session. Prefer serving active sessions with their original compatible definition during a deployment. If that definition is unavailable, return a controlled restart response rather than executing an unrelated state. Do not attempt arbitrary automatic migration of in-flight sessions.

### 4.4 Storage guarantees and concurrency

Document capabilities for expiry, partial data merge, deletion/replacement of fields, atomic turn commit, revision checks, and distributed ownership. Avoid assuming that a per-process mutex protects requests across instances.

For the supported Redis gateway path, commit the session revision and duplicate-response receipt atomically. Use ownership/revision checks so a worker that loses its lease cannot commit stale session results. Add a conformance suite for all storage adapters and wrappers; new required capabilities need a migration path for custom adapters.

External effects cannot be made exactly-once by a Redis lock. Expose stable business-operation idempotency keys and document application responsibilities. If a worker crashes after an external effect but before recording its result, recovery must consult an operation receipt or reconcile the outcome; it must not blindly repeat the effect.

### 4.5 Gateway and instrumentation boundaries

Keep provider parsing separate from the state-machine engine. Introduce a normalized request containing provider, service scope, session ID, caller identity, input, transcript or sequence information where supplied, request identity, and timing information. Exact public names are decided in the gateway design task.

Use one versioned event schema across runtime instrumentation, the workbench, and analytics. Include flow version, request/turn ID, previous and next state, outcome, timings, and error classification. Raw inputs, phone numbers, PINs, and arbitrary session data are excluded from telemetry by default. Redaction must also cover responses, exceptions, and exported fixtures.

## 5. Delivery phases and work packages

Every work package below is intended to become a focused issue or small PR. IDs are local planning identifiers, not existing tracker issues. Role labels describe responsibility, not assigned people.

### Phase 1 — Reliability and release confidence

Outcome: the advertised SDK features behave consistently when combined.

| ID | Deliverable | Acceptance criteria | Depends on |
| --- | --- | --- | --- |
| P1-01 | Characterization and runtime contract | Reproduce R1–R4 in focused tests; document lifecycle ordering, session completion, rendering/effect rules, navigation precedence, and compatibility impact. | Review baseline |
| P1-02 | SDK transition and menu fixes | Preserve destination data for `.goto()`, `.next()`, and back rendering; maintain displayed menu snapshots; isolate snapshots by state; clear stale internal selection data explicitly; reject malformed selection values and navigation-key collisions. Test changing catalogs, forms, pagination, refresh, and return navigation together. | P1-01 |
| P1-03 | Lifecycle integration | State and middleware hooks execute in the documented order; initial entry, same-state replies, forward/back moves, validation failures, `END`, explicit termination, and hook errors have verified behavior. Document newly activated callbacks as a compatibility consideration. | P1-01 |
| P1-04 | Correct instrumentation | Fix R4; test metrics through actual SDK requests, including success, validation failure, thrown error, and back navigation. Measure the whole turn rather than only a middleware callback. Avoid double counting. | P1-01, P1-03 |
| P1-05 | Adapter conformance and lease audit | Run a shared suite against InMemory, Redis, MongoDB, and PostgreSQL: expiry on read, TTL refresh, merge semantics, history, deletion, and restart behavior. Test encryption/locking composition and two independent workers. Document unsupported atomic capabilities. | P1-01 |
| P1-06 | Package and CI gates | Test packed CJS/ESM root and SDK imports; compile TypeScript consumers using NodeNext and bundler resolution; verify declaration/export parity. Use reproducible installs, maintained Node release lines, actual linting, and resource cleanup checks without relying on forced exit. | None |
| P1-07 | Documentation and compatibility release | Update README, production/security guides, examples, changelog, and support matrix. Replace unsupported blanket production claims with verified configurations. Run Mavuno against the packed release candidate. | P1-02 through P1-06 |

Phase exit gate:

- Every reproduced issue in scope has a regression test that fails on the baseline and passes on the fix.
- Existing unit and Redis/HTTP integration suites pass; adapter support claims match conformance evidence.
- A clean consumer project can install the packed candidate and run the documented SDK examples.
- No unexplained open handles or new input/response leakage in tested logging paths.
- Release notes identify behavior changes. If lifecycle activation or session semantics break existing applications, use an opt-in transition or a major version; do not force everything into a patch release.

### Phase 2 — Gateway-ready reference deployment

Outcome: a developer can connect Mavuno to Africa's Talking's sandbox through a supported integration.

| ID | Deliverable | Acceptance criteria | Depends on |
| --- | --- | --- | --- |
| P2-01 | Provider contract and captured fixtures | Verify current provider request format, input accumulation, termination events, authentication/network controls, response encoding and length, timeout rules, and retry behavior. Record sources and sanitized sandbox samples. Clearly mark provider/country-specific behavior. | P1 contract |
| P2-02 | Shared flow metadata and session version | Preserve the explicit SDK definition; add stable flow-version configuration and compatibility checks; correct R5. Known SDK routes render accurately; unknown dynamic routes are labeled. Existing traditional flows remain usable. | P1-02, P1-03 |
| P2-03 | Provider adapter | Normalize requests and distinguish incremental input from cumulative transcripts. Validate service/session scope and caller binding. Produce correct response content type and provider error behavior. Keep the adapter usable without requiring a specific HTTP framework. | P2-01 |
| P2-04 | Atomic turn receipts and replay | Same request returns the recorded response without rerunning the handler, including across workers and restarts. Repeated identical user choices at different transcript positions remain distinct turns. Reject or safely resolve stale, conflicting, or out-of-order requests. Atomically commit session revision and receipt; define receipt expiry. | P1-05, P2-01, P2-03 |
| P2-05 | Deadlines and effect recovery | Propagate an abort signal and a configured deadline through handlers and clients that support cancellation. Lock waits consume the same request budget. A timed-out or lease-lost worker cannot commit stale state. Demonstrate effect idempotency and crash reconciliation with a fake external service. A promise timeout alone is not accepted as cancellation. | P2-04 |
| P2-06 | Session termination and async callbacks | Reconcile duplicate/out-of-order provider end events. Test webhook receipt after restart and after session expiry; persist operation results independently of handset sessions. New sessions can retrieve completed business results through an application-authorized lookup. | P2-04, P2-05 |
| P2-07 | Starter and sandbox walkthrough | Provide one reproducible Redis-backed starter, environment example, health/readiness checks, drain/shutdown behavior, configuration guide, and troubleshooting path. Use provider-specific output budgets, including multilingual text. Run the complete Mavuno journey in the sandbox and retain a redacted evidence checklist. | P2-02 through P2-06 |

Phase exit gate:

- Fixture tests cover initial input, cumulative input, malformed payloads, duplicates, late requests, deadlines, provider termination, and output limits.
- Two-worker/restart tests prove the supported replay and commit guarantees, including a crash between effect execution and response persistence.
- The documented sandbox walkthrough is completed with actual provider traffic; local fixtures alone do not satisfy this gate.
- Scope deployment evidence precisely: sandbox success is not a live short-code launch. Live rollout follows provider provisioning and an explicit launch decision.

External dependency: a suitable Africa's Talking sandbox account and reachable callback endpoint. Complete all local contract, adapter, and fixture work before this dependency becomes the remaining blocker.

### Phase 3 — Local developer workbench

Outcome: developers can inspect a flow, reproduce a failure, and turn it into a test without a telecom connection.

| ID | Deliverable | Acceptance criteria | Depends on |
| --- | --- | --- | --- |
| P3-01 | Versioned trace and fixture schema | Implement the shared event schema, redaction rules, size bounds, and a fixture format for time, external responses, and synthetic data. Clearly distinguish synthetic replay from reproduction using captured dependencies. | P1-04, P2-02 |
| P3-02 | Reusable local workbench | Extract a generic keypad/session interface from Mavuno. Show current state, permitted state/data details, history, validation errors, and turn timing. Support reset, multiple isolated sessions, and the existing CLI/testing utilities. | P3-01 |
| P3-03 | Accurate graph and flow diagnostics | Render declared transitions from metadata; identify unreachable states, missing targets, dead ends, and conflicting navigation keys. Treat intentionally dynamic transitions as incomplete analysis, not errors. | P2-02 |
| P3-04 | Replay and test export | Export a failing session as a runnable `USSDTester`/Jest scenario. Inject deterministic time and fake external effects. Exported redacted inputs become explicit synthetic placeholders where exact replay is impossible. Tests fail when the reproduced defect is reintroduced. | P3-01, P3-02 |
| P3-05 | Developer onboarding | Provide a documented startup command and a walkthrough: create flow, inspect transition, simulate failure, export test, fix it. Check keyboard accessibility and narrow layouts. | P3-02 through P3-04 |

Phase exit gate:

- A developer unfamiliar with the internals can complete the walkthrough from a fresh checkout.
- The workbench binds locally by default, does not expose production secrets, and never sends real business effects during replay.
- SDK and traditional flows indicate the same actual runtime state; incomplete metadata is visible.
- Exported regression scenarios run in CI without the workbench UI.

### Phase 4 — Operational insight and external pilots

Outcome: application owners can explain completion and failure patterns, and external usage informs the next investment.

| ID | Deliverable | Acceptance criteria | Depends on |
| --- | --- | --- | --- |
| P4-01 | Metric definitions and event aggregation | Specify request, turn, session, and business-outcome grains. Deduplicate by stable IDs; support late provider events. Define completion, cancellation, expiry, abandonment inference, validation retries, and errors with explicit denominators. | P2-06, P3-01 |
| P4-02 | Useful exports and reference dashboard | Provide completion and drop-off by flow version/state, validation retries, backend errors, and p50/p95/p99 turn latency where sample sizes permit. Mark unknown outcomes and inferred abandonment. Verify Prometheus output and implement a tested OpenTelemetry integration before claiming one. | P4-01 |
| P4-03 | Retention and observability controls | Bound queues/buffers, document telemetry failure behavior, configure retention and deletion, and verify redaction. Keep phone/session/request IDs out of metric labels to avoid unbounded cardinality. | P4-01 |
| P4-04 | External pilot program | Recruit an initial target of 2–3 independent developers/teams; record setup time, blocked steps, production requirements, and repeat usage. Assist one real deployment if provisioning and the owner permit it. Separate developer feedback from commercial commitments. | P2-07; P3 workbench desirable |
| P4-05 | Product decision | Review pilot evidence and choose: deepen the SDK, offer hosted inspection/analytics, or address a proven provider/vertical need. Record the decision and reasons for deferring alternatives. | P4-02 through P4-04 |

Phase exit gate:

- A known synthetic dataset yields independently checked metric totals and funnels, including retries and late termination events.
- Owners can trace a reported drop-off or latency issue to the corresponding redacted flow evidence.
- Pilot feedback identifies repeated problems, rather than relying on repository activity or feature count as demand evidence.
- Hosted services require an explicit product decision. Multi-tenancy, access control, data handling, operating costs, and pricing are scoped at that point.

## 6. Dependency order and release policy

Critical path: runtime contract → SDK/lifecycle fixes → storage and package gates → gateway contract → replay/deadlines → sandbox walkthrough → pilots → commercial decision.

Flow metadata and trace design can begin once the runtime contract is settled. Workbench development can proceed alongside the final gateway walkthrough. Correct telemetry comes before analytics. Do not block an independently useful reliability release on a hosted product or a fully built workbench.

Use release milestones rather than preassigning version numbers. P1 can split into a compatible defect-fix release and a separately versioned behavior change. P2–P4 should remain additive wherever possible. Any storage interface, Node minimum, or lifecycle compatibility break receives migration notes and the appropriate version increment.

No calendar commitment is made until maintainers and capacity are assigned. At the end of P1-01, estimate the remaining Phase 1 issues; at each subsequent gate, estimate the next phase using actual throughput and unresolved dependencies.

## 7. Validation and release checklist

For each implementation PR:

- Link its work-package ID and state the observable behavior change.
- Add focused tests for the failure or boundary being changed, particularly combinations of features.
- Run affected tests, then the complete required suite before release; preserve unrelated work.
- Check public exports and declarations when API changes are involved.
- Update the example or documentation that teaches the affected behavior.

For each release candidate:

- Run unit, adapter conformance, Redis/HTTP, consumer-package, and type checks in CI.
- Test selected crash, lease-loss, duplicate, and deadline cases on the supported gateway path once available.
- Run the reference flow from the packed artifact; verify installation instructions from a clean consumer directory.
- Compare representative latency and memory results with the previous release using the same environment and workload. Establish a measured regression budget before making performance claims.
- Publish a compatibility matrix and explicit evidence boundaries; tag, publish, and deploy only as separately authorized release work.
- Document rollback: application version pinning, compatible session schema/flow versions, and handling in-flight sessions. Keep schema changes backward-readable where practical; never discard sessions as an implicit migration strategy.

## 8. Success measures

These are proposed measurement goals, not current baselines or commercial promises.

| Area | Measure | Initial decision rule |
| --- | --- | --- |
| Reliability | Regression coverage for R1–R5 and replay/crash invariants | No known blocker in the supported reference path at its release gate. |
| First use | Time from clean install to first valid response; then to sandbox success | Record pilot baselines and remove the most frequent blocked step before expanding provider scope. |
| Debugging | Time to reproduce a failure and export a passing regression test | Compare the workbench workflow with manual reproduction on the same task. |
| Operations | Completion/outcome coverage, latency distributions, validation retries | Totals reconcile against fixtures; inferred or missing outcomes remain visible. |
| Adoption | Independent applications, repeat use, support burden | Seek 2–3 independent pilots before prioritizing a hosted offering. Downloads alone are insufficient. |
| Commercial demand | Repeated requests for a hosted capability and willingness to pay | Scope a paid pilot only after a specific problem and buyer are evidenced. |

## 9. Risks and decisions to resolve

| Risk or decision | Default / mitigation | Resolve by |
| --- | --- | --- |
| Activating previously inert callbacks changes application behavior | Characterize existing usage; document callback ordering and failures; stage compatibility changes explicitly. | P1-01 |
| Menu snapshots become stale | Preserve what was displayed for selection; revalidate business availability at commit time and return a clear correction if it changed. | P1-02 |
| Custom adapters cannot provide atomic turns | Publish a capability contract and degrade only with explicit configuration; never advertise distributed guarantees for unsupported adapters. | P1-05 / P2-04 |
| Request identity differs by provider | Base deduplication on verified provider identity or transcript position, not input value alone. | P2-01 |
| Timeout leaves work running | Cooperative cancellation plus revision/ownership checks; application effect idempotency and reconciliation. | P2-05 |
| Flow changes break active sessions | Explicit versions and controlled compatibility/restart policy. | P2-02 |
| Sensitive inputs leak through logs, traces, responses, or fixtures | Default exclusions, field sensitivity, bounded local inspection, and leak tests. | P3-01 |
| Missing provider events distort completion | Separate observed completion, provider closure, inferred expiry/abandonment, and unknown outcomes. | P4-01 |
| Maintenance breadth exceeds capacity | Finish the Redis/provider reference path first; keep other capability claims evidence-based. | Every phase gate |
| Hosted tooling adds operations before demand exists | Start with local tools and exports; require pilot evidence for hosting investment. | P4-05 |

## 10. Immediate execution queue

1. Create P1-01 regression fixtures and write the lifecycle/navigation contract.
2. Implement P1-02, beginning with the wrong-item selection reproduction.
3. Implement P1-03 against the agreed contract, keeping behavior changes explicit.
4. Fix the histogram and verify end-to-end middleware measurements in P1-04.
5. Complete P1-05/P1-06 storage and distribution gates.
6. Review the compatibility impact, update documentation, and prepare the first release candidate.

Planning is complete when the scope, sequence, acceptance criteria, and unresolved decisions are recorded here. Implementation completion requires the phase evidence above; an item is not complete merely because its module or test configuration exists.

## References

- [Project README](../README.md), [existing improvement checklist](../IMPROVEMENTS.md), and [production guide](PRODUCTION.md).
- [Mavuno Co-op reference application](../examples/live-market/README.md).
- [Africa's Talking: going live and callback/event URLs](https://help.africastalking.com/en/articles/9915125-how-do-i-go-live-with-ussd).
- [Africa's Talking: Kenyan USSD session duration guidance](https://help.africastalking.com/en/articles/1284071-what-is-the-duration-of-a-ussd-session-for-kenyan-telcos). Reverify provider-specific limits during P2-01; do not generalize these values to all deployments.
- [Prometheus metric types](https://prometheus.io/docs/concepts/metric_types/).
- [Node.js release lifecycle](https://nodejs.org/en/about/previous-releases). Confirm supported versions when implementing P1-06.
