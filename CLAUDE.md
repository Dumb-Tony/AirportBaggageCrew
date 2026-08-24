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
- 2026-08-19 — **M4 DONE.** Outcomes and pressure. `scoring.js` on GDD §11.1's values, a
  pull pass that cannot double-count, a derived shift end (8:07, no dead ramp time), the
  shift report with §11.2 metrics and §11.3 odd statistics, replay, and `save.js` for the
  best shift. Measured: a worked shift 6100 points at 50/50; an untouched one −7500 at
  0/50. **113 assertions, 600 total.**
- 2026-08-19 — **OBLIQUE 2.5D.** The presentation pass, on a playtest note that the
  straight-down view read as "dot on the map". See "The look" below.
  `docs/m5-oblique.png`, `docs/m5-oblique-sortroom.png`.
- 2026-08-20 — **M5 DONE.** Onboarding and juice. `systems/audio.js` (WebAudio, inert
  until a gesture arms it, subscribing to the same bus the effects use);
  `systems/onboarding.js` (an eight-step rail over a completely live shift — no training
  pauses, because the airport never waits); `ui/settings.js` (volumes, reduced motion,
  text scale, guide toggle, and a schedule-pressure assist). Measured: a 200 s shift with
  live audio attached and one with none produce byte-identical `describe()` snapshots;
  600 live frames with audio wired in cost 0.020 ms each; the assist takes the shift from
  8:07 to 12:49 without touching a verb. **179 assertions, 779 total** +
  `docs/m5-first-minute.png`, `docs/m5-settings.png`.
- 2026-08-20 — **M6 DONE. PHASE 1 FEATURE-COMPLETE.** Balance and hardening.
  `tools/_bot.js` is a crew that PLAYS — walking, placarding, hitching, driving, loading
  holds, all through `input._debugPress` — and `tools/_balance.js` prints GDD §28.4's
  telemetry from it. It found the game unwinnable: 32% delivered and a five-figure
  deficit on every seed at every skill. Three fixes (a loaded cart in reach now beats
  the hold when TAKING a bag; 50 bags → 34; every window +45%, shift 8:07 → 11:32) took
  a competent crew to 76% and +1633 points, a careless one to 30% and −2467.
  (Those were single-seed figures. The gating assertions now run three seeds and gate on
  the median, because a tuning change that shifted seed 12345 by sixteen points would
  otherwise have flipped a claim about the whole game. **Superseded 2026-08-21** — see
  the bag-count entry below; the shift is 42 bags now and a competent crew clears 80%.)
  `tools/m6-tests.js` is GDD §29 made executable, with four criteria reported OPEN
  because they need external playtesters. Measured: 124 bags and three loaded carts cost
  0.079 ms per step, 210x frame-budget headroom; zero dead ends and zero unreachable
  bags across nine played shifts. **156 assertions** + `docs/m6-report.png`.
- 2026-08-20 — **HARDENING PASS.** Four adversarial audits — three in parallel over
  `src/systems`, over `core`/`entities`/`render`/`ui`, and over the GDD itself, then a
  fourth re-reading the fixes. Eighteen real defects, every one reproduced before it was
  touched. The worst: the difficulty assist stretched the flights but not the bags, so
  the scanner counted down to the wrong departure and §20.4's late-bag twist landed two
  minutes early; hitching a loaded cart threw a bag off it with the tractor standing
  still; getting out of the tractor could drop you inside a wall and freeze the game;
  the report could claim more mishandled bags than the shift had; and keys tapped behind
  the pause card all fired on resume. Four missing GDD requirements built (§24.3 recover
  action, §23.1 onboarding flag, §20.2 priority penalty, §16.3 board icons). Plus
  `tools/m7-tests.js` for working code no assertion would have missed, and
  `tools/_soak.js` fuzzing every invariant after every step. **1085 assertions, eight
  suites** + `docs/m6-title.png`.
- 2026-08-21 — **THE RENDERER, THE SUITES, AND THE BAG COUNT.** Three render bugs that had
  been shipping since M1 and were visible in this repo's own hero images: bags riding the
  conveyor painted *under* the belt, the aircraft drawn back-to-front, cart bags sliding
  under the bed. None of the four "the world paints" assertions could catch any of them —
  each sampled one pixel at the canvas centre, which the ground fill alone satisfies.
  `tools/m8-tests.js` replaces that with a DIFFERENTIAL (remove one class of thing,
  re-render, count changed pixels: 0 px before the fix, 1127 after). Then a meta-audit of
  the suites themselves found ~20 assertions that could not fail and the structural hole
  that a green suite never proved how many assertions RAN — the runner now enforces a
  per-suite count. `_soak.js` gained the one verb the fuzzer could not reach and
  immediately found a real bug: one press of `X` threw a bag off a train standing still.
  And `tools/_route.js` found the balance instrument cannot drive, which re-opened the bag
  count and closed the GDD §20.2 deviation at 14/14/14. **1208 assertions, nine suites.**
- 2026-08-23 — **THE INSTRUMENT CAN DRIVE, AND THE SHIFT IS 51 BAGS.** `CrewBot`'s reverse
  branch steered to aim the tractor's REAR at its target, so a target directly behind
  produced no steering and it reversed in a straight line for however far away it was — it
  drove half of every haul home backwards at the 3 m/s cap. Fixed: the nose turns toward
  the target when reversing to turn round, the tow point only when backing ONTO a drawbar.
  Open run **4.16 → 6.76 m/s**, throttle 31% → 97%.
  The train is now PERMANENT (up to three carts, never shed), which is the cart-management
  design the README had carried as an open limitation since M6 — three earlier attempts
  failed on shedding, and the answer was to stop shedding.
  Then the bag count was re-swept, because the first sweep had been measured on the
  instrument that could not drive: **42 → 51 bags (17 per flight)**, which is deeper into
  GDD §20.4's 14-18 and §20.2's 40-60. A competent crew **85% / +3350**, a careless one
  **48% / −1583** — and that last number matters, because at 42 bags a careless crew had
  started finishing in CREDIT and m6 D6 ("nobody clears it without trying") went red. The
  bigger shift restores the pressure the scoring is supposed to express.
  Raising the count then surfaced TWO real physics bugs that had been shipping since M1,
  both found by the invariant sweep rather than by eye: `separate()` normalised a
  degenerate contact with a divisor of 1e-6 and flung a bag **181 km** out of the world,
  and separation could shove a bag through the sort-room wall where nothing could reach
  it. **1345 assertions, ten suites, soak clean across 21 fuzzed shifts.**

