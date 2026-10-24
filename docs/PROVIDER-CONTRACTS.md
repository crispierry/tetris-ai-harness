# Offline provider adapter contract research

Official documentation checked 2026-10-24. Documentary preparation only; no provider request, credentials, account access or billing verified. Every adapter receives only a frozen public decision packet, never private RNG/seed or full internal simulator state. Live transport stays disabled without an explicit current run gate, external credential and hard request/token/cost limits. No silent retries, provider switching or fallback. Node-only credential boundary; browser never imports a key.

## Astra structured selection

`POST https://api.openai.com/v1/responses`, Bearer auth, explicit model `gpt-6-astra`. Responses structured output uses `text.format={type:'json_schema',name,strict:true,schema}`. Require only a selected legal candidate ID; do not request invented calibration/probability fields. Parse the response's message `output_text` item only after checking completion/refusal/incomplete status. Pin effort, standard speed and max output tokens in the run manifest. The model's current documented context/output limits do not establish this account's availability.

Sources: https://developers.openai.com/api/docs/guides/structured-outputs ; https://developers.openai.com/api/docs/guides/migrate-to-responses ; https://developers.openai.com/api/docs/models/gpt-6-astra . Pricing is a future run prerequisite, not permission or a current estimate of game cost.

## OpenAI Decisions

`POST https://api.openai.com/v1/decisions`, Bearer auth; current documented supported model is `gpt-6-luna`. Body: `{model,input,questions:[{type:'choice',name,instructions,choices:[{value,description?}]}]}`. Choice supports 2–255 unique typed string/boolean values. Use legal candidate IDs as string values. A one-candidate case needs an explicit deterministic controller decision, not an invalid one-option request. More than255 candidates is unsupported unless both competitors use a separately declared shared assistance policy; do not silently truncate or split probability comparisons across batches.

Answer order follows question order. Choice answer contains `choice`, `confidence`, `probabilities:[{value,probability}]`; refusals remain failures. Validate legal ID, correct question type/name, unique complete finite distribution and documented probability semantics. Confidence is not survival/win probability. Capture real model/usage/latency metadata without secrets. Input/candidate size must be bounded before dispatch.

Sources: https://developers.openai.com/api/docs/guides/decisions ; https://developers.openai.com/api/reference/resources/decisions/methods/create/ . Offline fixtures cannot prove a current account, price, model deployment or strategic quality.

## TypeSafe Jev

Original provider only. `POST https://api.typesafe.ai/v1/systemone`, Bearer auth. Documented body: `{model:'jev-latest',state,questions:{questionId:{type:'choice',instructions,criteria:{candidateId:description}}}}`. Answers are keyed by question ID, with `choice`, `confidence` and `probabilities:{candidateId:p}`; model and usage are top-level. Pin an actual discovered model version for a later measured run rather than assuming alias stability. `GET /v1/models` requires account authorization and was not called.

Docs describe32MiB request body and64nested levels. A numeric model context/choice-count cap and exact current input price remain unverified; configure a conservative explicit supported cap and fail unknown/oversize cases before any paid call. Do not claim output-free pricing or error-backoff strategy as free game execution. No automatic retries in the first bounded adapter.

Sources: https://docs.typesafe.ai/primitives/choice ; https://docs.typesafe.ai/api/system-one ; https://docs.typesafe.ai/api/list-models ; https://docs.typesafe.ai/api/errors . No unofficial proxy used.

## Offline acceptance

Injected-transport fixtures prove request schemas, exact enum/map identity, no missing/duplicate/unknown options, finite probabilities where provided, refusal/incomplete/error handling, response-size bounds, deadlines/AbortSignal/cancellation, late-response suppression and default-off transport. Explicit model/version/effort/speed and supported limits must fail closed when unconfigured. Mock schema tests do not claim live availability, billing, calibration or gameplay quality.

The shared controller remains the authority for request/revision/ID/legality and exactly-once execution, even after the adapter accepts a syntactically valid response. Afterstates shown to any provider are redacted to the original observed horizon, so enumerating hypothetical options cannot reveal the sixth or later future piece. Offline paired benchmark/replay and local comparison can proceed independently of paid provider access after their own supported task admission.

## P8-008 offline implementation

`providers.mjs` is a Node-only module outside the static public directory. `createAstraAdapter()` defaults to unavailable with live calls disabled. Tests inject a function explicitly marked `mode: 'fixture'`; there is no fetch implementation, environment lookup, credential input, automatic retry or provider fallback. Passing `live: true` fails. This is an executable offline protocol adapter, not a qualified live integration. A future authorized live boundary must supply verified credentials, model access and externally enforced request/token/spend limits; the zero-dollar offline configuration does not authorize spending.

`runMetadata` exposes the exact requested model alias, reasoning effort, standard service tier (`default`), output/timeout limits, zero retries/spend, instruction/protocol/schema versions and fixture-only availability. `lastReceipt` separately records sanitized failure categories, latency, fixture-reported model/tier/token usage, selected ID, response hash and an optional fixture artifact reference. Fixture usage is labeled as such; actual API usage/cost and resolved live model version remain unknown. Raw response bodies and transport error text are not retained or exported. A response hash is an integrity value, not a claim that a raw artifact was archived; a missing artifact reference remains null. These Node-side records do not imply setup/status/cost UI delivery.

The strict Responses request lowers controller schema constants to one-value enums, preserves every offered candidate, and sends the complete self-contained public packet. The adapter returns only the three controller decision fields. Cancellation and timeouts abort the injected transport and suppress its late completion; the controller independently revalidates before execution. All failure classes represent adapter errors rather than a Tetris loss.

Dependency refinement pins the independently reviewed nonvisual controller/packet interfaces at `5c7a926484ac799b3867eba7e5c2e3b9c2799339`, tree `35f1fadd4ffefe836501aa00148f26d5e0fbecaa`, plus accepted P8-003/004/005/007. P8-006 remains Blocked on its enlarged-text observation. No UI source or acceptance was changed by this adapter tranche; later combined UI acceptance is still required.
