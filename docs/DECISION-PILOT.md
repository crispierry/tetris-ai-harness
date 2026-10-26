# Foreground Decisions pilot

This dedicated CLI supports Cris's explicit approval for up to three native Decisions requests in one immutable 60-second dispatch window, one at a time, with no retry or fallback. It uses a separately qualified, privately verified project with a configured USD 1.00 enforced monthly budget. Provider enforcement and billing may be delayed. A USD 1.00 charged-cost ceiling is **not guaranteed**. The total billable-input ceiling remains unverified; measured billing remains unknown.

This path does not qualify the ordinary live service. `server.mjs`, the browser UI, existing owner pairing, strict qualification and fixture behavior are unchanged. There is no pilot server flag or browser connection path. No key or account discovery occurs.

## Private configuration

The CLI requires an absolute configuration path. Its parent must be an owner-controlled real directory with mode `0700`; the configuration must be a real, singly linked owner file with mode `0600`. Existing secure-file checks reject symlinks and identity changes. The exact configuration keys are:

- `directory`: absolute private durable ledger directory, outside the repository. Existing lineage/enrollment rules apply.
- `lineage`: stable bounded identifier for this pilot. It cannot be changed to refill an existing pilot.
- `qualification`: exact `owner-risk-accepted-decisions-pilot-1` qualification described below.
- `policy`: exact `risk-accepted-project-pilot-policy-1` policy described below.
- `recordFile` and `manifestFile`: distinct absolute new file paths in private `0700` directories. Both are created exclusively as `0600`; existing files are never overwritten.

The qualification binds `gpt-6-luna`, `POST https://api.openai.com/v1/decisions`, request schema `decisions-create-fixed-1`, request/response byte bounds `1048576`/`65536`, and an immutable `pilotStartedAt` epoch timestamp in milliseconds. Its `riskAcceptance` contains exactly `acceptedBy: "Cris"`, `acceptedAt`, `evidenceReference`, and `riskCode: "unquantified-project-hard-limit-enforcement-delay"`. Its `projectEvidence` contains exactly the privately verified `projectId`, raw parsed API-key UTF-8 SHA-256 `keyFingerprint`, `keyProjectBindingVerified: true`, `thresholdAmountCents: 100`, `currency: "USD"`, `interval: "month"`, `enforcementStatus: "enforcing"`, `checkedAt`, and `evidenceReference`. Project evidence must be checked no more than 15 minutes before the immutable start. Acceptance and evidence timestamps cannot follow the start.

The policy binds `qualificationDigest` to `digest(qualification)` from `decision-store.mjs` and fixes `maxAttempts: 3`, `maxRuns: 1`, `maxEpochs: 1`, `maxPlacements: 3`, `maxConcurrentUpstream: 1`, `timeoutMs: 1500`, `retryLimit: 0`, and `fallback: "none"`. Its `expiresAt` must be in the future and no later than `pilotStartedAt + 60000`. The durable policy digest therefore binds the private qualification as well as admission. Reusing expired evidence or changing the start/policy on the same ledger fails; there is no automatic renewal or refill.

No qualified configuration or project evidence is supplied by the repository. The existing fixed credential file is loaded only after qualification, output destinations and the durable store pass validation. The SHA-256 of the raw parsed key must exactly match private project evidence before the service is created. Every POST sends the exact verified project through `OpenAI-Project`; headers and endpoint are not configurable.

## Authorized invocation

After the owner independently verifies the project, key binding, enforced budget and current approval, the dedicated foreground command is:

```sh
node decision-pilot-runner.mjs --config=/absolute/private/pilot.json --enroll
```

Use pinned Node 24.22.1. `--enroll` is only for a new explicitly approved lineage; omitting it reopens an existing ledger without granting another run. The CLI supplies no fixture transport or credential-path override. Programmatic loader/transport injection exists only for disposable offline tests with dummy credentials.

Before dispatch, the CLI prints these exact disclosures; capture stdout in the owner's private operational log:

> Native Decisions pilot: owner-approved, risk accepted.
>
> Authorization: up to 3 requests in a 60-second dispatch window, sent one at a time. No automatic retries.
>
> Configured project budget: USD 1.00. Provider billing may be delayed; a USD 1.00 charged-cost ceiling is not guaranteed.
>
> Input-token ceiling: Unverified. Measured billing: Unknown.

Every attempt is durably counted before `fetch`. There is no numeric token or money reservation. Legacy ledger `used.inputTokens` and `used.estimatedMicros` remain unused internal zero fields; public reservation and actual-cost fields are `null`, never reported as zero dollars. Reported usage must include valid safe-integer input/output/total tokens and valid recognized cache subsets. Missing or malformed usage, schema/model/refusal/authentication/rate errors, stale policy, overlap, cancellation, timeout and authenticated predispatch failures stop the one-run pilot durably. No recovery action permits a fourth request.

Each request retains the existing 1500 ms deadline. The actual upstream slot and ledger lock remain held until the dispatched fetch positively settles, including after cancellation. A transport that ignores abort produces an uncertain result and `drain_pending`; the lock is retained and the ledger requires explicit reconciliation. Do not treat cancellation or a process interruption as a refund.

## Artifacts and assurance

The runner uses the existing Controller and canonical Journal, writes the exact public JSON, reads it back, hashes those bytes and runs `verifyDecisionUIRecord` locally. It makes no HTTP listener and uses no browser. Public pilot policy, receipt and accounting have separate exact schemas; strict and fixture records keep their existing validators. Public records omit project ID, key fingerprint, private evidence references, credentials, capabilities and raw responses. Usage and actual billing are separate facts.

The private manifest retains the opening disclosure, immutable start/digests, stop reason, drain state, durable attempt/completed/uncertain counts, placements and public-record hash/verification. Unknown billing and reservation fields remain `null`. A partial saved prefix can verify canonically while the pilot fails. CLI success requires a verified, drained placement cap or natural game terminal outcome; failure, cancellation, expiry, accounting failure and unverified/drain-pending results are not success. Canonical verification establishes consequences conditional on the recorded observed sequence, not provider or billing authenticity, wall-clock provenance, model quality or a completed 300-line game.
