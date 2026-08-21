/* Milestone 1 suite — the bag feels good.
 *
 * Exit criterion under test: moving and sorting ten bags is reliable and pleasant.
 * "Pleasant" is not testable; "reliable" is, and it is the half that bites. So this
 * suite hammers the two things that would quietly corrupt a shift — bag IDENTITY and
 * bag LOCATION — and measures the feel numbers (speed, throw distance, reach) rather
 * than trusting them.
 *
 * See tools\m0-tests.js for why the live section drives game.frame() by hand instead of
 * waiting for animation frames.
 */

import { CONFIG } from '../src/config.js';
import { Game, MODES } from '../src/game.js';
import { Input } from '../src/core/input.js';
import { GameClock } from '../src/core/clock.js';
import { Rng } from '../src/core/rng.js';
import { ASSIST_LEVELS } from '../src/ui/settings.js';
import { ScannerCard } from '../src/ui/scannerCard.js';
import { SpatialGrid } from '../src/core/grid.js';
import { FLIGHT_DEFS, buildBagSchedule, gateConflicts, flightById } from '../src/data/flights.js';
import { createBag, WEIGHT_CLASSES } from '../src/entities/bag.js';
import { beltPos } from '../src/entities/conveyor.js';
import { moveBag, assertContainment, countByLocation, isLoose, LOCATION_TYPES } from '../src/systems/containment.js';
import { moveWithWalls, applyFriction, separate, approach } from '../src/systems/physics.js';
import { findTarget, scanBag, throwHeld, releaseHeld } from '../src/systems/interaction.js';
import { STAGING_PADS, ZONES, CONVEYOR, WORLD, isBlocked, zoneAt } from '../src/data/airport.js';
import { MIN_PX_PER_M } from '../src/render/camera.js';

/* ── harness ─────────────────────────────────────────────────────────────── */
const lines = [];
let passes = 0, fails = 0;

function ok(name, cond, detail = '') {
  if (cond) { passes++; lines.push(`PASS  ${name}`); }
  else { fails++; lines.push(`FAIL  ${name}${detail ? '  <- ' + detail : ''}`); }
}
const eq   = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const near = (n, a, b, tol) => ok(n, Math.abs(a - b) <= tol, `got ${a}, want ${b} +/- ${tol}`);
const note = (s) => lines.push(`      ${s}`);

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
const STEP = CONFIG.sim.stepMs;

/** Hand control back to the browser long enough for the real rAF loop to run a frame.
 *  Bounded by a timer, because headless Chrome delivers only a couple of frames in
 *  total (see tools\_raf.js) and must not be waited on indefinitely. */
const yieldToLoop = () => new Promise((res) => {
  let done = false;
  const finish = () => { if (!done) { done = true; res(); } };
  requestAnimationFrame(finish);
  setTimeout(finish, 500);
});

/** The strongest difficulty assist the settings panel offers. Read from the table rather
 *  than typed, so re-proportioning the levels (M6 already did once) re-points the tests
 *  that exist to prove the assist does not corrupt a bag's idea of its own flight. */
const ASSIST_TOP = Math.max(...ASSIST_LEVELS.map((a) => a.v));

/** A headless game, mid-shift-ready. No canvas, no DOM.
 *
 *  The assist is read while the shift is AUTHORED (Game._authorShift), so it has to be
 *  set between construction and startShift(). Written straight onto game.settings rather
 *  than through applySettings(), which would persist it into the real browser store —
 *  and set explicitly on every game so a stale saved setting in the harness profile can
 *  never quietly reshape a shift the suite believes is the authored one. */
function newGame(seed = 4242, assist = 1) {
  const g = new Game({ seed, seedLabel: 'test' });
  g.settings.assist = assist;
  g.startShift();
  return g;
}

/** Run a whole shift out, bounded, without assuming how long one is. The shift end is
 *  DERIVED (last departure + pushback + wrap-up), so a loop counting a fixed number of
 *  ten-second skips stops wherever the schedule happened to be when it was written —
 *  which is how six suites quietly truncated at ten minutes when M6 stretched the shift
 *  to 11:32. The +2000 carries it past the end so the closing pass has run. */
function runShift(g, chunkMs = 5000, onChunk = null) {
  const guard = Math.ceil((g.state.shift.endTimeMs + 2000) / chunkMs) + 10;
  for (let i = 0; i < guard && g.state.simTimeMs < g.state.shift.endTimeMs + 2000; i++) {
    g.skipMs(chunkMs);
    if (onChunk) onChunk(g, i);
  }
  return g;
}
/** Drive real frames through the same call main.js's rAF callback makes. */
const drive = (g, frames, input = null) => {
  for (let i = 0; i < frames; i++) g.frame(FRAME_MS, input);
};
/**
 * A cheap hash of the whole painted canvas, for before/after frame comparisons.
 *
 * Sampling one pixel proves the canvas is not blank and nothing else — the ground fill
 * clears any brightness threshold on its own. Comparing two frames with one entity moved
 * between them proves the entity is drawn. Strided by 7: a 1262x700 frame is 3.5 MB, the
 * change being looked for is entity-sized, and 7 is coprime with the 4-byte RGBA period
 * so the walk rotates through all four channels.
 */
function frameSignature(renderer) {
  const d = renderer.ctx.getImageData(0, 0, renderer.canvas.width, renderer.canvas.height).data;
  let h = 2166136261;
  for (let i = 0; i < d.length; i += 7) h = Math.imul(h ^ d[i], 16777619);
  return h >>> 0;
}

/** Put a bag on the floor at a spot, bypassing the belt, for a focused test. */
function placeBag(g, x, y, opts = {}) {
  const spec = { flightId: opts.flightId || 'flight_AB221', priority: !!opts.priority,
                 weightClass: opts.weightClass || 'normal' };
  const bag = createBag(spec, g._t = (g._t || 0) + 1, 400000, new Rng(7, 'test'));
  g.state.bagsById[bag.id] = bag;
  bag.x = x; bag.y = y; bag.vx = 0; bag.vy = 0;
  moveBag(g.state, bag, { type: 'floor' }, g.bus, g.state.simTimeMs);
  return bag;
}

