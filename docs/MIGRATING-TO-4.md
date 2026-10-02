# Migrating from 3.0 to 4.0

4.0 packages the provider gateway, local workbench/replay and cohort reporting introduced after 3.0. Node 22 remains the minimum. CommonJS/ESM root and `/sdk` entrypoints remain available. This is a major version because compiled machines now have fixed storage and snapshot declarations; callers that mutate a built machine's adapter or builder need to change their setup. Read the [release evidence and limits](RELEASE-4.0.md) before deployment.

## Choose storage before constructing the machine

`machine.storage` is a getter with no setter. Assignment throws in strict JavaScript and is ignored in non-strict JavaScript; TypeScript now marks it readonly. During an opt-in prepared gateway turn, that getter can expose staged storage for that turn. Do not assign it or replace private `_baseStorage`/lock fields.

```js
const { createApp, InMemoryStorage } = require('ussd-state-builder');
const storage = new InMemoryStorage();
const machine = createApp().storage(storage)
  .state('START', state => state.message('Welcome'))
  .build();
// To use another adapter, construct another machine with .storage(otherAdapter).
```

Traditional callers pass `storage` in `new USSDStateMachine({ ...config, storage })`. Build encrypted/locked wrappers first, then supply the finished adapter. Retained flow versions must share the same storage object. New machines sharing an adapter also share local session locks; concurrency that previously bypassed serialization across machine objects now waits on the same session.

Do not switch an active service's adapter by rebuilding blindly. Stop ingress/drain the application, choose whether to retain or end active sessions, migrate app-owned data if needed, construct the new machines and validate before routing traffic. Changing adapters does not copy sessions, orders or receipts automatically. Rolling back to 3.0 after writing gateway receipts or versioned session data requires an application-owned compatibility plan; do not delete uncertain pending effects to make an old runtime proceed.

## Build again after editing declarations

Routes, messages, form field transforms and metadata used to compile a flow retain their configured values. Editing the builder afterward does not reconfigure an existing machine. Finish the form inside its configurator callback, then build. To change behavior, create/build another flow and deploy it deliberately. A callback's own mutable external dependencies are application code and are not deep-frozen or sandboxed.

`FlowDiagram` uses SDK declarations instead of inspecting handler text. Diagram snapshots and terminal/unknown flags can change; regenerate stored diagrams. Arbitrary handlers and dynamic menus remain partial/unknown unless accurately annotated. [Flow definitions](FLOW-DEFINITIONS.md) describe traditional fallback inference, sensitivity and opt-in session versions.

## Opt into new runtime features deliberately

- Existing `processInput()` applications continue to use ordinary storage semantics. Complete-turn atomicity is an opt-in `TurnGateway` + supported `RedisTurnStore` or `InMemoryTurnStore` path, not a new property of every storage adapter. The Redis gateway requires raw RedisStorage, not lock/encryption wrappers. See [gateway receipts](TURN-RECEIPTS.md).
- Provider HTTP form normalization requires explicit service/application/input mode. Deadlines, caller bindings and transcript checks do not establish provider origin. External effects still need application-owned idempotency, journals and reconciliation. See [adapter](AFRICAS-TALKING-ADAPTER.md) and [recovery](DEADLINES-AND-RECOVERY.md).
- Flow versioning reserves `__ussdFlow` session metadata. Enabling versions against active unversioned sessions causes a controlled END restart; it does not migrate them. Retain original versions where appropriate. Observers may see the new `flow_restart` outcome; update exhaustive switches.
- Runtime turn observations retain existing fields and add structural fields. The versioned trace projection is separately opt-in and excludes raw input/response/session/error data. Do not treat generated observation IDs as authoritative metric session/turn correlation.
- Workbench and replay are local developer tools. Replay requires authored synthetic inputs, ordered fake effects and trusted application factories. Captured-redacted drafts cannot execute until unresolved placeholders are replaced. This is deterministic test execution, not secure isolation of untrusted code.
- Cohort metrics are a separate opt-in event/report contract. They do not install a durable collector, auto-correlate runtime/provider events or replace legacy metric counters. Retention is local/lazy; remote deletion remains application-owned. A real OpenTelemetry SDK is supplied by the application; the legacy JSON collector is not the SDK bridge.

## Verify your application

Run the package consumers, your existing flow tests, active-session upgrade/restart cases and the Mavuno installed-tarball checks against the exact artifact. Compare your own latency/memory and test the configured provider, language and response budgets. The complete Mavuno provider walkthrough and independent pilots remain unverified; local package tests do not close those gates. [Support matrix](SUPPORT-MATRIX.md) distinguishes verified runtime/storage combinations.
