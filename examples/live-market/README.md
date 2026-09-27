# Mavuno Co-op live USSD test

This is a simulated ordering service. It uses the library's `USSDStateMachine` and `RedisStorage` through a real HTTP server. Redis also holds demo inventory and orders. No payment or fulfillment occurs.

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
  npx jest tests/integration/LiveMarket.integration.test.js --runInBand --forceExit
```

The integration test uses a private Redis key prefix and deletes its keys afterward. It places a two-product order over HTTP, restarts the app, retrieves and cancels the order, tests input validation and back navigation, and races two orders for the final unit of stock.

Stop the demo with `Ctrl-C`, then stop Redis with `docker stop ussd-live-redis`.