/* ── A. the authored shift ───────────────────────────────────────────────── */
function sectionA() {
lines.push('--- A. flight definitions (GDD 20.4) ---');
{
  eq('A1 three departing flights are authored', FLIGHT_DEFS.length, 3);
  eq('A2 flight ids are unique', new Set(FLIGHT_DEFS.map((f) => f.id)).size, 3);
  eq('A3 flight numbers are unique', new Set(FLIGHT_DEFS.map((f) => f.number)).size, 3);

  const badOrder = FLIGHT_DEFS.filter((f) => {
    const t = f.times;
    return !(t.bagAcceptanceMs < t.loadingMs && t.loadingMs < t.finalCallMs &&
             t.finalCallMs < t.holdClosingMs && t.holdClosingMs < t.departureMs);
  });
  ok('A4 every flight lifecycle time is in order', badOrder.length === 0,
     badOrder.map((f) => f.number).join());

  /*
   * "Inside the shift" has to mean something outside the set being measured. This used to
   * filter FLIGHT_DEFS for a departure later than the maximum departure in FLIGHT_DEFS —
   * a tautology, green for any timetable ever authored, including one that ran to an hour.
   *
   * The real ceiling is GDD §3.3: the prototype is ONE 8-12 minute shift, and the shift
   * does not end at the last departure — it ends a pushback and a wrap-up later
   * (Game._authorShift). So the last aircraft must be clear, and the ramp tidied, inside
   * twelve minutes. Measured against the AUTHORED times on purpose: §3.3 describes the
   * shift as designed, and §16.6's assist deliberately stretches it past that.
   */
  const GDD_SHIFT_MIN_MS = 8 * 60000, GDD_SHIFT_MAX_MS = 12 * 60000;
  const shiftEndsMs = Math.max(...FLIGHT_DEFS.map((f) => f.times.departureMs)) +
                      CONFIG.flight.pushbackMs + CONFIG.shift.wrapUpMs;
  const late = FLIGHT_DEFS.filter((f) =>
    f.times.departureMs + CONFIG.flight.pushbackMs + CONFIG.shift.wrapUpMs > GDD_SHIFT_MAX_MS);
  ok('A5 every flight is away inside GDD 3.3\'s twelve-minute shift', late.length === 0,
     late.map((f) => `${f.number} at ${(f.times.departureMs / 1000).toFixed(0)}s`).join());
  ok('A5b and the shift is a full one, not a squashed eight minutes',
     shiftEndsMs >= GDD_SHIFT_MIN_MS, `${GameClock.formatMs(shiftEndsMs)}`);
  note(`authored shift runs to ${GameClock.formatMs(shiftEndsMs)} (GDD 3.3 wants 8:00-12:00)`);

  const conflicts = gateConflicts();
  ok('A6 a gate is never double-booked (GDD 20.4)', conflicts.length === 0, JSON.stringify(conflicts));

  const gateIds = ZONES.filter((z) => z.kind === 'stand').map((z) => z.id.replace('stand_', 'gate_'));
  const badGate = FLIGHT_DEFS.filter((f) => !gateIds.includes(f.gateId));
  ok('A7 every flight is assigned a gate that exists', badGate.length === 0,
     badGate.map((f) => f.gateId).join());

  // GDD 20.4 requires overlap: at least two flights demanding attention at once.
  let overlapping = 0;
  for (let i = 0; i < FLIGHT_DEFS.length; i++) {
    for (let j = i + 1; j < FLIGHT_DEFS.length; j++) {
      const a = FLIGHT_DEFS[i].times, b = FLIGHT_DEFS[j].times;
      if (a.bagAcceptanceMs < b.holdClosingMs && b.bagAcceptanceMs < a.holdClosingMs) overlapping++;
    }
  }
  ok('A8 at least two flights create overlapping demands', overlapping >= 1, `${overlapping} pairs`);

  eq('A9 icons differ, so colour is not the only channel (GDD 7.2)',
     new Set(FLIGHT_DEFS.map((f) => f.tag.icon)).size, 3);
  eq('A10 tag colours differ too', new Set(FLIGHT_DEFS.map((f) => f.tag.color)).size, 3);
}
}

function sectionB() {
lines.push('--- B. bag timetable (GDD 20.2, 21.7) ---');
{
  const s1 = buildBagSchedule(new Rng(99, 'a'));
  const s2 = buildBagSchedule(new Rng(99, 'a'));
  const s3 = buildBagSchedule(new Rng(100, 'a'));
  ok('B1 the timetable is deterministic for a seed', JSON.stringify(s1) === JSON.stringify(s2));
  ok('B2 a different seed gives a different shift', JSON.stringify(s1) !== JSON.stringify(s3));

  const sorted = s1.every((b, i) => i === 0 || b.atMs >= s1[i - 1].atMs);
  ok('B3 the timetable is sorted by arrival', sorted);

  const total = FLIGHT_DEFS.reduce((n, f) => n + f.bagCount, 0);
  eq('B4 every authored bag is on the timetable', s1.length, total);
  note(`shift is ${total} bags across ${FLIGHT_DEFS.length} flights`);

  const shiftEndMs = Math.max(...FLIGHT_DEFS.map((f) => f.times.departureMs));
  const outside = s1.filter((b) => b.atMs < 0 || b.atMs > shiftEndMs);
  ok('B5 no bag arrives outside the shift', outside.length === 0, `${outside.length}`);

  for (const f of FLIGHT_DEFS) {
    const mine = s1.filter((b) => b.flightId === f.id);
    eq(`B6.${f.number} the flight gets exactly its bag count`, mine.length, f.bagCount);
    eq(`B7.${f.number} the flight gets its priority bags`,
       mine.filter((b) => b.priority).length, f.twist.priorityCount);
  }

  // §20.4 twists must actually be in the data, not just in the comment.
  const heavyFrac = (id) => {
    const m = s1.filter((b) => b.flightId === id);
    return m.filter((b) => b.weightClass === 'heavy').length / m.length;
  };
  ok('B8 MC184 really is the heavy-bag flight',
     heavyFrac('flight_MC184') > heavyFrac('flight_AB221'),
     `MC184 ${(heavyFrac('flight_MC184') * 100).toFixed(0)}% vs AB221 ${(heavyFrac('flight_AB221') * 100).toFixed(0)}%`);
  note(`heavy: AB221 ${(heavyFrac('flight_AB221') * 100).toFixed(0)}%  MC184 ${(heavyFrac('flight_MC184') * 100).toFixed(0)}%  SK307 ${(heavyFrac('flight_SK307') * 100).toFixed(0)}%`);

  const sk = s1.filter((b) => b.flightId === 'flight_SK307');
  const skPri = sk.filter((b) => b.priority);
  const median = sk[Math.floor(sk.length / 2)].atMs;
  const lateCount = skPri.filter((b) => b.atMs > median).length;
  // MOST, not every. The twist loads the tail of the window, but priorityCount is a
  // sizeable fraction of a 12-bag flight, so demanding all of them sit in the late half
  // is arithmetic the schedule cannot satisfy — and it is not what §20.4 asks for.
  ok('B9 SK307 priority bags mostly arrive late',
     lateCount >= Math.ceil(skPri.length * 0.6),
     `${lateCount} of ${skPri.length} after ${(median / 1000).toFixed(0)}s: ${skPri.map((b) => (b.atMs / 1000).toFixed(0)).join()}`);

  for (const f of FLIGHT_DEFS) {
    const lateOnes = s1.filter((b) => b.flightId === f.id && b.atMs > f.times.finalCallMs);
    ok(`B10.${f.number} some bags arrive after final call`, lateOnes.length === f.twist.lateBags,
       `${lateOnes.length}`);
  }
}
}

/* ── C. identity ─────────────────────────────────────────────────────────── */

