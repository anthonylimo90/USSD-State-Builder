# Deadlines and effect recovery

P2-05 bounds gateway requests and fences expired ownership. It extends the [atomic receipt contract](TURN-RECEIPTS.md). The defaults are `deadlineMs: 5000`, `leaseMs: deadlineMs`, and `ownershipCheckMs: 100`. These are application settings; provider timing and retry behavior still need verification.

```javascript
const gateway = new TurnGateway({ adapter, machine, store,
  deadlineMs: 4000, leaseMs: 4000, ownershipCheckMs: 100,
  recoverTurn: reconcileConfirmedJournal
});
const response = await gateway.handle(wireRequest, {
  signal: requestController.signal,
  deadlineAt: requestStartedAt + 4000
});
```

`handle`, `process` and explicit `recover` accept the same optional request signal and absolute deadline. An earlier caller deadline reduces the configured budget. A pre-aborted signal or expired deadline starts no storage or handler work. Cancellation/deadline errors produce the adapter's fixed 503 response. They do not imply that a provider retries.

## One budget and cooperative cancellation

The budget begins at gateway entry and includes reads, initial-data mapping, claiming ownership, local machine lock waits, handler/middleware execution, recovery reads and committing. A lease can shorten it at claim time. Remaining time uses a monotonic clock. Handlers receive `context.signal` and `context.deadlineAt`; middleware receives them directly and through its metadata. Initial-data and recovery callbacks receive them too.

Pass the signal into every client that supports cancellation:

```javascript
.run(async (input, sessionId, context) => {
  context.signal?.throwIfAborted();
  const result = await fetch(chargeUrl, {
    method: 'POST', signal: context.signal,
    headers: { 'Idempotency-Key': context.turn.idempotencyKey },
    body: JSON.stringify({ amount: 100 })
  });
  return { response: (await result.json()).response };
})
```

The response promise is bounded while the signal requests cancellation of actual work. An uncooperative promise can remain running in its isolated stage; it cannot install a late runtime snapshot. Synchronous CPU work can block the event loop, so timers cannot preempt it. The budget is checked again before commit, and Redis independently checks the ownership deadline. Use worker isolation for untrusted or unbounded CPU work.

Local lock acquisition listens for cancellation, removes its waiter and checks again before acquiring. It consumes the original budget and does not run a queued handler after timeout. The gateway requires raw atomic storage; legacy distributed-lock wrappers remain outside this guarantee. Passing a signal to ordinary `processInput()` supplies cooperative handler/lock cancellation, but ordinary storage writes are not staged or atomically fenced. Use `TurnGateway` for the complete guarantee.

## Server fencing and lost ownership

Atomic stores explicitly advertise `supportsDeadlines: true`. `read(key, { withClock: true })` returns a store-clock observation even for an empty key. The gateway anchors its remaining monotonic budget to that observation and supplies a store-clock deadline to `claim`. Redis caps the ownership deadline using its own clock and refuses expired claims. This avoids extending authority because of worker wall-clock skew or delayed claim delivery.

`commit` checks revision, ownership token and store-clock expiry in the same atomic operation as the snapshot/receipt installation. It rejects an expired owner even if no replacement has appeared. Explicit recovery replaces the token with compare-and-swap. Periodic ownership reads abort the previous worker when its token/revision changes; read failure also requests cancellation. Atomic fencing remains decisive if polling is delayed.

Expiry removes commit authority; the pending operation remains durable until receipt retention expiry. There is no automatic rerun, takeover or lease renewal. Inspect the effect journal and explicitly reconcile. If a Redis command was already sent when the caller disconnected, its result can be uncertain. A subsequent known request resolves that uncertainty by reading the receipt; it never assumes cancellation rolled back an effect or a completed commit.

## Confirmed effects and Mavuno recovery

Cancellation can close an HTTP connection after the remote service performed its effect. Use a stable operation key and a durable application/service journal. A recovery resolver receives the original pending operation key, prior committed snapshot, a fresh signal and its remaining deadline. It reads a confirmed outcome and reconstructs the next snapshot/response. Returning null or throwing leaves the operation pending. It never executes the original handler automatically.

Mavuno records provider order-placement and cancellation outcomes in the same Redis Lua operation as their stock/order mutation. Repeated delivery of the operation key returns the recorded result. These journals have 24-hour retention, matching the demo's default receipt retention. The resolver reconstructs terminal confirmation/cancellation responses from the bound session and journal, preserving response wording and preventing a second stock change. Unknown and nonterminal outcomes, including an out-of-stock cart correction, remain pending for explicit application reconciliation. Business orders persist separately from these handset turn records.

The demo exposes no public recovery HTTP endpoint. Application/operator code may invoke `app.providerGateway.recover(wireRequest)` after authorization and journal inspection. The provider HTTP route starts its deadline before reading the body, passes the remaining deadline onward, and aborts executing work if the caller disconnects. Configure `AT_DEADLINE_MS` (default 5000), or `providerDeadlineMs` in `createLiveMarket()`.

Mavuno's Redis client does not support cancelling a sent Lua command. A pre-send signal check avoids starting cancelled work; the atomic journal makes an uncertain effect reconcilable. Runtime commit and business effect remain separate atomic operations. Notification delivery remains best effort without a durable outbox.

## Evidence and remaining scope

Unit tests cover cooperative cancellation, an uncooperative late handler, lock waits, caller abort, expired deadlines, initial-data cancellation, ownership replacement, expired-token commits and timed-out recovery. Redis/HTTP tests cover server-time fencing, worker clock skew, native `fetch` cancellation with observed connection closure, external-service idempotency and journal recovery from another worker. A real child-process crash after a durable HTTP effect still reconciles without another handler execution. Mavuno HTTP tests inject failed runtime commits after placement and cancellation, then verify recovery and stock conservation. Slow bodies and disconnected callers are exercised over real HTTP.

These checks establish local library/demo behavior. Provider end-event evidence remains open under P2-01. Duplicate/out-of-order end-event reconciliation and durable asynchronous callback handling are described in [P2-06](SESSION-END-AND-CALLBACKS.md).
