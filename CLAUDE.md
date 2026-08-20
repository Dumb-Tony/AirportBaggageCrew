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
- 2026-08-19 — **M2 DONE.** Transport. Carts with slots, dual capacity and placards;
  `hitching.js` with a validated chain; the tractor; towing by drawbar constraint;
  spillage on hard corners; load / unload / hitch / drive verbs. The marked bays MOVED
  north to the belt — the M1 carry was ~17 m per bag and is now ~7 m. Measured: turning
  radius 1.7 m below the reference speed, 3.9 m at full tilt; a loaded cart reaches
  gate 1 in 19.6 s with 10 of 10 aboard; drawbar stretch under 0.02 m; three loaded
  carts plus 100 loose bags cost 0.33 ms per step. **140 assertions, 382 total** +
  `docs/m2-transport.png`.
- 2026-08-19 — **M3 DONE.** The sacred schedule. `stateAt(times, simTimeMs)` is a PURE
  FUNCTION and is the whole antagonist; the full GDD §5.1 lifecycle; aircraft that taxi
  in, open a real hold volume, and push back on the clock; departure evaluation
  (correct / misrouted / missed, arithmetic closing); the flight board, announcement
  toasts and hold-door state as the three GDD §5.3 urgency channels. SK307 moved to
  205 s — it had been double-booking gate 1 once taxi and pushback were counted.
  Measured: a no-input shift departs all 3 flights and classifies all 50 bags; a
  scripted bot delivers 50 of 50; a step of the whole airport costs 0.07 ms.
  **105 assertions, 487 total** + `docs/m3-final-call.png`.

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
- **A towed cart is POSITIONED, not integrated.** `updateTrain` places each cart at a
  fixed distance behind its parent hitch, facing it, then calls `pushOutOfWalls`. That
  is why a train cuts corners correctly with no solver and why the drawbar cannot
  stretch. It also means a cart does not collide properly — do not add velocity to a
  towed cart, fix the constraint instead.
- **A hitch link is stored twice** (`parent.nextCartId` and `child.hitchedToId`) because
  both directions get walked. Duplications drift, so `validateChain()` proves they still
  agree and it runs in the debug overlay live, not only in the suite. Any new way to
  attach or detach a cart must go through `hitch`/`unhitchTail`.
- **`Game.step()` order is load-bearing and now starts with vehicles**: spawn → belt →
  vehicles + trains → pin cart loads → rebuild grid → player → interaction → loose bags →
  cart absorption. A driving player is positioned FROM the tractor, so the tractor must
  move first; the load is pinned immediately after the train is placed so a cart and its
  bags can never be rendered a step apart.
- **The renderer must never import flight data.** `setPlacard()` writes denormalised
  display copies (`placardLabel`, `placardColor`) beside the id so the renderer can draw
  a placard without knowing what a flight is. One writer, so they cannot drift. When M3
  puts flight codes on aircraft, do the same thing rather than reaching for `flights.js`.
- **A cart is longer than the player can reach.** 2.4 m of bed against 1.7 m of reach, so
  the far slots are genuinely unreachable from one side. E with empty hands takes the TOP
  of the pile when nothing specific is in range; without that you could load a bag and
  then be unable to retrieve it.
- **Spill is a stability score, not physics** (GDD §6.4 permits this). Lateral load is
  speed × yaw rate scaled by fill. The numbers are PROVISIONAL — M6 owns them — and a
  full-lock circle at top speed still empties a cart.
- **`stateAt(times, simTimeMs)` is a pure function and must stay one.** It is how GDD
  §31.1.7 is enforced: there is no parameter that could carry player readiness, so a
  flight cannot be made to wait. Do not add a `state` argument, do not close over
  anything, do not "just check whether the hold is empty first". m3 A11/A12 and E1-E3
  exist specifically to catch that.