- 2026-08-24 — **M10: THE SUITES ARE TESTED TOO.** GDD §35, authored after the fact. Two
  holes found by auditing my own new code first — m9 `E5` checked the status labels in the
  audit's OWN table rather than anything the game renders, and the rule that `CrewBot`
  never writes to state was written in this file and checked by nothing. Both closed (m9
  `E5` now drives a live `FlightBoard` and reads `textContent`; m6 section J deep-snapshots
  the whole state graph either side of `bot.step()` 693 times across a shift, and
  deep-freezes state at three checkpoints — ES modules are strict mode, so a write throws).
  Then `tools\_mutate.ps1`: fourteen reversions of real fixes, applied one at a time, each
  followed by the suites that ought to care. **10 of 14 killed on the first pass. Three of
  the four survivors were the same defect — the assertion computed its expectation from the
  value under test** — and the fourth was a prober written for a known bug that only
  `_soak.js` called, and soak does not gate. All four closed; 15/15 now. **1383 assertions,
  ten suites.**

- 2026-08-24 — **M11: IS CORNERING A DECISION? Yes — for the veteran, and for nobody else.**
  GDD §36, authored from the README's one *genuinely still open* design question. Answering
  it needed a bot that could ease off, because `steer` is −1/0/+1 and the throttle is held
  or not; `_bot.js` gains an ANTICIPATORY ease-off (about to steer, above the shed speed,
  load on the train) as a policy axis rather than a fourth skill.
  ⚠ **The first answer was wrong because the ease-off used the OVERLOAD threshold (2.6 m/s)
  where it needed the SHED threshold (4.5).** Corrected, over nine shifts played twice each
  on the same seeds: spills **50 → 34 (−32%)** for **0.5–2.3%** of the shift off the
  throttle, delivery neutral at average, noise at novice, and **+1/+4/+1 bags and
  +750/+1500/+250 points at veteran — every seed.** That retires the M6 mystery of why the
  veteran scored worse than the average crew: it hauls at six bags, makes more trips,
  corners three times as often and sheds most, and its policy never accounted for the load.
  **The shipped bot still drives flat out on purpose** — making care the default takes the
  novice median from −1850 to −250 and 47% to 59%, which re-opens the bag count that m6
  D5/D6 gate. That is the next milestone, not a footnote to this one. **1383 assertions.**

## Phase 1 is done. What is actually left

GDD §29's Functional, UX and Quality criteria all pass (`tools/m6-tests.js`). FIVE
CRITERIA ARE OPEN and cannot be closed by any program — they need external players: a
first-timer completing the loop unaided, three playtesters understanding the airport will
not wait, two reporting a memorable mistake, repeated play improving routing, and pressure
coming from overlapping simple work rather than confusing controls. Do not call Phase 1
complete on a green suite alone; the suite says so itself, in section Z.

The balance telemetry says where to look next, and it is not the schedule: **90% of
missed bags are still sitting in a cart** and the belt queue never exceeds six. The crew
keeps up with sorting; the constraint is trips to the gate. That is why the "veteran" bot
profile scores WORSE than "average" — it hauls at six bags instead of eight and spends
the difference driving.

✅ **FIXED 2026-08-23 — the paragraph above is the state of the world BEFORE the bot could
drive, and it is kept because the reasoning it contains was wrong in an instructive way.**
`_driveTo` now steers the nose toward the target when reversing to turn round, and aims
the tow point only when backing ONTO a drawbar. The open run went from 4.16 m/s to
**6.76 m/s**, throttle held 97% of the time, 94% of it at top speed. The train is also
permanent now — up to three carts, never shed. A competent crew delivers **85%** of a
**51-bag** shift for +3350, a careless one **48%** for −1583. See the 2026-08-23 status
entry. What follows is why none of that was visible for two milestones.

⚠ **DO NOT ACT ON THE PARAGRAPH ABOVE BY SHORTENING THE HAUL. `tools\_route.js` measured
it and the map was not the problem — the instrument was.** The tractor reaches **7.00 m/s** in 1.5 s
with the throttle simply held down, towing or not. Across fifty-two metres of completely
empty ramp `CrewBot` averages **4.16 m/s**, holding the throttle 31% of the time and
reverse or brake 69%, with a mean SIGNED speed of **0.03 m/s** — it travels backwards
almost as far as it travels forwards, at the 3 m/s reverse cap, while believing it is
driving to the gate. `_driveTo`'s reverse branch steers to aim the tractor's REAR at the
waypoint, so a target directly behind produces zero steering and a dead-straight reverse
for however far away it is.

So **every per-trip cost in the balance report is roughly double the real one**, and the
"shorten the haul" conclusion was drawn from it. Moving the gates closer would be
optimising a number the game does not have. **Fix the bot first, then re-measure, then
decide.** The four-line driving fix works (open run 6.96 m/s, throttle 100%, reverse 0%)
and on its own takes delivery from 79% to **54%**, because the hitch, drop and unload
phases were all tuned around the broken driving and encode its speeds — five rounds of
follow-on fixes each moved the failure somewhere else. It is all written up at the top of
`tools\_route.js`, including which fixes were tried and exactly how each one failed.
Budget for re-tuning three phases, not for a four-line patch.

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
  speed × yaw rate scaled by fill, and a full-lock circle at top speed still empties a
  cart. Measured (`tools\_spill.js`, 3 shifts): 169 overload episodes a shift, median
  duration 100 ms, median cost **0.040** of one cart's stability, 5.7 bags actually shed.
  The model is doing the right thing — brief overloads are nothing, sustained ones cost a
  bag. Whether 5.7 a shift is the right PRICE is still open.
