/* Milestone 6 suite — balance and hardening.
 *
 * Exit criterion: ALL PHASE 1 ACCEPTANCE CRITERIA PASS. So this suite is GDD §29, made
 * executable, one assertion per bullet, in the document's own order and wording. Where a
 * criterion is already proven by an earlier suite the check here is deliberately shallow
 * — the point is COVERAGE OF §29, not a second implementation of m0-m5.
 *
 * Three of §29's bullets cannot be asserted by any program and are reported honestly
 * rather than faked green:
 *
 *   - "a first-time player can complete the basic loop without reading a manual"
 *   - "at least three external playtesters understand that the airport will not wait"
 *   - "at least two report a memorable unscripted mistake or recovery"
 *
 * Those need people. Section Z prints them as OPEN, and the README says the same. The
 * closest a suite can get is section D, which plays whole shifts with `CrewBot` through
 * the real input path and measures what a competent crew actually manages.
 */

import { CONFIG } from '../src/config.js';
import { Game, MODES } from '../src/game.js';
import { Input } from '../src/core/input.js';
import { Rng } from '../src/core/rng.js';
import { createBag } from '../src/entities/bag.js';
import { memoryStorage } from '../src/systems/save.js';
import { moveBag, assertContainment, countByLocation } from '../src/systems/containment.js';
import { validateChain } from '../src/systems/hitching.js';
import { aircraftHoldZone, holdContains } from '../src/entities/aircraft.js';
import { FLIGHT_DEFS, gateConflicts, standWindow } from '../src/data/flights.js';
import { WALLS, BOUNDS, ANCHORS, STANDS, rectContains } from '../src/data/airport.js';
import { stateAt, isHoldOpen } from '../src/systems/flightSchedule.js';
import { playShift, SKILLS, CrewBot } from './_bot.js';
import { fuzzShift, guidedFuzz, restartTorture } from './_invariants.js';

/* ── harness ─────────────────────────────────────────────────────────────── */
const lines = [];
let passes = 0, fails = 0;
function ok(name, cond, detail = '') {
  if (cond) { passes++; lines.push(`PASS  ${name}`); }
  else { fails++; lines.push(`FAIL  ${name}${detail ? '  <- ' + detail : ''}`); }
}
const eq   = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const note = (s) => lines.push(`      ${s}`);
const open = (s) => lines.push(`OPEN  ${s}`);

let _pre = null;
function emit(status) {
  if (!_pre) {
    _pre = document.createElement('pre');
    _pre.id = 'test-out';
    _pre.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:#06080c;' +
      'color:#cfe;font:11px ui-monospace,Consolas,monospace;padding:12px;white-space:pre';
    document.body.appendChild(_pre);
  }
  const tail = status || (fails === 0 ? `ALL-PASS  ${passes} assertions` : `FAILURES  ${fails} of ${passes + fails}`);
  _pre.textContent = '==ABCTEST-BEGIN==\n' + lines.join('\n') + '\n\n' + tail + '\n==ABCTEST-END==';
}

const FRAME_MS = 1000 / 60;
const yieldToLoop = () => new Promise((res) => {
  let done = false;
  const finish = () => { if (!done) { done = true; res(); } };
  requestAnimationFrame(finish);
  setTimeout(finish, 500);
});

function newGame(seed = 606) {
  return new Game({ seed, seedLabel: 'test', storage: memoryStorage() });
}
/** Run a whole shift, however long the schedule says it is. */
const wholeShift = (g) => g.skipMs(g.state.shift.endTimeMs + 2000);
let _serial = 0;
function makeBag(g, flightId, opts = {}) {
  const spec = { flightId, priority: !!opts.priority, weightClass: opts.weightClass || 'normal' };
  const bag = createBag(spec, ++_serial, 700000, new Rng(61 + _serial, 't'));
  g.state.bagsById[bag.id] = bag;
  bag.x = opts.x !== undefined ? opts.x : 0;
  bag.y = opts.y !== undefined ? opts.y : 0;
  moveBag(g.state, bag, { type: 'floor' }, g.bus, g.state.simTimeMs);
  return bag;
}