- **The hold is a VOLUME, not a radius** (GDD §9.1: "Do not count a bag merely because it
  touched the aircraft"). `holdContains` is an oriented box test, and every loading path
  — by hand, thrown, absorbed — goes through it. m3 B6 asserts the fuselage centre does
  not count.
- **Evaluation happens once, at PUSHBACK**, and `expectedCount` comes from the TIMETABLE
  rather than from what spawned — so a bag the conveyor never reached still counts as
  missed instead of vanishing from the arithmetic. m3 F7 checks owed = delivered + missed.
- **Missed bags are not touched.** GDD §5.2 requires them to stay physical and actionable
  after the aircraft leaves, so evaluation sets `lifecycle` and nothing else. Never move
  a missed bag to a bin, a warehouse or a null location.
- **A gate is occupied for longer than acceptance-to-departure.** `standWindow()` widens
  it by the taxi-in and the pushback, and `gateConflicts()` compares THAT. The narrower
  comparison passed while SK307 was arriving before AB221 had left.
- **Announcement copy must say what happened in words.** Until M5 brings audio, the
  toasts are the only channel besides the board, and GDD §5.3/§16.3 forbid colour being
  the only differentiator. Never write a toast whose meaning is in its tone.

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
- **Never assume WHEN a seeded event happens.** "A bag exists by 30 s" is a property of
  one seed, not of the game. Loop until the condition holds, bounded. This has now bitten
  twice — m2 F2 and m1 C10 — both times as a confident-looking assertion about a spawn
  time.
- **When a test breaks after a milestone, ask whether its PREMISE expired.** m1 C10
  asserted every bag is still `active` after a full shift; M3 made departures classify
  them, so the assertion was describing a world that no longer exists. That is a test to
  rewrite, not code to revert — but check which it is before touching either.
- **A performance threshold that passes by five milliseconds is a flake.** m3 F13 first
  asserted a whole shift runs in under 3 s and measured 2995 ms. Assert the per-step cost
  against the frame budget, which is the number that means something, and print the total.
- **Never write a rejection-sampling loop that fills a `Set` to a target count** unless
  the pool is provably much larger than the count. `buildBagSchedule` picked 4 priority
  bags from a 6-wide window that way; one edit to the twist numbers would have made it
  spin forever. Shuffle a candidate pool and slice instead.
- **Bash heredocs here break on apostrophes** — the command is wrapped in single quotes,
  so prose files (README, CHANGELOG, this file) need the Write tool, not `cat <<EOF`.
  There is also no `python`/`python3` on this box; `sed`, `perl` and the Edit tool are
  the editing options, and `sed` with backslash-heavy Windows paths often silently
  matches nothing — check the result rather than trusting the exit code.
- **A source-hygiene grep must test for LOGIC, not for words.** The m0 G4 check
  originally failed the renderer for containing the string "flight", which a placard
  legitimately needs. It now looks for score arithmetic, schedule field names and
  `simTimeMs` comparisons instead.
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

## Publishing — do this every milestone

**Live: https://dumb-tony.github.io/AirportBaggageCrew/**

GitHub Pages serves `main` at root, so a `git push` IS the deploy — no build step, no
second repo, no `dist/`. Pages takes ~30-60 s to rebuild.

**After every update, post that link in the chat.** The user asked for it explicitly
(2026-08-19) and it is the only way they can actually play what was just built.

- `.nojekyll` is in the repo root on purpose. Jekyll silently drops paths beginning with
  an underscore, and `tools/_shot-*.js` and `tools/_raf.js` do.
- Everything is relative-path. Do not introduce a root-absolute `/src/...` URL in
  shipping code — the site lives under `/AirportBaggageCrew/`, not at the domain root.
  (The suites use `fetch('/' + f)`, which is fine: they only ever run against the local
  harness server.)
- Verify after pushing rather than assuming:
  `curl -sSI https://dumb-tony.github.io/AirportBaggageCrew/src/main.js`

## Run it

```
play.bat                    # serves on http://localhost:8361/
tools\test.ps1              # all suites (487 assertions), exit 0 = green
tools\test.ps1 -Only m3     # one suite

# diagnostics (not suites — they measure, they don't gate):
tools\smoketest.ps1 -Tests tools\_raf.js     # is rAF usable under the harness
tools\shot.ps1 -Setup tools\_shot-m3.js -Out docs\m3-final-call.png
tools\shot.ps1 -Setup tools\_shot-m2.js -Out docs\m2-transport.png
tools\shot.ps1 -Setup tools\_shot-m1.js -Out docs\m1-sorting.png
tools\shot.ps1 -Setup tools\_shot-playing.js -Out docs\m0-airport.png
```

The m1 and m2 suites PRINT their feel numbers (throw distances, walk speed under load,
turning radius by speed, time to each gate, drawbar stretch, spills per corner, cost per
step) on every run. When Milestone 6 tunes the game, those printed lines are the
before/after evidence — read them, do not re-derive them.

In the browser console: `__ABC` exposes `game`, `camera`, `renderer`, `hud`, `debug`,
`input` and `CONFIG`.

## Testing (binding — GDD §28)

No Node.js on this box. Serve over http, smoke-run in a real browser tab before
delivering anything. Batch edits atomically. Verify numbers, not vibes — assert measured
values and report failures plainly.

Every milestone that changes schedule, scoring or containment rules **must** add or
update assertions (GDD §31.1.11). Keep clock, geometry, scoring and containment maths
pure — plain objects, no canvas context — so it stays testable without a paint.
