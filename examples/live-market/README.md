# Mavuno Co-op live USSD test

This is a simulated ordering service. Its [app definition](app.js) uses the SDK's fluent `createApp().state(...).build()` API with `.on(...).goto(...)` routes, `.validate(...)`, and `.run(...)` handlers. The HTTP server uses `RedisStorage` for sessions; Redis also holds demo inventory and orders. No payment or fulfillment occurs.

## Run it

```bash
docker run --rm -d --name ussd-live-redis -p 127.0.0.1:16379:6379 redis:7-alpine
REDIS_URL=redis://localhost:16379 PORT=3100 npm run demo:live-market
```

Open <http://localhost:3100> to use the browser keypad. The default demo phone is `0712345678`. Choose **New session** after an order to look it up under **My orders** and cancel it.

Use demo phone numbers only. The server binds to localhost and the Redis container exposes port 16379 on localhost.

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

Subsequent callbacks send accumulated `text=1`, `text=1*1`, etc. The adapter passes only the newest input into the fluent app. The demo binds the service/caller, replays known receipts, and rejects gaps, conflicts and uncertain turns. Runtime state and receipts commit atomically in Redis. External order effects still require application reconciliation after an uncertain turn. This endpoint has no provider authentication or end-event reconciliation; it remains a local demonstration until those gateway requirements and stable ingress are verified. See [adapter behavior and limits](../../docs/AFRICAS-TALKING-ADAPTER.md).

Run all HTTP/Redis suites, including this route, with:

```bash
REDIS_URL=redis://localhost:16379 npm run test:integration -- --runInBand --detectOpenHandles
```
