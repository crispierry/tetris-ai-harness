# Computer-run clocks

Solo computer and Human vs computer show an active-play clock beside the computer name. Compare shows one clock per model and a short finish summary in the existing control rail. The title/status header keeps its fixed height, so clocks and results never move the boards. Comparison terminal outcomes remain in the status, accessible announcement and shared summary instead of repeating long paragraphs beneath both boards.

Clocks begin on Start or Step, include model preparation and response waits, remote admission queues, real gravity, configured automatic pacing, acknowledgement and the drop animation, and exclude Pause/Stop, hidden-page time and idle time between manual Steps. A completed computer's clock freezes while its peer continues. Resume accumulates active time; Reset clears it. In paired multi-sample tests, header clocks accumulate across samples. Replay shows the frozen original clocks and makes no new decisions. Time text updates at most ten times per second through a disposable timeout; those ticks do not redraw the boards or announce every tenth of a second to screen readers.

When both models finish all samples:

- If both reach the same 300-line target in every sample, the summary compares total active time and says how many seconds sooner and what percentage less time the faster run took.
- Other completed games compare placed pieces per active second. Placement caps and different line totals remain explicit; an early loss is never called a faster 300-line finish.
- A model error or an incomplete sample suppresses the speed ratio. Very short or missing measurements do not produce a ratio.

These are observed browser-run timings for the current test, not authenticated billing, pure model-inference benchmarks, or a general model-quality ranking. Canonical event records and their verifier are unchanged. Existing saved visual exports can retain per-sample timing summaries; canonical exports continue to describe game inputs and states. Reset or reloading the page clears the in-memory run and its clocks, just as it clears its existing recording. No provider request, budget or gravity policy is changed by clock display.
