# Africa's Talking USSD contract

Research date: 2026-09-28. Roadmap item: P2-01. Initial target: Africa's Talking sandbox, with Kenyan operator limits recorded separately.

This is a documentation-verified contract and a preparation guide for captured fixtures. **Eleven sanitized sandbox interactive callbacks have since been captured**, alongside the synthetic [local fixture corpus](../tests/fixtures/africas-talking/). See the [capture manifest](../tests/fixtures/africas-talking/captured/2026-09-28-manifest.md). Interactive captures do not establish end-event delivery, authenticated provider origin, or live operator guarantees. Follow the [sandbox capture walkthrough](AFRICAS-TALKING-SANDBOX.md) before closing P2-01 or claiming provider validation.

The official developer portal returned HTTP 403 to the web retrieval tool but loaded in the in-app browser. Its rendered Overview, Handle Sessions, Notifications, and general Notifications pages were read directly. Help Center sources below were also read. Official documentation establishes expected behavior; dated Help Center guidance and actual service provisioning still need reconfirmation for a live launch.

## Callback wire contract

The provider sends an HTTP `POST` to the callback URL registered for the service, using `application/x-www-form-urlencoded`. The response is a menu string with `text/plain` content type. The Overview gives an application response ceiling of **10 seconds**. [Official Overview](https://developers.africastalking.com/docs/ussd/overview)

| Form field | Documented type | Meaning |
| --- | --- | --- |
| `sessionId` | String | Provider session identity, retained throughout the session |
| `phoneNumber` | String | Subscriber interacting with the service |
| `networkCode` | String | Subscriber's telco identifier |
| `serviceCode` | String | Assigned USSD code |
| `text` | String | Empty initially; later the complete input history joined by `*` |

These five fields are listed in the API payload table; none is labelled optional. The page says requests arrive when a user dials and after each menu reply. [Official Handle Sessions](https://developers.africastalking.com/docs/ussd/handle_sessions)

**Local implementation decisions, not additional provider promises:** require one string value for each listed field, allowing `text` to be empty; reject duplicate keys rather than depending on a framework's first/last-value behavior. Decode the form once. An encoded `+` in a phone number must survive as `+`; an unescaped `+` has the form-decoding meaning of space. Reject a phone number that no longer matches the configured caller format rather than repairing it silently. Preserve exact decoded transcript text; do not trim, coerce menu choices to numbers, or decode it twice. Bound request bytes before parsing, and keep field-size limits configurable until captures establish realistic bounds.

For a synthetic session, the successive transcripts `""`, `"1"`, `"1*1"` represent initial display and two distinct selections. The last token alone cannot distinguish a retry of the first selection from a new second selection. This interpretation follows the documented accumulated `text` format; the provider does not document a per-turn request ID here. [Official Handle Sessions](https://developers.africastalking.com/docs/ussd/handle_sessions)

The future adapter must bind a session to configured service/application scope and caller. Treat a changed caller/service as a conflict; do not trust supplied fields as authentication. Preserve the full transcript and its position for P2-04 receipts. A transcript extension, an exact repeat, a shorter transcript, and a divergent transcript are different local cases. Do not replay all tokens into an existing state machine on every callback.

### Optional journey metadata

The optional response header `at-ussd-hop-metadata` is echoed in the next request under the same header. Its value identifies a journey step, is visible on the dashboard, must be at most 99 characters, and must exclude `|`. Use static non-sensitive step labels. [Official Handle Sessions](https://developers.africastalking.com/docs/ussd/handle_sessions)

## Response, encoding, and country limits

Use `CON ` for a continuing menu and `END ` for a terminal menu. The provider documents termination for a HTTP `40X` or a response without a valid prefix. Its Help Center also rejects empty responses and whitespace before the prefix. [Official Handle Sessions](https://developers.africastalking.com/docs/ussd/handle_sessions), [Prefix error guidance](https://help.africastalking.com/en/articles/484351-why-am-i-seeing-the-error-messages-response-should-start-with-a-con-or-an-end)

Local response target: HTTP 200, `Content-Type: text/plain; charset=utf-8`, and the raw menu body without JSON quoting, HTML, or a byte-order mark. `text/plain` is verified; the charset suffix and 200 are our explicit interoperability target to check with real callbacks. An official C# example uses UTF-8 plain text but is archived, so it does not prove telco character support. [Official Overview](https://developers.africastalking.com/docs/ussd/overview), [Archived official C# example](https://github.com/AfricasTalkingLtd/africastalking.Net#building-a-ussd-application)

The session documentation warns against special characters. It does not specify a complete permitted alphabet or whether character budgets count Unicode code points, UTF-16 units, encoded bytes, GSM units, or the `CON `/`END ` prefix. A generic 182-character library default is not evidence of a provider limit. Multilingual display, combining marks, emoji, and exact boundary counting require operator-specific verification. [Official Handle Sessions](https://developers.africastalking.com/docs/ussd/handle_sessions)

| Kenya operator | Documented menu limit | Documented user input limit |
| --- | --- | --- |
| Safaricom | 160 characters | 80 characters |
| Airtel | 184 characters | 90 characters |
| Equitel / other operators | Not established by this source | Not established by this source |

The Help Center says long Safaricom/Airtel menus may be automatically paginated with `98:More 00:Back`. The article is dated 2020; do not assume simulator behavior or rely on these pagination keys without a live operator check. [Kenyan character limits](https://help.africastalking.com/en/articles/1284096-what-is-the-character-limit-for-ussd-menus-and-user-input-in-kenya)

Local conservative starter policy: short ASCII menus, own pagination below the selected operator budget, and no clipping that hides a choice or confirmation. Leave margin while prefix counting is unresolved. Unknown network codes should not acquire a larger budget automatically.

## Timing

| Scope | Documented timing |
| --- | --- |
| Gateway application response | At most 10 seconds |
| Safaricom Kenya | Session 180 seconds; customer inactivity 30 seconds |
| Airtel Kenya | Session 180 seconds; application 15 seconds; connection 10 seconds; customer inactivity 60 seconds |
| Equitel Kenya | Session 180 seconds; customer inactivity 30 seconds |

Sources: [Official Overview](https://developers.africastalking.com/docs/ussd/overview), [Kenyan session duration](https://help.africastalking.com/en/articles/1284071-what-is-the-duration-of-a-ussd-session-for-kenyan-telcos).

The gateway's 10-second ceiling and Airtel's 15-second figure describe different layers and sources; use the stricter applicable ceiling, not 15 seconds as an application allowance. The exact timeout boundary and simulator enforcement remain unobserved. P2-05 must set an application deadline with network margin, include queue/lock waiting in that budget, and cancel supported downstream work. A storage TTL is not the handset or callback deadline.

## Termination notification contract

A separately configured event callback receives a `POST` with `application/x-www-form-urlencoded` at session end. [Official USSD Notifications](https://developers.africastalking.com/docs/ussd/notifications)

| Form field | Documented type / semantics |
| --- | --- |
| `date` | String; UTC `yyyy-MM-dd HH:mm:ss`, notification time |
| `sessionId` | String; same identity as interactive callbacks |
| `serviceCode`, `networkCode`, `phoneNumber` | Strings; service, telco, subscriber |
| `status` | String; `Incomplete`, `Success`, or `Failed` |
| `cost` | String; session cost, no money format established here |
| `durationInMillis` | String; session duration in milliseconds |
| `hopsCount` | Integer; journey step count |
| `hopsMetadata` | String; journey metadata joined with `|` |
| `input` | String; all input joined with `*` |
| `lastAppResponse` | String; last application response, including exact failed response |
| `errorMessage` | Optional String; failed callback error |

`Incomplete` denotes termination while more input was expected; `Success` denotes reaching the session's expected end; `Failed` denotes an application-response error. Only `errorMessage` is explicitly marked optional in the table. Form-decoded values arrive as strings even where the documented semantic type is Integer. Actual omission/empty-field behavior needs captures. [Official USSD Notifications](https://developers.africastalking.com/docs/ussd/notifications)

The network table identifies sandbox Athena as `99999`; Kenyan entries include Safaricom `63902`, Airtel `63903`, Orange `63907`, and Equitel `63999`. Treat labels as documentation values rather than current provisioning guarantees. [Official USSD Notifications](https://developers.africastalking.com/docs/ussd/notifications)

Local event policy: acknowledge only after safe durable acceptance; do not run a new interactive turn. Keep decimal money as text until currency/format is established. Treat event success as session completion, not proof of payment/order success. Preserve business-operation results independently of session expiry. P2-06 implements bounded local reconciliation for duplicate, late, and conflicting notifications; actual provider delivery and origin remain unverified. See [session end events](SESSION-END-AND-CALLBACKS.md).

## Authentication and network controls

The USSD 403 troubleshooting article recommends allowing the provider's IP address through hosting controls but supplies no address list. This establishes the relevance of ingress filtering, not a usable stable allowlist. Obtain current sandbox/live ranges for the intended region and validate proxy-origin handling before deployment. [USSD 403 guidance](https://help.africastalking.com/en/articles/1284121-why-is-my-callback-returning-a-status-403-response)

**Unresolved:** the reviewed USSD pages do not establish a request-signature algorithm, signing key, signature header, timestamp tolerance, callback Basic/Bearer authentication support, mTLS support, or a current IP range list. Do not claim any of those unavailable; confirm with provider support and actual ingress captures. Do not invent an `apiKey` callback field or header based on the outbound API authentication scheme. The Help Center article about verifying POST origin belongs to Voice and discusses API credentials/SIP; it is not sufficient evidence of a USSD inbound authentication contract. [Voice article and scope](https://help.africastalking.com/en/articles/5947646-how-can-ensure-that-the-post-request-to-my-callback-url-is-coming-from-africa-s-talking-and-not-some-other-place), [Voice collection](https://help.africastalking.com/en/collections/150771-voice)

Local deployment requirements: HTTPS, trusted ingress/proxy configuration, service/caller binding, bounded payloads, and rate limiting. These reduce risk but are not evidence that a request originated at the provider. A public capture endpoint must only serve the explicitly authorized sandbox test; do not describe it as production-authenticated until the origin controls are verified.

## Retry, ordering, and identity

The reviewed USSD pages document stable `sessionId` and cumulative input, but do not establish a per-turn request ID, retry schedule, maximum attempts, exact delivery guarantee, ordering guarantee, retransmission identity, or event-acknowledgement retry contract. HTTP 40X/malformed responses are documented to terminate interactive sessions; other failure handling needs confirmation. [Official Handle Sessions](https://developers.africastalking.com/docs/ussd/handle_sessions), [Official USSD Notifications](https://developers.africastalking.com/docs/ussd/notifications)

Do not borrow SMS retry rules for USSD. The SMS article's repeated delivery until HTTP 200 or 12 hours describes incoming SMS, not USSD interactive callbacks or termination events. [SMS-specific retry guidance](https://help.africastalking.com/en/articles/742510-where-are-my-incoming-messages)

Local resilience fixtures may deliberately reorder, duplicate, or conflict requests. Label them injected scenarios, not observed provider behavior. A likely receipt identity is service scope + session + transcript position + transcript digest, with stored caller binding; this is a proposed application design to assess in P2-04, not a provider guarantee. Never rely on the final choice alone, or on a timestamp missing from interactive callbacks.

## Capture and fixture decisions still open

Actual interactive callback evidence is now [retained and reconciled](../tests/fixtures/africas-talking/captured/2026-09-28-manifest.md): empty initial text, cumulative repeated choices, back-token/free-text transport, and successful CON/END display. End-event records, deliberate failures, deadline/limit checks, and provider-origin controls remain unverified; P2-01 is still open.

- [ ] Capture initial request, successive selections including `1` then `1`, back navigation, free text, and terminal response. Retain method/media type, field names, sanitized shape and timing.
- [ ] Capture `Success`, user abandonment/timeout `Incomplete`, and a deliberately failed sandbox response. Verify presence/emptiness of event fields, timestamp format, `hopsCount`, and `hopsMetadata`.
- [ ] Compare an optional metadata response header with the following callback and eventual event. Keep the label non-sensitive.
- [ ] Verify exact response header/charset and HTTP status acceptance, plus malformed-prefix behavior. Do not deliberately damage live sessions.
- [ ] Measure observed gateway timeout with safe sandbox delays; record that observed simulator timing does not prove carrier timing.
- [ ] Obtain provider confirmation of source controls/signing, retries, ordering, end-event acknowledgement status/body, retention, and country-specific exceptions.
- [ ] Confirm `*` inside user-entered text, empty later input, direct/deep dial behavior, maximum field/body sizes, network-code omissions, and transcript escaping. The published separator alone does not settle these cases.
- [ ] Verify prefix counting, alphabet/encoding, exact menu/input boundaries, and pagination behavior for each live operator before claiming its support.
- [ ] Review sanitized captures before committing; never commit credentials, real phone numbers, input containing names/PINs, session identifiers, or personal data copied into `lastAppResponse`/metadata.

Synthetic fixture recommendations: start with the documented five-field form; retain an explicitly empty `text`; include cumulative repeated choices, URI-encoded service/phone data, optional metadata headers, and all three documented end statuses. Add separate malformed/adversarial fixtures for duplicate keys, missing fields, wrong content type, oversize bodies, stale/divergent transcripts, scope/caller changes, and leading-space responses. Encoding and boundary cases are local parser/formatter expectations until validated with captures.

## Country and evidence boundaries

The sandbox uses a simulator rather than a handset and requires an externally reachable callback. A successful simulator run establishes only sandbox interoperability. [Official sandbox setup](https://help.africastalking.com/en/articles/1170660-how-do-i-get-started-on-the-africa-s-talking-sandbox)

This document's timing and menu budgets apply only to the named Kenyan operators and source dates. No Nigeria, Uganda, Tanzania, Rwanda, Malawi, Zambia, Ghana, South Africa, or other country-specific operational guarantee is made. Product availability is not proof of shared deadlines, character rules, provisioning, or billing behavior. [Official product-country availability](https://help.africastalking.com/en/articles/2727792-which-countries-are-africa-s-talking-products-in)

P2-01 remains open until sanitized actual sandbox samples are retained and unresolved provider assertions are either confirmed or explicitly limited. The Phase 2 exit gate additionally requires the complete Mavuno journey and later receipt/deadline/recovery work; documentation and synthetic tests alone cannot meet it.

The framework-neutral adapter and local demo endpoint are implemented under P2-03; see [adapter API and validation boundaries](AFRICAS-TALKING-ADAPTER.md). P2-01 remains open for event-delivery evidence.
