# Atomic turn receipts

P2-04 adds `TurnGateway`, `RedisTurnStore` and `InMemoryTurnStore`. The gateway sits between a provider adapter and a versioned state machine. The Mavuno provider endpoint demonstrates this boundary; its browser endpoint retains the ordinary incremental API.

```javascript
const { AfricasTalkingAdapter, RedisStorage, RedisTurnStore, TurnGateway } = require('ussd-state-builder');
const storage = new RedisStorage({ url: process.env.REDIS_URL });
// Build your machine with this same storage object.
const gateway = new TurnGateway({
  adapter: new AfricasTalkingAdapter({ applicationId: 'market', serviceCode: '*384*123#' }),
  machine,
  store: new RedisTurnStore({ storage }),
  receiptTTL: 86400
});
const response = await gateway.handle(rawWireRequest);
// Return response.status, response.headers and response.body unchanged.
```

## Identity, replay and ordering

Identity includes the scoped session key, complete normalized transcript and transcript position. Identical choices at different positions remain distinct turns. The persisted caller/service/network binding is checked before any receipt lookup, including after losing a concurrent claim.

A known request returns its recorded HTTP status, headers and body without rerunning handlers, middleware, hooks or external effects. Earlier receipts remain replayable after later turns and active-session expiry. Unknown stale, conflicting, skipped, completed or expired-session turns receive 409. A duplicate while its first execution is pending receives 503; once committed, it replays. Provider retry behavior is not inferred from these statuses.

Defaults are 24-hour receipt retention, 128 turns and a 1 MiB serialized record limit. Retention must cover all retained flow timeouts. New work is rejected at capacity rather than evicting prior receipts. Size is checked before claiming and before committing; an oversized result after execution remains uncertain and requires reconciliation. Claims and commits refresh retention; replay does not. After retention expiry, the evidence is gone: choose retention to cover your provider retry window and business requirements.

## Atomic storage and staged execution

A Redis commit checks revision and ownership token, then installs state, data, history, flow version, next revision and response receipt in one Lua operation on one Redis hash key. Claim and read are also atomic. Redis server time controls active expiry. Receipt retention controls physical key expiry; ordinary Redis session reads hide expired active state even while the gateway retains its snapshot for reconciliation. Retained data may contain personal information, so retention is also a privacy decision.

Only raw `RedisStorage` and `InMemoryStorage` have supplied atomic turn stores. In-memory receipts are process-local and require a shared store instance. MongoDB, PostgreSQL, encryption/locking wrappers and custom adapters require an explicit atomic implementation; sequential transaction fallbacks are not used.

`machine.prepareTurn()` stages runtime writes in isolated memory through the handler, validator and middleware path. Use handler `data` results or machine session-write APIs. Captured machines sharing the same storage also see staged writes. Read results are JSON copies; mutate through write APIs. Session data must be JSON serializable. Direct adapter/client writes and external services escape staging and are application effects.

Use the gateway exclusively for its session namespace. Legacy direct writers, deletion/cleanup jobs and raw Redis writes do not participate in receipt revision checks. Existing unbound runtime sessions are rejected rather than silently adopted; allow them to finish/expire or begin new provider sessions when migrating from the earlier demo guard.

Lifecycle hooks and turn observers run after a successful commit. Their failures cannot change a durable receipt, and replay does not call them again. A crash between commit and notification can lose a notification; this is not a durable outbox.

## Unknown external effects and recovery

Each handler receives `context.turn.idempotencyKey`, `position` and `revision`. Send the stable operation key to an external service that supports idempotency, or record it in an application effect journal with a trustworthy outcome. Redis atomicity alone cannot make arbitrary external effects exactly once.

Pending ownership is durable and has no automatic takeover timer. A thrown handler, process crash or uncertain commit response blocks ordinary retries. If the commit succeeded despite a lost acknowledgement, the next request finds and replays its receipt. Otherwise an application/operator may explicitly invoke `gateway.recover(rawWireRequest)` with a configured `recoverTurn` resolver:

```javascript
recoverTurn: async ({ pending, session }) => {
  const result = await effects.read(pending.idempotencyKey);
  if (!result || result.status !== 'confirmed') return null;
  return {
    response: result.response,
    session: { ...session, data: { ...session?.data, ...result.data },
      expiresAt: Date.now() + 300000 }
  };
}
```

Recovery replaces the ownership token with a compare-and-swap, consults the journal and commits the reconstructed snapshot and receipt. It never reruns the original handler. A null/failed resolver remains pending. The gateway preserves the pending flow version and marks recovered terminal responses completed. An obsolete owner cannot commit after ownership replacement. Recovery resolvers must accurately reconstruct runtime state/history/data from a confirmed outcome; they must not blindly repeat an unknown operation. P2-05 will add deadlines and a broader effect-recovery policy.

## Validation boundary

Tests cover repeated choices, earlier receipts, caller races, conflicts, expired sessions, capacity, staged writes, retained versions, notification errors, lost commit acknowledgements and invalid commits. Redis integration uses independent workers, fresh clients after restart and a real child-process crash immediately after a fake HTTP service durably records its effect. Explicit journal recovery produces the receipt without a second handler execution. Packed Mavuno checks exercise browser and provider order/replay/lookup/cancellation/stock restoration.

These are local runtime and HTTP/Redis checks. They do not establish provider authentication, retry timing, end-event delivery or deployed production behavior. P2-01 event evidence remains open.
