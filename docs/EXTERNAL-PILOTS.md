# External developer pilots (P4-04)

Status on 2026-10-02: pilot materials prepared; no participants recruited, independent feedback collected or deployment completed. P4-04 remains open. Provider readiness depends on [P2-07](MAVUNO-SANDBOX-WALKTHROUGH.md); local onboarding may be evaluated while that gate remains open.

## Purpose and participants

Recruit 2–3 independent developers or teams with a concrete USSD use case. Include someone unfamiliar with this repository and someone who owns a provider/deployment integration. These are recruitment criteria, not confirmed participants. Internal agent runs do not count as independent pilots.

Use the [pilot register](pilots/REGISTER.md) and one copy of the [session record](pilots/SESSION-TEMPLATE.md) for each participant. Keep names and contact details in the owner's private contact system; use aliases here. Record permission before sharing quotes or identifiable feedback. Invite/contact participants only when the owner identifies the recipient and authorizes the communication.

The owner confirms participants, schedules sessions and owns any infrastructure account. Each participant chooses a small real use case, completes setup, records blockers and returns for a second session. Maintainers assist after recording the unaided attempt. Repository activity and feature count are not evidence of repeat use or commercial demand.

## Give each participant this packet

1. A specific source revision or installed tarball and Node version. Current published npm 3.0.0 does not contain the subsequent unreleased workbench/metrics additions. For those features, use a tarball packed from the selected checkout; do not assume npm latest matches it. Record the revision and install source separately. Do not push/publish a package just to start a pilot.
2. [First flow and workbench walkthrough](WORKBENCH-QUICKSTART.md), the root README and the runnable Mavuno fluent SDK example.
3. [Starter run guide](../examples/live-market/README.md), [environment example](../examples/live-market/.env.example), [provider walkthrough](MAVUNO-SANDBOX-WALKTHROUGH.md), [support matrix](SUPPORT-MATRIX.md) and [runtime contract](RUNTIME-CONTRACT.md).
4. [Metric definitions](METRIC-DEFINITIONS.md), [dashboard](METRIC-EXPORTS-AND-DASHBOARD.md) and [retention/deletion controls](METRIC-RETENTION.md), when observability is relevant to the participant's use case.
5. The session record, with a clear statement that feedback is voluntary and creates no payment, SLA, production-readiness or purchase commitment.

Check links and commands before sending. Never include provider credentials, real caller data or customer order data in this packet.

## First session: observe setup and the first useful flow

Record the participant's environment and previous USSD experience before starting. Start timing when they begin following the guide. Record elapsed time to install, run a first menu, create/change a state, inspect a transition and export/run a regression test. Distinguish active work, waiting on installs/provisioning, and maintainer assistance. Stop the unaided timer when help begins; do not combine assisted completion with unaided setup time.

Ask them to build a small flow they need, including validation, back navigation and a terminal response. Record each blocked step with command/UI step, sanitized error, expectation, workaround, help provided and resulting outcome. Keep unsuccessful attempts. Capture missing production requirements in their own words and classify whether they are verified requirements, preferences or maintainer inference.

Finish by asking what was useful, where they would have stopped without help, which other approach they currently use and what would make them return. Do not prompt for praise or turn a suggestion into a purchase commitment.

## Second session: actual repeat use

Arrange a participant-agreed follow-up after they have had time to use the tool independently. Record whether they returned, what they built or changed, and source evidence for that action. A promise to return, scheduled meeting or maintainer-generated demo does not count as repeat usage. Record no return or withdrawal without inventing a reason.

Summarize recurring problems only after comparing independent records. Keep numerator and denominator explicit: for example, two of three participants blocked on callback configuration, with the third not attempting that step. Separate provider provisioning problems from library behavior, and observed facts from inferred explanations.

## One owner-approved deployment

Attempt a real deployment only if a pilot owner provides infrastructure, provider service, access and permission. Before the attempt, record the owner, scope, environment, allowed changes and rollback. Do not silently expose a workbench, Redis, admin routes or caller data. The provider ingress should allow only intended callback paths with verified origin controls.

Verify provisioned service/routing and callback reachability, runtime/Redis readiness, configured response byte budgets, order/idempotency behavior if applicable, independent data read-back, observable errors, retention/deletion responsibilities, and drain/restart behavior. Save redacted evidence. A temporary tunnel, local Redis test or saved callback setting alone is not a real deployment. If access/provisioning is unavailable, keep the deployment gate open with its concrete dependency.

## Completion and decision handoff

P4-04 is complete only when 2–3 independent developers/teams are recruited and their actual setup times, blockers, production requirements and repeat-use outcomes are recorded; the permitted deployment is assisted or its unavailable owner/provisioning dependency is explicitly recorded; and the P2-07 gate is resolved. Do not mark the task complete for preparation alone.

P4-05 compares these records before deciding whether to deepen the SDK, offer hosted inspection/analytics, or address a proven provider/vertical need. Preserve contrary evidence and the reasons to defer alternatives. Developer feedback, budget discussions and signed commercial commitments are separate facts.
