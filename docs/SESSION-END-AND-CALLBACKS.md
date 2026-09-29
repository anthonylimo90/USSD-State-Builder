# Session end events and asynchronous results

P2-06 separates provider session closure from application business outcomes. The Africa's Talking end-event form is normalized by `AfricasTalkingEventAdapter`, accepted by `SessionEventGateway` and durably reconciled by `RedisSessionEventStore`. This is a framework-neutral API; the optional Mavuno routes exercise it over local HTTP/Redis. The [provider contract](AFRICAS-TALKING-CONTRACT.md) documents the field schema. Actual end-event delivery and provider-origin controls remain unverified under P2-01.

```javascript
const eventAdapter = new AfricasTalkingEventAdapter({ applicationId, serviceCode });
const eventStore = new RedisSessionEventStore({ storage, retentionSeconds: 604800, maxEvents: 16 });
const events = new SessionEventGateway({ adapter: eventAdapter, store: eventStore });
const turns = new TurnGateway({ adapter, machine, store: new RedisTurnStore({ storage }), eventStore });
const result = await events.handle({ method: 'POST', contentType, body: rawFormBytes });
// Send result.status, result.headers and result.body after durable acceptance.
```

The adapter requires the documented fields and a valid UTC `yyyy-MM-dd HH:mm:ss` date. It checks form encoding, duplicate keys, scope, caller shape, numeric fields and byte limits. It preserves cost as text; no currency interpretation is inferred. `errorMessage` is optional. Unknown fields are parsed for duplicate/malformed encoding and then ignored. Neither this adapter nor its scoped session key authenticates a callback.

A separate Redis record retains bounded event summaries for seven days by default. It stores binding, fingerprint, timestamp and provider status, excluding the raw input, response, cost and error text. Exact duplicates return the same 200 acknowledgement without another write. An older same-status event is recorded as stale; changed status or divergent details at the same timestamp mark the journal outcome `conflict`. Contradictory statuses never silently overwrite a canonical result. Conflict and stale classifications are inspectable in the application result but receive 200 only after durable acceptance. Binding/scope conflicts receive 409/403; capacity or storage failures receive a non-acknowledgement response. Provider retry behavior is unverified.

The event and session closure flag are installed by one Redis Lua operation. The flag fences new claims and ordinary pending commits. Active workers observe it through ownership polling and receive cancellation; an explicit, confirmed effect recovery may still commit the matching receipt. Known interactive receipts remain replayable. Provider `Success` describes a handset-session outcome and does not prove a business payment or order succeeded. No new interactive turn is run by an end event, and a provider close does not retroactively invoke application lifecycle hooks.

If the interactive ledger remains, acceptance checks all binding fields against it and records `bindingSource: turn`. If it has expired or been deleted, the callback is retained independently with `bindingSource: event_only`; prior caller identity cannot be reverified in that case. The separate event record still fences reuse of that scoped session ID until its retention expires. These guarantees target standalone Redis with raw `RedisStorage`. The two-key Lua write has no Redis Cluster cross-slot guarantee; other storage adapters need their own atomic implementation.

## Business callback and new-session lookup

Mavuno's optional `/demo/order-events` route models an asynchronous order update, separate from the provider end event. A configured `MARKET_ORDER_EVENT_TOKEN` must be supplied by the trusted sender or ingress. An event supplies `orderId`, stable `eventId`, monotonic integer `version`, and `Ready` or `Delayed` status. Redis atomically checks the durable order and its current update. Duplicate deliveries return `duplicate`, older versions `stale`, same-version disagreements `conflict`, and a later version becomes current. The current result is stored with the durable order namespace, independently of the handset session and its receipt retention. It does not change stock. A cancelled order rejects new updates and no longer displays an older fulfillment label; its update journal remains available for duplicate handling.

A new Mavuno session can select **My orders**. The order and update are returned only for the phone bound to that new session; another phone cannot retrieve them. This is application caller matching, not verified subscriber authentication. Production requires trustworthy provider-origin and subscriber-identity controls before treating this as private lookup.

The optional `/africas-talking/events` route is enabled with `AT_EVENT_TOKEN` and the service code. The local HTTP example requires a matching Bearer token before reading an event. This is an example ingress gate; the reviewed provider material does not establish that Africa's Talking sends custom Authorization headers. A deployment must verify supported source controls and may use a trusted edge to inject its own internal token after authentication. Do not connect this route to a real provider based solely on the local test. `AT_EVENT_TOKEN` and `MARKET_ORDER_EVENT_TOKEN` must each be 16–256 characters. Without a configured token, their respective routes are absent.

## Validation and limits

Local synthetic tests cover malformed event forms, exact duplicates, older and contradictory events, binding conflicts, races across independent Redis clients, worker restart, active-session expiry, full handset-key deletion, closure during a pending turn, and confirmed recovery after closure. The demo tests a business callback after restart and handset expiry, followed by successful bound lookup and failed wrong-caller lookup from new sessions. The packed-package journey exercises both callback routes. These tests do not establish that provider end events actually arrive, their retry schedule, or authenticated provider origin. P2-01 evidence remains open; the phase exit gate still requires actual sandbox traffic.
