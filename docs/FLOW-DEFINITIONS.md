# Flow definitions and session versions

The SDK keeps a snapshot of state declarations when `.build()` runs. `machine.getFlowDefinition()` returns a fresh JSON-compatible copy containing schema version 1, the initial state, state IDs, routes, default next edges, terminal markers, local input controls, back navigation, form relationships and declared field sensitivity. It contains no handlers, validators, prompts, response text or session values. Changing a builder after building does not change the compiled flow.

`FlowDiagram` and `StateInspector` share this definition. SDK routes are rendered directly, including reply loops and terminal routes; they do not require handler source inspection. Arbitrary `.run()` handlers and dynamic menus have unknown behavior, so their graphs show **Dynamic transitions** and report partial coverage. Their explicit routes and menu controls remain available. A complete definition describes declared behavior; it does not prove reachability or validate a custom handler's claims. [Graph diagnostics](LOCAL-WORKBENCH.md#graph-and-diagnostics) follow declared paths from the initial state, flag structural issues, and keep unknown dynamic paths explicit. They cannot validate a custom handler's claims.

Traditional configurations continue to work. Add `metadata` to individual state configurations to declare `{ terminal, dynamic, transitions, field, form }`. Unannotated traditional flows report partial coverage; their historical diagram heuristic remains available as `transitionSource: 'inferred'`. Annotated graphs use declarations and leave unknown edges unknown. SDK custom handlers may use `.metadata(...)` to supply the same declarations. Set `dynamic: false` only when the declaration covers every possible transition.

Declare data sensitivity with `.save('phone').sensitivity('sensitive')` or form `field.prompt('PIN').sensitivity('secret')`. Supported levels are `unspecified`, `public`, `sensitive`, and `secret`. These are metadata declarations for future trace/redaction tools; they do not encrypt data or redact existing logging. Form transforms retain the declared field name in the definition.

## Opt into versioned sessions

```javascript
const { createApp, InMemoryStorage } = require('ussd-state-builder');
const storage = new InMemoryStorage();
const original = createApp().flowVersion('orders-v1').storage(storage)
  .state('home', s => s.message('Order').on('1').goto('done'))
  .state('done', s => s.message('Order received').end()).build();

const current = createApp().flowVersion('orders-v2', {
  previousFlows: [original],
  restartResponse: 'END Our service has changed. Please dial again.'
}).storage(storage)
  .state('home', s => s.message('New order menu')).build();
```

Traditional constructors accept `flowVersion`, `previousFlows`, and `restartResponse` as configuration options. Versions are explicit non-empty strings of at most 128 characters. They are not inferred from function text. Change the version when incompatible states, routing, validation, data shape, or effects change. Reusing a version promises compatibility; the library cannot verify that promise from metadata.

The first accepted turn pins `__ussdFlow.version` in session data before validators and handlers execute. This key is reserved; handler results and `setSessionData()` cannot replace it. Middleware-blocked new sessions are not pinned. Versioning is optional: applications with no versions keep their existing runtime behavior.

Before executing a versioned session, the entrypoint selects its original retained machine. Retained machines must have distinct versions and use the **same storage object** as the entrypoint. They retain their own handlers, validators, middleware, navigation, timeout and lifecycle hooks. The entrypoint's turn observers observe the request once. Selection reuses the existing session lock rather than acquiring a nested lock. Each worker must load the versions it intends to retain, using its own shared storage/lock wrapper. Local locks are shared by machines using the same storage object; cross-worker serialization still requires a distributed lock manager.

If the original version is unavailable, the default response is:

```text
END This service has changed. Please dial again to restart.
```

The runtime records this terminal receipt and preserves existing state/data. Further requests replay the receipt. A new provider session ID, normal expiry, or explicit `endSession()` permits a new session. The runtime does not migrate data automatically. When enabling versions, existing active unversioned sessions also receive this controlled restart; reverting to an unversioned configuration cannot silently resume a pinned session. Already completed terminal responses remain replayable across versions.

Version checks run before state lookup, middleware, validators and handlers. Reserved-key protection applies to library data-write APIs; writing directly to the storage adapter bypasses it. This feature does not make multi-write turns atomic, deduplicate provider requests, or prevent partial external effects; those are P2-04/P2-05.

## Validation

`tests/FlowDefinition.test.js` covers metadata isolation, R5, forms, sensitivity, explicit traditional metadata, partial graphs, pinning, controlled restart, rollback, completed receipts, retained navigation and concurrent entrypoints. The Redis integration suite checks retained versions and terminal effects through two independently connected workers with a shared distributed lock namespace. Package consumers check versioned flows through CJS/ESM and compile the new APIs under NodeNext and bundler resolution.
