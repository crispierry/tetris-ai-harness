# Frozen Marathon-v2 replay dependencies

Preserves genuine `offline-benchmark-2` recordings with `local-marathon-2` rules, observation/candidate/decision schema 2, feature schema 1 and `local-rules-brief-2`. Current run creation remains decision schema 3/brief3 through the current benchmark facade. The historical module exports replay, metric recomputation and aggregation only; it exports neither preflight nor run creation.

Source snapshot: commit `2ca4278e7bf02d3517b538a473b3395f5e347dc2`, tree `dd973f06f1575670c4ac7fd5b891e443cc0edf59`. Commit `0f994f1b8c3136577ff5ffce80d18e5b807bafcc` has the same tree and supplied the read-only baseline fixture capture. Engine, harness, briefing and controller below are byte-for-byte copies. The benchmark copy changes only import location, removes the classic-only facade dispatch, makes run creation/preflight private and exports its original current replay/recompute/aggregate implementations under the historical entry-point names. Original validators and packet/canonical-transition hashing are retained.

| Source file | SHA-256 |
| --- | --- |
| `public/engine.mjs` | `2d5ce73149f1d23e46f74a8f89031f0983d2a7465c8fb1e8cb8b30eb26350252` |
| `public/harness.mjs` | `952cd4e795cae4a8c4c3b57ae0bdfcc9fc8b9afae4e1077a4fb807a4f936a799` |
| `public/briefing.mjs` | `6cf725e3ca1787b7e20198c7b2577ca6839f6bf0bb413cdd3da61401f0ca5832` |
| `public/controller.mjs` | `c0435255d1f341ab625779dfdd3e7c1325d4fe77d51328fc8703ff9ac1ebb241` |

`test/fixtures/marathon-v2-recording.json` was generated on 2026-10-25 during P8-018 Fix1 from the read-only baseline checkout, using private seed 2 and two local-heuristic placements per lane. Both lanes first replayed successfully under that original baseline with zero provider calls. This is a fresh compatibility fixture, not a backdated human/game history. Its artifact hash is `cb2deaf86c24b000819f0d7aad266aeb772705cc3e885cca17ab42ebee1e26a0`. Keep its exact recorded packet hashes and saved metrics intact.

Strict facade dispatch requires the historical schema/rules/brief tuple. The archived validator then checks the complete original manifest. Mixed versions are rejected; replay reexecutes every saved placement against the frozen canonical engine and checks packet, candidate and public transition hashes. No validator is relaxed to accept a current packet as a historical packet. Classic-v1 replay remains separate and unchanged.