- ⚠⚠ **THERE ARE TWO CORNERING SPEEDS AND THEY ARE NOT THE SAME NUMBER.** Above about
  **2.6 m/s** a loaded full-lock turn clears the lateral threshold and stability starts
  DRAINING; a bag does not actually leave until **4.5 m/s**. Measured (m2 F5b, ten light
  bags round a full-lock circle): `1.2 → 0, 2.6 → 0, 3.5 → 0, 4.5 → 4, 5.5 → 7, 6.5 → 8,
  7.0 → 9`. The statistic keys on the first number and the LOAD keys on the second, and
  conflating them has already cost once — `_bot.js`'s careful-driving policy was first
  written to ease off at 2.6, so it spent time avoiding a cost that does not exist below
  4.5, and then measured being careful as nearly free and nearly pointless. Quote the right
  threshold for the question being asked.
- ⚠ **STEERING IS BINARY, so there is no such thing as a gentle correction.** `steer` is
  −1, 0 or +1, so every nudge is full lock, and full lock above about 2.6 m/s with a
  loaded cart clears the lateral threshold. Any statistic that keys on "is it over the
  limit right now" is therefore counting KEYSTROKES: GDD §11.3's "corners taken above safe
  speed" read 168 a shift against 5.7 spills until it was changed to require an overload
  to have cost a quarter of the cart's grip (`CORNER_COUNTS_AT`), which gives 22.
  **A counter that ticks every few seconds is not an odd statistic, it is noise.**
- **`CORNER_COUNTS_AT` is deliberately NOT in `CONFIG`.** It tunes a reported statistic
  and nothing the simulation does — moving it changes what the end-of-shift card says and
  cannot change the outcome of a shift. Difficulty and physics live in config; a label
  does not.
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
- ⚠ **"COLOUR IS NEVER THE ONLY CHANNEL" IS NOW COMPUTED, NOT BELIEVED** — `src/ui/a11y.js`
  and `tools/m9-tests.js`. Measured, **6 of 17 signal pairs lose their hue** to at least
  one colour-vision deficiency, and the game is fine anyway *because* every one of them
  carries a word or a glyph: the ORD and MIA tags collapse to 8.8 dE under tritanopia
  (icon + destination code carry it), the scanner's right-vs-wrong verdict to 5.3 dE
  under deuteranopia (the words plus ✓/✕), and HOLD OPEN vs HOLD CLOSED likewise (the
  words themselves). That is the design working — but m9 section E proves each named
  channel is REAL by driving a live scanner card and reading the renderer's own source,
  so the allowance cannot become a loophole. **If you add a signal, add its group to
  `SIGNAL_GROUPS` and its redundancy to section E in the same commit.**
- **The a11y module IMPORTS the palette rather than copying it.** `FLIGHT_DEFS`, `PALETTE`
  and the live `:root` tokens, never a table of literals. The version this was adapted
  from (`SmallTownEmergencyServices\src\ui\a11y.js`) keeps literals plus a second test to
  prove they have not drifted; importing needs neither, and a signal table that names its
  own entries cannot notice a new one.
- **Audit a colour at the opacity it is actually rendered at.** `.b-row.st-departed` is
  `opacity:.55`, which took the rail to 1.87:1 — under WCAG 1.4.11's 3:1 for a non-text
  indicator. Auditing the token alone would have reported a contrast nobody gets.
- **Non-text gets 3:1 (1.4.11), text gets 4.5:1 (1.4.3), and the distinction matters.**
  The departed rail is a 3px border, not text; holding it to the text floor would report
  the wrong rule at the wrong severity. It failed the correct one too.
- **The floor surfaces are deliberately NOT a channel** — all six sit between 1.02:1 and
  1.59:1 of each other. No zone is ever identified by its colour; every one is labelled in
  words, and m9 E6/E7 assert both halves. That is why the road's lane lines are allowed to
  sit at 2.36:1 and be declared decorative rather than brightened.
- **Announcement copy must say what happened in words.** GDD §5.3/§16.3 forbid colour
  being the only differentiator, and the same now goes for sound: every audio cue has a
  visual equivalent, so mute is a preference and not a handicap. Never write a toast whose
  meaning is in its tone, and never add a cue that is only audible.
- **Audio is the ONE subsystem allowed to touch real time**, because a WebAudio schedule
  is measured in `AudioContext` seconds. It pays for that with four rules: inert until a
  user gesture arms it; READS simulation state and never writes to it; the decision is
  separate from the plumbing; every cue is also visible. The test that matters (m5 E) runs
  the same seeded shift twice — once with a live `Sfx` attached, once with none — and
  demands the `describe()` snapshots match to the byte. If that ever goes red, every other
  suite in the project becomes advisory.
- **`mixFor(state)` is PURE and `CUES` is DATA, and both must stay that way.** That seam
  is the only reason the interesting half of audio is testable on a box with no sound
  card — m5 section H asserts the engine bed rises with speed, a paused airport is silent,
  final call out-shouts loading, and every cue row names a real event. Put a decision
  inside an oscillator callback and section H can no longer see it. Structure copied from
  `SmallTownEmergencyServices\src\audio\audio.js`; keep the names.
- **A cue row for an event that does not exist is inert, and an unknown variant falls back
  to `_`.** A new sound is a new row, never a new branch, and a missing row is silence
  rather than a throw — these handlers run inside `bus.emit`, so a throw would take the
  simulation step down with it. m5 H3 fires every row with a bare `{}` to prove it.