/**
 * Every bag counts down to the departure of the flight the player is ACTUALLY playing.
 *
 * `createBag` can only see the frozen FLIGHT_DEFS, so `spawnDueBags` overwrites
 * `expectedDepartureMs` from `state.flightsById` — and GDD §16.6's assist scales every
 * window there (`createFlights` -> `scaleTimes`) while FLIGHT_DEFS never moves. C5 used to
 * compare a bag against `flightById()`, which at assist 1 is the SAME NUMBER the
 * implementation read: two copies of one authored constant, green for any implementation
 * whatsoever, and blind to the entire class of defect the assertion was named for. The two
 * only disagree at the other assist levels, which is exactly where the scanner card
 * counted down to a departure five minutes early and §20.4's late-bag twist landed two
 * minutes ahead of final call. So it is run at 1.0 AND at the strongest assist offered.
 *
 * @param {Game} g  a shift already run to its end
 */
function bagsAgreeWithLiveFlight(g, tag, assist) {
  const bags = Object.values(g.state.bagsById);
  const departsOf = (b) => g.state.flightsById[b.flightId].times.departureMs;
  const wrong = bags.filter((b) => b.expectedDepartureMs !== departsOf(b));
  ok(`${tag} every bag counts down to the departure of the shift being PLAYED (assist ${assist})`,
     bags.length > 0 && wrong.length === 0,
     wrong.length
       ? `${wrong.length} of ${bags.length}, e.g. the bag says ${wrong[0].expectedDepartureMs} and its flight says ${departsOf(wrong[0])}`
       : `no bags spawned`);
}

function sectionC() {
lines.push('--- C. bag identity (GDD 6.2, 22.1, 7.2) ---');
{
  const g = newGame(4242);
  g.skipMs(g.state.shift.endTimeMs + 2000);
  const bags = Object.values(g.state.bagsById);
  const authored = FLIGHT_DEFS.reduce((t, f) => t + f.bagCount, 0);
  eq('C1 a full shift spawns every authored bag', bags.length, authored);

  eq('C2 every bag id is unique', new Set(bags.map((b) => b.id)).size, bags.length);
  eq('C3 every printed tag number is unique', new Set(bags.map((b) => b.tag)).size, bags.length);
  ok('C4 tags are the six digits the GDD prints', bags.every((b) => /^\d{6}$/.test(b.tag)));

  // Destination and gate are STATIC identity — the assist moves clocks, never routes, so
  // these are the fields FLIGHT_DEFS is still the authority on. The departure is not, and
  // it is checked against the LIVE flight in C5b/C12 below.
  const mismatched = bags.filter((b) => {
    const f = flightById(b.flightId);
    return b.destinationCode !== f.destinationCode || b.gateId !== f.gateId;
  });
  ok('C5 a bag agrees with its own flight', mismatched.length === 0, `${mismatched.length}`);
  bagsAgreeWithLiveFlight(g, 'C5b', 1);

  // GDD 7.2: body colour must NOT be a shortcut for the flight, or players learn a lie.
  const byColor = new Map();
  for (const b of bags) {
    if (!byColor.has(b.appearance.color)) byColor.set(b.appearance.color, new Set());
    byColor.get(b.appearance.color).add(b.flightId);
  }
  const shared = [...byColor.values()].filter((s) => s.size > 1).length;
  ok('C6 body colour does not encode the flight', shared >= 3,
     `${shared} of ${byColor.size} colours are used by more than one flight`);

  const iconOk = bags.every((b) => b.appearance.icon === flightById(b.flightId).tag.icon);
  ok('C7 the tag icon does encode the flight', iconOk);

  ok('C8 weight classes are all real', bags.every((b) => WEIGHT_CLASSES[b.weightClass]));
  const heavy = bags.find((b) => b.weightClass === 'heavy');
  const light = bags.find((b) => b.weightClass === 'light');
  ok('C9 a heavy bag is physically bigger than a light one',
     !heavy || !light || heavy.widthM > light.widthM);
  // Sampled EARLY on purpose. Since Milestone 3 a departure classifies every bag it was
  // owed, so "still active at the end of a shift" stopped being true the moment flights
  // began leaving — the invariant was always about how a bag STARTS.
  // Wait for the first arrivals rather than assuming a time — "bags exist by 30 s" is a
  // property of one seed, not of the game. (Same trap as m2 F2.)
  const fresh = newGame(4242);
  let waited = 0;
  while (Object.keys(fresh.state.bagsById).length === 0 && waited < 200000) {
    fresh.skipMs(2000); waited += 2000;
  }
  const early = Object.values(fresh.state.bagsById);
  ok('C10 a bag starts active and undamaged',
     early.length > 0 && early.every((b) => b.lifecycle === 'active' && b.condition === 'ok'),
     `${early.length} bags`);
  ok('C11 an unattended shift credits no bag to any flight, because none were loaded',
     bags.every((b) => b.actualFlightId === null));

  /* The same shift under the strongest assist. Nothing about a bag's identity may change
   * except the clock it is racing — and that clock has to be the stretched one. */
  const gA = runShift(newGame(4242, ASSIST_TOP));
  bagsAgreeWithLiveFlight(gA, 'C12', ASSIST_TOP);

  // ...and the guard that keeps C12 honest. If the assist ever stopped reaching the
  // flights, C12 would go on passing against an unstretched shift while proving nothing,
  // which is precisely how C5 spent five milestones green.
  const wrongScale = FLIGHT_DEFS.filter((f) =>
    gA.state.flightsById[f.id].times.departureMs !== Math.round(f.times.departureMs * ASSIST_TOP));
  ok('C13 the assist stretches every departure by exactly its multiplier',
     wrongScale.length === 0,
     wrongScale.map((f) => `${f.number}: ${gA.state.flightsById[f.id].times.departureMs} vs ${Math.round(f.times.departureMs * ASSIST_TOP)}`).join());
  const unmoved = FLIGHT_DEFS.filter((f) =>
    gA.state.flightsById[f.id].times.departureMs === f.times.departureMs);
  ok(`C14 so an assisted shift really is a different clock from the authored one`,
     ASSIST_TOP > 1 && unmoved.length === 0,
     `${unmoved.length} flights unmoved at assist ${ASSIST_TOP}`);
  note(`assist ${ASSIST_TOP}: SK307 departs ${GameClock.formatMs(gA.state.flightsById['flight_SK307'].times.departureMs)} against an authored ${GameClock.formatMs(flightById('flight_SK307').times.departureMs)}`);
}
}

