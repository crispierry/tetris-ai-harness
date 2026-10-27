# Tetris AI Harness

A browser-based falling-block game for comparing computer players on the same piece sequence. Play yourself, watch Lookahead, or connect OpenAI Decisions through a local backend. Comparison boards run independently, with aligned boards, live clocks and replayable decision records.

This is an independent research project. Its classic-inspired rules use clockwise matrix rotation, horizontal kicks, immediate locking, no hidden rows and a deterministic seven-piece bag. It does not implement an official tournament ruleset.

## Run locally

Install [Node.js](https://nodejs.org/) **24.22.1** and Git, then:

```sh
git clone https://github.com/crispierry/tetris-ai-harness.git
cd tetris-ai-harness
npm start
```

Open [127.0.0.1:4407](http://127.0.0.1:4407/). There are no npm dependencies to install. Use `PORT=4408 npm start` for another loopback port. The launcher requires a Git clone and snapshots non-ignored source into a Git tree for `/identity`, using a temporary index. It preserves your real index and creates no commit. Restart after editing source to refresh that identity. Downloaded ZIP archives are not supported by this launcher.

OpenAI is **off by default**. Local games, Lookahead, mock players, tests and saved replay work without an account, API key or network service. The server binds only to `127.0.0.1` and is intended for local use.

## Play and compare

| Page | Purpose |
|---|---|
| [Play](http://127.0.0.1:4407/) | Keyboard play: arrows move/soft drop, Up or X rotates, Space hard drops, P pauses |
| [Computer](http://127.0.0.1:4407/harness.html) | One computer player |
| [Comparison](http://127.0.0.1:4407/comparison.html) | Independently select each player and Lookahead depth |
| [Versus](http://127.0.0.1:4407/versus.html) | Human versus computer |

The Marathon target is **300 lines**, starting at level 1 and speeding up every ten lines, to level 30. A blocked spawn loses. Placement caps, session expiry, provider errors and recording limits can stop a run before the target; those are reported separately from completion.

Lookahead supports depths **1–6**: the current piece counts as the first, followed by up to five visible upcoming pieces. Deeper search uses a bounded beam, so it is approximate and can exhaust its search budget. The former separate Local heuristic menu entry is removed; local evaluation remains part of Lookahead.

AI gravity defaults to **on**. The piece keeps falling while the model thinks; a reachable returned decision uses the normal Space hard drop. A late decision can miss a piece and cannot teleport it. Disable gravity to inspect decisions without that timing pressure. Presentation pace and animation are separate from the gravity clock.

Comparison clocks measure active elapsed time. The final pace explanation compares time per piece; it does not imply equal outcomes when one player loses. Costs are labeled estimates from reported usage, with unknown charges kept unknown.

## OpenAI Decisions

The implemented live integration uses `gpt-6-luna` through the Decisions API. The backend provides the rules, current board, next five pieces and every reachable legal placement with its exact afterstate. The factual format adds hole coordinates, surface gaps, nearly complete rows, confirmed recent outcomes and fixed teaching examples. It does not rank live moves or recommend a candidate; OpenAI selects the returned move ID. If only one legal move exists, the adapter executes that forced move without an API call.

Live play requires explicit owner activation, verified project/key/budget evidence, a private credential file, a durable private ledger and local pairing. See [local browser setup](docs/DECISION-BROWSER.md). The repository contains no ready-to-use paid configuration. Project spending thresholds can have billing delays; the app does not promise an exact dollar cutoff or reaching 300 lines within a budget. No automatic paid retries or heuristic fallback are used.

Terra and Sol are **future integrations**. Their hypothetical costs and the Decisions failures are preserved in the [article evidence packet](docs/research/ARTICLE-EVIDENCE.md); neither model is enabled in the app.

## Develop and verify

```sh
npm test
node --pending-deprecation --test
node verify-decision-record.mjs /absolute/path/to/comparison-run.json
```

Tests run offline with explicit mock transports. Replays verify recorded engine transitions and offered-choice binding; they do not authenticate a model, wall clock or bill. Exact older record formats use the maintained frozen reducers in `legacy/` so historical experiments remain verifiable. New games use the current canonical engine. Compatibility modules are not additional selectable rulesets.

Read [Contributing](CONTRIBUTING.md), [Security](SECURITY.md), [rules](docs/MARATHON.md), [design](docs/BOARD-FIRST-DESIGN.md), [OpenAI errors](docs/OPENAI-ERRORS.md) and [public-release review](docs/OPEN-SOURCE-REVIEW.md). There is no automatic hosting or deployment configured.

## License

[MIT](LICENSE), copyright 2026 Cris Pierry.
