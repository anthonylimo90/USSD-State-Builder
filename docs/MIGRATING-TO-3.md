# Migrating from 2.7 to 3.0

`3.0.0` is a major release reflecting observable runtime changes and a Node.js minimum of 22. Read the [support matrix](SUPPORT-MATRIX.md) and test the package against your application before rollout.

## Behavior to review

| Area | 2.7 behavior to account for | 3.0 behavior |
| --- | --- | --- |
| Lifecycle | Some configured state and session callbacks were inert or inconsistent. | Initial entry, committed transitions, back navigation, and completion emit the documented callbacks. Audit callbacks for external side effects before upgrading. |
| Post-commit failures | A callback error could appear to fail a turn whose state had already changed. | Notification errors are reported without rejecting a committed turn, even with `hookErrorStrategy: 'throw'`. Move veto logic to `beforeProcess`; make side effects idempotent. |
| Completed sessions | A later input could run after `END`. | The stored terminal response is replayed for the same session ID until its TTL expires. Use a new ID for a new handset session. |
| Inactivity TTL | Static initial screens, same-state replies, and validation retries could fail to refresh the session. | Active interactions refresh TTL. Check expiry assumptions and key volume. |
| Dynamic menus | A changing fetch result could route a displayed number to a different item; a local `0` could lose to back navigation. | Selection uses the displayed snapshot; an explicit visible `0` route/control takes precedence. Ambiguous key conflicts are rejected. Recheck price and stock when committing business actions. |
| Metrics | SDK turns and some outcomes could be missed; histogram buckets were incorrect. | Whole-turn outcomes include validation, block, back, replay, and error. Check dashboards and alerts for the changed counts. |
| Runtime | Package declared Node 14 or newer. | Maintained/tested minimum is Node 22. Upgrade the runtime before installing version 3.0. |

`__ussdLifecycle` is a reserved session-data key for the bounded terminal response. Custom storage and application code must preserve it and avoid using that name. It is not a durable provider receipt; retries after expiry or partial storage failure still require gateway and application safeguards.

## Rollout and rollback

1. Pin the exact release version in a clean test consumer and run the application flow, including retries, expiration, navigation, and lifecycle side effects.
2. Drain or allow existing 2.7 sessions to expire before switching mixed-version workers. The release does not provide a flow/session-schema migration mechanism; never silently delete live sessions to simplify an upgrade.
3. Roll out a single application version at a time and monitor turn outcomes, hook errors, TTL, and adapter errors. Keep external effects idempotent.
4. For rollback, pin the prior package version and restart workers after active 3.0 sessions drain. Session data written by 3.0, including `__ussdLifecycle`, has not been certified for a mixed-version rollback; validate it in your application before restoring traffic.

Version 3.0 does not add provider payload parsing, callback authentication, atomic turn commits, or lease fencing. Those are tracked in [Phase 2](ROADMAP.md).