- **Every audio subscription is gated on `armed` at the subscription site**, not inside
  `tone()`/`noise()`. Audio is unarmed for the whole title screen, and a shift emits
  thousands of events; the table lookup and panning arithmetic must not run for cues
  nobody can hear.
- **Cue rate-limiting (`minGapMs`) runs on REAL audio time, never simulation time.** It
  exists so nine bags landing together are one thump, and it must stay somewhere the
  simulation can never observe — otherwise it becomes a game rule with a stopwatch.
- **The onboarding rail has NO TRAINING PAUSES and must never gain any.** A tutorial that
  stopped the clock would teach a lie about the only thing the game is about (pillar 1,
  §31.1.7). It is advisory text over a completely live shift.
- **Every rail step asserts the STATE it wanted, never the route you took.** The
  predicates read live game state, so a player who does things out of order collapses the
  chain forward instead of deadlocking on a step they already satisfied. Something's
  Different (M11) shipped a rail that tracked actions instead and deadlocked on any
  unexpected play order. Satisfying a step also resets the stall timer — that is
  deliberate, and it is why a screenshot pose has to run a frame BEFORE back-dating
  `enteredAtMs`.
- **The difficulty assist is a multiplier applied once, where the times are authored.**
  `createFlights(state, assist)` scales every window in `scaleTimes`, so the board, the
  countdowns and the derived shift end all follow with no system remembering to. Do not
  scale a schedule value at any other read site, and never write difficulty into
  `CONFIG` — it is deep-frozen for exactly this reason (GDD §31.1).
- **Text scaling is one CSS variable, `--ts`, multiplying every `font-size` in
  `styles.css`.** A new rule with a raw `font-size:14px` silently opts out of the setting;
  write `font-size:calc(14px * var(--ts))`.
- **Reduced motion is TWO switches, not one.** `renderer.fx.enabled` kills the particle
  system and `renderer.reducedMotion` holds the tractor beacon and the aircraft strobe
  steady. A dimmed strobe is still a strobe, so neither may be implemented as a fade.
- ⚠ **A "paused" check must key on `clock.paused`, never on `steps === 0`.** A RUNNING
  frame banks zero steps whenever the accumulator has not reached one — every other
  frame on a 120 Hz display. Draining the input edge buffer there discarded half of every
  E, F, Q and X press, and ONLY the edge verbs, because movement reads `isDown`. Every
  suite drives frames at exactly 1000/60, so nothing could have caught it.
- **`X` is the recover action (GDD §24.3), and it is a LOCAL unstick.** It never moves
  you toward where you were going: the drive to the gate is the game, and an escape hatch
  that shortened it would be a movement ability. It does nothing when nothing is stuck.
- ⚠ **`recoverStuck` must RE-SEAT THE TRAIN before it returns**, because its pushes are
  teleports and it runs LATER in the step than `updateTrain`. Without that, the next
  step's constraint snap is differenced as motion and one press of `X` throws a bag off a
  train standing perfectly still — measured, stability 1 and 3 aboard became stability
  0.875 and 2 aboard with nobody touching the throttle. `updateTrain(state, v, 0)` is the
  fix and `dtSec = 0` is the point: the whole stability model is inside `if (dtSec > 0)`,
  so it places the carts and skips the differencing. This is the SECOND call site of the
  `pushOutOfWalls` rule below; when you add a third, re-seat there too.
- **The recover verb is unreachable in ordinary play, by design.** 5392 fuzzed presses
  across four full shifts un-stuck exactly zero things, because `moveWithWalls` never
  commits a move into geometry. That is correct behaviour and it means every path inside
  `recoverStuck` is only reachable from a MANUFACTURED state — which is why the bug above
  survived. `tools/_invariants.js` `recoverFuzz()` wedges things on purpose for that
  reason; a verb the fuzzer cannot reach is a verb the fuzzer is not testing.
- ⚠⚠ **A DEGENERATE NORMAL MUST STILL BE A UNIT VECTOR.** `separate()`'s coincident guard
  set `dx = 1, dy = 0, d = 1e-6` and then normalised with `dx / d` — a "unit" normal a
  million units long, which took the separation impulse with it. Two bags landing on
  exactly the same float position threw one of them **181 kilometres** along x, in a
  120 m world, in one step, with its velocity still reading zero. It shipped from M1 and
  only surfaced when the shift grew to 51 bags and the belt piled deep enough to stack two
  bags precisely. The assertion that was supposed to cover it — "coincident circles
  separate deterministically" — checked only that they were no longer in the same place,
  which being 181 km apart satisfies perfectly. m1 E9b now checks the distance.
- ⚠ **SEPARATION IS A TELEPORT TOO, so a separated bag has to be pushed out of walls.**
  `separate` writes positions directly rather than going through `moveWithWalls`, so a
  pile against the sort-room's west wall shoves the outermost bags through it — and
  `moveWithWalls` then refuses to bring them back, because it never commits a move whose
  destination is blocked. A novice crew stood at (4.9, 13) reaching for a bag at (3.4, 13)
  behind a wall at x = 4, and re-tried every six seconds for the last minute of the shift.
  That is a GDD §29 blocker. This is the FOURTH call site of the rule below and the first
  one about bags; when you add a fifth, push there too.
- **Anything POSITIONED rather than moved must be pushed out of walls.** `moveWithWalls`
  only commits a move whose destination is clear and never updates position while
  blocked, so an entity that ends up inside geometry can never leave — which reads as
  the game having frozen. `exitVehicle` and `hitch` both learned this the hard way.
- **`pushOutOfWalls` is a TELEPORT, so nothing may difference position across it.** The
  cart stability model did, and read a wall scrape in the doorway as 45 m/s and 24 rad/s
  — a spilled bag from a stationary train. Measure against the constraint solution.
