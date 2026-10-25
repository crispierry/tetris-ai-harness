# Decisions transport boundary

The default `npm start` process exposes `/decision/status`, `/decision/choice`
and `/decision/control`, but remains **OFF**. Status and page load cannot enroll a
run or obtain a provider credential. No UI activation or hosted deployment is
implemented here. Fixture Choice adapters retain their offline names and guards.

`choice-protocol.mjs` shares the pure native Choice builder/parser with the fixture
adapter. The service fixes POST `https://api.openai.com/v1/decisions` and JSON model
`gpt-6-luna`, with exactly one named placement Choice. No client supplies an
upstream URL/model, and upstream redirects fail. The complete canonical offered
set is preserved: one candidate selects locally, 2–255 use one request, and >255
fails without pruning or dispatch. Legacy replay bundles remain immutable.

## Trusted Node owner

`openDecisionStore({directory,lineage,policy,enroll:true})` explicitly enrolls a
fixed lineage once. The private owned 0700 directory must be outside this source
checkout/static roots; ledger and lifetime O_EXCL lock are 0600. A persistent
one-time enrollment marker prevents missing-ledger recreation from refilling an
allowance. Ordinary reopen omits `enroll`; it never creates missing data. No stale
lock stealing or automatic reconciliation exists. An unresolved reservation,
dispatch intent, uncertain result, damaged store or persistence fault holds
activation for owner investigation. Atomic writes fsync the temporary file,
rename it and fsync the directory. Mutations serialize behind the lifetime lock.
This is local single-process enforcement, not distributed hosted enforcement.

`createDecisionService` is OFF unless an owner explicitly enables it with a sound
store and immutable finite policy. Policy fields are `maxAttempts`,
`maxInputTokens`, `maxEstimatedMicros`, `expiresAt` (absolute Unix milliseconds),
`maxRuns`, `maxEpochs`, `maxPlacements`, `timeoutMs`, `reservationTokens`, and
`reservationMicros`. Money uses integer microdollars; the program ceiling is
10,000,000 ($10). Placements support up to 1000 per epoch, epochs up to 100 per
grant, grants up to 64, with an additional 10,000 durable-operation ceiling. These
bounds do not grant spending authority.

An explicitly injected `transport` marked `mode:'fixture'` enables only
`http-fixture` provenance. It does not prove provider availability or live usage.
A fixture persistence-fault hook also prevents live qualification. Real transport
requires an explicitly supplied credential (no environment/key discovery), no
injected transport, and an owner qualification with kind
`owner-qualified-live-v1`, exact model/endpoint, a source `evidence` reference,
`maxBodyBytes:1048576`, `maxInputTokens` equal to the reservation, conservative
`framingTokenBound`, bounded `maxOutputTokens`, integer input/output microdollar
rates per million tokens and a `maxCostMicros` covering their worst-case cost.
A byte ceiling alone is not a token estimate: the reservation conservatively
covers every input byte plus qualified framing. Qualification must establish the
provider output/framing/pricing bounds separately. No such live qualification or
credential is created by these tests. Hosted activation always remains OFF.

Only `service.owner.issueRun({laneId,controllerSessionBase})` can issue admission.
It returns a random 256-bit capability, opaque run ID, expiry and epoch. Only the
capability digest is persisted. There is no public issuance endpoint. The bridge
receives this grant explicitly in closure memory and sends it only in the
`x-decision-capability` header, never URLs, storage, packets or receipts. A reload
loses admission. Future activation UX must supply a trusted bootstrap separately.

## HTTP and state ownership

The handler requires exact configured `127.0.0.1:port` Host, and exact same Origin
on POSTs; it rejects duplicate critical raw headers, other methods/media,
unknown envelope fields, malformed and oversized streamed JSON. There is no CORS
expansion. Packet and serialized native body limits are 1 MiB; native/bridge
responses are 64 KiB and controller choice is 4 KiB. Errors contain stable codes,
never upstream body/headers. Browser receipt metadata contains no capability or
credential and is immutable. Reported tokens remain separate from conservative
reserved tokens and actual cost remains unknown.

The server reconstructs the engine from public board/active/next-five facts,
validates pose fit and numeric bounds, and rebuilds the entire ordered candidate
set, evidence, briefing and response schema. Synthetic private refill machinery
never crosses the public horizon: ordinary afterstates retain only the four known
remaining previews, while victory retains five. No search is added. Subsequent
packets must match the selected afterstate and revision, including the known
preview prefix. A new fifth preview is the only newly revealed future piece.
Marathon start1/target300/max30 and final-clear scoring/no-spawn are canonical.

One pending operation owns each lane before canonical validation. An atomic shared
reservation and durable dispatch intent precede the upstream request; every lane,
tab, epoch and restart consumes the same lineage allowance. Duplicates always
reject; changed packet digests under the same key reject as collisions. There is
no retry, fallback or refund, including cancellation and ambiguous dispatch.

Pause/Stop abort the request. A cancelled, failed or lost-delivery decision may
leave the server ahead of the Controller; resuming the old state rejects instead
of dispatching a replacement. Reset is the explicit recovery: the bridge advances
exactly one epoch lazily, keeps the same aggregate remaining allowance and sends
the new `controllerSessionBase-epoch` session at revision1. Winning/loss selection
closes the current epoch before delivery, blocks repeated/late decisions, and
allows this bounded Reset transition. Explicit `close` revokes the grant entirely.
Cancellation, disconnect, deadline, epoch advance and shutdown fence late results
and receipts. A normal completed request body does not abort upstream work.

`service.close()` stops admissions, aborts pending work and waits for tracked
operations. If an abort-ignoring upstream has not positively settled within one
second, it fails with `drain_pending` and retains the ledger lock. The owner must
close idle/active HTTP sockets/server and retry close after settlement; it must
never claim drained resources from an abort alone.

## Offline evidence

Run `node --test test/decision-http.test.mjs` for actual owned loopback HTTP
bridge→handler→native fixture→Controller composition, healthy slow-body completion,
real socket disconnect, Reset/late-response fencing, shared final allowance,
terminal overshoot, authorization/bounds, durable restart and persistence-fault
coverage. Temporary servers, sockets, ledgers and operations close in test cleanup.
`npm test` also preserves existing protocol and legacy replay coverage. These are
offline source checks, with zero real provider requests and zero API dollars;
independent source/functional acceptance and live qualification remain separate.
