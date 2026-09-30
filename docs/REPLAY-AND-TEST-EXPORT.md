# Replay and test export

Replay runs an explicitly supplied factory in a fresh machine with a virtual clock, isolated in-memory storage and ordered fake dependencies. The same `replayScenario()` function drives the workbench and exported Jest tests through `USSDTester`. It asserts each turn's structural outcome and active next state. It returns no response bodies, input values, session data or application exception text.

## Try the bundled regression

Run `npm run workbench`, choose **Replay lab · stock defect**, create a session, then dial and reply `1`, `3`. The intentionally broken synthetic stock check produces an error on turn 3. The graph still reports partial metadata: replay does not turn undeclared paths into declarations.

Choose **Create replay draft**. Every input is replaced by `__REPLACE_INPUT_N__`, and no external response or call is inferred. These placeholders deliberately fail replay. The draft's observed `error` outcome describes the defect; change it to the expected fixed behavior to create a regression test.

For a complete, authored demonstration scenario, print this fixture and paste its JSON into **Synthetic scenario**:

```sh
node -e "console.log(JSON.stringify(require('./examples/workbench/replay-flows').regressionFixture(), null, 2))"
```

Choose **Run isolated replay**. All three turns pass against the repaired replay factory while the handset's failed session and history remain unchanged. Turn 3 calls fake `inventory` at virtual millisecond 220 and expects a successful reply in `QUANTITY`. Choose **Generate Jest test**, then **Download Jest test**, and save it under this checkout's `tests/` directory. The preview contains the same source if your browser does not support downloads. Run the saved file with Jest; no browser, Redis or telecom provider is needed.

The exported test uses `createReplayLab` from `examples/workbench/replay-flows.js`. Replacing it with `createBrokenReplayLab` makes the same test fail with `EXPECTATION_MISMATCH` on turn 3. This pass/fail pair is also checked by `tests/Replay.test.js`, which executes generated Jest source in a separate temporary consumer outside the workbench.

## Supply a replay factory

Keep the replay factory in a normal application module that both your local server and tests can import. Wire every dependency through its arguments; do not instantiate production clients in that module. For example, save this CommonJS module as `replay-factory.js`:

```js
const { createApp } = require('ussd-state-builder');

exports.responses = { 'stock-two': { available: 2 } };
exports.createMachine = ({ storage, clock, effects }) =>
  createApp().flowVersion('stock-v1').storage(storage).clock(clock).logger(null)
    .state('HOME', state => state.message('Choose\n1 Check stock').on('1').goto('COUNT'))
    .state('COUNT', state => state.run(async input => {
      if (!input) return 'Enter quantity';
      const stock = await effects.call('inventory');
      return Number(input) > stock.available
        ? { response: 'CON Insufficient stock. Try again.', data: { checkedAt: clock.now() } }
        : { response: 'END Synthetic reservation accepted.', data: { checkedAt: clock.now() } };
    })).build();
```

Opt a workbench flow into replay using a separate factory. `createMachine` below is your ordinary **synthetic** handset factory; the replay factory is never replaced with it as a fallback:

```js
const replayModule = require('./replay-factory');
const flow = {
  id: 'stock', name: 'Synthetic stock flow', createMachine: createHandsetMachine,
  replay: {
    createMachine: replayModule.createMachine, responses: replayModule.responses,
    modulePath: '../replay-factory', // Relative to the exported file saved in tests/.
    factoryExport: 'createMachine', responsesExport: 'responses'
  }
};
// Pass flow to new LocalWorkbench({ flows: [flow] }).
```

Flows without a replay factory show **Replay factory required**, and their replay/export controls remain disabled. Factories must return a new machine using exactly the injected `storage` and `clock.now`. Redis/shared storage, a different clock and incompatible flow versions are rejected before processing. Traditional machines use the same interface via `new USSDStateMachine({ storage, now: clock.now, ... })`.

## Author the scenario

The [v1 fixture contract](TRACE-AND-FIXTURES.md) bounds JSON, identifiers and turn counts. A runnable fixture has `provenance: 'synthetic'`; inputs and named fake responses must be developer-authored synthetic values. A captured-redacted fixture cannot execute. `createReplayDraft(history)` retains only structural observations, gives each missing input an alias, and requires a complete history of 1–64 turns. Workbench exports refuse histories that have dropped earlier turns, even if the remaining turns would fit.

Each `turn.atMs` is relative to `clock.startMs`. A scripted effect is an ordered descriptor such as:

```json
{
  "operation": "inventory",
  "atMs": 220,
  "result": "success",
  "statusCode": 200,
  "responseRef": "stock-two"
}
```

The application calls `await effects.call('inventory')`. The runner advances the clock to 220 and returns a fresh clone of `responses['stock-two']`. `result: 'error'` throws a synthetic `ReplayEffectError` with `statusCode`; it does not replay exception text. Supply a named JSON fake even for an error descriptor (it may be `null`). Missing references, functions/getters, cyclic or oversized fake values, backward time, wrong call order, unscripted calls and unconsumed effects fail replay. Catching an unscripted-call error inside application code cannot make the test pass.

Expected state is the trace's **active next state**, so an END turn expects `null`, even when the inspector displays a stored terminal state. Assertions protect outcome/state, not message text, business data or effect-call arguments. Add application-specific assertions separately when those are part of your regression. A fixture that expects the observed broken outcome only documents that failure; it does not protect the intended repair.

```js
const { replayScenario, exportReplayTest } = require('ussd-state-builder');
await replayScenario(fixture, {
  createMachine: replayModule.createMachine, responses: replayModule.responses
});
const source = exportReplayTest(fixture, {
  modulePath: '../replay-factory', factoryExport: 'createMachine', responsesExport: 'responses'
});
// Write source to tests/stock.test.js and run it with Jest.
```

Workbench methods are `exportSession(id, optionalFixture)` and `replay(id, fixture)`. HTTP uses `GET /api/sessions/:id/export` for a captured draft and `POST /api/sessions/:id/export` or `/replay` with `{ "fixture": ... }` for authored scenarios. Replay locks its source session against overlapping changes, but uses a separate runtime session and clears its local storage afterward. Exported source imports the normal package and a static, author-configured factory module; the browser never supplies executable JavaScript to the server.

## Time and effect boundaries

`ReplayClock.now()` supplies epoch milliseconds. `advanceTo(relativeMs)` advances monotonically, and `await sleep(ms)` advances instantly without a real wait. Core session expiry, in-memory TTLs and runtime turn measurements use this clock. Application handlers must explicitly use it for business time. `Date.now()`, native timers, middleware with its own clock, gateway lease/deadline clocks and imported clients are not globally replaced. Real-clock behavior remains the default for ordinary machines and storage.

This is dependency injection in trusted application code, not a JavaScript security sandbox. A factory that directly calls a network client, or a handler/middleware/hook that bypasses the injected effects, can still produce real effects. Audit the replay factory and all its hooks so every external interaction uses `effects.call()` or another explicitly local fake; module imports and cleanup must also be side-effect free. The bundled replay factories make no external calls. Non-cooperative handlers can still hang and should have normal Jest time limits in CI. Fixtures never provide a production session ID, credentials or client configuration.

Fake values are limited to 32,768 UTF-8 bytes, 32 nested levels and 4,096 visited nodes per value. The runner uses ordinary `USSDTester` internally, discards its raw local history, and exposes only safe error codes and turn numbers. It skips explicit session-end notification during cleanup, but normal runtime hooks still execute through the authored factory.