- **The assist scales the flights AND the bag timetable.** They are stretched by the same
  factor or the shift is reshaped rather than lengthened: §20.4's late bags landed before
  final call and SK307 fed the belt before its aircraft existed. Anything that reads
  `FLIGHT_DEFS` at runtime is reading the authored shift, not the one being played —
  read `state.flightsById`.
- **`CrewBot` (`tools/_bot.js`) MUST NEVER WRITE TO STATE.** Reading is fine — a player
  can see the ramp. The moment it assigns a position or moves a bag it stops being a
  measurement and becomes a second, worse implementation of the game. Every number in
  the balance report rests on that line holding.
- **A bot that presses a verb every frame acts SIXTY TIMES A SECOND.** `wasPressed` is
  an edge per simulation step, so an unthrottled bot put a ten-bag cart into a hold in
  under a fifth of a second and the unload leg vanished from the telemetry. That is the
  instrument lying, not a finding. `VERB_GAP_MS` is 145 ms — brisk for a person — and it
  applies to E, F and Q alike.
- **The shift end is DERIVED** (`Game._authorShift`: last departure + pushback + wrap).
  `CONFIG.shift.durationMs` is a FALLBACK, not the length. Six suites silently truncated
  at ten minutes when M6 stretched the schedule to 11:32; a test that means "the whole
  shift" must read `state.shift.endTimeMs`.
- **A cart parked IN the hold volume is the fast way to work**, and that is deliberate.
  Taking a bag prefers a loaded cart in reach over the hold manifest, so a well-parked
  train needs no walking between the two. Reversing that priority puts 8.9 s per bag
  back and makes the shift unfinishable — it is the single change that turned a losing
  game into a winnable one.
- **`hitchCandidate` measures from the TAIL of the train, not from the tractor.** A
  tractor already towing something can never bring a second cart into range without
  ramming the first: drop what you have first. It is also why hitching needs no
  reversing at all — drive PAST the cart and it is behind you, in range.
- **`state.settings` and `game.settings` are different objects.** `state.settings` is the
  debug-overlay's `{ showGrid }`; `game.settings` is the player's saved preferences. The
  collision is pre-existing and harmless, but read the receiver before assuming.

## Gotchas already paid for

- ⚠⚠ **`performance.now()` FREEZES INTERMITTENTLY under `--virtual-time-budget`, and a
  frozen clock reads as INFINITELY FAST.** Timing 240 `render()` calls reported
  0.000 ms/frame. A control loop of three million `Math.sqrt` calls placed beside it
  reported 0.00 ms too, which is how you tell a frozen clock from a fast renderer —
  **always put a known-cost control next to a suspicious zero.** Removing every runtime
  `fetch` and dynamic `import()` from the suite brought it back (a fetch does poison it:
  m3's F13 measured a 41,000-step shift as `0.000 ms/step in 0 ms` until its source grep
  stopped fetching and used `Function.prototype.toString()` instead) — and then the very
  next run of the unchanged file read zero again, control included. So the fetch is *a*
  cause, not *the* cause. Do not gate on a short timed loop here: the failure mode points
  the wrong way and passes any threshold anybody will ever write. **Count the WORK
  instead** — m8 section H censuses canvas operations and returns byte-identical numbers
  across runs and across Chrome and Edge. Best available figure, unasserted: a frame is
  around 6 ms headless with no GPU, dominated by the ground pass.
- **A runtime `fetch` or `await import()` in a suite poisons the clock for the rest of the
  page.** Read source with `Function.prototype.toString()` and hoist every import to a
  static top-level one. m8 says so at its import block; do not "tidy" one back.
- **Canvas 2D records a display list and rasterises it lazily.** A loop of `render()`
  calls with no read-back never executes; `getImageData` is what forces the pipeline
  through. This is a second, independent reason the naive timing loop above read zero.
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
- ⚠ **CHECK `..\INDEX.md` BEFORE writing a system, not after.** M5's `audio.js` was
  written from scratch and only then compared against Small Town Emergency Services,
  which already had a better-shaped layer — `mixFor` as a pure function, `CUES` as a data
  table. It had to be rewritten to that shape, and the rewrite is what made section H
  possible at all. The catalog entry existed the whole time. This is exactly the waste
  rule 3 exists to stop, and knowing the rule was not enough — the lookup has to happen
  before the first line, not before the commit.
- ⚠ **A BOT THAT STANDS STILL IS USUALLY IN A PHASE FLIP-FLOP, not stuck on geometry.**
  Two states that each bounce to the other press no keys at all, so the crew simply
  stops. It happened three separate ways in `_bot.js` — carrying a bag into a phase that
  refuses to run while carrying, sorting while still sitting in the tractor, and
  re-deciding a multi-press action every frame off its own intermediate state. The tell
  is `speed 0` with a sensible-looking target; the fix is to finish what is in your hands
  before changing phase.
- **Instrument the stall; do not reason about it.** Four rounds of deduction on the
  73%-idle bot got nowhere. Adding `speed`, `rot`, the aim point and the cart's hitch
  state to the dead-end record found it in one run. `speed 0` says control problem,
  `speed 7` into a wall says geometry, and `hitched=true clear=1800` says the branch runs
  every frame and its precondition never clears.
- **Standing still is not the same as being stuck.** Loitering at an empty belt and
  pressing F repeatedly in one spot are both progress. Counting them as stalls buried
  seven real dead ends under 517 false ones.
- **Never assert a raw event COUNT either.** m5 E4 first demanded "more than 100 events
  in 60 s" and measured 13 — the same mistake as assuming when a seeded bag spawns, worn
  as a magnitude. Count the KINDS of event the test actually depends on, and assert those
  are non-zero.