/* ── A. §29 FUNCTIONAL ───────────────────────────────────────────────────── */
function sectionA() {
lines.push('--- A. GDD §29 Functional ---');

  // "The game loads into a playable shift with no external services."
  const g = newGame();
  g.startShift();
  eq('A1 the game loads into a playable shift', g.state.mode, MODES.PLAYING);
  ok('A2 with a schedule, an aircraft each, and a crew',
    Object.keys(g.state.flightsById).length === 3 &&
    Object.keys(g.state.aircraftById).length === 3 && !!g.state.player);

  // "The player can move, grab, carry, release/throw, and scan bags."
  const input = new Input(window);
  const bag = makeBag(g, 'flight_AB221', { x: g.state.player.x + 0.8, y: g.state.player.y });
  const x0 = g.state.player.x;
  input._debugPress('KeyD');
  for (let i = 0; i < 30; i++) g.frame(FRAME_MS, input);
  input._debugRelease('KeyD');
  ok('A3 the player can move', g.state.player.x > x0 + 0.5, `${x0} -> ${g.state.player.x}`);

  bag.x = g.state.player.x + 0.7; bag.y = g.state.player.y;
  g.frame(FRAME_MS, input);
  input._debugPress('KeyE'); g.frame(FRAME_MS, input); input._debugRelease('KeyE');
  eq('A4 and grab a bag', g.state.player.carryingBagId, bag.id);
  const bx = bag.x;
  input._debugPress('KeyA');
  for (let i = 0; i < 30; i++) g.frame(FRAME_MS, input);
  input._debugRelease('KeyA');
  ok('A5 and carry it', bag.x < bx - 0.4 && bag.location.type === 'carried');
  input._debugPress('KeyQ'); g.frame(FRAME_MS, input); input._debugRelease('KeyQ');
  ok('A6 and scan it', !!g.state.scan && g.state.scan.bagId === bag.id);
  input._debugPress('Space');
  for (let i = 0; i < 40; i++) g.frame(FRAME_MS, input);
  input._debugRelease('Space');
  g.frame(FRAME_MS, input);
  eq('A7 and throw it', g.state.player.carryingBagId, null);
  ok('A8 and it travels', Math.hypot(bag.vx, bag.vy) > 0 || bag.location.type === 'floor');

  // "The conveyor emits the authored bags over time."
  const c = newGame(99); c.startShift();
  wholeShift(c);
  const authored = FLIGHT_DEFS.reduce((t, f) => t + f.bagCount, 0);
  eq('A9 the conveyor emits every authored bag', Object.keys(c.state.bagsById).length, authored);
  note(`      the authored shift is ${authored} bags across ${FLIGHT_DEFS.length} flights`);

  // "Each bag has a unique identity and correct flight assignment."
  const bags = Object.values(c.state.bagsById);
  eq('A10 every bag id is unique', new Set(bags.map((b) => b.id)).size, bags.length);
  eq('A11 every tag is unique', new Set(bags.map((b) => b.tag)).size, bags.length);
  ok('A12 every bag belongs to a real flight',
    bags.every((b) => !!c.state.flightsById[b.flightId]));
  ok('A13 and its tag agrees with its flight',
    bags.every((b) => b.destinationCode === c.state.flightsById[b.flightId].destinationCode));

  // "At least three flights progress and depart on schedule without waiting."
  eq('A14 three flights departed with nobody touching anything',
    Object.values(c.state.flightsById).filter((f) => f.state === 'DEPARTED').length, 3);

  // "At least two flights create overlapping demands."
  let overlaps = 0;
  for (let i = 0; i < FLIGHT_DEFS.length; i++) {
    for (let j = i + 1; j < FLIGHT_DEFS.length; j++) {
      const a = FLIGHT_DEFS[i].times, b = FLIGHT_DEFS[j].times;
      if (a.bagAcceptanceMs < b.holdClosingMs && b.bagAcceptanceMs < a.holdClosingMs) overlaps++;
    }
  }
  ok('A15 at least two flights want the crew at once', overlaps >= 1, `${overlaps} overlapping pairs`);
  eq('A16 and no gate is ever double-booked', gateConflicts().length, 0);
  for (const f of FLIGHT_DEFS) {
    const w = standWindow(f);
    ok(`A17.${f.number} occupies its stand for a bounded window`, w.to > w.from);
  }
}