/* ── D. the containment invariant ────────────────────────────────────────── */
function sectionD() {
lines.push('--- D. one authoritative location (GDD 21.6, 31.1.10) ---');
{
  const g = newGame(7);
  const conv = g.state.world.conveyor;
  // Run until the belt HAS a bag rather than assuming one has arrived by 30 s. That is
  // a property of one seed and one bag count, and the M6 retune changed both.
  for (let i = 0; i < 240 && !conv.bagIds.length; i++) g.skipMs(1000);

  ok('D1 bags spawn onto the belt', conv.bagIds.length > 0, `${conv.bagIds.length}`);
  const onBelt = Object.values(g.state.bagsById).filter((b) => b.location.type === 'conveyor');
  eq('D2 conveyor.bagIds agrees with the bags themselves', conv.bagIds.length, onBelt.length);
  eq('D3 no bag is listed on the belt twice', new Set(conv.bagIds).size, conv.bagIds.length);

  const bag = g.state.bagsById[conv.bagIds[0]];
  moveBag(g.state, bag, { type: 'floor' }, g.bus, g.state.simTimeMs);
  ok('D4 moving a bag off the belt removes it from the belt index',
     !conv.bagIds.includes(bag.id) && bag.location.type === 'floor');

  moveBag(g.state, bag, { type: 'carried', id: 'player_1' }, g.bus, g.state.simTimeMs);
  ok('D5 carrying sets both the location and the player hand',
     bag.location.type === 'carried' && g.state.player.carryingBagId === bag.id);

  // GDD 31.1.10: one pair of hands. A second grab must not orphan the first bag.
  const second = placeBag(g, 20, 24);
  moveBag(g.state, second, { type: 'carried', id: 'player_1' }, g.bus, g.state.simTimeMs);
  ok('D6 grabbing a second bag puts the first one down rather than losing it',
     g.state.player.carryingBagId === second.id && bag.location.type === 'floor');
  eq('D7 and the invariant still holds', assertContainment(g.state).length, 0);

  let threw = false;
  try { moveBag(g.state, bag, { type: 'nonsense' }, g.bus, 0); } catch (e) { threw = true; }
  ok('D8 an unknown location type is rejected outright', threw);

  const counts = countByLocation(g.state);
  const sum = Object.values(counts).reduce((a, b) => a + b, 0);
  eq('D9 every bag is counted in exactly one place', sum, Object.keys(g.state.bagsById).length);

  /* `floor` in, everything else out. The pair this used to test — floor true, carried
   * false — left the four location types that ACTUALLY matter unchecked, and they are the
   * ones a regression reaches: `stepBags` integrates exactly the bags isLoose() admits, so
   * a carted or loaded bag counted as loose gets floor physics run on it while its
   * container is also writing its position. Every LOCATION_TYPE is covered here, so a new
   * one cannot be added without deciding which side of this line it falls on. */
  const looseTypes = LOCATION_TYPES.filter((t) => isLoose({ location: { type: t } }));
  eq('D10 isLoose is true for "floor" and nothing else', looseTypes.join(), 'floor');
  const notLoose = ['conveyor', 'carried', 'cart', 'aircraftHold', 'departed'];
  ok('D10b every other location type is emphatically not loose',
     notLoose.every((t) => !isLoose({ location: { type: t } })) &&
     notLoose.every((t) => LOCATION_TYPES.includes(t)),
     notLoose.filter((t) => isLoose({ location: { type: t } })).join());

  // The real test: does the invariant survive a whole shift of the belt running?
  //
  // Sixty ten-second skips is 600 000 ms, and the DERIVED shift is 692 000 — so this
  // stopped 92 seconds short of the end and never saw SK307's final call, hold closing,
  // departure or classification pass, which is the exact window where containment moves
  // bags in bulk. It ended with 31 of 34 bags. Read the end off the state instead.
  const g2 = newGame(1234);
  let worst = null;
  runShift(g2, 5000, () => {
    const bad = assertContainment(g2.state);
    if (bad.length && !worst) worst = `at ${g2.state.simTimeMs} ms: ${bad[0]}`;
  });
  ok('D11 the invariant holds across a full unattended shift', !worst, worst);
  ok('D11b and that shift really did run to its end',
     g2.state.simTimeMs >= g2.state.shift.endTimeMs,
     `stopped at ${g2.state.simTimeMs} of ${g2.state.shift.endTimeMs} ms`);
  note(`unattended shift ended with ${JSON.stringify(countByLocation(g2.state))}`);
}
}

/* ── E. arcade physics ───────────────────────────────────────────────────── */
function sectionE() {
lines.push('--- E. arcade physics (GDD 6.2, 21.6, 24.3) ---');
{
  // straight into the sort room's north wall (y = 8..8.6)
  const e = { x: 20, y: 10, vx: 0, vy: -6 };
  for (let i = 0; i < 60; i++) moveWithWalls(e, 1 / 60, 0.34, 0);
  ok('E1 a wall stops movement', e.y > 8.6, `y=${e.y.toFixed(2)}`);
  ok('E2 and nothing ends up inside it', !isBlocked(e.x, e.y, 0.34));

  // moving diagonally into the same wall must preserve the sideways component
  const s = { x: 20, y: 10, vx: 3, vy: -6 };
  const x0 = s.x;
  for (let i = 0; i < 30; i++) moveWithWalls(s, 1 / 60, 0.34, 0);
  ok('E3 an entity slides along a wall instead of sticking', s.x > x0 + 0.6, `dx=${(s.x - x0).toFixed(2)}`);

  const out = { x: -50, y: -50, vx: 0, vy: 0 };
  moveWithWalls(out, 1 / 60, 0.34, 0);
  ok('E4 anything outside the world is clamped back in (GDD 24.3)',
     out.x > 0 && out.y > 0, `${out.x},${out.y}`);

  const f = { x: 20, y: 24, vx: 8, vy: 0 };
  let steps = 0;
  while (Math.hypot(f.vx, f.vy) > 0 && steps < 600) { applyFriction(f, 1 / 60, CONFIG.bag.friction); steps++; }
  ok('E5 friction brings a bag to a dead stop, with no creep',
     f.vx === 0 && f.vy === 0 && steps < 200, `${steps} steps`);
  note(`a bag thrown at 8 m/s slides for ${(steps / 60).toFixed(2)} s`);

  // 0.8 is the sum of the two radii; they start 0.2 m apart, so 0.6 m of overlap has to
  // go. At strength 1.0 a single pass resolves ALL of it — which is the property worth
  // asserting. "Further apart than 0.2 m" was satisfied by a one-millimetre nudge, so a
  // separation pass that had quietly become a rounding error still passed.
  const MIN_DIST = 0.8;
  const a = { x: 10, y: 10 }, b = { x: 10.2, y: 10 };
  ok('E6 overlapping circles are pushed apart', separate(a, b, MIN_DIST, 0.5, 1.0));
  near('E7 and at full strength they end up exactly touching, not merely nudged',
       Math.hypot(b.x - a.x, b.y - a.y), MIN_DIST, 1e-9);
  near('E7b and at weight 0.5 the two of them share the push evenly',
       a.x - 10, -(b.x - 10.2), 1e-9);

  const pinned = { x: 10, y: 10 }, pushed = { x: 10.2, y: 10 };
  separate(pinned, pushed, 0.8, 0, 1.0);
  ok('E8 weightA 0 pins the first and moves only the second',
     pinned.x === 10 && pushed.x > 10.2);

  const c1 = { x: 5, y: 5 }, c2 = { x: 5, y: 5 };
  separate(c1, c2, 0.8, 0.5, 1.0);
  ok('E9 exactly coincident circles separate deterministically, not randomly',
     c1.x !== c2.x || c1.y !== c2.y);

  eq('E10 approach never overshoots its target', approach(0, 10, 3), 3);
  eq('E11 approach lands exactly on target', approach(9, 10, 3), 10);
  eq('E12 approach works downward too', approach(0, -10, 3), -3);

  const grid = new SpatialGrid(120, 70, 4);
  grid.insert('a', 10, 10); grid.insert('b', 10.5, 10); grid.insert('c', 90, 60);
  const hits = grid.query(10, 10, 1, []);
  ok('E13 the spatial grid finds neighbours', hits.includes('a') && hits.includes('b'));
  ok('E14 and excludes the far side of the airport', !hits.includes('c'));
  grid.clear();
  eq('E15 clearing the grid empties it', grid.query(10, 10, 1, []).length, 0);
}
}