- **A performance threshold that passes by five milliseconds is a flake.** m3 F13 first
  asserted a whole shift runs in under 3 s and measured 2995 ms. Assert the per-step cost
  against the frame budget, which is the number that means something, and print the total.
- **Never write a rejection-sampling loop that fills a `Set` to a target count** unless
  the pool is provably much larger than the count. `buildBagSchedule` picked 4 priority
  bags from a 6-wide window that way; one edit to the twist numbers would have made it
  spin forever. Shuffle a candidate pool and slice instead.
- ⚠⚠ **AN ASSERTION MUST NOT DERIVE ITS EXPECTATION FROM THE VALUE UNDER TEST.** This is
  the single most common defect in this project's suites and it is invisible on the page —
  it reads better than a correct assertion, because re-deriving the rule looks rigorous.
  Three of `_mutate.ps1`'s four survivors were this: m1 `I5` asserted the zoom equals
  `min(viewWidthM, cssW / MIN_PX_PER_M)` recomputed from the constant the camera had just
  used, so MIN_PX_PER_M could go 28 → 1 with both sides moving together; `I5b` asked whether
  the scale cleared MIN_PX_PER_M, which was now 1; m6 `A9` asserted the conveyor emits
  `sum(bagCount)` bags, which is true of any bag count including 11 a flight. **The fix is
  always an ABSOLUTE number tied to the thing the design actually cares about** — 15 px of
  bag tag, GDD §20.2's 40-60 bags — not a re-derivation of the constant that is supposed to
  deliver it. Keep the closed-form assertion too if it pins the SHAPE of the rule; just
  never let it be the only one.
- ⚠ **A PROBER IN A DIAGNOSTIC IS NOT COVERAGE.** `recoverFuzz` and `recoverSpillProbe`
  were written specifically for the "one press of X throws a bag off a stationary train"
  bug, and `tools\_soak.js` was their only caller. **Soak measures; it does not gate.**
  Reverting the fix left the entire project green. Anything written to catch a specific bug
  belongs in a suite `tools\test.ps1` runs — put it in the diagnostic as well if it prints
  something useful, but the gate is the point.
- **A MUTATION KILLED IN THE WRONG PLACE is a finding too.** `_mutate.ps1` tries suites in
  COST ORDER and stops at the first kill, so the report names the cheapest catcher. Two
  bugs were caught only by three-and-a-half-minute played shifts — the wall-shove by
  `D1.novice.12345` on one seed at one skill, and the x-axis wall branch only incidentally,
  because the recover test happens to manufacture a player inside a wall. Both would have
  gone quiet on a different seed, and neither could say what broke. Coverage that exists
  but is slow, fragile and mute is worth re-homing.
- **A test scenario can be too CLEAN to show the bug.** m2 `F6c` bounds hard corners against
  spills correctly and could not see `CORNER_COUNTS_AT` being zeroed, because its scenario
  is a full-lock circle — one long overload episode against a once-per-episode latch. The
  keystroke artefact only appears across hundreds of brief corrections, i.e. across a played
  shift. When an assertion about a statistic passes, ask whether its scenario produces the
  DISTRIBUTION the statistic is supposed to describe.
- ⚠ **A GREEN SUITE PROVES THE ASSERTIONS THAT RAN PASSED — not how many ran.** Most of
  the coverage here loops over a collection (24 event names, 17 cue rows, three flights,
  nine waypoints); a loop over an empty collection contributes ZERO assertions and stays
  green, and so does a section that returns early. `tools\test.ps1` holds a per-suite
  baseline count and `smoketest.ps1 -ExpectAssertions` fails the run when the number
  moves. Update the baseline in the same commit as a deliberate change — that is the
  moment somebody has to look at it.
- **The verdict grep must be ANCHORED.** `smoketest.ps1` used to exit 0 on `-match
  'ALL-PASS'` anywhere in the block, and every FAIL detail is a `JSON.stringify(payload)`
  or an element's `textContent` — so one assertion whose detail carried that substring
  would have turned a red run green. It now requires a line STARTING with `ALL-PASS` and
  no line starting with `FAIL`.
- ⚠ **TWO CONCURRENT RUNS IN THIS REPO used to serve each other's page.** The GUID stamp
  defeated other PROJECTS holding the port, but the scratch FILENAME was fixed, so a
  second run overwrote the first's `_smoketest.html`, the loser's server served the
  winner's suite, both reported ALL-PASS under the wrong heading, and whichever finished
  first deleted the file mid-run. The stamp is now part of the filename
  (`_smoketest-<guid>.html`, `_shot-<guid>.html`). Any new tool that writes a scratch
  file into the served root must do the same.
- ⚠ **OTHER PROJECTS ON THIS MACHINE RUN THIS SAME HARNESS.** SmallTownEmergencyServices
  and TowBros were copied from here, so they have the same scratch filenames and compete
  for the same ports. A readiness probe that only checks for a 200 WILL eventually attach
  to another game's server — it did, and put a screenshot of Small Town Emergency
  Services into `docs/` as if it were this game. `tools\_serve-mine.ps1` stamps the
  scratch file with a GUID and refuses any port whose response does not contain it. Any
  new tool that starts a server must go through it. A hijacked TEST run would have
  reported another game's results as ours.
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

