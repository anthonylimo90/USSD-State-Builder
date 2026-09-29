# Mavuno sandbox attempt — 2026-09-29

This is a redacted **failed connection attempt**, not a captured Mavuno provider journey or a passing fixture. The local starter ran from the P2-07 checkout with isolated Redis keys, service code `*384*17960#`, and the default 160-byte network output budget. A fresh temporary HTTPS tunnel forwarded to the localhost Mavuno server.

## Independent controls

- Public `GET /ready` returned HTTP 200 and JSON status `ok` before and after the simulator attempt.
- A synthetic form POST through the public tunnel to `/africas-talking/ussd` returned HTTP 200, `text/plain; charset=utf-8`, and the Mavuno `CON` main menu. The synthetic session and caller were disposable. This is **not** provider traffic.
- The sandbox dashboard's callback form was changed to the new tunnel URL. A full reload showed the new `/africas-talking/ussd` URL on the service-code row. Its event URL read back as `N/A`; no event callback was tested.

## Provider observation

- One simulator dial using a disposable caller displayed the provider's generic network-error message. Its session row showed `Failed`, one hop, and about one second.
- The provider session detail named the **previous stopped tunnel host** as its attempted destination and reported `java.net.UnknownHostException`. The new Mavuno callback was therefore not exercised by that dial. The dashboard read-back alone did not prove the provider's routing state had updated.
- A second attempt stayed on the simulator's `USSD code running...` state and did not produce a new session row during observation. Reloading and reconnecting the simulator then stayed on `Connecting...`. No second callback or application outcome is claimed.

No raw phone number, provider session ID, tunnel hostname, entered business data, or token is retained here. The first failure is evidence of a stale provider-side destination for that attempt; the later simulator stall has no established root cause. The prior [event diagnosis](../../../../docs/AFRICAS-TALKING-EVENT-DIAGNOSIS.md) likewise found working public controls but failed provider attempts. P2-07 remains in progress. Retry only after a stable callback host is available and a fresh provider session detail confirms the provider called that exact host; then follow the [Mavuno walkthrough](../../../../docs/MAVUNO-SANDBOX-WALKTHROUGH.md).

At cleanup, the temporary tunnel, Mavuno process and isolated Redis container were stopped. The saved dashboard callback still pointed at this now-stopped temporary tunnel, and its event URL read `N/A`. The attempted restoration of the prior callback/event values was not submitted because automatic approval review rejected that external configuration mutation pending explicit user confirmation. Do not dial this channel until its callback is updated to a reachable host.