/* ── B. §29 FUNCTIONAL, continued: carts, tractor, holds ─────────────────── */
function sectionB() {
lines.push('--- B. GDD §29 Functional: transport and loading ---');

  const g = newGame(); g.startShift();
  const cart = g.state.cartsById.cart_1;
  const v = g.state.vehiclesById.tractor_1;

  // "Bags can be placed into and removed from carts."
  const b1 = makeBag(g, 'flight_AB221');
  moveBag(g.state, b1, { type: 'cart', id: cart.id }, g.bus, 0);
  eq('B1 a bag can be placed into a cart', cart.bagIds.length, 1);
  moveBag(g.state, b1, { type: 'floor' }, g.bus, 0);
  eq('B2 and taken back out', cart.bagIds.length, 0);

  // "A tractor can hitch carts, drive between sort room and gates, and detach them."
  const input = new Input(window);
  // Out on the open apron, not on the bays: driving east from bay 1 arrives at the cart
  // parked on bay 2, and E then hitches THAT instead of dropping this one. Correct
  // behaviour, wrong place to test a detach.
  cart.x = 46; cart.y = 30; cart.rot = 0;
  v.x = cart.x + 2.0; v.y = cart.y; v.rot = 0;
  g.frame(FRAME_MS, input);
  g.state.player.x = v.x; g.state.player.y = v.y;
  g.frame(FRAME_MS, input);
  input._debugPress('KeyF'); g.frame(FRAME_MS, input); input._debugRelease('KeyF');
  eq('B3 the crew can climb into the tractor', g.state.player.drivingId, v.id);
  input._debugPress('KeyE'); g.frame(FRAME_MS, input); input._debugRelease('KeyE');
  eq('B4 and hitch a cart', cart.hitchedToId, v.id);
  eq('B5 the chain validates', validateChain(g.state).length, 0);

  const px = v.x;
  input._debugPress('KeyW');
  for (let i = 0; i < 180; i++) g.frame(FRAME_MS, input);
  input._debugRelease('KeyW');
  ok('B6 and drive it somewhere', Math.abs(v.x - px) > 5, `moved ${Math.abs(v.x - px).toFixed(1)} m`);
  ok('B7 with the cart still behind it', cart.hitchedToId === v.id);
  input._debugPress('KeyE'); g.frame(FRAME_MS, input); input._debugRelease('KeyE');
  eq('B8 and detach it again', cart.hitchedToId, null);
  input._debugPress('KeyF'); g.frame(FRAME_MS, input); input._debugRelease('KeyF');
  eq('B9 and get out', g.state.player.drivingId, null);

  // "Bags released in the correct open aircraft hold are loaded."
  const h = newGame(); h.startShift();
  h.skipMs(FLIGHT_DEFS[0].times.loadingMs + 5000);
  const flight = h.state.flightsById.flight_AB221;
  const ac = h.state.aircraftById[flight.aircraftId];
  ok('B10 the hold is open during loading', isHoldOpen(flight) && ac.holdOpen, flight.state);
  const z = aircraftHoldZone(ac);
  const right = makeBag(h, 'flight_AB221', { x: z.x, y: z.y });
  moveBag(h.state, right, { type: 'aircraftHold', id: ac.id }, h.bus, h.state.simTimeMs);
  ok('B11 a correct bag released in the hold is loaded', flight.loadedBagIds.includes(right.id));

  // "Bags can also be loaded into the wrong open aircraft; the game does not block it."
  const wrong = makeBag(h, 'flight_MC184', { x: z.x, y: z.y });
  moveBag(h.state, wrong, { type: 'aircraftHold', id: ac.id }, h.bus, h.state.simTimeMs);
  ok('B12 a WRONG bag is accepted too, because errors are gameplay',
    flight.loadedBagIds.includes(wrong.id));
  ok('B13 the hold is a volume, not a radius: the fuselage centre does not count',
    !holdContains(ac, ac.x, ac.y));

  // "Missed and wrong-flight bags are classified once, without double counting."
  wholeShift(h);
  const all = Object.values(h.state.bagsById);
  ok('B14 no bag finishes a shift unclassified',
    all.every((b) => b.lifecycle !== 'active'),
    all.filter((b) => b.lifecycle === 'active').length + ' still active');
  eq('B15 the misrouted bag is recorded as misrouted', wrong.lifecycle, 'misrouted');
  eq('B16 and the correct one as loaded', right.lifecycle, 'loaded');
  for (const f of Object.values(h.state.flightsById)) {
    const o = f.outcome;
    eq(`B17.${f.number} owed equals delivered plus missed`, o.correct + o.missed, f.expectedCount);
  }

  // "The shift ends with an accurate report and can be replayed."
  eq('B18 the shift ends on the report screen', h.state.mode, MODES.REPORT);
  ok('B19 with a report', !!h.state.report);
  const r = h.state.report;
  eq('B20 whose totals agree with the flights', r.correct,
    Object.values(h.state.flightsById).reduce((n, f) => n + f.outcome.correct, 0));
  h.startShift();
  eq('B21 and it can be replayed', h.state.mode, MODES.PLAYING);
  eq('B22 from a clean slate', h.state.score.points, 0);
}

