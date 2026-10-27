# Local owner-approved browser Decisions session

This is a separate risk-accepted local browser mode. It reuses owner pairing and the existing three computer-player screens, and is not a hosted or Netlify deployment. The shared isolated project's configured USD 1 monthly limit includes earlier usage, including the earlier pilot. Billing enforcement can be delayed and charges may exceed that limit. Actual billed spend and remaining billed budget are unknown. The total billable-input ceiling remains unverified.

The fixed technical envelope is one hour from explicit operator activation, at most 1,000 aggregate upstream attempts across 64 lifetime owner-issued grants and 100 bounded game epochs per grant, at most 1,000 placements per participant/game, one actual unsettled upstream fetch globally, 1500 ms per request, no automatic retries and no fallback. The 300-line Marathon goal can lose or stop at a safety, session or provider limit. Neither the project budget nor these limits guarantee reaching it.

## Activation and private evidence

The ordinary server is OFF by default. Browser risk mode requires all of:

```sh
node server.mjs --decision-browser-owner --decision-browser-config=/absolute/private/browser.json --enroll-decision-browser
```

Use pinned Node 24.22.1 and the existing supervised local identity/port environment. These flags are mutually exclusive with fixture and strict-live flags. `--enroll-decision-browser` is only for a new explicitly approved fixed lineage. Reopening the same config does not renew its activation or refill its ledger.

The exact private config keys are `directory`, `lineage`, `policy`, `qualification`. Existing secure-file checks require a real, singly linked owner file at mode `0600` in a real owner directory at mode `0700`. Ledger storage remains private and outside the repository. The new fixed credential path is `~/.config/tetris-ai-harness/openai.browser.env`; this mode never loads the legacy strict/CLI key path. The file contains only `OPENAI_API_KEY=<key>` and is read through the existing secure parser. No key discovery or creation occurs.

The qualification kind is `owner-risk-accepted-decisions-browser-1`, with the same fixed model, endpoint, method, request schema and byte bounds as the pilot. Replace `pilotStartedAt` with `activationStartedAt`. Risk acceptance is the exact `{acceptedBy, acceptedAt, evidenceReference, riskCode}` owner approval using `acceptedBy: "Cris"` and `riskCode: "unquantified-project-hard-limit-enforcement-delay"`. Exact project evidence is `{projectId, keyFingerprint, keyProjectBindingVerified, thresholdAmountCents, currency, interval, enforcementStatus, checkedAt, evidenceReference, keyExpiresAt}`. It must bind the raw parsed key's SHA-256 to the privately verified project, confirmed enforcing USD 100-cent monthly limit, and verified key expiry. Project evidence is checked within 15 minutes before activation. Acceptance and evidence cannot follow activation.

The policy kind is `risk-accepted-project-browser-policy-1`. It binds `qualificationDigest: digest(qualification)` and fixes `maxAttempts:1000`, `maxRuns:64`, `maxEpochs:100`, `maxPlacements:1000`, `maxConcurrentUpstream:1`, `timeoutMs:1500`, `retryLimit:0`, `fallback:"none"`. Its immutable `expiresAt` must be no later than `activationStartedAt+3600000` and the verified key expiry. There are no token or monetary reservations. Qualification, immutable policy and the durable store are validated before loading the key, and the raw parsed key hash is matched before service creation. Every actual POST sends the exact privately verified `OpenAI-Project` header.

The repository supplies no qualified real configuration. Account/project/key verification and activation are explicit operator work after frozen acceptance, not part of source tests or coding time.

## Pairing and play

Select OpenAI, Connect, and match the full fingerprint to the local inherited owner-stdin listing. The existing exact owner approval command issues a one-time grant. Connect alone issues no game decision and never starts play. The resulting screen is connected and paused until the human presses Start or Step. Comparison still requires local left, OpenAI right and one sample. There is no HTTP approval route or automatic grant.

The existing pairing panel permanently displays this line for browser risk mode, including before Start:

> $1 monthly project limit. Billing enforcement can be delayed; charges may exceed that limit.

