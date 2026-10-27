# Contributing

Use Node 24.22.1 and a Git clone. There are no third-party runtime or npm dependencies. Run `npm test` before proposing changes. Tests must remain offline and must not consume paid API quota.

Keep one canonical rules engine for new play. Preserve exact candidate-to-choice binding, deterministic piece sequences, replay verification, independent comparison lanes, aligned board geometry and fixed control positions. Keep explanations short on the playing surface and place technical detail in documentation. Check the four pages at a typical 14-inch MacBook viewport and a narrow viewport after layout changes.

New providers must explicitly report model, assistance, endpoint, usage and cost provenance. Never silently select another model, rank OpenAI's moves locally, substitute a heuristic answer, retry paid calls automatically or reset historical accounting. Qualify a live integration separately from offline contract tests. Mock protocol adapters are labeled fixtures; they do not establish live provider support.

Do not commit credentials, project configurations, budget evidence, private ledgers, recordings or personal paths. Keep real paid configuration outside the checkout. Share minimal synthetic reproductions. Curated public research data belongs in `docs/research/` only after checking its contents for private metadata.

Pull requests should explain the user-visible behavior, relevant tests and remaining limits. GitHub workflows must remain read-only and offline, without production secrets, deployment credentials or paid-provider access. Untrusted PR code must never run in a privileged `pull_request_target` workflow.

Historical serializers and frozen replay engines are maintained compatibility, not new-game entry points. Remove obsolete code only after checking imports, saved-record dispatch and fixtures; update the documented compatibility boundary when a format changes.

Contributions are provided under the repository's MIT license.
