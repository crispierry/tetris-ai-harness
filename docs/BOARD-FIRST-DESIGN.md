# Tetris board-first v1

Presentation amendment to tetris-local-design-v2, reviewed by Astra before implementation. Use the existing dark palette, system font, mint primary action, amber focus ring and piece colors. The game is the primary content.

All four routes use one compact Tetris masthead, the same four navigation links and a shared playfield size/origin. On desktop, two board slots precede a control rail. Solo modes retain the left board position and use the second slot for compact next/help or placement details. Boards share a 1:2 outer ratio; selectors, expanded details and recovery messages never push desktop boards downward. Default desktop boards and primary actions fit at1100×800 and1440×900. Below960px the rail follows the board stage; below620px lanes stack, retaining a consistent first-board origin. Text expansion can increase intrinsic rows; readability takes precedence over exact coordinates.

Primary actions and Reset stay visible. Rules, provider/placement facts, settings, recordings and descriptive results use native disclosures. Normal play does not repeat Marathon prose; Lines /300 and Level /30 communicate progress. Terminal outcomes, errors, owner approval/reconciliation and the exact existing monthly billing-risk line remain visible. Native links/buttons/selects/details preserve focus and keyboard behavior. Board animation and reduced-motion semantics are unchanged.

## Estimated OpenAI test cost

The display sums usage in unique successfully recorded Decisions receipts for the current game. Repeated rendering and saved replay do not add spend. Reset starts a new test subtotal, without changing session/project usage. Failed or interrupted requests make the estimate partial or unavailable. Unknown usage is never shown as free. Actual billed cost remains unknown/null in transport and saved-record contracts.

USD pricing snapshot, October26,2026: ordinary input $0.10 per million, cache-read input $0.01, default30-minute cache writes $0.125. These are mutually exclusive portions of total input. Output is free for Decisions. Requests over272,000 input tokens use2× input rates. The displayed estimate assumes standard global processing and excludes possible premiums/adjustments and unknown failed-request charges. It is not an invoice or a budget enforcement mechanism.

Sources: [Decisions pricing](https://developers.openai.com/api/docs/guides/decisions#pricing-and-availability), [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), [pricing](https://developers.openai.com/api/docs/pricing).

Validation: compare first-board rectangles across all routes and paired-board tops/sizes, desktop and narrow layouts, text enlargement, keyboard focus, normal/error/permission states, replay/export and cost deduplication/reset/partial handling. Source checks, independent source/functional review and designer review of rendered evidence are separate acceptance steps.

## MacBook layout refinement

Astra reviewed the source and rendered four-page layout at 1200×700. Every lane now reserves the same 40px heading with the compact player name above status, with no inherited row gap. Four fixed metric columns and 32px next-piece previews keep the complete stage in view. Compare selectors share one row; routine progress and placement facts live in Run details. Connected OpenAI uses a short request-count summary and hides the inactive Connect button; expiry and full accounting remain in Provider details. Blocking, interrupted, stale and expired statuses retain their complete messages, and the exact monthly budget-risk disclosure remains visible. Replay keeps a visible no-new-requests notice.

Rendered checks: at 1200×700, every first board starts at (52,159), measures 200×400, and Next ends at 657.2px. At 1512×850, every first board starts at (208,159), measures 265×530, and Next ends at 787.2px. Both paired boards have identical top coordinates. The normal four-page layouts have no horizontal or vertical overflow at either size. Temporary device emulation is reset after verification.
