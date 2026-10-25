# Human versus local algorithm — design brief v1

P8-024 amendment: the Marathon brief v1 in `../DESIGN_BRIEF.md` and `MARATHON.md` supersedes earlier objective, success/status and safety-limit wording below. Original preparation/inspection history remains historical evidence.

Product brief for the new separate mode; preparation, not running-candidate acceptance. Reuse the existing local-classic-1 rules and dark arcade design.

Add a distinct `/versus.html` titled Human vs local algorithm. Preserve `/` manual solo, `/harness.html` solo computer play and `/comparison.html` algorithm comparison. All four pages show a compact wrapping Play modes navigation with current-page indication. No page redesign or framework. Human-vs-algorithm is genuinely absent in current code: comparison choices contain only local/lookahead/mocks; manual input is standalone.

Two equally labeled cards: left Human, right Local heuristic · offline. Reuse existing dark arcade/card/board/piece/metric/next-five/focus patterns. Endless score/survival rules remain unchanged, with explicit per-board100-piece safety cap and bounded saved-frame capacity. Both independent games start from the same private deterministic ordinal sequence and may diverge; human gravity and algorithm pacing differ, so show descriptive outcomes, no winner/fair-race or model-quality claim. Local algorithm is fixed existing heuristic, not an unavailable live provider. Display each board's score, lines, level, pieces, state and terminal/capped reason; preserve a finished lane while its peer continues.

Shared Start/Resume, Pause, Stop and Reset control both lanes. Manual arrows/Up-or-X/Space/P use the accepted mapping, only while the focusable left playfield owns focus; modifiers and unrelated typing are ignored. Start/Resume focuses that playfield. Leaving the playfield/window or hiding the tab pauses BOTH, with explicit help text. Use separate Pause and Resume actions so blur-before-click cannot accidentally resume. Human input never selects/moves the algorithm board, and AI decisions never move the human board. The human gravity and actions keep advancing while the algorithm is Choosing or delayed; only intentional shared Pause/Stop/focus-loss pauses both. Step algorithm deliberately freezes the human clock as specified.

Label live single-step action Step algorithm: it performs exactly one eligible AI decision and leaves both clocks paused, with no automatic human placement or gravity advance. From initial Ready it may advance the AI alone; human remains Ready until Start. During saved replay the same action becomes Next saved frame. This is an explicit applicability policy, not a misleading claim that a human choice can be auto-stepped.

Replay/Export reuse the established concepts, not the benchmark verifier. Record only own immutable compact visible snapshots at meaningful human pose/lock/status changes and AI decisions, not every animation frame; retain human/local identity, policy, counters and capped/error/cancel facts. Saved replay freezes human controls/gravity and AI requests, advances only stored frames, and says Saved visual replay. Reset leaves replay for a fresh run. No untrusted import, private seeds/RNG/hidden queue, credential material or raw responses. Up to4000 frames/eightMiB UTF-8 export; capacity exhaustion pauses/stops honestly while retaining recorded data and marking any truncation explicitly. No silent dropped-frame completeness claim.

Keep recovery actions and terminal/error text visible, semantic controls and ordinary keyboard/narrow behavior. Existing comparison200%, solo200% and enabled reduced-motion checks remain Deferred, NOT Passed, per the fresh human scope; no human preference setup or another accessibility preview is required for this episode.


## Observable working acceptance

Verify human movement/rotation/drop only changes its own board, local algorithm progresses independently, global pause/stop/reset work without late mutation, Step algorithm advances only one eligible AI choice with human unchanged, and replay/export use only own saved frames. Inspect mode navigation, ordinary desktop/narrow/resize and browser keyboard/focus on the unchanged candidate. Preserve the existing solo/manual/computer-comparison behavior. Deferred accessibility checks remain explicitly Deferred, not Passed.
