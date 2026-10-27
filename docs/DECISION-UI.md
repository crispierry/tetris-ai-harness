# Owner-paired Decisions player

P8-020 uses the existing browser modes and Node service. This implementation is local-only; live qualification and hosted authentication remain separate work. The ordinary server starts with provider admission disabled. No provider key is discovered or read by the fixture bootstrap.

The explicit fixture preview command uses the existing supervised `server.mjs`, pinned Node 24.22.1, `BOB_LOCAL_*` identity, and port 4407. The supervising local owner additionally sets `BOB_DECISION_FIXTURE_LEDGER` to an absolute private directory outside the repository and `BOB_DECISION_FIXTURE_EXPIRES` to one fixed future epoch timestamp in milliseconds. Add `--decision-fixture-owner`; use `--enroll-decision-fixture` only for a new private lineage. Restart uses the same directory and exact expiry/policy. It cannot silently recreate a deleted enrolled ledger or refill attempts. The fixture chooses an offered option without external HTTP or API spend; it is not model-quality evidence.

Choose OpenAI Decisions and press Connect. Connect registers a SHA-256 digest of 32 random bytes held only in the source session closure. It does not issue a run or place a piece. The page shows the public digest and waits up to 60 seconds. The inherited OS-owner stdin channel accepts one strict JSON command per line, at most 4096 bytes:

```json
{"action":"list"}
```

After matching the full page fingerprint with the owner listing, approve the exact challenge, full digest, mode, and lane:

```json
{"action":"approve","challengeId":"<listed UUID>","nonceDigest":"<full 64 lowercase hex digest>","mode":"solo","lane":"solo"}
```

Comparison context is `comparison` / `right`; versus is `versus` / `algorithm`. Only Local heuristic left versus one OpenAI right is admitted, with one sample. The browser claims the approved response once using the original nonce proof. The capability passes directly to the bridge closure; it never enters DOM, URL, storage, public status, exports, or owner output. There is no HTTP approval route. Use the same exact command tuple with `action:"close"` for an undelivered/lost delivered grant; closing grants never refunds the durable aggregate. Failed expiry close leaves an owner hold. Reconnect always needs a fresh explicit owner approval. The owner retains private delivered-capability memory until shutdown/reconciliation; the pairing entry never exposes it in listings.

Start and Step are separate actions. Pause/Stop/focus loss fence scheduling without advancing game epoch. Reset advances the game epoch, preserves the owner-issued controller base, and never refills allowance. Interrupted external work requires Reset; local/human peers remain independent while a request waits. Shutdown detaches/drains owner input, closes owned grants, aborts/drains service work, closes sockets, and releases the ledger only after successful drain.

External policies use `provider-policy-1`, compact receipts use `decision-receipt-2`, and new browser exports use `decision-ui-record-2`. The standalone legacy `decisionRecord()` helper still emits `decision-ui-record-1`. Fixture requests have zero external calls/API dollars; conservative token/money reservations are not measured usage/billing. Live billing remains unknown unless separately measured. The external record saves visible immutable frames and compact decisions, not private seeds, RNG, full provider responses, or candidate distributions. Replay advances stored frames only and makes zero new decisions. Existing offline benchmark/legacy validators remain unchanged.

The finite external comparison limit is 16 MiB / 4000 frames / 2000 paired placements; versus remains 64 MiB / 50000 frames with a 160 KiB metadata reserve. Solo records at most 1000 placement frames within 16 MiB with a 160 KiB terminal/metadata reserve. External-capable frames encode bounded selected paths with `LRCDH-1` (left/right/clockwise/down/drop); they are inspection data and are never executed by replay. Actual per-frame byte guards stop honestly before overflow. Caps remain abbreviated outcomes, distinct from the 300-line Marathon goal. Source tests do not constitute independent browser Design/QA acceptance or live-provider qualification.


## Canonical saved-record verification

