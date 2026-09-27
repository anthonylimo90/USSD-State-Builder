# Runtime contract for the reliability work

Status: P1-02 through P1-04 behavior is implemented and locally verified; later storage and gateway guarantees remain targets. Changes that affect established applications require release notes and compatibility review.

This contract covers the in-process engine and fluent SDK. Gateway identity, durable replay, distributed commit, and flow-version handling are specified by P2-01 through P2-06 in the [roadmap](ROADMAP.md).

## A turn and its response

A turn is one application call to `processInput(sessionId, input, options)`. Input is a string; the configured maximum length applies before state validation. The caller or gateway is responsible for parsing provider payloads. Every successful engine result starts with `CON ` or `END `.

For a new session, the configured initial state is the current state. Its first empty input renders the initial response. Session creation must be explicit enough for start and expiry behavior to work even when the state returns a static message without changing state. A missing or expired session ID begins from the initial state until gateway replay protection is added in Phase 2. An `END` response is an application completion signal; it does not prove the telecom provider reported a closed session.

For an active turn, the intended order is:

1. Acquire per-session ownership and read active state, data, and history.
2. Run `beforeProcess` middleware. Blocking middleware returns its response without running the state handler. Middleware-modified input is used thereafter.
3. Dispatch a reserved navigation input according to the visible menu's effective key map. Otherwise run the state's validator, then its handler.
4. If a transition is selected, render the destination using the updated in-memory data. Carry the destination's returned data into the same turn commit.
5. Commit data, state, history, and the response in the order/atomic unit supported by the adapter. Phase 2 strengthens the Redis path to a single revision-checked turn commit.
6. Run post-commit notifications and `afterProcess` middleware, then return the response. An `afterProcess` hook may change the returned response only where the public middleware contract allows it; future durable replay must record that final response.

Handler, validation, storage, and middleware failures must be classified. Validation errors return a continuing retry message and keep the active state. Other errors reach `onError` and the caller unless a documented middleware policy handles them. The engine must not claim an uncommitted transition succeeded.

## Rendering and selection

The item chosen by a numeric input is the item displayed for that same menu session and page. The runtime must persist or otherwise retain a bounded snapshot before accepting input. Changing data returned by the fetcher between display and selection must not silently change which item a user selected.

Snapshot state belongs to its menu state. On moving to another state, clear or replace internal selection markers so a later menu cannot consume an earlier menu's item. Pagination and refresh keep their current page and snapshot rules explicit. User input for item selection must match a displayed key exactly; strings such as `1abc` must not parse as selection `1`.

The application must separately recheck mutable business facts, such as stock and price, when committing a business operation. A display snapshot identifies intent; it does not reserve stock.

Initial rendering, back navigation, and refresh may invoke existing `.run()` handlers. For compatibility, P1 does not declare arbitrary `.run()` handlers side-effect-free. Authors must keep rendering handlers safe to repeat and put external mutations behind explicit input and application idempotency. A later API may distinguish render and action callbacks; that would receive its own migration plan.

## Navigation keys

With back navigation enabled, `0` goes back unless an explicit route or visible menu control claims it. A local `0. Refresh` therefore refreshes, including when history exists. The invariant is that every visible control executes its displayed action. Pagination uses other keys; duplicate routes and controls that conflict with item numbers are rejected. A developer who needs back navigation on a menu with local `0` must choose another local key.

When a user goes back, restore the prior state and render it with empty input. A prior dynamic menu can refetch on re-entry if the menu contract indicates a new display; its new snapshot must be the one used on the next selection. A back action with no history remains in the current state and follows a documented fallback rather than executing an unrelated route.

## Lifecycle callbacks

State `.onEnter()` and `.onExit()` callbacks and global `onStateEnter`/`onStateExit` hooks are lifecycle notifications. `onSessionStart`, `onStateChange`, and `onSessionEnd` middleware hooks are also notifications. These hooks must execute at most once per engine turn, in a documented order, and must never create an implicit second handler run. Phase 2 adds durable deduplication for gateway retries.

Target event sequence for a newly created session: session-start notification, initial-state enter notification, then any after-process observation. For a committed forward or back transition: old-state exit, state-change, then new-state enter notifications. For `END`: completion notification once after the final response is committed; an explicit `endSession()` on an already completed session must not emit it again. Same-state replies and validation failures do not emit a state change. Middleware-blocked requests do not emit state or session completion events.

Notification failures follow a configurable error policy and are observable through error reporting. They must not undo a committed state change or cause a business effect to run again. The exact public callback arguments and failure policy will be finalized and tested in P1-03, with compatibility notes because these callbacks were previously inert or inconsistently invoked. Existing `beforeProcess` middleware remains the place for intentional veto or input modification.

## Session completion and expiry

Active, completed, expired, and explicitly terminated are distinct outcomes. Session data uses a documented inactivity TTL; successful same-state replies and validation errors should refresh it, because the user is still interacting. The final implementation must test each adapter's actual expiry semantics before promising this behavior across adapters.

`END` completes the application turn and stores a bounded-by-session-TTL terminal response under the reserved `__ussdLifecycle` session-data key. A later request with that session ID passes through `beforeProcess` middleware, then returns the stored response without rerunning the handler. This is local replay protection, not the provider-aware, atomic turn receipt promised in Phase 2. `endSession()` explicitly removes an active session and is idempotent. Provider-reported termination is a separate event from engine completion and may arrive late or never arrive.

P1-03 now creates an active session for a static initial screen, refreshes inactivity TTL on same-state replies and validation errors, emits state and middleware lifecycle notifications, and runs `afterProcess` for back navigation. Post-commit notification errors are reported without failing the committed response, including when the historical `hookErrorStrategy: 'throw'` option is configured. This changes the observable behavior of applications that expected a state-entry callback to reject a completed turn; release notes and versioning must call it out. `onError` remains governed by the configured error strategy. Provider replay identity, atomic writes, and recovery from storage or `afterProcess` failures remain later work.

## Compatibility and verification

The current four reproductions are runnable with `node tests/roadmap/reproduce-current-gaps.js R1` through `R4`. A nonzero exit status means the desired behavior is not yet met. Keep this probe outside Jest while the corresponding fixes are pending; move each case to a permanent integration regression test with the implementation that fixes it. Do not invert assertions to make current broken behavior appear passing.

P1-02 implements the rendering/navigation invariants, with focused unit and Redis/HTTP integration verification on 27 September 2026. P1-03 implements the lifecycle and completion behavior described above. P1-04 measures complete turns through `useTurnObserver()` and fixes Prometheus histogram bucket export. The SDK `.metrics()` helper uses this observer. `totalErrors` counts validation failures and thrown errors; `outcomes` separates success, validation error, error, block, and replay. Adapter exceptions and provider-aware guarantees remain to be verified.
