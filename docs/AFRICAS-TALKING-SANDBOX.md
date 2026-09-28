# Africa's Talking sandbox evidence checklist

Status: Eleven actual sandbox interactive callbacks are [retained and reconciled](../tests/fixtures/africas-talking/captured/2026-09-28-manifest.md), including repeated choices, a cancellation attempt, the back token, free text, and terminal responses. **End-event evidence remains pending**, so P2-01 is still in progress. This does not claim a connected Mavuno deployment.

The [provider contract](AFRICAS-TALKING-CONTRACT.md) records verified documentation and outstanding questions. The [synthetic fixtures](../tests/fixtures/africas-talking/README.md) exercise the wire shapes without claiming provider traffic.

## Run the evidence probe

```bash
CAPTURE_FILE=/private/tmp/ussd-at-sandbox-2026-09-28.jsonl PORT=3101 \
  node scripts/capture-africas-talking.js
```

The probe binds to localhost, accepts form-encoded `POST /ussd` and `POST /events`, and writes only sanitized JSONL with mode `0600`. Each run requires a new output file. It does not run Mavuno, authenticate the provider, forward business inputs, or provide durable session processing. Its replies are fixed synthetic menus: choose `1` to continue, then `2` to finish. The response is UTF-8 `text/plain` with `CON ` or `END `. Event requests receive `200 OK`. These are probe choices, not a claim about provider event acknowledgement requirements.

Use a controlled HTTPS tunnel or an existing callback host to route the two paths to this probe. Configure the callback/event URLs in the sandbox dashboard according to the [official setup guidance](https://help.africastalking.com/en/articles/9915125-how-do-i-go-live-with-ussd). Record the transport and access controls in the evidence manifest; a received POST alone does not prove its source. Do not expose the existing Mavuno JSON endpoint as an Africa's Talking adapter.

The recorder accepts at most 500 records, limits each request to 16 KiB and 32 form fields, rejects duplicate decoded keys, and stores no headers, query strings, raw phone numbers, session IDs, entered values, error messages, or app response values from provider notifications. Those size limits are local tooling policy, not provider limits. It emits no raw request/error logging. Identity maps live only in process memory and are lost on restart. A restarted run cannot join aliases to an earlier run.

On shutdown the recorder also prints aggregate response counts using only fixed route labels (`/ussd`, `/events`, `other`) and numeric HTTP statuses. These counters distinguish rejected requests from no requests reaching the probe without retaining arbitrary paths, headers or payloads. Save them with the observation window in the manifest when diagnosing missing notifications.

Caller, service, session, and network values become stable aliases. Transcript segments become stable value aliases; repeated choices remain equal, positions and empty segments remain visible. Recognized event status values (`Success`, `Incomplete`, `Failed`) are retained; other event values are redacted. Unknown field names/values are omitted and only a count is retained. Optional headers such as hop metadata are not captured by this probe. This prevents identity disclosure but means the capture cannot replay exact app choices, measure notification durations/costs, or prove header behavior. Use a separate synthetic test for exact replay; verify duration/cost/header behavior in the sandbox console and document only sanitized observations.

For a local smoke check, submit synthetic values:

```bash
curl --fail http://127.0.0.1:3101/ussd \
  --data-urlencode sessionId=synthetic-session \
  --data-urlencode phoneNumber=+254700000001 \
  --data-urlencode networkCode=99999 \
  --data-urlencode 'serviceCode=*384*000#' \
  --data-urlencode text=
```

This local request is synthetic evidence. Stop the probe with `Ctrl-C`; do not add that smoke-check record to captured provider fixtures.

## Actual provider run

Use a sandbox account and a provisioned simulator service code. Keep capture traffic separate from local requests. Record the following in a manifest alongside the sanitized records:

- Capture date, environment (`sandbox`), country/network scope, contract source URLs, and the tested commit.
- Scenario-to-record mapping, including a simulator/session reference that contains no caller identity.
- Method, content type, field presence, and transcript shape checked against the provider console. Confirm whether fields are absent, present-empty, or populated; do not infer optionality from the table alone.
- Capture sanitation method, session alias scope, and unsupported/omitted header or event values.

Required scenarios:

- [x] First dial: initial callback has empty `text`; fixed menu renders.
- [x] Choose `1` twice: callback transcript advances from `1` to `1*1`, rather than confusing the second choice with a duplicate.
- [x] Choose `2`: `END` is displayed and the handset/simulator session closes.
- [ ] Capture the corresponding end notification and reconcile its session alias and documented field presence with the callback records.
- [x] Cancel/abandon a separate session; record whether and how the provider sends an end notification. CANCEL closed the simulator; no accepted end-event record was retained. This does not prove non-delivery (rejected requests are not logged by the current probe).
- [x] Record observed ordering/timing of end events. A separate diagnostic run counted zero requests to `/events` through 77 seconds after END. Absence during a bounded observation window is an observation, not proof that events never occur.
- [ ] Confirm callback authentication/network controls supported by this sandbox setup. Do not claim a caller binding check authenticates the provider.
- [ ] Exercise or obtain first-party confirmation for retries, request identity, ordering, and delivery guarantees. If the simulator cannot provoke a retry, retain the uncertainty and the synthetic replay cases.
- [ ] Verify response limits/encoding and error/deadline behavior for the intended deployment profile. Sandbox behavior does not verify Kenyan telco limits; distinguish documentation from observations and keep live checks pending until provisioning.

After the run, inspect sanitized files for disclosure, copy reviewed records under `tests/fixtures/africas-talking/captured/`, and add the manifest. Change provenance to `sandbox-capture-verified` only after cross-checking provider-console evidence. Keep synthetic cases separate and keep unknown guarantees explicitly unresolved. P2-01 remains in progress until required actual callback/end-event evidence is present. Provider retry guarantees may remain unknown; later gateway behavior must be conservative.

P2-03 adds the real adapter; P2-04 adds durable replay; P2-07 validates the complete Mavuno journey through the sandbox. This probe satisfies none of those runtime guarantees.
