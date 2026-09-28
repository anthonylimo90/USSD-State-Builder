# Event-delivery follow-up — 2026-09-28

The public events route works. A longer observation did not produce provider
event traffic, but this follow-up also exposed an upstream failure of interactive
callbacks. It does **not** establish why the earlier successful sessions had no
end-event records. P2-01 remains in progress.

## Controls and isolation

Using the committed capture tool at `996bde9`, a fresh HTTPS tunnel forwarded to
localhost port 3101. A synthetic, form-encoded `POST /events` returned HTTP 200,
UTF-8 `text/plain`, and body `OK` at 09:36:24 UTC. The separate control recorder
reported exactly `{"captured":1,"outcomes":{"/events:200":1}}`.

A synthetic `POST /ussd` independently returned HTTP 200 and the expected CON
menu at 09:37:51 UTC. Its recorder reported exactly
`{"captured":1,"outcomes":{"/ussd:200":1}}`. Neither control is provider
evidence; no synthetic request was added to captured provider fixtures.

The dashboard was updated to the fresh tunnel's `/ussd` and `/events` routes.
Both values were independently read back after a full dashboard reload.
The simulator was also reloaded and reconnected using the synthetic caller.
Two HEAD controls to `/events`, one each over IPv4 and IPv6, returned the
probe's expected 404 (it accepts POST only) at 09:41:05 UTC. These controls are
the only requests counted by the final observation recorder.

## Provider observations

The simulator's attempts at approximately 09:37, 09:38, 09:40, and 09:42 UTC
displayed a network technical-problems response. The console independently
recorded Failed sessions. Details for the 09:38 session showed:

- App response: `error code: 1033`.
- Error: `Received unexpected response code: 530 <none>`.
- One hop, one second; the final response was the provider's generic terminal
  error message.

The provider-only observation recorder was active from approximately 09:37:57
until 09:43:16 UTC, over five minutes after the 09:38 failed session. At shutdown
it reported exactly `{"captured":0,"outcomes":{"/events:404":2}}`.
The two 404s are our HEAD controls; no provider request was accepted or rejected
by the probe. The earlier 09:37 attempt likewise produced no provider record in
its recorder. This is a bounded observation, not a notification-delivery SLA.

[Cloudflare's error 1033 documentation](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1033/)
identifies an unavailable tunnel connection at the Cloudflare network. This is
evidence of an upstream transport failure for the inspected callback attempt,
before our parser or response handler. The console does not expose the target
host or edge trace for that request. We therefore cannot distinguish a stale
provider callback configuration from a failure to resolve the current tunnel
on the provider's network path. Local controls passing do not resolve that gap.

## What remains unresolved

- A longer **successful-session** observation could not be completed because
  provider interactive callbacks failed on this fresh tunnel. Failed-session
  notification traffic was not observed during the longer window either.
- The earlier missing Success/Incomplete events remain unexplained. This new
  transport failure must not be presented as their proven root cause.
- Retry timing, sandbox event support, and delivery attempts are not visible
  in the inspected session console.

Next verification should use a stable callback host (or provider delivery logs
confirming the exact target URL), then repeat normal completion and cancellation
with controls isolated from provider traffic. Obtain provider confirmation of
sandbox event behavior if requests still do not arrive. No support message was
sent as part of this run.

The temporary recorder and tunnel were stopped at 09:43:16 UTC. The retained
sandbox channel now points to that stopped tunnel and requires both URLs to be
updated to an active host before further testing.
