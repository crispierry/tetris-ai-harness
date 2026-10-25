# Offline Tetris harness v2

P8-002–007 extend accepted manual game 94a99a080fe0c7ec43505784efeccf0af9e6ecfb. The manual entry point stays `/`; the separate offline inspection surface is `/harness.html`. No live provider, credentials, server backend, framework or production deployment.

The canonical engine retains its 10×20 visible board, zero hidden rows, clockwise square-matrix rotation and horizontal kicks [0,-1,1,-2,2], immediate lock on failed descent, seven-bag deterministic sequence, 100/300/500/800 pre-clear-level scoring and blocked-spawn loss. Marathon starts at level 1, reaches level 30 at 290 lines, and completes at 300 or more lines before the next spawn/refill. A minimum five-piece internal queue buffers the same sequence; observations publish only the next five, never seed/RNG or later pieces.

## Contracts

- Rules, observation, candidate, feature and decision schema each have an explicit version. Session ID plus monotonic revision scopes every request and candidate. A private full-state fingerprint checks exact execution inputs; it is never transmitted to a decision provider.
- Public observation is a deep serializable copy: full locked occupancy, active pose/cells, supported rules/geometry, next five, counters and the 300-line Marathon objective. No private PRNG fields. Simulator-only full states remain local.
- Candidate search is breadth-first over actual engine poses using left/right/clockwise/soft-drop with gravity paused; hard drop terminates a path. Failed soft-drop locking is also a terminal route. Bound: 800 valid poses, 4000 transitions; exhaustion is an error, never silent pruning. Rotation/movement must call canonical reducers. Candidates retain placed cells before line clear, route, exact consequence and state binding. Losing legal placements remain candidates. No hold or realtime reachability claim.
- Simulator replays each route on a cloned full state, using canonical lock/clear/score/spawn. Export afterstate only through the public observation boundary, limited to the originally visible horizon: after one placement the new active type was originally next[0], and only the remaining original four preview entries may be supplied to a model. A winning clear spawns nothing: active is null and all five original preview entries remain visible. Do not reveal a newly refilled sixth piece through hypothetical afterstates. Fresh actual decision observations may reveal a new next-five after execution. Feature v1: per-column height, aggregate/max height, holes below occupied cells, adjacent-column bumpiness. Raw features are distinct from heuristic value.
- Controller owns one outstanding request, AbortController and monotonic request ID. Providers receive a frozen public packet; local heuristic and delayed/error mock implement the same async decision contract. Revision, request and legal candidate ID are revalidated before exactly-once canonical execution. Reset/pause/stop cancels; late responses cannot mutate state. Stop retains board and Start resumes it; Reset is the only fresh sequence action. A hard decision deadline stops hung mocks. No fallback is silent.
- One piece per step; waiting/paused game-time never advances. Automatic local play repeats decisions at a bounded UI pace, separate from game gravity. The objective is a 300-line Marathon with a level-30 ceiling. Completed state freezes every action until Reset; Reset starts level 1 and a fresh request epoch. Rules briefing and worked examples derive from canonical rule/geometry exports and executable engine fixtures.

## Design brief v1

Designer-agent read existing DESIGN_BRIEF.md, index.html and styles.css before implementation. Reuse their dark neutral arcade palette, seven-piece colors, system type, bordered cards, visible focus and reduced-motion support. Preserve manual play. Name the separate surface “Offline computer play”; label the active player “Local heuristic” or “Delayed mock”/“Error mock”, never live AI.

Dominant board, score/lines/level/pieces, next-five previews, clear Ready/Running/Choosing/Paused/Stopped/Game over/Error status. Start runs locally; Pause/Resume toggles automatic progression; Step one piece makes one decision then remains paused; Stop retains inspectable board; Reset returns to deterministic ready state. Errors cancel progression, retain board and explain Reset recovery. Provider choice is disabled during a pending step. Secondary details disclose selected candidate, latency, factual features, heuristic score and rules brief. No side-by-side view, lookahead or unsupported mechanic.

Use semantic buttons, meaningful live announcements (not every cell), labeled board, visible keyboard focus, and no global keyboard interception. Stack at 390×844 without horizontal page overflow. Desktop 1280×720 keeps primary play/control/status understandable. Narrow layout is not touch-play certification. Text expansion and reduced motion retain access to all controls.

## Validation and delivery

Use existing `npm test` on Node 24.22.1 with meaningful additions for sequence/bag-boundary privacy, all shape orientations, actual reachable paths vs independent reference, unreachable cavities, canonical simulation/clear/scoring, features, full local game and mock timeout/cancel/stale/duplicate rejection. Keep existing manual-game tests. Independent source review binds the frozen candidate. Actual local browser verifies controls, pause/step/stop/reset, pending/error/top-out, desktop/narrow and text/reduced-motion behavior with independent Design acceptance. Retain source/head/tree and serving identity. No public AI deployment.

## Approved remaining tranche (P8-008–012)

The current user explicitly requested all open Tetris work after the foundation; this supersedes the earlier deferred implementation scope, but does not authorize paid inference. Build injected-transport provider contract adapters on a Node-only credential boundary, disabled live by default. Browser packets never carry keys. Verify official APIs and limits before calling them; unsupported model/candidate/context configurations fail explicitly. Choice probabilities are not win probabilities. No silent provider switching or fallback.

P8-010 first supports paired local heuristic/mock games with isolated state/RNG, shared ordinal sequences, saved decisions, exact replay hashes and recomputable metrics. Benchmark objective follows the same Marathon rule; safety caps stay censored and cannot be reported as completion. Paired sample count and assistance tiers are explicit.

P8-011 adds a separate side-by-side local/mock comparison flow to the existing harness after a compact Design addendum. Label provider availability and offline/live/replay accurately; no live-provider claim. Independent stop/reset/result and accessible responsive behavior remain required.

P8-012 adds optional bounded visible-queue lookahead with explicit depth/node/time bounds, deterministic pruning/ties and a shared assistance tier. Search must use only the observed upcoming sequence; unknown future stops a branch and is not recovered from private RNG. Preserve occupancy and report overhead. No unbounded search, hidden future, hold or spin mechanic.

Next smallest harness batch: P8-010 offline paired heuristic/mock seed runs and saved-decision replay, then P8-011 locally labeled comparison. These can be built without live APIs. Their stale baseline/hold/sprint assumptions and provider-only dependencies must be refined before admission. P8-008/009 API adapters remain separate configured work; P8-012 lookahead remains optional.