Save the JSON exported by Solo, an external comparison, or external versus, then run from the checkout with pinned Node 24.22.1:

```sh
node verify-decision-record.mjs /absolute/path/to/saved-record.json
```

The CLI reads the original file without changing it, reports its exact byte count and SHA-256, and exits 0 only for canonical v2 verification. Invalid or unsupported input exits 1 with a diagnostic. A v1 visual record returns explicit `legacy-visual-only` assurance and exits 2. Existing benchmark and historical replay formats retain their own validators unchanged. This CLI does not start a service, read credentials, call a provider, execute a browser, or replay through a UI. The verifier module imports only the pure engine and harness reducers; file reading and hashing belong to the CLI.

V2 anchors every lane to an empty ready board, level 1, zero score/lines/pieces and its first five observed preview pieces. It records ordered per-lane lifecycle, applied human actions, exact applied clock calls, engine spawn, bound computer selection, cancellation and error events. The selected computer request/revision/ID, piece, orientation, cells and route must match a freshly enumerated local candidate, which is then executed using its fresh local binding. Boards, falling pieces, clocks, previews, score, lines, levels and placement counts are recomputed. A nonwinning lock consumes the previously known head and carries the remaining four preview pieces forward; only the newly visible fifth is additional observed input. Winning locks keep all five previews and do not spawn. Terminal and capped lanes cannot accept more gameplay events. Reset begins a new record with the new controller epoch and an empty canonical initial state.

Adjacent same-lane clock calls may share a `ticks` event with a vector of at most 256 exact arguments. Each argument is positive and at most 250 ms. Calls are replayed individually, in order, and vectors never cross a lock or an intervening lane event. This preserves invisible accumulated gravity without charging one full-board frame per animation tick. Browser visual frames and their existing finite admission profile remain unchanged. V2 retains the existing 16 MiB solo/comparison and 64 MiB versus export limits, 2002/4000/50000 canonical-event bounds and 160 KiB metadata reserve. Each event is bounded to 16 KiB. A proposed canonical transition is retained before the engine commits it; capacity exhaustion stops play and exports a verifiable retained prefix with censored unfinished finals. Final snapshots describe that prefix, not an unrecorded later state.

Full public provider policies, bounded compact receipts, observed decision latency, usage/cost fields and a snapshot of authenticated accounting remain in v2. Receipt bindings must agree with their selected event and policy. These are recorded provenance claims: canonical verification does not authenticate a provider, receipt, billing, wall time, initial observed piece sequence or private random seed. There is no seed, RNG, hidden queue, owner capability or raw provider response in the record. A newly visible fifth preview piece is a recorded input, so changing that input consistently creates a different conditional sequence rather than proving seed authenticity. Reordering/deleting meaningful events without preserving canonical consequences fails; this is verification of the saved sequence, not a signed proof that every physical input was recorded.

Browser replay continues to display its own immutable saved visual frames and issues zero decisions. It never imports or executes v2 event actions. Entering replay freezes the exact exported JSON, including accounting, so subsequent visual stepping does not change the saved file. Ordinary local comparison and versus exports retain their previous formats. Offline fixture and source checks do not qualify live Decisions access or establish a fair-race or model-quality claim.

Comparison connections belong to lanes rather than a fixed opponent. Either selector can choose OpenAI; each selected OpenAI lane needs its own owner pairing. Search controls remain available when either lane uses Lookahead. The displayed estimate aggregates both paid lanes across every sample in this comparison and resets only for a new comparison. Local-search policies and receipts have separate canonical verification, with no claim that replay recomputes search timing or authenticates model provenance. Multiple-sample exports use `decision-ui-comparison-series-1` containing `decision-ui-record-2` sample records sharing one 4000-event and 16 MiB allowance. Canonical verification rejects sessions reused anywhere in the series and impossible complete-search counts. Replay makes zero provider calls. Jev and Astra remain offline adapters until their live connections are implemented.
