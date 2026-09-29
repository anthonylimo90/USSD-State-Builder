# Local workbench

Run `npm ci`, then `npm run workbench` on Node 22 or newer. Open the printed URL (default `http://127.0.0.1:3200`). The bundled SDK and traditional demo shops use in-memory storage and synthetic data; no Redis or telecom account is required. Set `PORT` to choose another local port.

Choose a flow and create a session. **Dial**, reply `1`, enter an invalid quantity to see validation feedback, then reply `2` and enter a synthetic PIN such as `1234`. The inspector reads the actual stored state after each turn, shows public quantity data, and hides the PIN. Create a second session to compare flows; switching preserves each session's screen and history. **Reset** clears that session and creates a fresh application instance. **Close session** deletes its runtime session. The default limit is eight sessions, and sessions stay available until closed, reset or the process stops. Runtime expiry is shown explicitly and requires a reset.

The handset, session controls, state inspector and history work with either API. Declared transitions are metadata; dynamic/unannotated handlers show partial coverage. Navigation history comes from storage, and turn duration/outcome comes from the [versioned runtime trace](TRACE-AND-FIXTURES.md). A terminal trace has no active next state, while the inspector can still show the stored terminal state (for example `DONE`). Graph diagnostics and deterministic test export are the next roadmap items.

## Attach a flow

The workbench takes factories, so each session can receive its own machine, storage and fake business dependencies. The factory receives the generated runtime `sessionId` if it needs to seed synthetic session data. Return a fresh machine on every call, including reset. Shared storage is supported through distinct generated session keys, but the factory must also isolate any mutable application dependencies.

Save this example as an `.mjs` file:

```js
import { createApp, InMemoryStorage, LocalWorkbench, createWorkbenchServer } from 'ussd-state-builder';

const workbench = new LocalWorkbench({ flows: [{
  id: 'my-flow', name: 'My synthetic flow',
  createMachine: () => createApp().flowVersion('demo-v1')
    .storage(new InMemoryStorage()).logger(null)
    .state('HOME', state => state.message('Choose\n1 Continue').on('1').goto('COUNT'))
    .state('COUNT', state => state.message('Enter a count')
      .save('count').sensitivity('public').next('DONE'))
    .state('DONE', state => state.message('Finished').end()).build()
}] });
const app = createWorkbenchServer({ workbench });
const { url } = await app.listen(3200); // IPv4 loopback only
console.log(url);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  app.close().then(() => process.exit(0));
});
// Close application-owned storage/clients separately if you use them.
```

Traditional states declare the same permission with `metadata: { field: { name: 'count', sensitivity: 'public' } }`. Public projection permits only small strings, finite numbers, booleans and null; nested objects and arrays stay hidden. A non-public declaration anywhere in the flow overrides a public declaration for the same field. Undeclared fields and internal `__ussd` data never appear in the data inspector. State IDs and flow versions must satisfy the trace schema's identifier bounds.

## CLI and tests

`npm run workbench -- --cli` runs the existing `USSDSimulator` interactively against the same controller. Commands include `/state`, `/history`, `/reset` and `/quit`. Programmatic clients also share the managed session and trace history:

```js
const session = await workbench.createSession('my-flow');
await workbench.getTester(session.id).start().expectState('HOME')
  .input('1').expectState('COUNT').run();
const simulator = workbench.getSimulator(session.id, { showDebug: true });
await simulator.send('2');
console.log((await workbench.inspect(session.id)).history);
await workbench.close();
```

These clients use the same session serialization and reset rules as the browser, and expose only public data to assertions. Existing `USSDTester`/`USSDSimulator` usage outside the workbench is unchanged. Their own local interaction histories retain their synthetic inputs/responses as before; the workbench trace history excludes these values.

## Local boundaries

The server binds to `127.0.0.1` and checks Host, Origin and cross-site browser requests. It has no remote-host option, CORS access or provider callback endpoint. The bundled flows make no external calls. A custom factory runs your handlers, so supply fake dependencies and synthetic storage rather than production clients or credentials. The latest handset response is displayed as text and is not a general response sanitizer: application prompts and validation messages may themselves contain user data. Only the structural turn history and explicitly permitted data projection follow the redaction contract.

Default bounds: eight sessions (configurable up to 16), 64 retained turn events per session (up to 256), 160 input characters, 1,024 request-body bytes, 8,192 response bytes, 32,768 flow-metadata bytes, and 4,096 public-data bytes. Inputs, responses and exceptions are not retained in turn history. An oversized response is replaced by a safe display error; this cannot undo already executed handler work. Same-session overlapping turns/reset/close are rejected while processing, and unrelated sessions can progress independently. Close the HTTP server before closing the controller to let active requests finish; handlers must terminate cooperatively. Application-owned storage connections are not closed automatically.

The shared browser keypad is also used by Mavuno's existing Redis-backed demo. Its business endpoints and provider walkthrough remain documented in the [Mavuno guide](../examples/live-market/README.md).