The panel shows authenticated aggregate remaining session attempts and immutable local expiry with time zone. Details separate session attempts from this run's attempted/completed/placement/uncertain counts. They identify provider-reported usage separately from billing, disclose shared earlier project usage, and report billing and token bounds as Unknown/Unverified. Strict and fixture modes retain their own provenance and reservation semantics. Stale counts are explicitly unavailable and cannot authorize another paid request; authenticated reconciliation refreshes the controls. Replay remains stored visual frames, with zero choices, and Reset never refills session allowance.

## Durable holds and recovery

Every upstream attempt is counted durably before dispatch, with no refunds. Another grant's overlap request is rejected without cancelling the actual in-flight fetch. The global slot and ledger lock remain until the actual fetch/response stream settles, even after abort. Reads and close remain authenticated and available during holds.

Completed responses require an explicit bound browser acknowledgement after the Controller has synchronously journaled and committed the placement. The original decision timer ends before this synchronous commit; a separately bounded local-control phase confirms it while Start/Step remain busy. Pause/Stop during confirmation preserve the committed placement, and Reset retains the confirmation fence without restoring the old board when it settles. Confirmation failure retains the placement and holds the session without logging a second failed decision for the same request. Unacknowledged completion blocks further dispatch, Reset and new pairing; restart cannot clear it. The bridge distinguishes actual Controller placement commit from ordinary cancellation cleanup. A stale or late reply cannot silently release the session for another request.

A settled predispatch cancellation/rejection and an explicit native refusal permit an explicit safe Reset after authenticated settlement. A dispatched timeout/cancellation, transport ambiguity, lost completion delivery, malformed success/usage, authentication/model mismatch, unknown quota, explicit provider budget error, expiry or store failure creates a global reconciliation hold. Generic quota is never described as proof that USD 1 was spent. Holds persist across Reset, grants, tabs and restarts. Unresolved durable requests retain the existing restart guard; no automatic reconciliation is supplied. Runtime drain failure retains the ledger lock rather than assuming a refund or settlement.

Local/human peers keep their existing independence. Stops retain boards and recorded history; unfinished lanes are censored, never Marathon victories. Completed lanes remain frozen. Public browser policies, compact receipts and accounting use separate exact schemas; existing strict/pilot schemas remain unchanged. They contain public caps, policy binding, expiry, risk disclosure and null reservations/billing, and omit private project IDs, key hashes, authority references, capabilities and raw provider responses. Canonical saved-record verification recomputes game consequences conditional on observed piece inputs; it does not authenticate provider identity, billing, seed authenticity or wall time.

## Explicit owner abandonment and successor

`decision-recovery.mjs` supplies an offline OS-owner recovery operation; it adds no HTTP or browser approval path and reads no provider credential. After the supervised server exits cleanly through its drain path and releases its lifetime lock, the owner may bind the exact expected ledger SHA-256, current human recovery authorization and private drain evidence to one uncertain request. Recovery acquires the same exclusive lock without stealing it, saves the exact original bytes, and records a validated `reconciled-abandoned` disposition. The original uncertain entry is retained in the reconciliation event. Provider outcome and billed cost stay unknown; the choice is never replayed, delivered or applied. All attempts and the original immutable policy remain unchanged. The old game and lineage stay permanently closed/held.

A separately authorized one-hour successor may be prepared only for the single lineage named by that disposition, with the same verified project/key and USD1 monthly boundary. It inherits consumed attempts (no refund), records predecessor/reconciliation identity, and binds one exact successor policy. Write its private activation config only after successor preparation succeeds. Repeating preparation for that same successor does not reset its counters. Recovery-only store handles cannot enable any Decisions service, and ordinary reopening validates disposition and predecessor counter metadata. This is explicit owner abandonment after investigation and positive local fetch/stream drain; it is not proof of remote cancellation, successful completion, zero billing, or an automatic retry/reconciliation mechanism.

Successor debits and predecessor metadata are persisted in the first enrollment snapshot, so there is no zero-count intermediate ledger. A failure before that first ledger write leaves the existing enrollment marker and no usable ledger; ordinary startup stays closed and owner investigation is required. The tool never deletes the marker or treats missing history as permission to enroll again. A committed after-rename snapshot can be reopened/reconciled using the identical successor binding without resetting counters.