/* ── C. §29 UX ───────────────────────────────────────────────────────────── */
function sectionC() {
lines.push('--- C. GDD §29 UX ---');

  // "Flight, gate, countdown, and bag destination are legible at desktop resolution."
  // Legibility is a rendering budget, and the budget is the camera zoom: every metre-space
  // font in the renderer is sized against it (see CLAUDE.md, "the camera zoom is a
  // READABILITY budget"). Assert the budget, which is the thing that can silently drift.
  ok('C1 the camera is at the readability zoom', CONFIG.render.viewWidthM <= 50,
    `${CONFIG.render.viewWidthM} m across`);
  ok('C2 a bag is a usable fraction of the view',
    0.72 / CONFIG.render.viewWidthM > 1 / 80, 'bag/view ratio');

  // "Color is not the only information channel."
  const codes = new Set(FLIGHT_DEFS.map((f) => f.destinationCode));
  const icons = new Set(FLIGHT_DEFS.map((f) => f.tag.icon));
  const colors = new Set(FLIGHT_DEFS.map((f) => f.tag.color));
  eq('C3 every flight has a distinct destination code', codes.size, FLIGHT_DEFS.length);
  eq('C4 and a distinct tag icon', icons.size, FLIGHT_DEFS.length);
  eq('C5 and a distinct colour, as the THIRD channel', colors.size, FLIGHT_DEFS.length);

  // "Pausing stops the entire simulation consistently."
  const g = newGame(); g.startShift();
  g.skipMs(60000);
  g.togglePause();
  // Snapshot AFTER pausing, and without `frames`. `describe()` carries the mode, which a
  // pause obviously changes, and the RENDER frame counter, which keeps climbing while
  // paused because the page is still painting the pause card — neither is the simulation.
  const sim = () => { const d = g.describe(); delete d.frames; return JSON.stringify(d); };
  const before = sim();
  for (let i = 0; i < 600; i++) g.frame(FRAME_MS, null);
  eq('C6 ten seconds of frames while paused change nothing in the simulation', sim(), before);
  // 1000/60 is not exact, so 3600 steps land a hair under a round minute. A pause test
  // asserts the clock did not MOVE, not that it sits on a whole number.
  ok('C6b including the clock', Math.abs(g.state.simTimeMs - 60000) < CONFIG.sim.stepMs,
    `${g.state.simTimeMs}`);
  g.togglePause();
  g.frame(FRAME_MS, null);
  ok('C7 and unpausing starts it again', sim() !== before);

  // "Restart resets every entity and timer cleanly."
  const a = newGame(4321); a.startShift(); a.skipMs(120000);
  a.startShift();
  eq('C8 restart zeroes the clock', a.state.simTimeMs, 0);
  eq('C9 and the score', a.state.score.points, 0);
  eq('C10 and every bag', Object.keys(a.state.bagsById).length, 0);
  ok('C11 and every cart', Object.values(a.state.cartsById).every((c) => !c.bagIds.length && !c.hitchedToId));
  eq('C12 and the shift-ended flag', a.state.shift.ended, false);
  const fresh = newGame(4321); fresh.startShift();
  a.skipMs(120000); fresh.skipMs(120000);
  eq('C13 and a restarted shift replays the fresh one exactly',
    JSON.stringify(a.describe()), JSON.stringify(fresh.describe()));
}

