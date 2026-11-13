# Project instructions


## Shared CI/CD fast feedback

Follow the [shared CI/CD operating guide](https://github.com/crispierry/codex-skills/blob/main/docs/ci-cd-operating-guide.md) and this repository's existing
validation/release owner. Before package/build/pipeline edits reach hosted CI,
run the cheapest existing entry-point/stage contract, finish available review,
refresh main and batch compatible fixes. Narrow checks only from demonstrated
input/consumer differences; preserve required security, compatibility and source
binding. Wait for configured automatic review findings before merging. A guidance
update does not deploy, change provider settings or resume held work.

Use `npm test` for local offline regression feedback. Before changing package/CLI
or test-entry behavior, also exercise the actual CI entry point:
`node --pending-deprecation --test`. Keep the Node version and five-minute cap in
`.github/workflows/test.yml`; PR and main-integration runs remain distinct.
No lint framework, model/API calls, application deployment or new approval gate
is introduced for this process guidance.