/* ── F. the conveyor ─────────────────────────────────────────────────────── */
function sectionF() {
lines.push('--- F. the conveyor (GDD 20.2, pillar 1) ---');
{
  const g = newGame(31);
  const conv = g.state.world.conveyor;
  near('F1 the belt length matches its endpoints', conv.lengthM,
       Math.hypot(CONVEYOR.x1 - CONVEYOR.x0, CONVEYOR.y1 - CONVEYOR.y0), 1e-9);

  // Wait for the first arrival rather than assuming a time: the timetable is seeded, so
  // "a bag exists by 8 s" is a property of one seed and not of the conveyor.
  let waited = 0;
  while (conv.bagIds.length === 0 && waited < 200000) { g.skipMs(500); waited += 500; }
  const first = g.state.bagsById[conv.bagIds[0]];
  ok('F2 a bag is riding the belt', !!first, `nothing after ${waited} ms`);

  if (first) {
    const t0 = first.location.t;
    const x0 = first.x, y0 = first.y;
    g.skipMs(2000);   // a fresh bag needs ~13 s to cross, so it cannot drop off mid-test
    near('F3 a bag advances at belt speed', first.location.t - t0, conv.speedMps * 2, 0.15);

    /*
     * F4/F5 used to be `near(first.x, beltPos(conv, first.location.t).x)` — the same call
     * on the same t that src/entities/conveyor.js makes one line after it sets t. That
     * re-runs the implementation rather than checking it: the ONLY edit that could turn it
     * red is deleting the assignment outright, and every wrong-but-present position passes.
     * Assert the PROPERTIES a drawn belt position has instead: it moves along the belt at
     * belt speed, and it lies on the segment between the two endpoints.
     */
    near('F4 and its drawn position moves with it, at the same speed',
         Math.hypot(first.x - x0, first.y - y0), conv.speedMps * 2, 0.15);
    // The raw endpoints, not beltPos() again — the whole point is to stop asking the
    // implementation where it thinks the bag is.
    const start = { x: conv.x0, y: conv.y0 }, end = { x: conv.x1, y: conv.y1 };
    const along = Math.hypot(first.x - start.x, first.y - start.y);
    const toGo = Math.hypot(end.x - first.x, end.y - first.y);
    near('F5 and that position is on the belt, between its two ends',
         along + toGo, conv.lengthM, 1e-6);
    ok('F5b and it is travelling towards the far end, not away from it',
       along > Math.hypot(x0 - start.x, y0 - start.y), `${along.toFixed(2)} m along`);
  }

  /*
   * The pressure test: nobody touches anything for a whole shift.
   *
   * Two defects lived in the old version of this loop. It ran 120 x 5000 ms = 600 000 ms
   * against a DERIVED shift of 692 000, so it stopped 92 seconds short — before SK307's
   * final call, its hold closing and its departure. And it sampled every 5000 ms, which on
   * a 1.6 m/s belt is eight metres of travel per sample: a pair of bags could close, touch
   * and separate entirely between two looks. Sample every STEP, for the whole shift.
   */
  const g2 = newGame(31);
  let minGap = Infinity, pairsSeen = 0, samples = 0;
  const stepChunk = CONFIG.sim.stepMs;
  const guard = Math.ceil((g2.state.shift.endTimeMs + 2000) / stepChunk) + 10;
  for (let i = 0; i < guard && g2.state.simTimeMs < g2.state.shift.endTimeMs + 2000; i++) {
    g2.skipMs(stepChunk);
    samples++;
    const belt = g2.state.world.conveyor.bagIds.map((id) => g2.state.bagsById[id].location.t);
    /* SIGNED, not absolute. `conveyor.bagIds` is ordered with index 0 furthest along, and
     * stepConveyor's queueing leans on that order — it caps each bag against the one it
     * placed immediately before. An absolute difference hides a reversed index entirely:
     * a bag attached at the wrong end of the list reads as a perfectly healthy gap while
     * every bag behind it is being queued against a bag that is behind THEM. */
    for (let k = 1; k < belt.length; k++) {
      pairsSeen++;
      minGap = Math.min(minGap, belt[k - 1] - belt[k]);
    }
  }
  /* `minGap` starts at Infinity, and Infinity >= anything is true — so an assertion that
   * never caught two bags on the belt at once passed having compared nothing at all, and
   * said so in its own detail string ("n/a"). Prove a pair was observed first. */
  ok('F6 two bags were on the belt together often enough to have an opinion',
     pairsSeen > 0, `${pairsSeen} pairs across ${samples} steps`);
  ok('F6b and bags never overlap or swap places on the belt',
     minGap >= CONFIG.bag.beltSpacingM * 0.98,
     `closest pair was ${minGap === Infinity ? 'n/a' : minGap.toFixed(3)} m, spacing is ${CONFIG.bag.beltSpacingM}`);
  note(`belt: ${pairsSeen} adjacent pairs sampled over ${samples} steps, closest ${minGap.toFixed(3)} m`);

  /* Derived from the timetable, not from an authored count. `> 30` was written against 50
   * bags and survived the M6 balance pass cutting the shift to 34 without anyone noticing
   * it now had four bags of slack; another cut to 31 would have kept it green. The belt
   * runs unattended for a full shift, so every scheduled bag should be on the floor. */
  const scheduled = g2.state.shift.bagSchedule.length;
  eq('F7 the belt delivers every scheduled bag without a player touching it',
     g2.state.world.conveyor.delivered, scheduled);

  const counts = countByLocation(g2.state);
  eq('F8 delivered bags end up on the floor, not deleted', counts.floor, scheduled);
  eq('F9 nothing was lost between the belt and the floor',
     Object.values(counts).reduce((a, b) => a + b, 0), Object.keys(g2.state.bagsById).length);

  const endPt = beltPos(conv, conv.lengthM);
  const strays = Object.values(g2.state.bagsById)
    .filter((b) => b.location.type === 'floor' && Math.hypot(b.x - endPt.x, b.y - endPt.y) > 22);
  ok('F10 dropped bags land near the end of the belt and stay in the room',
     strays.length === 0, `${strays.length} strays`);
  ok('F11 the pile is in the sort room', zoneAt(endPt.x, endPt.y).id === 'sort_room');
}
}

