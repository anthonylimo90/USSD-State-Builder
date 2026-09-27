# Storage conformance and lease audit

The shared suite is `tests/StorageConformance.test.js`. It covers state/data reads, shallow data merge, bounded history push/pop, deletion, immediate expiry on read, TTL refresh on a same-state write, fresh writes after expiry, and adapter restart behavior. InMemory intentionally loses sessions when a new instance starts; Redis, MongoDB, and PostgreSQL retain them while their backing service remains available.

Run the InMemory and wrapper checks with `npm test`. Run all four adapters against **isolated test services** with:

```bash
RUN_INTEGRATION=1 \
REDIS_URL=redis://127.0.0.1:16379 \
MONGODB_URI=mongodb://127.0.0.1:17017 \
POSTGRES_URL=postgresql://postgres:ussd_test_only@127.0.0.1:16432/ussd_conformance \
npx jest tests/StorageConformance.test.js --runInBand --forceExit
```

The PostgreSQL test creates `ussd_conformance_sessions` in the specified **test database**. MongoDB uses `ussd_conformance` by default. Tests create random session IDs and delete them afterward. Set `MONGODB_DATABASE` to override the MongoDB database. The live Redis two-worker check uses separate clients and a unique key prefix.

## Verified behavior

| Capability | InMemory | Redis | MongoDB | PostgreSQL |
| --- | --- | --- | --- | --- |
| Expiry rejected on read | Yes | Yes | Yes, explicit filter before TTL monitor deletion | Yes |
| Same-state write refreshes TTL | Yes | Yes | Yes | Yes |
| Fresh data after expired session | Yes | Yes | Yes | Yes |
| Shallow data merge | Yes | Yes | Yes | Yes |
| Bounded history and deletion | Yes | Yes | Yes | Yes |
| Survives new adapter instance | No | Yes | Yes | Yes |

## Atomicity and lease boundaries

- `setState`, `setData`, and history updates are separate calls. No adapter currently commits a complete turn (state, data, history, and response receipt) atomically. A worker crash between calls can leave a partial turn. P2-04 must add a revisioned commit and receipt before claiming exactly-once turn processing.
- Redis and MongoDB `setData` perform read/merge/write. Concurrent unguarded calls can overwrite one another. MongoDB history pop also reads then writes. The PostgreSQL history pop uses one row-locking statement, and its JSONB merge is one update, but neither makes the full turn atomic.
- The existing `withTransaction` APIs are **not** a portable atomic-turn contract. Redis queues a limited write proxy and replaces data rather than merging; PostgreSQL opens a transaction on one client but passes an adapter whose methods query the pool; MongoDB starts a transaction session but does not pass that session to adapter operations. Do not use these methods as evidence of multi-operation atomicity.
- `createDistributedLockManager` serializes cooperative workers while a Redis lease remains valid. Its ownership-aware release and extension protect another owner's lock. Renewal errors are currently ignored, and neither a lease token nor a session revision is checked at commit. A paused worker can resume after losing the lease and write stale results. Keep handlers within the lease window; P2-04 must fence stale commits with a revision or ownership check.
- Encryption wraps session data and merges plaintext before encrypting. It hides the adapter's `setDataIfStatus` optimization, so a lock is needed for cross-worker read-modify-write. The suite verifies wrapper composition with two worker instances in memory and with two independent live Redis clients. This is serialization under a healthy lease, not a durability or exactly-once guarantee.

These limits apply to custom adapters unless they explicitly implement stronger operations. The current `StorageInterface` does not advertise atomic-turn capability; P2-04 should introduce an opt-in capability and a migration path rather than assuming one exists.