/* ── D. §29 QUALITY: can it be played, and does anything strand you? ─────── */
function sectionD() {
lines.push('--- D. GDD §29 Quality: a shift somebody played ---');

  // The closest a suite gets to §28.3's usability playtest: CrewBot drives the real
  // input path — walking, grabbing, placarding, hitching, driving, loading holds.
  const results = [];
  for (const skill of ['novice', 'average', 'veteran']) {
    const g = newGame(12345);
    results.push(playShift(g, new Input(window), skill));
  }
  const [novice, average, veteran] = results;
  for (const r of results) {
    note(`      ${r.skill.padEnd(8)} ${r.correct}/${r.owed} delivered (${r.pct}%), ` +
         `${r.points} points, ${r.bot.hauls} cart trips, ` +
         `${(r.bot.walkedM).toFixed(0)} m walked, ${(r.bot.drivenM).toFixed(0)} m driven`);
  }

  // "No known blocker can make a required bag permanently unreachable."
  for (const r of results) {
    eq(`D1.${r.skill} nothing stranded the crew`, r.bot.deadEnds.length, 0,
      JSON.stringify(r.bot.deadEnds.slice(0, 3)));
    // §29 forbids a bag being PERMANENTLY unreachable. One that has ridden on down the
    // belt by the time you get there is not that — the bot sets it aside and comes back,
    // and D9/D10 prove every bag is eventually accounted for. A real blocker would be one
    // the crew reaches for over and over and never gets.
    ok(`D2.${r.skill} out-of-reach arrivals stay incidental`,
      r.bot.unreachable <= Math.max(3, r.bot.bagsCarried * 0.15),
      `${r.bot.unreachable} misses against ${r.bot.bagsCarried} pickups`);
  }

  // The shift has to be WINNABLE — the M6 balance target. A competent crew clears most
  // of it and scores positive; an unskilled one does not. Both halves matter: a game
  // nobody can finish is broken, and one anybody can finish has no pressure.
  ok('D3 a competent crew delivers most of the shift', average.pct >= 60, `${average.pct}%`);
  ok('D4 and finishes in credit', average.points > 0, `${average.points}`);
  ok('D5 a careless one does not', novice.pct < average.pct,
    `novice ${novice.pct}% vs average ${average.pct}%`);
  ok('D6 nobody clears it without trying', novice.points < 0, `${novice.points}`);
  ok('D7 every flight gets a share of the crew',
    average.perFlight.every((f) => f.correct > 0),
    JSON.stringify(average.perFlight));
  void veteran;

  // "No known duplication or deletion of bag identity occurs during normal play."
  const g = newGame(2024);
  const bot = new CrewBot('average');
  const input = new Input(window);
  g.startShift();
  const seen = new Set();
  let maxBags = 0;
  const frames = Math.ceil((g.state.shift.endTimeMs + 2000) / FRAME_MS);
  for (let i = 0; i < frames && !g.state.shift.ended; i++) {
    bot.step(g, input, FRAME_MS);
    g.frame(FRAME_MS, input);
    if (i % 60 === 0) {
      for (const id of Object.keys(g.state.bagsById)) seen.add(id);
      maxBags = Math.max(maxBags, Object.keys(g.state.bagsById).length);
      // Every bag is in exactly one place, every step of a played shift.
      if (assertContainment(g.state).length) {
        ok('D8 containment held for a whole played shift', false,
          JSON.stringify(assertContainment(g.state).slice(0, 2)));
        return;
      }
    }
  }
  ok('D8 containment held for a whole played shift', true);
  eq('D9 no bag identity was deleted mid-shift', Object.keys(g.state.bagsById).length, seen.size);
  eq('D10 nor duplicated', seen.size, FLIGHT_DEFS.reduce((t, f) => t + f.bagCount, 0));
  eq('D11 the hitch chain survived being played with', validateChain(g.state).length, 0);
  const byLoc = countByLocation(g.state);
  eq('D12 and every bag is in exactly one place',
    Object.values(byLoc).reduce((a, b) => a + b, 0), seen.size);
  note(`      played shift, seed 2024: ${JSON.stringify(byLoc)}`);
}

/* ── E. §29 QUALITY: performance with 100 bags, and no stuck geometry ────── */
function sectionE() {
lines.push('--- E. GDD §29 Quality: 100 bags, and nothing wedged in the scenery ---');

  // "Performance remains playable with 100 spawned bags." GDD §30 M6: "Profile 100 bags."
  const g = newGame(31337);
  g.startShift();
  const rng = new Rng(4242, 'stress');
  for (let i = 0; i < 100; i++) {
    const f = FLIGHT_DEFS[i % FLIGHT_DEFS.length];
    makeBag(g, f.id, {
      x: 8 + rng.range(0, 24), y: 10 + rng.range(0, 26),
      weightClass: rng.chance(0.3) ? 'heavy' : 'normal',
    });
  }
  // Fill all three carts too, so the profile covers the real worst case rather than
  // a hundred loose bags on an otherwise empty floor.
  for (const cart of Object.values(g.state.cartsById)) {
    for (let i = 0; i < 8; i++) {
      const b = makeBag(g, FLIGHT_DEFS[0].id, { x: cart.x, y: cart.y });
      moveBag(g.state, b, { type: 'cart', id: cart.id }, g.bus, g.state.simTimeMs);
    }
  }
  const bagCount = Object.keys(g.state.bagsById).length;
  ok('E1 the stress load really is 100+ bags', bagCount >= 100, `${bagCount}`);

  const t0 = performance.now();
  const STEPS = 1800;                                   // 30 s of simulation
  for (let i = 0; i < STEPS; i++) g.frame(FRAME_MS, null);
  const ms = performance.now() - t0;
  const perStep = ms / STEPS;
  ok('E2 a step with 100+ bags fits the frame budget', perStep < CONFIG.sim.stepMs / 4,
    `${perStep.toFixed(3)} ms/step`);
  note(`      ${bagCount} bags, ${STEPS} steps: ${perStep.toFixed(3)} ms per step ` +
       `(budget ${CONFIG.sim.stepMs.toFixed(2)} ms) — ${(CONFIG.sim.stepMs / perStep).toFixed(0)}x headroom`);
  eq('E3 and containment survived the crowd', assertContainment(g.state).length, 0);

  // "Fix unreachable/stuck cases." Nothing may come to rest inside a wall.
  const inWall = (x, y) => WALLS.some((w) => rectContains(w, x, y));
  const stuck = Object.values(g.state.bagsById)
    .filter((b) => b.location.type === 'floor' && inWall(b.x, b.y));
  eq('E4 no bag came to rest inside a wall', stuck.length, 0,
    JSON.stringify(stuck.slice(0, 3).map((b) => ({ id: b.id, x: +b.x.toFixed(1), y: +b.y.toFixed(1) }))));
  const outside = Object.values(g.state.bagsById).filter((b) =>
    b.location.type === 'floor' &&
    (b.x < BOUNDS.x || b.x > BOUNDS.x + BOUNDS.w || b.y < BOUNDS.y || b.y > BOUNDS.y + BOUNDS.h));
  eq('E5 nor outside the airport', outside.length, 0);

  // Every place a bag must be able to reach has to be reachable on foot from spawn.
  // The sort-room wall is the only obstacle and the door is its only gap, so "reachable"
  // is: on the spawn side of the wall, or the far side with the door between them.
  const wp = [ANCHORS.conveyorEnd, ANCHORS.cartBay1, ANCHORS.cartBay2, ANCHORS.cartPark,
              ANCHORS.tractorPark, ANCHORS.gate1Hold, ANCHORS.gate2Hold];
  for (const p of wp) {
    ok(`E6 (${p.x},${p.y}) is not inside a wall`, !inWall(p.x, p.y));
  }
  for (const s of STANDS) {
    ok(`E7 ${s.id} hold door is clear of scenery`, !inWall(s.hold.x, s.hold.y));
  }

  // A ten-minute shift with no uncaught errors — §29 asks for exactly this.
  const clean = newGame(777);
  clean.startShift();
  let threw = null;
  try { wholeShift(clean); } catch (e) { threw = String((e && e.stack) || e); }
  ok('E8 a whole shift runs without an uncaught error', !threw, threw);
  ok('E9 and its length is inside GDD §3.3\'s 8-12 minutes',
    clean.state.shift.endTimeMs >= 8 * 60000 && clean.state.shift.endTimeMs <= 12 * 60000,
    `${(clean.state.shift.endTimeMs / 60000).toFixed(2)} min`);
}

