# Mavuno Co-op sandbox walkthrough

Status: the [2026-10-02 rerun](../tests/fixtures/africas-talking/captured/2026-10-02-mavuno-attempt.md) passed local/public controls, but two simulator connections stalled before dialing. Local preparation complete; the complete Mavuno journey has **not yet been observed through Africa's Talking**. The [2026-09-29 attempt](../tests/fixtures/africas-talking/captured/2026-09-29-mavuno-attempt.md) passed public controls, but the provider's first dial targeted an older stopped tunnel and the simulator then stalled. Do not close P2-07 or the Phase 2 gate until the checklist below is filled with actual provider traffic. The earlier [probe capture](AFRICAS-TALKING-SANDBOX.md) ran fixed menus, not Mavuno.

## Prepare the starter

1. Use Node 22+, `npm ci`, and a disposable Redis database. Follow the [starter run guide](../examples/live-market/README.md) and its [environment example](../examples/live-market/.env.example). Use a fresh `MARKET_PREFIX` for each evidence run and a provisioned sandbox `AT_SERVICE_CODE`.
2. Set `AT_RESPONSE_BUDGETS` to a conservative complete UTF-8 byte limit. The default is 160 bytes for every network until network codes are verified. The prefix and multilingual bytes count. This is a local safeguard; the sandbox does not establish live operator character counting or glyph support.
3. Start the app on localhost. Confirm `GET /live` and `GET /ready` both return 200. Confirm a synthetic form POST to `/africas-talking/ussd` returns a plain `CON ` menu, and repeat it to check receipt replay. Label these checks **synthetic**, not provider evidence.
4. Put an owner-controlled, stable HTTPS ingress in front of the local listener. Allow only the intended callback paths. Confirm public `GET /ready` and synthetic POST reach the app before changing the sandbox channel. If a tunnel gives 1033/530 or a connection error, fix ingress first; the provider cannot validate the application through a disconnected endpoint. Do not put event tokens in a URL. Configure provider-origin controls that the sandbox actually supports; an application-level caller binding is not provider authentication.
5. Set the sandbox channel's interactive callback URL to `https://<host>/africas-talking/ussd`. Set the event URL to `https://<host>/africas-talking/events` only when a compatible authenticated delivery mechanism has been verified. The app only exposes that route when `AT_EVENT_TOKEN` is configured. Record the exact route configuration and access-control method without recording secrets.

## Run the provider journey

Use a disposable sandbox phone and a new provider session. In the simulator, choose **1 Shop → 1 Seeds → 1 Maize seed → 2 quantity → 3 Checkout → 1 pickup → 1 Place order**. Record each accumulated `text` shape and menu outcome, including the terminal order code with the code redacted or consistently aliased. Repeat a callback or use the simulator's retry path if supported; check that stock and order count do not change twice. Start a fresh session with the same demo phone, choose **3 My orders**, enter the order code, and choose **1 Cancel**. Confirm the order reaches cancelled and stock is restored once. Exercise **0 Back**, invalid input, and a second session that abandons a continuing menu. Check events separately from interactive callbacks.

For multilingual output, run a configured test menu or isolated adapter scenario containing accented letters, combining marks, and emoji at and above a network budget. The local adapter must reject an over-budget whole response without truncation. The simulator may not prove handset glyph rendering; document what it actually displays. Do not assume a Kenyan network code or increase its budget from a simulator alias alone.

## Redacted evidence checklist

- [ ] Date/time window, sandbox account/channel alias, service-code alias, tested commit, Node/Redis versions, and response-budget configuration recorded.
- [ ] Stable public HTTPS endpoint: public control POST and readiness succeeded; ingress/tunnel state observed throughout the run.
- [ ] Initial callback, cumulative choices, final `END`, new-session lookup, and cancellation observed from provider traffic; each mapped to a sanitized session alias.
- [ ] HTTP status, content type, whole response byte length, and simulator-rendered text checked at each turn; no raw phone, session ID, token, or full order ID retained.
- [ ] Duplicate or retry behavior distinguished from a second choice at a different transcript position; order and stock read back after order and cancellation.
- [ ] End notification for success and abandonment received and reconciled, or its absence and bounded observation window recorded accurately. Event authentication and provider retry guarantees described as observed or unknown.
- [ ] Network/language output-limit observations separated from published operator guidance and from local policy.
- [ ] Server drain checked: readiness turns 503 when draining; an in-flight callback either completes before Redis closes or yields a safe retry/recovery path.

Save a dated manifest under `tests/fixtures/africas-talking/captured/` only after reviewing sanitation and cross-checking the provider dashboard. Use the [probe's redaction rules](AFRICAS-TALKING-SANDBOX.md) for phone/session/input aliases. Synthetic controls and actual callbacks must be labeled separately. If the provider cannot reach the endpoint, preserve the local test results and the exact ingress failure; do not mark this checklist complete.

## Troubleshooting

`/ready` 503 means Redis is unavailable or the instance is draining; check the Redis URL and listener first. A provider technical-problem screen with no app callback suggests the public route or tunnel; compare public control POST, ingress counters, and provider console status. HTTP 400/403/409 from the app points to a malformed form, service mismatch, or conflicting transcript/binding respectively. HTTP 500 after an oversized menu leaves the claimed turn pending; inspect the menu and budget, then use explicit recovery where a business effect is confirmed. Do not clear a pending record or repeat a checkout blindly. If interactive callbacks work but no end event arrives, verify the separate event URL, token compatibility and provider routing; the earlier probe had this exact unresolved boundary.