/* ── G. the verbs ────────────────────────────────────────────────────────── */
function sectionG() {
lines.push('--- G. grab, carry, throw, scan (GDD 6.1, 7.1, 17.1) ---');
{
  const g = newGame(55);
  const st = g.state;
  st.player.x = 20; st.player.y = 24; st.player.aimX = 1; st.player.aimY = 0;

  const ahead = placeBag(g, 21.2, 24);
  const behind = placeBag(g, 18.8, 24);
  const far = placeBag(g, 26, 24);
  drive(g, 1);

  const t = findTarget(st, g.grid);
  eq('G1 targeting prefers the bag the player is facing', t, ahead.id);
  ok('G2 targeting ignores anything out of reach', t !== far.id);
  st.player.aimX = -1; st.player.aimY = 0;
  drive(g, 1);
  eq('G3 turning around retargets', findTarget(st, g.grid), behind.id);

  /* grab and carry, through the real Input */
  const input = new Input(window);
  st.player.aimX = 1; st.player.aimY = 0;
  input._debugPress('KeyE');
  drive(g, 1, input);
  eq('G4 E picks up the targeted bag', st.player.carryingBagId, ahead.id);
  eq('G5 the bag knows it is carried', ahead.location.type, 'carried');

  st.player.x = 24; st.player.y = 28;
  drive(g, 2, input);
  near('G6 a carried bag tracks the hands, x', ahead.x, st.player.x + CONFIG.bag.carryOffsetM, 0.01);
  near('G7 a carried bag has no velocity of its own', Math.hypot(ahead.vx, ahead.vy), 0, 1e-9);

  input._debugPress('KeyE');
  drive(g, 1, input);
  eq('G8 E again puts it down', st.player.carryingBagId, null);
  eq('G9 and it is loose on the floor', ahead.location.type, 'floor');
  near('G10 a released bag is placed, not thrown', Math.hypot(ahead.vx, ahead.vy), 0, 1e-9);

  /* throw distance, measured */
  function throwDistance(weightClass, charge) {
    const gg = newGame(88);
    gg.state.player.x = 70; gg.state.player.y = 35;
    gg.state.player.vx = 0; gg.state.player.vy = 0;
    gg.state.player.aimX = 1; gg.state.player.aimY = 0;
    const b = placeBag(gg, 70.6, 35, { weightClass });
    moveBag(gg.state, b, { type: 'carried', id: 'player_1' }, gg.bus, 0);
    gg.state.player.chargeMs = charge * CONFIG.bag.throwChargeMs;
    gg.state.player.charging = true;
    const x0 = b.x;
    throwHeld(gg.state, gg.bus, gg.state.simTimeMs);
    for (let i = 0; i < 240; i++) gg.frame(FRAME_MS, null);
    return b.x - x0;
  }
  const dTap = throwDistance('normal', 0);
  const dFull = throwDistance('normal', 1);
  const dHeavy = throwDistance('heavy', 1);
  const dLight = throwDistance('light', 1);
  ok('G11 a tap throw goes somewhere', dTap > 0.8, `${dTap.toFixed(2)} m`);
  ok('G12 a charged throw goes considerably further', dFull > dTap * 1.8, `${dFull.toFixed(2)} m`);
  ok('G13 a heavy bag does not go as far (GDD 6.3)', dHeavy < dFull * 0.75, `${dHeavy.toFixed(2)} m`);
  ok('G14 a light bag goes further than a normal one', dLight > dFull, `${dLight.toFixed(2)} m`);
  note(`throw: tap ${dTap.toFixed(1)} m, full ${dFull.toFixed(1)} m, heavy ${dHeavy.toFixed(1)} m, light ${dLight.toFixed(1)} m`);

  /* carrying weight slows you down — measured, not assumed */
  function walkDistance(carry) {
    const gg = newGame(89);
    gg.state.player.x = 74; gg.state.player.y = 35;
    if (carry) {
      const b = placeBag(gg, 74.6, 35, { weightClass: carry });
      moveBag(gg.state, b, { type: 'carried', id: 'player_1' }, gg.bus, 0);
    }
    const inp = new Input(window);
    inp._debugPress('KeyD');
    const x0 = gg.state.player.x;
    for (let i = 0; i < 120; i++) gg.frame(FRAME_MS, inp);
    return gg.state.player.x - x0;
  }
  const wFree = walkDistance(null);
  const wHeavy = walkDistance('heavy');
  ok('G15 carrying a heavy bag slows the player', wHeavy < wFree * 0.8,
     `${wHeavy.toFixed(2)} m vs ${wFree.toFixed(2)} m in 2 s`);
  note(`two seconds of walking: empty-handed ${wFree.toFixed(1)} m, with a heavy bag ${wHeavy.toFixed(1)} m`);

  /* the scanner reports; it never vetoes (GDD 7.1, 31.1.8) */
  const pad1 = STAGING_PADS.find((p) => p.gateId === 'gate_1');
  const pad2 = STAGING_PADS.find((p) => p.gateId === 'gate_2');
  const gg = newGame(90);
  const atl = placeBag(gg, pad1.x + 2, pad1.y + 2, { flightId: 'flight_AB221' });   // gate 1
  eq('G16 a bag on its own gate pad scans correct',
     scanBag(gg.state, atl, gg.bus, 1000).verdict, 'correct');

  const wrongPad = placeBag(gg, pad2.x + 2, pad2.y + 2, { flightId: 'flight_AB221' });
  eq('G17 the same bag on the other gate pad scans wrong',
     scanBag(gg.state, wrongPad, gg.bus, 1000).verdict, 'wrong');
  ok('G18 but the wrong placement is ALLOWED to stand (GDD 31.1.8)',
     wrongPad.location.type === 'floor' && Math.abs(wrongPad.x - (pad2.x + 2)) < 1e-9);

  const offPad = placeBag(gg, 12, 26, { flightId: 'flight_AB221' });   // open floor: clear of both bays
  eq('G19 a bag on open floor scans neutral',
     scanBag(gg.state, offPad, gg.bus, 1000).verdict, 'neutral');

  eq('G20 scanning writes a trace event (GDD 7.4)', atl.scanHistory.length, 1);
  ok('G21 the trace is timestamped in simulation time', atl.scanHistory[0].simTimeMs === 1000);
  for (let i = 0; i < 40; i++) scanBag(gg.state, atl, gg.bus, 1000 + i);
  ok('G22 scan history stays bounded (GDD 24.1)', atl.scanHistory.length <= 12,
     `${atl.scanHistory.length}`);

  /* scanning is optional */
  const never = placeBag(gg, 24, 24);
  moveBag(gg.state, never, { type: 'carried', id: 'player_1' }, gg.bus, 0);
  releaseHeld(gg.state, gg.bus, 0);
  ok('G23 a bag can be moved and placed without ever being scanned',
     never.scanHistory.length === 0 && never.location.type === 'floor');
}
}

