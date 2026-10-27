# Article evidence: Decisions, early mistakes and cost

Prepared October 27, 2026. This is an evidence packet for a future article, not a finished article or a claim that OpenAI solved the game. The records in this folder are unmodified exports, with SHA-256 hashes in `manifest.json`. Private credentials, project IDs, owner configurations and ledgers are excluded.

## Three different kinds of failure

**Adapter error:** `original-adapter-failure.json` preserves the first full comparison. Lookahead reached 300 lines in 756 pieces. OpenAI placed 48 pieces and cleared five lines, then the 49th request failed because only one legal candidate remained. The Decisions Choice contract requires at least two options. Sending a singleton was our integration bug; it is not evidence that the model refused or could not choose. The adapter now validates and executes the only legal move without a paid call. The original exact provider error text was not retained and must not be invented. The regression test exercises this same 49th-turn boundary.

**Integration deadline:** an intermediate run stopped at 34 lines and 88 pieces with zero holes and height two. The browser's 1,500 ms deadline cancelled the next request while the backend was awaiting a response, around 1,484 ms. No response outcome was known. This does not establish whether inference or the network was slow. The cancelled charge remains unknown. Deadline ownership was moved to the backend, with a separately versioned 10-second request envelope for the approved $5 Marathon policy and no automatic retry. Its private evidence is retained separately; the complete record is not included in this packet.

**Decision quality:** `hole-priority-run.json` shows a later run that completed 262 responses without provider errors or timeouts, yet lost at 92 lines. Median decision time was 293.6 ms. At piece 106, an L placement created a hole with stack height four, despite an offered surviving alternative that created none; latency was about 293 ms. Piece 111's O made another hole at height four in about 239 ms. These early mistakes occurred before the stack was tall. Eleven applied hole-creating choices had a surviving non-hole-creating alternative. Those comparisons are retrospective analysis, not facts supplied as live move rankings.

A useful teaching position comes before piece 11: two O placements both leave zero holes immediately, but leave different legal options for the visible next Z. The fixed executable example is in `decision-facts.mjs`. Only that fixed board gets enumerated continuations; live choices receive no continuation search or recommended answer.

## What the factual changes achieved

The model receives every legal placement, exact boards and paths, current piece, next five, hole coordinates and covering counts, surface-gap geometry, nearly complete rows, five confirmed transitions and fixed examples. No live candidate is scored, ranked, pruned or recommended by the presentation layer. Lookahead is a separate comparator with its own explicitly local evaluation.

The first factual variant also weakened the strategic instructions and regressed on two fresh sequences. It cleared 15 versus 17 lines on seed 6149 and five versus 14 on seed 9011, at 48 pieces. The second version restored hole-priority instructions and reused those development sequences:

| Matched horizon | Earlier format | Final factual format |
|---|---|---|
| Seed 6149, 48 pieces | 17 lines, zero holes, height 4 | 18 lines, zero holes, height 2 |
| Seed 9011, 44 pieces | 14 lines, one hole, height 8 | 11 lines, four holes, height 12 |

The second run stopped on native refusal on request 45, with HTTP 200 and a 280 ms response phase. No retry occurred; that charge is unknown. The 9011 baseline is from the earlier round because the refusal stopped the retest before a fourth arm. These results do not show a consistent improvement or isolate the effect of added facts from prompt changes.

`factual-run.json` records the full final comparison, source `d3966892f19624a43aa5b305583222009105dd65`, with gravity on and hard drop after a reachable decision:

| Player | Lines | Pieces | Active time | Result |
|---|---:|---:|---:|---|
| Lookahead depth 1 | 300 | 756 | 4:46.1 | Target reached |
| OpenAI, final factual format | 125 | 332 | 6:07.6 | Blocked spawn |
| OpenAI, historical hole-priority format | 92 | 262 | 3:11.4 | Blocked spawn |

The factual run had 331 successful requests, no errors, timeouts, refusals or automatic retries, and two missed decisions under real gravity. One pending request covered multiple gravity locks. Median decision time was 630.3 ms; maximum was 1,456.8 ms. Longer survival did not mean consistently better early play: at piece 88 it had 30 lines/four holes/height seven versus 34/zero/two previously; at piece 150 it had 53/four/ten versus 57/zero/six. At piece 300 it recovered to 116 lines/zero holes/height six before the final loss.

This is one standard-sequence comparison, with differing prompts and uncontrolled API variability. The first eleven pieces also informed the teaching example. It is development evidence, not an unseen-sequence evaluation, statistically established gain or proof that a stronger model would win.

## Measured usage estimates and unknown billing

Known usage estimates: first factual controlled round $0.423326275; second round $0.252750605; final full game $0.929412625. Total $1.605489505 across 664 dispatches, plus one unknown refusal charge. The earlier 92-line run's estimate was $0.329968785. An earlier cancelled request remains separately unknown.

The project threshold stayed at the approved $5 monthly amount. Delayed dashboard figures were $1.40 before and $1.66 after testing; neither is the final invoice or a trustworthy remaining-budget calculation. These historical amounts do not authorize or configure paid play for contributors.

## Terra and Sol scenarios

The original estimate is preserved in `terra-sol-estimate.json`. Official pricing was checked again on October 27, 2026: standard global short-context Terra input $1/M, cache reads $0.05/M, 30-minute cache writes $1.25/M, output $5/M. Sol rates are twice those. Internal reasoning is billed as output even when the visible answer is just a move ID. Sources: [pricing](https://developers.openai.com/api/docs/pricing), [Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra), [reasoning](https://developers.openai.com/api/docs/guides/reasoning).

Using the final Luna run's mean 22,697 input tokens/request and observed cache mix as proxies, plus 20 visible output tokens and 500–2,000 internal reasoning tokens:

| Hypothetical workload | Terra | Sol |
|---|---:|---:|
| 50 decisions | $1.53–$1.91 | $3.07–$3.82 |
| 800 decisions | $24.54–$30.54 | $49.09–$61.09 |

800 decisions is a planning horizon near a 300-line game, not a completion guarantee. No Terra/Sol requests were made. Tokenization, cache behavior, reasoning volume and real-time latency may differ. Stronger cache reuse can reduce cost; more reasoning can increase it. Regional, Fast, long-context and external-tool premiums are excluded. A full game at this prompt size should not be assumed to fit $5.

Terra/Sol support remains future work: a separately qualified Responses adapter could return one strict legal move ID using the same facts, with no local reranking. A bounded frozen-position quality test should precede real-gravity comparisons. Structured output guarantees a constrained answer shape, not good decisions or adequate speed.

## Verify the preserved records

```sh
node --test test/research-evidence.test.mjs
node verify-decision-record.mjs docs/research/factual-run.json
```

Replay checks the recorded game and move binding. It cannot authenticate the provider, invoice, real wall clock or private project configuration. The article should retain that distinction and report failures alongside improvements.
