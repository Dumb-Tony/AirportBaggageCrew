# Changelog

## Milestone 0 — skeleton and design locks — 2026-08-17

**Exit criterion: stable blank simulation, pause/restart, deterministic seed. Met.**
117 assertions green (`tools\test.ps1`).

Built:

- `GameClock` — the single owner of simulation time. Fixed 1/60 s step with an
  accumulator; frame gaps over 250 ms are discarded rather than banked, so a backgrounded
  tab cannot make the airport lurch forward. The clock advances `simTimeMs` itself while
  calling the step callback, so steps and simulation time cannot drift apart.
- `Game` — authoritative state in the GDD §21.4 shape, `createInitialState`, fixed-step
  driver, mode machine (title / playing / paused / report), restart, and an observation
  boundary for the renderer and UI.
- `Rng` — `mulberry32` copied from Something's Different, wrapped in a named,
  resettable, draw-counting stream. `hashStr` for seeding a shift from its label.
- `EventBus` — the GDD §21.5 event vocabulary, with a **bounded** recent-event log.
- `Input` — actions, not keycodes; press edges consumed per simulation step, not per
  render frame; drops held keys on focus loss.
- `src/data/airport.js` — the Tiny Regional airport as data plus pure geometry helpers.
  Sort room with a 6 m door, staging apron, service road, ramp, two gate stands.
  Measured route: sort-room door to gate 1 is 55.1 m, to gate 2 is 61.7 m.
- `Camera` + `Renderer` — Canvas 2D, world drawn in metres, whole airport fitted on
  screen, oversized painted gate numbers so the world carries the information.
- `Hud` — title and pause cards, shift clock, driven by mode through one funnel.
- `DebugOverlay` — F3. Sim time, steps, FPS, seed, RNG draws, time scale, clamp count,
  recent events, bounds and grid toggles, skip-10-seconds.
- Crash banner, focus-loss auto-pause, `play.bat`, and the headless-Chrome test harness.

Fixed during the milestone:

- **A new game left the clock running on the title screen.** `createInitialState` set
  `mode: 'title'` directly while `GameClock.reset()` left `paused: false`, so the shift
  burned simulation time behind the title card. `clock.paused` is now a function of
  `mode` alone, applied by `_syncClockToMode()` from both the constructor and `reset()`.
  Caught by assertion C3; it would have been invisible until Milestone 3 put a flight
  clock on screen.

Learned about the harness, and worth not rediscovering:

- **Headless Chrome in `--dump-dom` mode delivers 1–3 `requestAnimationFrame` callbacks
  and then stops**, while `setTimeout` and `performance.now` keep running normally.
  Measured with `tools\_raf.js`: `--run-all-compositor-stages-before-draw` gave 3,
  swiftshader with the GPU enabled gave 1, and dropping `--virtual-time-budget` produced
  no output at all. Live assertions must drive `game.frame()` themselves.
- A `setTimeout` watchdog racing a frame counter **always wins** under virtual time, so
  the first version of the suite silently skipped every live assertion instead of
  failing. Watchdogs here must trip on stall, not on elapsed time.
- Source-hygiene greps must strip comments first: the comment explaining "never call
  `Math.random`" contains the string `Math.random`.

Not built, on purpose: player, bags, carts, tractor, flights, scoring, audio, save.
