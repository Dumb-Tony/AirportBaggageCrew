# Changelog

## Milestone 3 — the sacred schedule — 2026-08-19

**Exit criterion: a no-input shift completes deterministically. Met.**
105 new assertions, 487 total (`tools\test.ps1`).

Built:

- **`stateAt(times, simTimeMs)` — the whole antagonist, as a pure function.** It takes
  the authored times and the clock, and nothing else. There is no argument that could
  carry player readiness and no closure it could read one from, so GDD §31.1.7 ("never
  make a flight wait for task completion") is enforced by shape rather than by
  discipline. The suite proves it: the same flight at the same instant returns the same
  state for an idle crew, a swamped one, and one that has already loaded everything.
- **The full GDD §5.1 lifecycle** — SCHEDULED, BAG_ACCEPTANCE, LOADING, FINAL_BAG_CALL,
  HOLD_CLOSING, PUSHBACK, DEPARTED — each transition landing on its exact millisecond
  and never running backwards.
- **Aircraft on stand.** One regional type per GDD §9.1: taxis in to finish exactly at
  bag acceptance, sits on its marks, pushes back exactly at departure. The hold is a
  real oriented box, not a proximity radius, because §9.1 is explicit that a bag counts
  as loaded only when released *inside the valid hold volume* — touching the fuselage
  does not count, and the suite asserts that specifically.
- **Loading and unloading.** Carry or throw a bag through an open door and it is aboard.
  Take it back out before closure and it stops counting. Load somebody else's bag and
  the game lets you — the scanner says "wrong", it does not refuse (GDD §31.1.8).
- **Hold closing means closed.** After HOLD_CLOSING nothing more goes in, from any
  route: not by hand, not thrown, not from a cart. A bag lying in the doorway of a
  sealed aircraft stays on the ramp.
- **Departure evaluates every expected bag** (GDD §5.2). Correct, misrouted, missed —
  counted once, with the arithmetic closing: owed equals delivered plus missed. Wrongly
  loaded bags travel anyway and record where they actually went. Missed bags stay
  exactly where they are, physical and retrievable, because §5.2 requires it.
- **Three readability channels** (GDD §5.3): the flight board with status, countdown and
  a loaded-of-expected count; announcement toasts; and the aircraft itself, whose door
  reads HOLD OPEN or HOLD CLOSED. Colour is reinforcement on all three — turn every hue
  off and the board still spells out what is happening.
- **Debug**: `,` skips to just before the next flight event, and `forceDeparture()` pushes
  a flight to pushback now (GDD §21.8).

Measured, printed by the suite on every run:

| | |
|---|---|
| A no-input shift | all 3 flights depart, all 50 bags classified, 0 delivered |
| The same shift, worked by a scripted bot | 50 of 50 delivered, 100% on-time baggage |
| Cost of a step of the whole airport | 0.07 ms against a 16.67 ms budget |
| Ten minutes of airport | simulates in ~2.5 s, about 240x real time |
| Gate 1, used twice | AB221 clear at 195 s, SK307 taxis in at 201 s |

Fixed during the milestone:

- **SK307 was double-booking gate 1.** Its acceptance was 200 s, but AB221's aircraft is
  not clear of the stand until 195 s once the taxi-in and pushback are counted — and
  SK307's own taxi-in would have started at 196 s. `gateConflicts()` compared
  acceptance-to-departure, which is narrower than the window a stand is actually
  occupied; it now compares the real window, and SK307 moved to 205 s.
- **The wings read as grey slabs** laid across the stand. Swept and tapered, and the
  wingspan cut from 24 m to 21 m so it fits a 22 m stand instead of overhanging it.
- **HOLD OPEN was printed underneath the crew**, where the player, the cart and the hold
  zone all crowd the same few metres. Moved beside the door.

Two tests changed because their premise expired rather than because anything broke:

- m1 C10 asserted every bag is still `active` after a full shift. Since departures now
  classify what they were owed, that stopped being true the moment flights began
  leaving; the invariant was always about how a bag STARTS, so it samples early now.
- m3 F13 first asserted a whole shift simulates in under 3 s and passed by five
  milliseconds. A threshold that tight is a flake, not a check — it measures per-step
  cost against the frame budget now, which is the number that actually means something.

Not built, on purpose: scoring, the shift report, audio, save. A perfectly worked shift
and a disastrous one still produce the same nothing at the end — that is Milestone 4.


## Milestone 2 — transport — 2026-08-19

**Exit criterion: a full cart can travel to either gate without state corruption. Met.**
140 new assertions, 382 total (`tools\test.ps1`).

Built:

- **Carts.** Ten fixed slots, capacity by space AND weight (both bind: ten light bags run
  out of slots at 90 kg, heavy ones run out of weight at six), a placard the player sets
  or ignores, and a stability score. Bags in a cart are pinned to slots rather than
  simulated — GDD §21.6 — which is what makes "arrives without corruption" a property
  instead of a hope.
- **`systems/hitching.js`.** Trains are a linked chain with a back-pointer, and
  `validateChain()` proves the two halves of every link still agree — the GDD §28.1 unit
  test, run after every hitch, every unhitch, every step of every drive, and live in the
  debug overlay. It catches one-sided links, a cart towed by two parents, and cycles.
- **The tractor.** Throttle, brake, reverse that brakes first, and a yaw rate that ramps
  with speed. The turning RADIUS is a constant 1.7 m below the reference speed and grows
  to 3.9 m at full tilt — GDD §8.2 ("forgiving turning at low speed", wider arcs when
  fast) expressed as one formula rather than a table.
- **Towing by constraint.** Each cart is placed at a fixed distance behind its parent
  hitch, facing it. A long train cuts corners and swings wide for free, with no solver,
  and the drawbar cannot stretch: measured worst-case error over a full run to a gate was
  under 0.02 m.
- **Spillage.** Lateral load is speed × yaw rate scaled by how full the bed is; sustained
  load drains stability and an empty tank throws the top bag off the outside of the turn.
  A spilled bag lands on the ramp, physical and retrievable, and a cooldown stops the
  cart that just lost it from swallowing it again on the next frame.
- **The loading verbs.** E at a cart loads the held bag, or takes one back off the top.
  A thrown bag that lands in a cart is caught by it. F sets the placard on foot, climbs
  in and out of the tractor, and E hitches or unhitches while driving.
- **Layout change.** The two marked bays moved from the far side of the sort room up to
  the belt. At Milestone 1 the carry was ~17 m per bag; with carts as the target that
  walk is the whole loop and it was far too long. It is now ~7 m — the pressure should
  come from choosing the right cart and from the drive, not from walking.

Measured, printed by the suite on every run:

| | |
|---|---|
| Turning radius | 1.7 m at 1.5 m/s · 1.7 m at 3 m/s · 3.9 m at 7 m/s |
| Nought to top speed | 1.17 s |
| A loaded cart to gate 1 / gate 2 | 19.6 s / 20.6 s of driving, 10 of 10 bags delivered |
| Drawbar stretch over a full run | under 0.02 m |
| Cart capacity | 10 light bags (slots) · 6 heavy bags, 186 kg (weight) |
| Three-cart train, driven hard | 11 of 12 aboard, 1 shaken off |
| Ten bags, full-lock circle at 7 m/s | 9 shaken off |
| The same circle at 1.2 m/s | 0 spilled |
| Three loaded carts + 100 loose bags | 0.33 ms per step, against a 16.67 ms budget |

Fixed during the milestone:

- **You could load a bag into a cart and then be unable to get it back out.** A cart is
  2.4 m long and reach is 1.7 m, so the first slot sits at the far corner, out of range
  from the side you loaded it from. E with empty hands now takes the top of the pile when
  nothing specific is in reach — which is how you unload a cart in life too.
- **Spill was emptying a full cart in about a second** of hard cornering. Softened; one
  bad corner now costs a bag or two rather than the load. Milestone 6 owns the real
  balance pass, and these numbers are provisional.
- **Bags overhung the ends of the cart bed** by about 11 cm. Slot run inset.
- **The title card still said Milestone 0** and described a game with no bags in it.

Kept clean on purpose:

- The renderer needs to draw a placard, so `setPlacard()` writes a **denormalised display
  copy** (`placardLabel`, `placardColor`) beside the id. One writer, so it cannot drift,
  and the renderer still imports no flight data at all.
- The m0 source-hygiene check was rewritten to test for scoring and schedule LOGIC rather
  than for the words "score" and "flight". Drawing a flight code on a stand is legitimate
  and Milestone 3 will have to; computing a departure in the renderer never is.

Not built, on purpose: aircraft, flight state machine, holds, scoring, audio, save.


## Milestone 1 — the bag feels good — 2026-08-18

**Exit criterion: moving and sorting ten bags is reliable and pleasant. Met.**
125 new assertions, 242 total (`tools\test.ps1`).

Built:

- **Bags with identity.** Unique id, printed six-digit tag, flight, destination, gate,
  priority, weight class, scan history, condition, and a single authoritative
  `location`. Identity survives every move; the suite proves no bag is ever duplicated
  or lost across a full shift.
- **`systems/containment.js` — the one writer of `bag.location`.** Reverse indexes
  (`conveyor.bagIds`, `player.carryingBagId`) are derived and proven to agree by
  `assertContainment()`, which the debug overlay runs live and the suite runs after
  every interesting operation. Grabbing a second bag puts the first down rather than
  orphaning it. An unknown location type throws rather than being written.
- **The conveyor.** 21 m of belt at 1.6 m/s — a 13 s ride — running whether or not
  anyone is watching. Bags queue behind each other rather than overlapping, drop off the
  end onto the floor with a seeded sideways kick, and pile up. There is deliberately no
  overflow bin: the pile is the pressure.
- **The verbs.** Move, aim, grab, carry, put down, charge-and-throw, scan. Aim follows
  the mouse, or the direction of travel for keyboard-only play. Carrying a heavy bag
  slows the player and shortens the throw.
- **Arcade physics.** Axis-separated wall resolution so entities slide instead of
  sticking, linear friction with a dead-stop threshold, and positional push-apart
  between bags. The player shoves bags aside rather than being blocked by them — being
  unable to walk through your own mess would be realistic and miserable.
- **A uniform spatial grid** (GDD §24.2), rebuilt each step, so interaction and
  separation stay linear in bag count.
- **The scanner card.** Reports; never vetoes. It already says "wrong staging pad"
  because the two floor pads are gated by gate id, and it lets the mistake stand.
- **The authored shift** as static data: three flights, 50 bags, deterministic
  timetable with pressure peaks, late bags and the GDD §20.4 twists — MC184 heavy,
  SK307 priority-late. The flight state machine is still Milestone 3.
- **A following camera** at a zoom set by tag readability, plus a held-object indicator
  and a contextual prompt.

Measured, not assumed — printed by the suite on every run:

| | |
|---|---|
| Throw, normal bag | 1.4 m tapped · 12.1 m fully charged |
| Throw at full charge | 3.8 m heavy · 16.8 m light |
| Two seconds of walking | 8.1 m empty-handed · 5.1 m with a heavy bag |
| A bag thrown at 8 m/s | slides 1.35 s |
| Heavy bags per flight | AB221 6% · MC184 31% · SK307 39% |
| 100 loose bags | 0.28 ms per step, against a 16.67 ms budget |
| Unattended 10-minute shift | all 50 bags spawn, all 50 end on the floor, nothing lost |

Fixed during the milestone:

- **A fast feed stacked bags on top of each other at the belt entry.** Spawning now
  defers until the entry is clear, so the check-in feed backs up instead — which is what
  a real backlog does. The belt never stops, so a deferred bag always arrives, just late.
- **`buildBagSchedule` picked priority bags by rejection-sampling into a `Set`.** With
  SK307 needing 4 of a 6-wide late window it was already slow, and one edit to the twist
  numbers away from never terminating. Replaced with a seeded shuffle of a candidate
  pool.
- **The camera zoom broke world signage.** Every metre-space font was sized for
  Milestone 0 fit camera at ~10 px/m; at the follow camera ~26 px/m the zone labels
  swamped the sort room and the painted gate numbers were 13 m tall. Retuned, and the
  player is now drawn larger than its collider so it reads as a person rather than a dot.

Learned about the harness:

- **A suite of synchronous sections never yields to the event loop.** `await` on a
  synchronous function only queues a microtask, and animation frames are not microtasks,
  so the boot loop had never run, the canvas had never been sized, and the m1 render
  assertions were testing a 1x1 canvas. m0 only escaped this because its `await fetch`
  happened to yield. Live sections now yield explicitly first, and assert that the boot
  loop ran.
- **A screenshot pose script must capture `game.state` AFTER `startShift()`**, because
  `reset()` replaces the object. Captured before, every edit lands on a discarded state
  and vanishes silently — which is exactly what the first M1 screenshot showed.

Not built, on purpose: carts, tractor, aircraft, flight state machine, scoring, audio,
save.


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
