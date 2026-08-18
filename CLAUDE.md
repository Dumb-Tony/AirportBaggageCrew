# CLAUDE.md — Airport Baggage Crew

**Read [GDD.md](GDD.md) first. It is the authority on this project.**

Chaotic co-op ground-handling game. Browser, Canvas 2D world + DOM/CSS interface, plain
ES modules, served over http, zero dependencies and zero runtime network requests.
Phase 1 is a solo browser prototype; online co-op on Steam is the long-term target.

**Before writing any non-trivial system, check [`..\INDEX.md`](../INDEX.md)** — the
Dev-wide catalog of what already exists and where to copy it from.

## Status

- 2026-08-17 — **M0 DONE.** Skeleton and design locks: `GameClock`, `Game` +
  `createInitialState`, seeded `Rng`, `EventBus`, `Input`, the airport map as data,
  `Camera` + `Renderer`, title/pause HUD, F3 developer overlay, crash banner,
  focus-loss auto-pause, and the headless-Chrome test harness.
  **117 assertions** + `docs/m0-airport.png`.
- 2026-08-18 — **M1 DONE.** The bag feels good. Bags with identity and one authoritative
  location, `containment.js` as the only writer of it, the conveyor, the verbs
  (grab / carry / put down / charge-throw / scan), arcade physics, a spatial grid, the
  scanner card, the authored 50-bag timetable as static data, a following camera, and
  the held-object + prompt HUD. Measured: full throw 12.1 m normal / 3.8 m heavy /
  16.8 m light; two seconds of walking 8.1 m empty vs 5.1 m carrying heavy; 100 loose
  bags cost 0.28 ms per step. **125 assertions, 242 total** + `docs/m1-sorting.png`.

## The rules that must not bend (GDD §31.1)

- **The airport never waits.** Flight state advances on `simTimeMs` crossing a
  threshold, never because a task completed. Nothing in `src/systems/` may ask whether
  the player is ready.
- **`GameClock` owns time.** No `Date.now`, `performance.now`, `setTimeout` or
  `setInterval` anywhere in `src/` except the bootstrap's frame delta in `main.js`.
  `tools\m0-tests.js` section G greps for this and fails the suite.
- **A bag has exactly one authoritative location.** `location.type` is the single truth;
  a bag changes container only through an explicit containment check on release.
- **Wrong actions are allowed.** Never block a mis-load, never teleport a bag back,
  never make a misplaced bag a loss condition. Errors become gameplay.
- **No gameplay `Math.random`.** Everything draws from a seeded `Rng` stream.
- **Rendering and UI own nothing.** No scoring in a renderer, no flight timing in the
  HUD, no entity ownership hidden in a DOM node.
- **All tuning lives in `src/config.js` or `src/data/`.** Difficulty, when it arrives,
  must be a MULTIPLIER applied at the read site — never an assignment into `CONFIG`,
  which is deep-frozen for that reason.

## Structures worth knowing

- **`clock.paused` is a function of `state.mode`, never set independently.**
  `Game._syncClockToMode()` is the only writer, called from the constructor, `reset()`
  and `setMode()`. Before that existed, a fresh game sat on the title screen with a
  running clock and silently burned shift time (caught by m0 C3).
- **Pause is total by construction, not by discipline.** Every simulation mutation
  happens inside `GameClock.advance()`'s step callback, which returns 0 steps while
  paused. No system needs to check a paused flag, so no system can forget to.
- **`Game.frame()` is the only entry point into the simulation** and `main.js` holds the
  only `requestAnimationFrame` loop. If a second loop ever appears, the clock is no
  longer authoritative.
- **Input edges are consumed per SIMULATION step**, not per render frame —
  `input.endStep()` is called inside the step callback. A grab pressed during a dropped
  frame still lands on exactly one step.
- **The state object is handed out live, not cloned.** `TheBenefactors`' `GameStore`
  deep-clones on every read; correct there, ruinous at 60 Hz with 100 bags. Readers are
  trusted not to write. Do not "fix" this by adding cloning.