- ✅ **RESOLVED — the shift is 17/17/17, 51 bags** (2026-08-23; it was 14/14/14 for a day,
  see below). Both GDD ranges are satisfied: §20.4 wants 14-18 per flight, §20.2 wants
  40-60 in total. Re-swept once the bot could drive, because the first sweep was measured
  on an instrument that reversed half of every haul:

  | per flight | total | novice | average | veteran | dead ends |
  |---|---|---|---|---|---|
  | 14 | 42 | 64% / +250 | 84% / +2517 | 66% / +533 | none |
  | 15 | 45 | 61% / −17 | 83% / +2800 | 63% / +250 | present |
  | 16 | 48 | 54% / −850 | 80% / +2617 | 62% / −50 | present |
  | **17** | **51** | **48% / −1583** | **85% / +3350** | 58% / −567 | **none** |
  | 18 | 54 | 53% / −1200 | 84% / +3517 | 57% / −800 | present |

  51 is the pick on three counts at once: the best average score, zero dead ends, and a
  careless crew back in DEBT. That last one is not a preference — at 42 bags a novice
  finished on +250 and m6 D6 went red, because "nobody clears it without trying" is a
  design claim the suite encodes and a game anybody can finish has no pressure. 54 scores
  a competent crew slightly higher and reintroduces dead ends, which is a §29 rule.
  ⚠ The whole table above is worth more than the number it produced: **it had to be
  re-measured because the instrument changed.** The first version of this sweep, on the
  old bot, picked 42 and rejected 48 for dead ends. Both conclusions were artefacts.

- **Superseded, kept for the reasoning — the 2026-08-21 pass that took it to 42.** It was 34 (11/11/12), which
  broke GDD §20.2's stated 40-60 and §20.4's 14-18 per flight; the M6 balance pass had cut
  it from 16/16/18 because 50 bags was sixteen minutes of work in an eight-minute shift.
  What made 50 impossible was the eight-minute shift, and M6 then stretched every window
  by 45% without putting the bags back. The telemetry said so plainly and nobody read it
  that way: the crew was **idle 284 s of a 692 s shift** and the belt never queued past
  six. Measured across three seeds and three skills, going to 42:

  | bags | novice | average | veteran | dead ends |
  |---|---|---|---|---|
  | 34 | 34% / −2383 | 79% / +1783 | 73% / +1233 | none |
  | **42** | **54% / −700** | **80% / +2183** | 63% / +533 | none |
  | 45 | 43% / −2083 | 83% / +2767 | 61% / +333 | none |
  | 48 | 47% / −1767 | 83% / +3033 | 60% / +283 | **present** |

  42 is the pick and 45 is not, even though 45 scores an average crew higher: it costs a
  first-timer 11 points of delivery and 1400 points, and GDD §29's open criteria are about
  a first-timer completing the loop. **48 is out on a rule, not a preference** — it
  reintroduces dead ends, and "no known blocker can make a bag unreachable" is §29.
  An average crew now delivers 33.6 bags where it delivered 26.9: a quarter more work
  done, for more points, with the same instrument.

- **§21.1 "runs by opening `index.html`" is impossible with ES modules** (CORS blocks
  module loads on `file://`). Modules won because §21.2's whole architecture rests on
  them. `play.bat` serves over http; the page prints a clear message on `file://`.
- **§28.1 asks for "save parsing/version migration"; only the parsing half exists.**
  `src/systems/save.js` rejects any record whose `schemaVersion` differs, so a save from
  an OLDER build is discarded exactly like a corrupt one and the player's best shift is
  silently lost at the first schema bump. Left as-is deliberately: the schema has never
  changed, so a migration path would be speculative infrastructure with nothing to
  migrate, and writing one now means guessing at a shape that does not exist yet. The
  BEHAVIOUR is pinned (m4 E9a/E9b) rather than left to drift, so whoever bumps the
  version will fail a test that tells them what they are about to throw away.
