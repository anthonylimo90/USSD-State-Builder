# Mavuno Co-op live USSD test

This is a simulated ordering service. Its [app definition](app.js) uses the SDK's fluent `createApp().state(...).build()` API with `.on(...).goto(...)` routes, `.validate(...)`, and `.run(...)` handlers. The HTTP server uses `RedisStorage` for sessions; Redis also holds demo inventory and orders. No payment or fulfillment occurs.

## Run it

Use Node 22 or newer. Install dependencies with `npm ci`. The starter's [environment example](.env.example) lists every runtime setting; export values in your shell or deployment environment before starting the process. It does not load `.env` files automatically.

```bash
docker run --rm -d --name ussd-live-redis -p 127.0.0.1:16379:6379 redis:7-alpine
REDIS_URL=redis://localhost:16379 PORT=3100 npm run demo:live-market
```

Open <http://localhost:3100> to use the browser keypad. The default demo phone is `0712345678`. Choose **New session** after an order to look it up under **My orders** and cancel it.

Use demo phone numbers only. The server binds to localhost and the Redis container exposes port 16379 on localhost.

Mavuno shares its browser keypad with the [local workbench](../../docs/LOCAL-WORKBENCH.md). Run `npm run workbench` for isolated SDK/traditional sessions with state inspection, public data, trace history and timing, without requiring Redis.

The HTTP endpoint also accepts incremental gateway-style requests:

```bash
curl -s http://localhost:3100/ussd \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"demo-1","phoneNumber":"0712345678","input":""}'
```

Send one new input per request with the same `sessionId`; a new session uses a new ID. `0` navigates back. The endpoint validates the session ID and phone number and binds each session to its first phone number.

## Integration run

```bash
RUN_INTEGRATION=1 REDIS_URL=redis://localhost:16379 \
  npx jest tests/integration/LiveMarket.integration.test.js --runInBand --detectOpenHandles
```

The integration test uses a private Redis key prefix and deletes its keys afterward. It places a two-product order over HTTP, restarts the app, retrieves and cancels the order, tests input validation and back navigation, and races two orders for the final unit of stock.

For the release candidate, verify the installed tarball rather than the checkout source:

```bash
REDIS_URL=redis://localhost:16379 npm run test:packed-demo
```

This packs the checkout, installs it into a temporary consumer, starts Mavuno from that installed package, and checks order placement, terminal replay, lookup, cancellation, and restored stock. It cleans its isolated Redis keys and temporary consumer afterward.

Stop the demo with `Ctrl-C`, then stop Redis with `docker stop ussd-live-redis`.

`GET /live` reports that the process can answer HTTP. `GET /ready` checks Redis and returns 503 if it is unavailable; `/health` is a compatibility alias for readiness. Embedders can call `app.drain()` to make readiness return 503 and reject new work while existing requests finish, then call `app.close()`. On `SIGINT` or `SIGTERM`, the CLI drains and stops accepting new requests, waits up to at least ten seconds for current requests to finish, then closes Redis. A forced drain closes remaining HTTP connections; retry an uncertain provider turn through the documented recovery path. Use a host that removes an unready instance from traffic before terminating it. The CLI binds to `127.0.0.1`; put a controlled HTTPS ingress in front of it for sandbox callbacks.

## Africa's Talking form endpoint

Enable the optional cumulative-input route with an explicitly configured service:

```bash
AT_SERVICE_CODE='*384*000#' AT_APPLICATION_ID=mavuno-demo \
  REDIS_URL=redis://localhost:16379 PORT=3100 npm run demo:live-market
```

Replace the sample code with your provisioned service. The route is `/africas-talking/ussd`:

```bash
curl -s http://localhost:3100/africas-talking/ussd \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'sessionId=provider-demo-1' \
  --data-urlencode 'phoneNumber=+254712345678' \
  --data-urlencode 'networkCode=99999' \
  --data-urlencode 'serviceCode=*384*000#' \
  --data-urlencode 'text='
```

Subsequent callbacks send accumulated `text=1`, `text=1*1`, etc. The adapter passes only the newest input into the fluent app. The demo binds the service/caller, replays known receipts, and rejects gaps, conflicts and uncertain turns. Runtime state and receipts commit atomically in Redis. Confirmed terminal order/cancellation effects can be reconciled explicitly through `app.providerGateway.recover(wireRequest)` without a second stock mutation. Unknown/nonterminal outcomes remain pending. It remains a local demonstration until provider-origin controls and stable ingress are verified. See [adapter behavior and limits](../../docs/AFRICAS-TALKING-ADAPTER.md).

`AT_RESPONSE_BUDGETS` is a JSON object with a mandatory `default` UTF-8 byte limit and optional numeric network-code keys, for example `'{"default":160,"63902":160}'`. It counts the entire response including the prefix and never clips a menu. The starter uses 160 bytes for unknown networks. This is a local safety margin, not proof of carrier character accounting or Unicode rendering. Test the actual network, language, long cart and error screens before changing limits. An over-budget prepared turn returns an error and stays pending for inspection; do not blindly replay a business effect. See the [sandbox walkthrough](../../docs/MAVUNO-SANDBOX-WALKTHROUGH.md).

Run all HTTP/Redis suites, including this route, with:

```bash
REDIS_URL=redis://localhost:16379 npm run test:integration -- --runInBand --detectOpenHandles
```

The provider route uses one request deadline, including body reads, and aborts handler work when the caller disconnects. Set `AT_DEADLINE_MS` (default 5000). Order/cancellation journals persist for 24 hours; this local demo exposes no recovery HTTP endpoint. See [deadlines and effect recovery](../../docs/DEADLINES-AND-RECOVERY.md) for the supported guarantees and operator recovery contract.

## Optional event callbacks

Set `AT_EVENT_TOKEN` with `AT_SERVICE_CODE` to enable `/africas-talking/events`, and `MARKET_ORDER_EVENT_TOKEN` to enable `/demo/order-events`. Each token must be 16–256 characters. The local routes require `Authorization: Bearer <token>` and are absent when their token is unset. These headers are a local ingress policy; the provider documentation does not establish support for custom callback authorization. Verify the provider's actual source controls before connecting a real service. See [session end events and asynchronous results](../../docs/SESSION-END-AND-CALLBACKS.md).

The order callback accepts bounded JSON such as `{ "orderId": "M00001", "eventId": "evt-1", "version": 1, "status": "Ready" }`. It updates a durable order result without modifying stock or the handset session. A new session with the order's bound phone sees `Ready` under **My orders**. Duplicate and older versions are safely acknowledged; same-version conflicts and updates to cancelled orders return 409 for operator inspection. The browser demo can also show this result after a new session is started.
