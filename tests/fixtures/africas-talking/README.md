# Africa's Talking evidence fixtures

`requests.json` contains **synthetic**, documentation-derived form requests for P2-01. It contains no captured provider traffic, and passing these checks does not satisfy sandbox acceptance. Provider sources and unverified behavior are tracked in [the contract](../../../docs/AFRICAS-TALKING-CONTRACT.md).

The corpus keeps cumulative transcripts intact. `1`, `1*1`, and `1*1*2` are distinct turns even though the newest value can be identical. An exact retry and an earlier transcript arriving late are separate cases. Caller/service conflicts, encoded punctuation, Unicode, empty segments, missing fields, duplicate keys, and invalid encoding are included. Interpretation and rejection policy belong to P2-03/P2-04; the capture parser only checks form encoding and ambiguity.

The synthetic phone numbers, service codes, and network code are placeholders. They do not identify provisioned services or assert a country/operator mapping.

Eleven actual interactive callbacks across two recorder runs now live under `captured/`, with a [manifest](captured/2026-09-28-manifest.md) recording the source, capture date, scope, scenarios, reconciliation and sanitation. Aliases are independent between files. This is partial evidence: the [sandbox checklist](../../../docs/AFRICAS-TALKING-SANDBOX.md) still requires end-event evidence. Never relabel a synthetic case as captured. Captured value aliases preserve equality and transcript position but cannot replay the original app selection; add a separate synthetic replay case when needed.
