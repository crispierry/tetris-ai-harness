# Open-source preparation review

October 27, 2026. This review prepares source for publication. It does not change repository visibility, publish an article, deploy the game or activate paid play.

## Scope

Reviewed the canonical engine and candidate contract, independent comparison controllers, real-gravity execution and missed decisions, request/choice mapping, factual presentation, provider transport and redacted diagnostics, owner pairing, durable accounting and recovery, static serving, startup, replay compatibility, public documentation and repository history. Regression coverage includes malformed inputs, stale replies, cancellation, terminal states, timeout/refusal boundaries, ledger persistence, replay tampering and recording limits. All tests use explicit offline transports.

## Issues corrected

- Unknown comparison provider keys silently selected depth-one Lookahead. The factory now rejects them; explicit historical keys still resolve only to their documented implementations.
- Browser ledger reload validated predecessor totals but could accept a counter lower than the ledger's own dispatched-request count. Reload now requires predecessor attempts plus this ledger's recorded upstream dispatches. It preserves the damaged bytes and fails closed, with regression tests for original and successor ledgers.
- Local startup required private supervision environment values. `npm start` now derives Git head/base/tree and a fresh operation UUID, binds to loopback, and leaves paid service disabled by default. A temporary Git index captures source changes without altering the contributor's index. Invalid ports and non-Git directories fail explicitly.
- The repository lacked a license, credential/runtime ignore rules, contributor guidance, security guidance and a portable README. These are supplied, with the standard MIT license and matching package metadata.
- Removed obsolete orchestration bootstrap state from the current tree and a machine-specific documentation reference. The package's old scaffold name and manual-only introduction are replaced.
- Added an offline, read-only GitHub workflow, with official action releases pinned to commit hashes and checkout credential persistence disabled. It has no provider secrets, paid calls or deployment step.
- Preserved three exact research exports with integrity manifests, canonical replay tests, failure explanations and dated Terra/Sol cost scenarios. Private owner ledgers, project settings and credentials are excluded.
- The first Linux CI run exposed two timeout tests that assumed transport dispatch could always happen within 5–10 ms of starting request preparation. Production correctly expired before dispatch on the slower runner. Those tests now advance a controlled timer after a dispatch handshake, checking timeout, aborted transport and rejected late replies without weakening production deadlines.

## Maintained compatibility and deprecated code

There are no third-party npm/runtime dependencies. The test suite is run on pinned Node 24.22.1 with pending deprecation reporting enabled. The current app uses the canonical engine; no deprecated Node APIs or dependencies were identified in this review.

The frozen `legacy/classic-v1` and `legacy/marathon-v2` modules remain required by explicit saved-record dispatch and fixtures. Historical serializers and provider-policy versions also remain necessary to verify old experiments and recovery evidence. They are maintained compatibility, unavailable as new-game ruleset selectors. Removing them would invalidate the evidence the project preserves. Offline Astra/Jev protocol fixtures remain labeled tests, not live provider implementations or UI choices. The removed Local heuristic menu entry is not reintroduced; its evaluator remains an implementation component of Lookahead and replay.

## Publication inventory

Fetched every remote branch and both archive tags before scanning all reachable Git blobs. Pattern checks covered API keys, GitHub tokens, private keys, AWS keys, real-looking OpenAI project identifiers and local home paths. The only key-shaped match was the literal `sk-proj-dummy_secret_only` in a redaction test. No actual credential was identified. The current tree has no personal home paths or actual project identifiers.

Historical commits retain the removed bootstrap's orchestration UUIDs and an old local documentation path. They are reviewed metadata, not authentication credentials; removal from the current tree does not erase Git history. Commit authorship and historical project discussion will also become visible. No history rewrite was performed.

At inspection, GitHub had nine branches, two tags, ten issue/PR entries, nine issue comments, four inline review comments, and no releases, Actions artifacts or workflows. Text scans of the fetched discussions found none of the credential, real project-ID or home-path patterns. A pattern scan is a scoped check, not a guarantee that every possible secret or sensitive fact can be recognized. The research records contain public policy names, local request IDs and usage receipts, without pairing capabilities, credentials or project IDs.

The repository remains private. A future visibility change will expose the entire existing history and GitHub discussion, not just these files. Private owner configuration remains outside Git. This work does not rotate credentials, change the approved $5 threshold or claim final billing totals.

## Verification

All 400 source tests passed on Node 24.22.1 with pending deprecation reporting enabled and no deprecation warnings. A separate local smoke check passed all four pages, disabled Decisions status, actual serving PID/source identity, host/origin rejection and graceful shutdown. Its temporary server was stopped. No paid request was made. The preserved records also pass independent canonical verification, including reconstruction of the early hole-creating choices used in the article evidence.

GitHub workflow execution is a separate check from the local suite. Rendered layout is unchanged by these fixes; prior layout acceptance is documented in [BOARD-FIRST-DESIGN.md](BOARD-FIRST-DESIGN.md).