- **`src/data/airport.js` is pure.** No canvas, no DOM, no state. The renderer draws the
  same `WALLS` records the collision code reads, so a wall cannot be drawn somewhere it
  does not block.
- **The event log is bounded** (`CONFIG.debug.eventLogSize`). A ten-minute shift with
  100 bags emits thousands of events; GDD §24.1 forbids unbounded logs.
- **`systems/containment.js` is the ONLY code that may assign `bag.location`.** Carts
  (M2), holds and `departed` (M3) all hang off `moveBag()` and inherit its proof.
  `conveyor.bagIds` and `player.carryingBagId` are DERIVED indexes — never a second
  source of truth. `assertContainment()` proves they still agree; run it after any new
  way of moving a bag, and add the new location type to `LOCATION_TYPES` first or
  `moveBag` will throw (deliberately).
- **`Game.step()` order is load-bearing**, and the comment in it says why: spawn → belt
  → rebuild grid → player → interaction → loose bags. Targeting needs the grid to exist;
  the carried bag follows the hands, so the player must have moved first.
- **A carried bag is PINNED, not simulated.** `stepPlayer` writes its position every
  step from the hands. `stepBags` only integrates bags whose location is `floor`. That
  split is what makes "exactly one authoritative location" cheap to honour.
- **Body colour is deliberately NOT the flight.** GDD §7.2 forbids colour as the only
  channel, so a tag is three channels — destination code, flight colour, flight icon —
  and the suitcase colour is cosmetic noise. A player who learns to sort by "the red
  ones" has learned a lie. m1 C6 asserts colours are shared across flights.
- **The scanner reports and never vetoes** (GDD §7.1, §31.1.8). It must never move a
  bag, block a placement, or correct a mistake. m1 G18 asserts a wrong placement stands.
- **The camera zoom is a READABILITY budget, not taste.** `CONFIG.render.viewWidthM`
  is set so a 0.72 m bag is ~19 px and its tag text is legible. Widening it breaks
  GDD §7.2. Every metre-space font in the renderer is sized against that zoom.
- **The conveyor feed defers rather than stacking.** If the belt entry is occupied,
  `spawnDueBags` breaks out and the schedule backs up. The belt never stops, so a
  deferred bag always arrives — late, which is the correct behaviour.

## Gotchas already paid for

- **Headless Chrome in `--dump-dom` mode delivers 1–3 `requestAnimationFrame` callbacks
  in total, then stops.** `setTimeout` and `performance.now` keep working normally.
  Measured across three flag sets with `tools\_raf.js`. Live assertions must drive
  `game.frame(1000/60, input)` themselves; a test that waits for 20 frames waits
  forever. Keep `tools\_raf.js` — re-run it if Chrome updates.
- **A `setTimeout` watchdog racing a frame counter always wins under virtual time.**
  The first version of the m0 suite used one and silently skipped every live assertion
  instead of failing. Watchdogs must trip on *stall*, not on elapsed time.
- **Source-hygiene greps must strip comments first.** The comment explaining "never call
  `Math.random`" contains the string `Math.random`, and failed its own rule.
- **A single 1000 ms `clock.advance()` is a clamped tab-suspend gap, not one second.**
  Feed sixty 16.67 ms frames when a test means "one second of play".
- **The suite must emit progressively.** `emit()` is called after every section, so a
  section that throws or hangs still reports how far it got. A blank dumped DOM teaches
  nothing; the first debugging round here was spent on exactly that.
- **A suite of synchronous sections never yields to the event loop, so no animation
  frame ever runs.** `await` on a synchronous function only queues a MICROtask; rAF
  callbacks are not microtasks. The m1 live section was silently testing a 1x1 unsized
  canvas until it called `yieldToLoop()` first. m0 only escaped this because its
  `await fetch` happened to yield. Any new suite with live assertions must yield first
  and then assert the boot loop actually ran.
- **A screenshot pose script must capture `game.state` AFTER `startShift()`.** `reset()`
  replaces the state object, so a reference taken earlier points at a discarded one and
  every edit vanishes without an error. The first M1 screenshot was posed entirely on a
  dead object and looked merely "empty".