- **§21.2's `tests/*.test.js` implies a Node runner. There is no Node.js on this box.**
  §31.4 lets Claude choose the runner "provided launch remains simple and offline", so
  the runner is the headless-Chrome PowerShell harness copied from Something's
  Different. Suites live in `tools\`, not `tests\`.
- **The suggested file tree was built lazily**, per §31.1.3 — each file arrived with the
  milestone that filled it. Only `core/stateMachine.js` is still missing and it never
  will arrive: the flight lifecycle is a pure function of the clock and needs no machinery.
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
- **`audio.js` `play()` still mixes the decision with the plumbing.** `if (!this.armed)
  return recipe;` sits above `this._pos(e.x, e.y)` and the whole part loop, so every line
  that reads a field off the event is on the wrong side of the seam the rest of the file
  respects. Extracting a pure `recipeFor(cue, e)` / `partsFor(cue, e, pos)` would put the
  field-reading half beside `mixFor` and `CUES`, and m5 H3 could drop its stand-in
  AudioContext. NOT DONE, deliberately: the coverage gap that justified it is already
  closed — H3 now arms the probe through the real `arm()` against a stand-in and fires
  every cue through `bus.emit`, so the field-reading path genuinely runs. What is left is
  tidiness, and it is not worth churning a green audio subsystem for. Do it when
  something else needs to change in there.

## The look: oblique 2.5D (2026-08-19)

Straight-down read as a floorplan — the user said so. GDD §19.1 permits "top-down **or**
2.5D", so this is inside the brief; only moving away from top-down Canvas 2D needs the
§31.5 sign-off, and the camera has not moved.

- **Two passes, and they must not be mixed.** `camera.applyGround()` for anything lying
  flat (floor, markings, footprints, shadows) — foreshortened by `CONFIG.render.groundSquash`.
  `camera.beginUpright(ctx, x, y)` for anything standing — unsquashed, origin at the
  base, height going to −y. **Never draw text or a circle on the ground transform**; it
  will be squashed with it.
- **Depth-sort by base y.** `_collect()` fills a reused array and it is sorted every
  frame. A new entity type that stands up must be added there or it will draw at the
  wrong depth.
- ⚠ **A bag that RIDES something sorts with its CARRIER, never by its own footprint.**
  Its own y is where it sits on the deck, which is metres in front of the carrier's sort
  key — so the belt (13.7) was drawn after every bag on it (~13.2) and painted over the
  lot. The conveyor rendered as a featureless empty bar for six milestones, in a game
  about bags arriving on a conveyor, and it was visible in the README's own hero image
  the whole time. The same applies to the lift: a riding bag stands on its carrier's
  deck (`H.belt`, `H.cart`), not on the tarmac.
- ⚠ **The two aircraft passes must AGREE about rotation.** The ground pass rotated by
  `ac.rot` and the upright pass did not; `rot` is π at a stand, so the shadow, gear and
  wings were drawn back-to-front against the fuselage and the fin sat over the nose gear.
  Neither pass rotates now. m8 C3 asserts the pair agree rather than asserting either one
  alone, because one of each is the bug.
- **The camera has a readability FLOOR as well as a budget.** `viewWidthM` caps how much
  world is shown; `MIN_PX_PER_M` (28) caps how small the writing gets, and it wins below
  a ~1290 px window — which is exactly where a 1280-wide laptop lands. A narrow window
  shows less airport rather than shrinking a bag's tag below legibility. Assertions about
  zoom must use the closed form `min(viewWidthM, cssW / MIN_PX_PER_M)`; the old
  unconditional equality went red on the harness's own 1262 px canvas.
- **Canvas text scales by hand, because a canvas has no cascade.** `--ts` carries GDD
  §16.6's setting through `styles.css`; the canvas half multiplies by
  `renderer.textScale` at each `ctx.font`. Only the four fonts that carry INFORMATION
  scale — the bag tag, the cart placard, the hold state and the aircraft number. Painted
  tarmac and the debug overlay deliberately do not: they are world art and developer
  furniture, not interface. m8 D4/D5 assert both halves of that.
- **"Did it paint" is not "did it paint the right thing in the right place".** Every
  milestone suite sampled ONE pixel at the canvas centre and checked it was not black —
  a gate the ground fill alone clears, which is how three visible bugs shipped. m8 uses a
  DIFFERENTIAL instead: render, remove exactly one class of thing, render again, count
  the pixels that changed. Removing the bags from the belt changed 0 px before the fix
  and 1127 px after. Remove things by deleting them from `state.bagsById` and putting
  them back — never by reassigning `bag.location`, which containment owns.
- **Extrude by slices, translating BEFORE rotating.** Sweeping a rotated footprint up the
  screen is not a shape canvas will give you. Translate-then-rotate keeps the extrusion
  screen-vertical; rotate-then-translate tilts it with the object and looks broken.
- **`viewWidthM` is 46, not 62.** Foreshortening fits MORE world into the same pixels
  vertically, so keeping the old width made everything read smaller — the opposite of
  the point. Changing the squash means re-checking this number.
- **The drawn fuselage is 1.9 m, not the real 3.2 m.** At true height it was a
  featureless wall that buried its own wings and most of the stand. Heights in `H` are
  presentation only; none of them is collision.

## Animation: derived, never stored (2026-08-19)

**Every moving part reads a value the simulation already owns.** The walk cycle reads
`player.walkedM`, wheels read `odometerM` and `cart.rolledM`, beacons and strobes read
`simTimeMs`, the cargo door reads `aircraft.door01`.

That is not a stylistic choice — it buys three things that would each cost real work
otherwise: the renderer stays stateless, two runs of one seed animate identically (so a
screenshot is reproducible and `describe()` stays a complete determinism contract), and a
paused game freezes mid-stride instead of jogging on behind the pause card.

**Do not add a renderer-side animation clock.** If something needs to move, find the sim
value it should move with — and if there is not one, add it to the entity (`rolledM` and
`door01` were both added this way, and both are two lines).

The one exception is `render/fx.js`, which owns particle lifetimes and is driven by the
REAL frame delta — and is handed `dt = 0` whenever the mode is not `playing`, so it
freezes with everything else. It reacts to bus EVENTS rather than diffing frames, uses a
seeded stream (m0 G1 forbids `Math.random` anywhere in `src/`), and is capped.

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
tools\test.ps1              # all suites, exit 0 = green; enforces the assertion baseline
tools\test.ps1 -Only m8     # one suite
tools\shot.ps1 -Setup tools\_shot-vis-gate.js     -Out docs\vis-gate.png
tools\shot.ps1 -Setup tools\_shot-vis-sortroom.js -Out docs\vis-sortroom.png

# diagnostics (not suites — they measure, they don't gate):
tools\smoketest.ps1 -Tests tools\_raf.js      # is rAF usable under the harness
tools\smoketest.ps1 -Tests tools\_balance.js  # GDD §28.4 telemetry, from a bot that plays
tools\smoketest.ps1 -Tests tools\_route.js    # where the haul goes, and whether the bot can drive
tools\smoketest.ps1 -Tests tools\_spill.js    # what the cart stability model is actually doing
tools\smoketest.ps1 -Tests tools\_corner.js   # GDD 36: does easing off for a corner pay?
tools\smoketest.ps1 -Tests tools\_escape.js   # catch anything that leaves the world, at the step
tools\smoketest.ps1 -Tests tools\_soak.js     # fuzz every invariant after every step
tools\_mutate.ps1                             # break the code on purpose; do the suites notice
tools\_mutate.ps1 -List                       # the mutation table, touching nothing
tools\_mutate.ps1 -Only camera                # one mutation, by substring of its name
tools\shot.ps1 -Setup tools\_shot-m6.js -Out docs\m6-report.png
tools\shot.ps1 -Setup tools\_shot-m5.js -Out docs\m5-first-minute.png
tools\shot.ps1 -Setup tools\_shot-m5-settings.js -Out docs\m5-settings.png
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
`input`, `sfx` and `CONFIG`.

## Testing (binding — GDD §28)

No Node.js on this box. Serve over http, smoke-run in a real browser tab before
delivering anything. Batch edits atomically. Verify numbers, not vibes — assert measured
values and report failures plainly.

Every milestone that changes schedule, scoring or containment rules **must** add or
update assertions (GDD §31.1.11). Keep clock, geometry, scoring and containment maths
pure — plain objects, no canvas context — so it stays testable without a paint.
