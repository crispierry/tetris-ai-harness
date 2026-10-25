# Tetris local pilot — foreground designer brief v2

Prepared by the root coordinator acting in the separate Tom Design responsibility, from Cris's request for a locally playable faithful classic falling-block game and later computer play. This is an explicit manual design handoff, not proof of an automated designer executor. Real PM research and architecture still run and own detailed game rules, scoring, timing and decomposition inside the original scope. No implementation, project or original clock starts from this draft alone.

## Intended experience and scope

Cris opens one local browser page, understands the controls, starts a game, moves and rotates falling pieces, clears lines, sees progress, pauses, resumes and starts over after losing. Initial delivery is single-player manual play; computer play is a later separate extension against the accepted baseline. No account, advertising, network service, public publishing, licensed artwork or audio is needed.

## Compact project design system

Use a restrained arcade presentation with a dark neutral board, high-contrast text and controls, a clear seven-piece color palette, and visible cell boundaries. Piece shape and board position must remain understandable without relying only on color. Use system fonts, a consistent spacing scale and native semantic buttons with visible focus. Keep the game board dominant; show score, lines and level together, with plain controls nearby. Put help and secondary explanations below or beside play rather than across the board. Keep diagnostics and orchestration IDs out of the playing surface.

The baseline is version `tetris-local-design-v2`. Routine visual details can be chosen within these rules; a new product feature or changed interaction contract returns to PM/Design. Source workers must not silently replace this brief or claim design acceptance for themselves.

## Flow, language and interaction

Use visible, semantic controls named `Start game`, `Pause`, `Resume` and `New game` in the appropriate states. Show concise keyboard instructions before play: arrows for movement/soft drop and an indicated rotate key. Include and explain hard drop only if PM selects a ruleset that supports it. The architect may select conventional additional shortcuts but must document the actual mapping. Keyboard game input must not scroll the page while the game has focus; normal tab navigation and visible focus remain available. Moving focus outside the game must not unexpectedly capture unrelated typing.

Before starting, show an empty board and a clear start action. During play, show active and locked pieces plus truthful score/line/level state. Pausing freezes gameplay and exposes Resume. Game over is explicit, keeps the final score visible, and offers New game. Restart clears the previous game rather than retaining invisible state. There is no unsaved user document requiring a confirmation dialog. Avoid flashing; reduced-motion preference suppresses decorative animation without disabling essential game state.

## Layout and accessibility

Target desktop keyboard play in a modern local browser. At 1280×720, keep the main board, essential status and actions understandable without overlap. Adapt to a narrow 390×844 viewport by stacking status/help and preserving all essential game/status content without horizontal page scrolling. Add usable touch gameplay controls only if PM includes touch among supported inputs; narrow layout alone does not expand the desktop-keyboard scope. Do not claim physical-device/touch qualification from an emulated viewport.

Use semantic controls, readable contrast, accessible names, visible unobscured focus and reasonably sized targets. Announce important state transitions and line/score updates without announcing every animation frame. Preserve usability with enlarged text, long labels and reduced motion. English is the initial language; keep strings centralized or otherwise straightforward to localize, allow label expansion, and do not claim translations or a complete accessibility certification.

## Observable acceptance and handoff

Canonical game tests must exercise the real rules (piece inventory, movement/collision, rotation, locking, line clearing, progress, top-out, pause and restart), with assertions that would fail on broken behavior. A healthy HTTP response or a scaffold test is insufficient. Actual browser inspection must demonstrate start, movement/rotation/drop, pause/resume and restart on the delivered candidate, inspect desktop/narrow layout, keyboard focus and truthful status, and retain raw evidence. Independent rendered review assesses the same unchanged candidate and original brief; unavailable evidence stays unavailable. Root's manual designer acceptance is separate from the source author's report and must name head/base/tree, URL/environment, observed inputs/viewports, findings and limitations.

The computer-play extension must preserve these manual flows and show an explicit understandable control for enabling/disabling computer play. PM defines a bounded observable demonstration that the computer actually chooses and executes moves and makes game progress. No preselected performance benchmark or perfect-playing claim is supplied here.

References: installed `/Users/cris/.codex/skills/tom-pm/references/design-language.md` and `role-contracts.md`. This brief is preparatory product/design input only; current authorization, supported runtime contracts, original budgets and independent readiness still govern launch.

## P8-024 Marathon brief v1 (supersedes earlier objective/status/cap wording)

All four routes show “Marathon: clear 300 lines. Start at level 1; every 10 lines raises the level, up to level 30.” Keep Score/Lines/Level and show actual lines / 300, including overshoot. On success preserve final board/preview with no active piece; say “Marathon complete” and “300-line target reached. Final score: {score}. Lines cleared: {lines}. Start a new game to play again.” Loss says Game over with blocked-spawn reason. Placement exhaustion says Capped and explicitly explains it is not Marathon completion. Error keeps the actual explanation. Aggregate orchestration says Run finished; do not infer a winner.

Complete lanes freeze all controls/keys/timers/callbacks until Reset/New game, which starts level 1 and a new request epoch. Shared controls still operate an eligible peer. Normal safety limits are 1000 placements per participant, one paired sample / 2000 aggregate; smaller selected limits say Abbreviated run. Keep finite recording/time/byte guards. Recorded replay/export remains available and labeled. Reuse existing desktop/narrow layouts, wrapping, semantic focus and polite once-per-transition lane announcements. Required independent running acceptance covers four routes at 1280/390, completion/overshoot/freeze/reset, loss/caps/error, independent peers and recorded replay. Enlarged-text/enabled reduced-motion checks remain Deferred. See docs/MARATHON.md.