- **Never write a rejection-sampling loop that fills a `Set` to a target count** unless
  the pool is provably much larger than the count. `buildBagSchedule` picked 4 priority
  bags from a 6-wide window that way; one edit to the twist numbers would have made it
  spin forever. Shuffle a candidate pool and slice instead.
- **Bash heredocs here break on apostrophes** — the command is wrapped in single quotes,
  so prose files (README, CHANGELOG, this file) need the Write tool, not `cat <<EOF`.
- `chrome.exe` is a GUI-subsystem binary: `$x = & chrome --dump-dom` captures **nothing**
  under PowerShell. Redirect to a file (`Start-Process -RedirectStandardOutput`).
- PS 5.1 `Get-Content -Raw` defaults to **ANSI** — always pass `-Encoding UTF8` or a
  UTF-8 file round-trips into mojibake.
- `$args` is a PowerShell automatic variable; naming a local `$args` breaks the script.

## Deviations from the GDD, and why

- **§21.1 "runs by opening `index.html`" is impossible with ES modules** (CORS blocks
  module loads on `file://`). Modules won because §21.2's whole architecture rests on
  them. `play.bat` serves over http; the page prints a clear message on `file://`.
- **§21.2's `tests/*.test.js` implies a Node runner. There is no Node.js on this box.**
  §31.4 lets Claude choose the runner "provided launch remains simple and offline", so
  the runner is the headless-Chrome PowerShell harness copied from Something's
  Different. Suites live in `tools\`, not `tests\`.
- **The suggested file tree is built lazily.** `core/stateMachine.js`, `entities/cart.js`,
  `entities/tractor.js`, `entities/aircraft.js`, `systems/flightSchedule.js`,
  `systems/scoring.js`, `systems/announcements.js`, `systems/save.js` and the three
  pending UI panels arrive with the milestones that fill them, per §31.1.3.
- **§21.2 `systems/baggageFlow.js` is split in two.** `containment.js` owns the location
  invariant (the thing that must never be violated); `baggageFlow.js` owns spawning and
  loose-bag movement. One file mixing an invariant with a simulation loop is how the
  invariant gets bypassed "just this once".

## Open questions for later milestones

- **§22.2's sample flight `times` cannot be shared across the §20.4 shift.** Its
  `departureMs: 225000` is 3:45, but §20.4 authors three flights across an 8–12 minute
  shift with the third starting before the second departs. Treat those numbers as
  absolute sim timestamps for *one* flight, authored per flight in `data/flights.js`.
  Confirm at M3.
- **§11.1 "Correct bag left loose on dangerous ramp area: optional small penalty"** —
  "correct" reads like a typo; any loose bag on a live movement area is the hazard.
  Confirm at M4.

## Run it

```
play.bat                    # serves on http://localhost:8361/
tools\test.ps1              # all suites (242 assertions), exit 0 = green
tools\test.ps1 -Only m1     # one suite

# diagnostics (not suites — they measure, they don't gate):
tools\smoketest.ps1 -Tests tools\_raf.js     # is rAF usable under the harness
tools\shot.ps1 -Setup tools\_shot-m1.js -Out docs\m1-sorting.png
tools\shot.ps1 -Setup tools\_shot-playing.js -Out docs\m0-airport.png
```

The m1 suite PRINTS its feel numbers (throw distances, walk speed carrying weight, heavy
bag mix per flight, cost per step at 100 bags) on every run. When Milestone 6 tunes the
game, those printed lines are the before/after evidence — read them, do not re-derive.

In the browser console: `__ABC` exposes `game`, `camera`, `renderer`, `hud`, `debug`,
`input` and `CONFIG`.

## Testing (binding — GDD §28)

No Node.js on this box. Serve over http, smoke-run in a real browser tab before
delivering anything. Batch edits atomically. Verify numbers, not vibes — assert measured
values and report failures plainly.

Every milestone that changes schedule, scoring or containment rules **must** add or
update assertions (GDD §31.1.11). Keep clock, geometry, scoring and containment maths
pure — plain objects, no canvas context — so it stays testable without a paint.
