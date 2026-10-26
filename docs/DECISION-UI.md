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

External policies use `provider-policy-1`, compact receipts use `decision-receipt-2`, and exports use `decision-ui-record-1`. Fixture requests have zero external calls/API dollars; conservative token/money reservations are not measured usage/billing. Live billing remains unknown unless separately measured. The external record saves visible immutable frames and compact decisions, not private seeds, RNG, full provider responses, or candidate distributions. Replay advances stored frames only and makes zero new decisions. Existing offline benchmark/legacy validators remain unchanged.

The finite external comparison limit is 16 MiB / 4000 frames / 2000 paired placements; versus remains 64 MiB / 50000 frames with a 160 KiB metadata reserve. Solo records at most 1000 placement frames within 16 MiB with a 160 KiB terminal/metadata reserve. External-capable frames encode bounded selected paths with `LRCDH-1` (left/right/clockwise/down/drop); they are inspection data and are never executed by replay. Actual per-frame byte guards stop honestly before overflow. Caps remain abbreviated outcomes, distinct from the 300-line Marathon goal. Source tests do not constitute independent browser Design/QA acceptance or live-provider qualification.