/* ── H. determinism and a full unattended shift ──────────────────────────── */
function sectionH() {
lines.push('--- H. determinism and the unattended shift ---');
{
  const a = newGame(2026); a.skipMs(180000);
  const b = newGame(2026); b.skipMs(180000);
  ok('H1 two games on one seed are identical after three minutes',
     JSON.stringify(a.describe()) === JSON.stringify(b.describe()),
     JSON.stringify(a.describe()) + '\n' + JSON.stringify(b.describe()));

  const c = newGame(2027); c.skipMs(180000);
  ok('H2 a different seed produces a different shift',
     JSON.stringify(a.describe()) !== JSON.stringify(c.describe()));

  a.startShift(); a.skipMs(180000);
  ok('H3 restart replays the same shift exactly',
     JSON.stringify(a.describe()) === JSON.stringify(b.describe()));

  // GDD 28.2: run a complete shift with no input and check nothing is lost.
  const g = newGame(5150);
  g.skipMs(g.state.shift.endTimeMs + 2000);
  const total = Object.keys(g.state.bagsById).length;
  const scheduled = g.state.shift.bagSchedule.length;
  eq('H4 an unattended shift spawns every scheduled bag', total, scheduled);
  eq('H5 no bag was duplicated', new Set(Object.values(g.state.bagsById).map((x) => x.id)).size, total);
  eq('H6 the containment invariant survived', assertContainment(g.state).length, 0);
  const counts = countByLocation(g.state);
  eq('H7 every bag is accounted for at the end',
     Object.values(counts).reduce((a, b) => a + b, 0), total);
  note(`unattended 10 min: ${total} bags -> ${counts.floor} on the floor, ${counts.conveyor} still on the belt`);

  ok('H8 the player never moved, because nothing told it to',
     Math.abs(g.state.player.x - g.state.world.spawn.x) < 0.01);

  /* pause must freeze the bags too, not just the clock */
  const p = newGame(77);
  p.skipMs(40000);
  const before = JSON.stringify(countByLocation(p.state));
  const beltBefore = p.state.world.conveyor.bagIds.map((id) => p.state.bagsById[id].location.t);
  p.setMode(MODES.PAUSED);
  drive(p, 120);
  const beltAfter = p.state.world.conveyor.bagIds.map((id) => p.state.bagsById[id].location.t);
  ok('H9 pausing freezes the conveyor, not only the clock',
     JSON.stringify(beltBefore) === JSON.stringify(beltAfter));
  eq('H10 and no bag spawns while paused', JSON.stringify(countByLocation(p.state)), before);

  /* performance: GDD 24.1 wants 100 active bags without material degradation */
  const perf = newGame(11);
  for (let i = 0; i < 100; i++) {
    placeBag(perf, 70 + (i % 10) * 0.8, 30 + Math.floor(i / 10) * 0.8);
  }
  const n = Object.values(perf.state.bagsById).filter((x) => x.location.type === 'floor').length;
  /* Best of three batches. The minimum is the honest estimator here: the harness shares a
   * box with whatever else is running, and a batch that lost the CPU measures the machine
   * rather than the game. Same 600 frames as before, read three times. */
  let perStep = Infinity;
  for (let r = 0; r < 3; r++) {
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) perf.frame(FRAME_MS, null);
    perStep = Math.min(perStep, (performance.now() - t0) / 200);
  }
  /* Gated on the RECORDED cost, not on the frame budget. "Under 4 ms" against a measured
   * 0.2 needed a twelvefold regression before it noticed — an O(n^2) pass over the bag
   * pile would have to be written twice to trip it. The baseline is the M1 figure in
   * CLAUDE.md (0.28 ms for 100 loose bags, 0.33 with three loaded carts); 3x leaves room
   * for a noisy box while catching anything that actually changed complexity. Re-measure
   * and move it deliberately when the step gains work — do not raise it to fit a red run. */
  const PERF_BASELINE_MS = 0.33;
  ok('H11 a hundred loose bags still cost about what they cost when this was measured',
     perStep < PERF_BASELINE_MS * 3,
     `${perStep.toFixed(3)} ms/step with ${n} loose bags, baseline ${PERF_BASELINE_MS}`);
  note(`100-bag simulation step: ${perStep.toFixed(3)} ms (baseline ${PERF_BASELINE_MS} ms, frame budget ${STEP.toFixed(2)} ms)`);
  eq('H12 and the pile did not corrupt anything', assertContainment(perf.state).length, 0);

  const escaped = Object.values(perf.state.bagsById)
    .filter((x) => x.location.type === 'floor' && isBlocked(x.x, x.y, 0));
  ok('H13 no bag was squeezed inside a wall', escaped.length === 0, `${escaped.length}`);
}
}

/* ── I. the live page ────────────────────────────────────────────────────── */
async function sectionI() {
  lines.push('--- I. the live page ---');
  const abc = window.__ABC;
  ok('I1 the game booted', !!(abc && abc.game));
  if (!abc) return;

  // MUST come first. Sections A-H are synchronous, and `await` on a synchronous
  // function only yields a MICROtask — which never lets an animation frame run. Without
  // this the boot loop had never executed, the canvas had never been sized, and the
  // render assertions below tested a 1x1 canvas full of nothing.
  await yieldToLoop();

  const { game, renderer, camera, hud, input } = abc;
  const banner0 = document.getElementById('err-banner');
  ok('I2 no error banner after boot', !banner0, banner0 && banner0.textContent);
  ok('I2b the real rAF loop ran and sized the canvas',
     game.frames >= 1 && camera.cssW > 1, `${game.frames} frames, cssW=${camera.cssW}`);

  abc.startShift();
  // Run until the belt has actually PUT something on the floor, bounded — rather than
  // assuming thirty seconds is enough. It was, for the 50-bag schedule; the M6 retune
  // spread 34 bags over a longer window and it stopped being true.
  const hasFloorBag = () =>
    Object.values(game.state.bagsById).some((b) => b.location.type === 'floor');
  for (let i = 0; i < 60 * 180 && !hasFloorBag(); i++) game.frame(FRAME_MS, null);
  ok('I3 bags exist once the belt has run',
     Object.keys(game.state.bagsById).length > 0, `${Object.keys(game.state.bagsById).length}`);

  camera.follow(game.state.player.x, game.state.player.y, 0);
  renderer.render(game.state);
  const px = renderer.ctx.getImageData(
    Math.floor(renderer.canvas.width / 2), Math.floor(renderer.canvas.height / 2), 1, 1).data;
  ok('I4 the world still paints', (px[0] + px[1] + px[2]) > 60, `rgb(${px[0]},${px[1]},${px[2]})`);

  /* One pixel of ground fill clears any brightness threshold on its own — delete every
   * bag, player and belt draw call and I4 stays green. So diff two whole frames with one
   * bag moved between them. Nothing else changes across the pair: no frame() runs, fx is
   * handed dt 0, and every animation in this renderer is derived from simulation values
   * that are not advancing. Any difference at all is that bag being drawn. */
  const drawTest = Object.values(game.state.bagsById).find((b) => b.location.type === 'floor');
  if (drawTest) {
    const bx = drawTest.x, by = drawTest.y;
    drawTest.x = game.state.player.x + 1.2; drawTest.y = game.state.player.y;
    renderer.render(game.state);
    const withBag = frameSignature(renderer);
    drawTest.x = bx; drawTest.y = by;
    renderer.render(game.state);
    ok('I4b and the bags in it are actually drawn, not just the floor under them',
       withBag !== frameSignature(renderer),
       `identical signature ${withBag} with the bag moved to the player's feet`);
  } else {
    ok('I4b and the bags in it are actually drawn, not just the floor under them',
       false, 'no floor bag to move');
  }

  /*
   * The zoom rule in closed form. `viewWidthM` is a CEILING on how much world is shown,
   * and MIN_PX_PER_M is a FLOOR under how big the writing gets; below a ~1290 px window
   * the floor wins and the camera shows less airport rather than shrinking a bag's tag
   * below legibility. Re-derived from cssW and the two constants, so it is falsifiable
   * at any window size — this used to assert the ceiling unconditionally and went red
   * on the harness's own 1262 px canvas the moment the floor arrived.
   */
  near('I5 the camera honours the readability zoom at this window width', camera.visibleM.w,
       Math.min(CONFIG.render.viewWidthM, camera.cssW / MIN_PX_PER_M), 0.01);
  ok('I5b a bag tag never renders below the legibility floor',
     camera.scale >= MIN_PX_PER_M - 1e-9,
     `${camera.scale.toFixed(1)} px/m across a ${camera.cssW} px window`);
  ok('I6 the camera stays inside the world',
     camera.centre.x >= camera.visibleM.w / 2 - 0.01 &&
     camera.centre.x <= WORLD.widthM - camera.visibleM.w / 2 + 0.01,
     `centre.x=${camera.centre.x.toFixed(1)}`);

  // put the player next to the pile and check the HUD reacts
  const conv = game.state.world.conveyor;
  const anyFloor = Object.values(game.state.bagsById).find((b) => b.location.type === 'floor');
  ok('I7 the belt delivered a bag to the floor unattended', !!anyFloor);
  if (anyFloor) {
    game.state.player.x = anyFloor.x - 0.8;
    game.state.player.y = anyFloor.y;
    game.state.player.aimX = 1; game.state.player.aimY = 0;
    game.frame(FRAME_MS, null);
    hud.update();
    ok('I8 the contextual prompt appears when a bag is in reach',
       document.getElementById('hudPrompt').classList.contains('on'),
       `target=${game.state.player.targetBagId}`);

    const inp = new Input(window);
    inp._debugPress('KeyE');
    game.frame(FRAME_MS, inp);
    hud.update();
    const heldId = game.state.player.carryingBagId;
    ok('I9 pressing E through the real input picks a bag up',
       !!heldId && game.state.bagsById[heldId].location.type === 'carried', `${heldId}`);
    ok('I10 the held-object indicator shows what is in hand',
       document.getElementById('hudHeld').classList.contains('on'));

    inp._debugPress('KeyQ');
    game.frame(FRAME_MS, inp);
    hud.update();
    ok('I11 the scanner card appears on a scan',
       document.querySelector('.scan-card').classList.contains('on'));
    ok('I12 and the card prints the bag tag',
       /BAG \d{6}/.test(document.querySelector('.scan-card').textContent),
       document.querySelector('.scan-card').textContent.slice(0, 40));
  }

  eq('I13 the live game never violated containment', assertContainment(game.state).length, 0);
  const banner = document.getElementById('err-banner');
  ok('I14 no error banner at the end of the run', !banner, banner && banner.textContent);
  void conv; void input;
}

