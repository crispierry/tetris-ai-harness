# Player comparison

Open `/comparison.html` using the repository's existing local server. The manual game at `/` and solo player at `/harness.html` remain separate. Local players work without credentials. OpenAI play uses the separately qualified local owner service described in `DECISION-BROWSER.md`; the browser never receives an API key. Arbitrary replay import is unavailable.

The approved design is copied unchanged in `COMPARISON-DESIGN.md`. The page uses the existing dark arcade tokens, piece palette, system fonts and native semantic controls. The current shared Marathon contract is documented in `MARATHON.md`; the original design remains as historical context, with the Marathon brief superseding objective/status/cap wording.

## Controls and lane ownership

Choose Lookahead, Delayed mock, Error mock or OpenAI independently for each lane. Each Lookahead lane has its own depth selector from 1 through 6; the separate Local heuristic player is removed. Depth controls are hidden for other players and lock with the model selectors until Reset. Each OpenAI lane pairs separately with the local owner; other live providers are not implemented. Each sample receives fresh controllers, with independent state, RNG, pending decision and automatic loop; OpenAI grants persist across sample epochs without refilling the shared allowance. Paired samples use the same private deterministic seed internally, with no seed or hidden queue in exported records. A slow, failed or capped local lane cannot stop or mutate its peer. Two OpenAI lanes serialize requests under the shared service allowance; an unresolved paid request can block further OpenAI work. The next sample starts only after both lanes have an outcome.

Start runs eligible lanes independently. Pause cancels pending decisions and timers. Step makes exactly one decision in each eligible lane, then pauses; it does not retry a terminal/error lane. Stop retains boards, errors, outcomes and evidence; Start resumes eligible lanes. Reset clears the run, unlocks settings and repeats the same private sequence. Settings lock on the first Start or Step and remain locked through Stop and replay until Reset. To recover a failed lane or change its provider, Reset first.

Every async completion is bound to the current epoch and lane object. Pause, Stop, Reset, replay and sample replacement invalidate earlier loops; the accepted Controller separately rejects cancelled/stale responses. Browser visibility loss pauses active work. The UI registers no global gameplay keyboard handler: native Tab, Shift-Tab, Enter and Space operate controls without capturing unrelated typing.

## Bounds and interpretation

| Setting | Allowed range | Default |
| --- | --- | --- |
| Paired samples | 1–8 | 1 |
| Placement safety limit per lane/game | 1–1000 | 1000 |
| Visual playback pace | 30–1000 ms | 150 ms |
| Search placement nodes/evaluator calls | 1–4000 each | 4000 |
| Search time | 1–1000 ms | 500 ms |

Local decisions retain a 1500 ms deadline. OpenAI uses the authenticated session request deadline, with two additional seconds for local response delivery; the $5 Marathon session allows 10000 ms upstream. Gravity continues during both waits. Planned placements are at most 2000, retained frames at most 4000, and local-only exported UTF-8 JSON at most eight MiB. Comparisons using OpenAI share one 4000-event, 16 MiB canonical recording allowance across all samples, including series-envelope overhead. Frame storage reserves 128 KiB for configuration and paired summaries. If storage reaches its bound, play stops with an explicit archive error and retains existing frames/outcomes. Export performs an independent final byte check. A failed export creates no download.

Game time freezes while choosing; playback pace is not game time or measured local decision/search overhead. Lookahead uses `visible-beam-search-1` with the local `local-leaf-value-2` evaluator, selectable depth 1–6, deterministic tie order and a four-branch beam after each completed layer. It evaluates all offered roots before pruning; the full tree is not searched, and cache remains off. Search exhaustion is an Error with no partial selected placement. Any depth can reach its time/node limit; increasing limits beyond the UI bounds is unsupported. Raw board features and scalar leaf values are not probabilities. Lookahead assistance differs from the heuristic; this UI makes no equal-assistance model/provider comparison.

Each pair reports both actual outcomes plus left-minus-right score/line/piece differences. Expected, observed and missing pairs and the score-difference range are descriptive. Piece-capped and failed outcomes are censored; Marathon completion and natural blocked-spawn endings are identified separately. A completed lane stays frozen while an eligible peer can continue. Smaller limits are labeled Abbreviated run. No winner, improvement or provider-quality conclusion is inferred. Model calls are zero for these built-in local choices; actual monetary cost is not measured.

## Saved visual replay and export

The versioned DOMless facade retains its own immutable, allowlisted compact observation/decision/search frames. Boards are encoded as twenty strings of ten cells (`.` means empty), with the visible active piece and next five only. Placement facts include cells, orientation, route, feature deltas and score/line consequences; search frames include bounded summary counts and completion/error status, not complete search trees. Each frame references its own immutable lane/sample policy record, exported once and shown in live/replay details: evaluator identity and weights, depth/discount, node/call/time/output limits, visible horizon, reachability bounds, tie order, root reward, pruning/cache and rules/features/objective versions. Records retain actual local overhead. Provider-generated raw responses, credentials, private seeds/RNG, hidden queue entries and unbounded text are omitted. Trusted test-only factory injection is not a network sandbox for arbitrary executable code.

Replay cancels live work, advances only these saved frames and labels every lane Saved replay. Recorded overhead/outcomes remain explicitly recorded. It creates no decisions, provider calls, new frames or live metrics. Pause/Step/Start/Stop then control visual playback; Reset returns to a fresh run using the selected players. Local-only exports retain the visual replay format. Comparisons using OpenAI export canonical `decision-ui-record-2` records, or `decision-ui-comparison-series-1` for multiple observed samples, verifiable with the Node CLI described in `DECISION-UI.md`. Browser replay remains visual inspection. Export downloads only this session's own record; no untrusted import exists.

## Validation and remaining acceptance

Run focused checks with `node --test test/comparison.test.mjs test/comparison-ui.test.mjs` and the existing full suite with `npm test` on the repository's required Node version. The focused UI tests exercise the real facade through a minimal DOM fixture; they do not establish rendered acceptance.

Before completion, independently review the exact frozen candidate and inspect the running page at desktop/narrow widths, resize, native keyboard/focus, replay/export/error/search exhaustion, actual 200% enlargement and reduced-motion preference. Preserve actual browser/environment evidence and any limitations. Screenshots alone do not verify model/benchmark correctness. P8-006's separate enlarged-text gate remains a distinct pending acceptance item; this source change does not close or repair it.

Exports also retain calculated aggregate decision-wait and pace upper bounds, finite frame/byte admission and observed decision-attempt elapsed time. The observed sum may overlap across independent lanes; it is not a wall-time prediction. Local games have no expiry; OpenAI sessions retain their fixed owner-approved expiry. The overall sample status says Run finished; only lane `won` means Marathon complete, while placement exhaustion is `capped`.