/* ── F. §28.2 simulation tests, verbatim ─────────────────────────────────── */
function sectionF() {
lines.push('--- F. GDD §28.2 simulation tests ---');

  // "Pause just before departure; no scheduled state advances until unpaused."
  const g = newGame(); g.startShift();
  const f = g.state.flightsById.flight_AB221;
  g.skipMs(f.times.departureMs - 2000);
  const stateBefore = f.state;
  g.togglePause();
  for (let i = 0; i < 600; i++) g.frame(FRAME_MS, null);
  eq('F1 paused on the brink, the flight does not advance', f.state, stateBefore);
  g.togglePause();
  g.skipMs(4000);
  ok('F2 unpaused, it departs', f.state === 'PUSHBACK' || f.state === 'DEPARTED', f.state);

  // "Suspend/resume the browser tab; no enormous unbounded simulation catch-up."
  const s = newGame(); s.startShift();
  const t0 = s.state.simTimeMs;
  s.frame(60000, null);                                  // a one-minute tab suspend
  const jumped = s.state.simTimeMs - t0;
  ok('F3 a minute-long tab suspend is clamped, not caught up',
    jumped <= CONFIG.sim.maxFrameMs + CONFIG.sim.stepMs, `${jumped} ms`);
  ok('F4 and the clamp is counted for diagnosis', s.clock.clampedFrames > 0);

  // "Remove a bag from a hold before closure; it is not counted as loaded."
  const h = newGame(); h.startShift();
  h.skipMs(FLIGHT_DEFS[0].times.loadingMs + 3000);
  const fl = h.state.flightsById.flight_AB221;
  const ac = h.state.aircraftById[fl.aircraftId];
  const z = aircraftHoldZone(ac);
  const b = makeBag(h, 'flight_AB221', { x: z.x, y: z.y });
  moveBag(h.state, b, { type: 'aircraftHold', id: ac.id }, h.bus, h.state.simTimeMs);
  ok('F5 a bag put in the hold is aboard', fl.loadedBagIds.includes(b.id));
  moveBag(h.state, b, { type: 'floor' }, h.bus, h.state.simTimeMs);
  ok('F6 taking it back out before closure removes it from the manifest',
    !fl.loadedBagIds.includes(b.id));
  // Carry it CLEAR of the hold. Set down inside the volume it is absorbed straight back
  // aboard on the next step, which is the containment system working exactly as it
  // should — a bag lying in an open hold IS in the hold. §28.2 means removed from the
  // aircraft, not merely let go of while standing in the doorway.
  b.x = z.x - 14; b.y = z.y + 9; b.vx = 0; b.vy = 0;
  b.cartCooldownMs = h.state.simTimeMs + 5000;
  h.skipMs(200);
  ok('F6b and carried clear, it stays out', !fl.loadedBagIds.includes(b.id), b.location.type);
  wholeShift(h);
  eq('F7 and it is classified as missed, not loaded', b.lifecycle, 'missed');

  // "Place a bag across overlapping zones; it has exactly one location owner."
  const o = newGame(); o.startShift();
  o.skipMs(FLIGHT_DEFS[0].times.loadingMs + 3000);
  const oac = o.state.aircraftById[o.state.flightsById.flight_AB221.aircraftId];
  const oz = aircraftHoldZone(oac);
  const cart = o.state.cartsById.cart_1;
  // A cart parked ON the hold door: both containers claim the same square metre.
  cart.x = oz.x; cart.y = oz.y; cart.rot = 0;
  const ob = makeBag(o, 'flight_AB221', { x: oz.x, y: oz.y });
  moveBag(o.state, ob, { type: 'cart', id: cart.id }, o.bus, o.state.simTimeMs);
  eq('F8 a bag in overlapping zones has one location type', ob.location.type, 'cart');
  ok('F9 and exactly one container holds it',
    cart.bagIds.includes(ob.id) && !o.state.flightsById.flight_AB221.loadedBagIds.includes(ob.id));
  eq('F10 and the derived indexes agree', assertContainment(o.state).length, 0);
  moveBag(o.state, ob, { type: 'aircraftHold', id: oac.id }, o.bus, o.state.simTimeMs);
  ok('F11 moving it hands ownership over completely',
    !cart.bagIds.includes(ob.id) &&
    o.state.flightsById.flight_AB221.loadedBagIds.includes(ob.id));
  eq('F12 and containment still proves itself', assertContainment(o.state).length, 0);

  // "Load every bag on the wrong aircraft; departures proceed and penalties recorded."
  const w = newGame(8); w.startShift();
  w.skipMs(FLIGHT_DEFS[1].times.loadingMs + 2000);
  const wf = w.state.flightsById.flight_MC184;
  const wac = w.state.aircraftById[wf.aircraftId];
  const wz = aircraftHoldZone(wac);
  let put = 0;
  for (const bag of Object.values(w.state.bagsById)) {
    if (bag.flightId === 'flight_MC184') continue;
    if (bag.location.type !== 'floor' && bag.location.type !== 'conveyor') continue;
    bag.x = wz.x; bag.y = wz.y;
    moveBag(w.state, bag, { type: 'aircraftHold', id: wac.id }, w.bus, w.state.simTimeMs);
    put++;
  }
  wholeShift(w);
  ok('F13 a wrongly loaded aircraft still departs', wf.state === 'DEPARTED');
  ok('F14 and the strangers aboard are recorded as misrouted',
    wf.outcome.misrouted === put, `${wf.outcome.misrouted} of ${put}`);
  ok('F15 and it cost points', w.state.score.points < 0, `${w.state.score.points}`);
}