/* ── J. the scanner countdown ────────────────────────────────────────────── */
/*
 * "DEPARTS IN mm:ss" is the one number on screen that tells a player how much shift a bag
 * has left, and its VALUE was asserted nowhere in this project — section I only ever
 * checked that the card prints a six-digit tag.
 *
 * src/ui/scannerCard.js picks `live ? live.times.departureMs : bag.expectedDepartureMs`,
 * which is the exact line GDD §16.6's assist corrupted: on Unhurried the card counted down
 * to the AUTHORED departure, reached 0:00 while the hold was still open, and disagreed
 * with the flight board next to it on the same screen. Combined with C5's tautology, the
 * countdown had no coverage at any difficulty at all.
 *
 * The expected value is derived from the authored time and the multiplier — the assist is
 * "a multiplier applied once, where the times are authored" — so nothing here reads back
 * the field the card read. The displayed text is parsed rather than re-formatted through
 * GameClock.formatMs, for the same reason (m0 B18-B21 owns the formatter).
 */
const parseClock = (s) => {
  const m = /^(\d+):(\d\d)$/.exec((s || '').trim());
  return m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 : NaN;
};

/** Scan the first bag of a shift at `assist` and read what the card actually printed. */
function shownCountdown(assist) {
  const g = newGame(4242, assist);
  // Bounded wait for the first arrival: WHEN a seeded bag spawns is a property of one
  // seed, not of the game.
  for (let i = 0; i < 400 && Object.keys(g.state.bagsById).length === 0; i++) g.skipMs(1000);
  const bag = Object.values(g.state.bagsById)[0];
  if (!bag) return { g, bag: null };

  const card = new ScannerCard(document.createElement('div'));   // detached: no DOM litter
  const read = () => {
    g.state.scan = { bagId: bag.id, atMs: g.state.simTimeMs, verdict: 'neutral', where: 'floor' };
    card.update(g.state);
    const node = card.el.querySelector('#scanCountdown');
    return node ? parseClock(node.textContent) : NaN;
  };
  const shownMs = read();
  g.skipMs(30000);
  const laterMs = read();
  card.destroy();

  // What the card SHOULD be counting down to: the authored departure, stretched once.
  const authored = flightById(bag.flightId).times.departureMs;
  const wantMs = Math.round(authored * assist) - g.state.simTimeMs + 30000;
  return { g, bag, shownMs, laterMs, wantMs, authored };
}

function sectionJ() {
lines.push('--- J. the scanner countdown (GDD 7.1, 16.6) ---');
{
  const std = shownCountdown(1);
  ok('J1 a scan card exists to read', !!std.bag, 'no bag ever spawned');
  if (!std.bag) return;
  // formatMs floors to whole seconds, so one second of slack is the whole tolerance.
  near('J2 the card counts down to this bag\'s real departure', std.shownMs, std.wantMs, 1000);
  near('J3 and it keeps counting down as the shift runs', std.shownMs - std.laterMs, 30000, 1200);

  const asst = shownCountdown(ASSIST_TOP);
  ok('J4 a scan card exists at the assisted difficulty too', !!asst.bag, 'no bag ever spawned');
  if (!asst.bag) return;
  near(`J5 and at assist ${ASSIST_TOP} it counts down to the STRETCHED departure`,
       asst.shownMs, asst.wantMs, 1000);
  // The guard: if the assist stopped reaching the card, J5 would still pass against an
  // unstretched number. It may not print the authored countdown at an assisted difficulty.
  const authoredLeft = asst.authored - (asst.g.state.simTimeMs - 30000);
  ok('J6 which is not the authored one, so J5 compared two different numbers',
     Math.abs(asst.shownMs - authoredLeft) > 1000,
     `showed ${(asst.shownMs / 1000).toFixed(0)}s, authored would be ${(authoredLeft / 1000).toFixed(0)}s`);
  note(`scanner countdown: ${(std.shownMs / 1000).toFixed(0)}s at assist 1, ${(asst.shownMs / 1000).toFixed(0)}s at assist ${ASSIST_TOP}`);
}
}

/* ── run ─────────────────────────────────────────────────────────────────── */
(async () => {
  const sections = [
    ['A', sectionA], ['B', sectionB], ['C', sectionC], ['D', sectionD], ['E', sectionE],
    ['F', sectionF], ['G', sectionG], ['H', sectionH], ['I', sectionI], ['J', sectionJ],
  ];
  for (const [name, fn] of sections) {
    emit(`RUNNING section ${name}...`);
    try { await fn(); }
    catch (e) { fails++; lines.push(`FAIL  section ${name} threw: ${(e && e.stack) || e}`); }
    emit(`RUNNING (section ${name} done)`);
  }
  emit();
})();
