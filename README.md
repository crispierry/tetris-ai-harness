# Local human-play falling-block game

This is the supervised product rescue. It is not evidence that Tom completed its unattended Tetris acceptance scenario.

Seven four-square shapes fall on a 10×20 board. Arrows move and soft drop; Up or X rotates clockwise; Space hard drops; P pauses or resumes. Click Start game, then keep focus on the board. Leaving the board or hiding the tab pauses the game; Resume returns focus. New game resets the board, score, timing and deterministic piece sequence. No autoplay or touch-play feature is included.

Rules deliberately use simple clockwise matrix rotation with horizontal kicks (0, −1, +1, −2, +2), immediate locking when a downward move fails, and no hidden rows. Complete rows score 100/300/500/800 points times the level before the clear. Marathon starts at level 1; level increases every ten lines, up to 30. Clear 300 lines to complete the game. The complete final clear scores at its pre-clear level, then freezes the settled board before any next piece spawns. New game resets to level 1. This is a classic-inspired local game, not an exact official rotation-system implementation.

The engine uses a deterministic seven-piece bag, seed 0x6d2b79f5, xorshift32 and Fisher–Yates shuffling. This makes tests and offline computer/comparison/versus play reproducible. See `docs/MARATHON.md` for shared terminal, replay and finite-run contracts.

Run `npm test` with Node 24.22.1. The existing server requires an explicit local URL, port, actual Git head/base/tree and operation UUID in BOB_LOCAL_* variables. `verify-health.mjs` checks that serving identity. `verify-game.mjs` additionally checks exact served assets and actual engine transitions; it does not claim browser interaction. Local delivery is coordinated separately; no hosting or deployment is configured.