/* ── G. the live page, cross-browser surface ─────────────────────────────── */
async function sectionG() {
lines.push('--- G. the live build ---');
  await yieldToLoop();
  const abc = window.__ABC;
  ok('G1 the bootstrap ran', !!abc);
  if (!abc) return;

  const banner = document.getElementById('err-banner');
  ok('G2 no error banner after boot', !banner, banner && banner.textContent);
  ok('G3 the real rAF loop ran and sized the canvas',
    abc.game.frames >= 1 && abc.camera.cssW > 1);

  // "The game loads with no external services." Nothing in the document may reach out.
  const remote = [...document.querySelectorAll('script[src], link[href], img[src]')]
    .map((el) => el.getAttribute('src') || el.getAttribute('href'))
    .filter((u) => u && /^(https?:)?\/\//i.test(u));
  eq('G4 the page fetches nothing from the network', remote.length, 0, JSON.stringify(remote));

  // Cross-browser surface: everything the game needs must be feature-detected here rather
  // than assumed, because a missing one is a blank screen on somebody else's machine.
  const need = {
    canvas2d: !!document.createElement('canvas').getContext('2d'),
    modules: true,                                  // this file is one
    rAF: typeof requestAnimationFrame === 'function',
    perfNow: typeof performance !== 'undefined' && typeof performance.now === 'function',
    roundRect: typeof CanvasRenderingContext2D !== 'undefined' &&
               typeof CanvasRenderingContext2D.prototype.roundRect === 'function',
    createPattern: typeof CanvasRenderingContext2D.prototype.createPattern === 'function',
    webAudio: !!(globalThis.AudioContext || globalThis.webkitAudioContext),
    localStorage: (() => { try { return !!globalThis.localStorage; } catch { return false; } })(),
  };
  for (const [k, v] of Object.entries(need)) ok(`G5.${k} available`, v);
  note('      the two optional ones are handled: SaveSystem guards storage access, and');
  note('      Sfx stays inert when no AudioContext exists (m5 E, m4 save section).');

  // GDD §21.1: no external requests AT RUNTIME either.
  const perf = performance.getEntriesByType ? performance.getEntriesByType('resource') : [];
  const external = perf.map((e) => e.name)
    .filter((u) => !u.startsWith(location.origin) && !u.startsWith('data:') && !u.startsWith('blob:'));
  eq('G6 and nothing was fetched off-origin at runtime', external.length, 0,
    JSON.stringify(external.slice(0, 4)));

  eq('G7 containment held on the live page', assertContainment(abc.game.state).length, 0);
}

/* ── H. fuzz: the invariants under input nobody sane would produce ───────── */
/* GDD §29 asks that a shift run without uncaught errors and without duplicating or
 * deleting a bag. `CrewBot` cannot earn those sentences on its own — it only ever presses
 * keys that make sense. This mashes the keyboard and checks EVERY invariant after EVERY
 * step. It is a short version of `tools\_soak.js`; run that one when changing the
 * simulation, and keep this one here so a regression is caught by the suite. */
function sectionH() {
lines.push('--- H. fuzz: random input against every invariant, every step ---');

  // Two whole shifts of pure mashing. Delivers nothing — that is the point; what it
  // exercises is every verb fired in every wrong order and place.
  for (const seed of [4, 2026]) {
    const r = fuzzShift(seed);
    ok(`H1.${seed} a fuzzed shift raises no uncaught error`, !r.threw,
      r.threw && String(r.threw).split('\n')[0]);
    eq(`H2.${seed} and violates no invariant`, r.violations.length, 0,
      JSON.stringify(r.violations.slice(0, 2)));
    note(`      seed ${seed}: ${(r.simMs / 1000).toFixed(0)} s of random input, ` +
         `${r.bags} bags, ${r.delivered} delivered`);
  }

  // Chaos: pausing, focus loss, settings changes and dropped frames on top.
  const c = fuzzShift(99, { chaos: true, frames: 12000 });
  ok('H3 chaos — pause, blur, settings and frame jitter — raises no error', !c.threw,
    c.threw && String(c.threw).split('\n')[0]);
  eq('H4 and violates no invariant', c.violations.length, 0,
    JSON.stringify(c.violations.slice(0, 2)));

  // Guided: the real bot with a hand tremor, so the fuzz reaches the aircraft and makes
  // mistakes THERE — loading, misrouting, taking bags back out, hold closing on a cart.
  const gz = guidedFuzz(11, 0.02);
  ok('H5 a clumsy crew still raises no error', !gz.threw,
    gz.threw && String(gz.threw).split('\n')[0]);
  eq('H6 and still violates no invariant', gz.violations.length, 0,
    JSON.stringify(gz.violations.slice(0, 2)));
  ok('H7 and it really did reach the aircraft', gz.delivered + gz.misrouted > 0,
    `${gz.delivered} delivered, ${gz.misrouted} misrouted`);
  note(`      clumsy crew: ${gz.delivered} delivered, ${gz.misrouted} misrouted, ` +
       `${gz.nudges} stray keypresses, ${gz.points} points`);

  // "Restart resets every entity and timer cleanly" — hammered, not sampled.
  const rt = restartTorture(31337, 8);
  ok('H8 eight restarts mid-shift raise no error', !rt.threw,
    rt.threw && String(rt.threw).split('\n')[0]);
  eq('H9 and leave nothing behind', rt.problems.length, 0, JSON.stringify(rt.problems.slice(0, 3)));
}

/* ── Z. what a suite cannot close ────────────────────────────────────────── */
function sectionZ() {
lines.push('--- Z. GDD §29 criteria that need people, not a test runner ---');
  open('Z1 "a first-time player can complete the basic loop without a manual" (§29 UX)');
  open('Z2 "at least three external playtesters understand that the airport will not wait"');
  open('Z3 "at least two report a memorable unscripted mistake or recovery"');
  open('Z4 "repeated play produces improved organization or routing"');
  note('      Section D is the closest a program gets: it plays whole shifts through the');
  note('      real input path and shows a competent crew clearing most of the schedule');
  note('      and a careless one going backwards. It cannot tell you whether the game');
  note('      TEACHES that, and it is reported open rather than assumed green.');
}

/* ── run ─────────────────────────────────────────────────────────────────── */
(async () => {
  const sections = [
    ['A', sectionA], ['B', sectionB], ['C', sectionC], ['D', sectionD],
    ['E', sectionE], ['F', sectionF], ['H', sectionH], ['G', sectionG], ['Z', sectionZ],
  ];
  for (const [name, fn] of sections) {
    emit(`RUNNING section ${name}...`);
    try { await fn(); }
    catch (e) { fails++; lines.push(`FAIL  section ${name} threw: ${(e && e.stack) || e}`); }
    emit(`RUNNING (section ${name} done)`);
  }
  emit();
})();
