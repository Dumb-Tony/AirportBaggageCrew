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
import { Rng } from '../src/core/rng.js';
import { SpatialGrid } from '../src/core/grid.js';
import { FLIGHT_DEFS, buildBagSchedule, gateConflicts, flightById } from '../src/data/flights.js';
import { createBag, WEIGHT_CLASSES } from '../src/entities/bag.js';
import { beltPos } from '../src/entities/conveyor.js';
import { moveBag, assertContainment, countByLocation, isLoose } from '../src/systems/containment.js';
import { moveWithWalls, applyFriction, separate, approach } from '../src/systems/physics.js';
import { findTarget, scanBag, throwHeld, releaseHeld } from '../src/systems/interaction.js';
import { STAGING_PADS, ZONES, CONVEYOR, isBlocked, zoneAt } from '../src/data/airport.js';

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

/** A headless game, mid-shift-ready. No canvas, no DOM. */
function newGame(seed = 4242) {
  const g = new Game({ seed, seedLabel: 'test' });
  g.startShift();
  return g;
}
/** Drive real frames through the same call main.js's rAF callback makes. */
const drive = (g, frames, input = null) => {
  for (let i = 0; i < frames; i++) g.frame(FRAME_MS, input);
};
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

  const late = FLIGHT_DEFS.filter((f) => f.times.departureMs > CONFIG.shift.durationMs);
  ok('A5 every flight departs inside the shift', late.length === 0, late.map((f) => f.number).join());

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

  const outside = s1.filter((b) => b.atMs < 0 || b.atMs > CONFIG.shift.durationMs);
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
  ok('B9 SK307 priority bags really do arrive late',
     skPri.every((b) => b.atMs > median),
     skPri.map((b) => b.atMs).join());

  for (const f of FLIGHT_DEFS) {
    const lateOnes = s1.filter((b) => b.flightId === f.id && b.atMs > f.times.finalCallMs);
    ok(`B10.${f.number} some bags arrive after final call`, lateOnes.length === f.twist.lateBags,
       `${lateOnes.length}`);
  }
}
}

/* ── C. identity ─────────────────────────────────────────────────────────── */
function sectionC() {
lines.push('--- C. bag identity (GDD 6.2, 22.1, 7.2) ---');
{
  const g = newGame(4242);
  g.skipMs(CONFIG.shift.durationMs);
  const bags = Object.values(g.state.bagsById);
  ok('C1 a full shift actually spawns its bags', bags.length > 40, `${bags.length}`);

  eq('C2 every bag id is unique', new Set(bags.map((b) => b.id)).size, bags.length);
  eq('C3 every printed tag number is unique', new Set(bags.map((b) => b.tag)).size, bags.length);
  ok('C4 tags are the six digits the GDD prints', bags.every((b) => /^\d{6}$/.test(b.tag)));

  const mismatched = bags.filter((b) => {
    const f = flightById(b.flightId);
    return b.destinationCode !== f.destinationCode || b.gateId !== f.gateId ||
           b.expectedDepartureMs !== f.times.departureMs;
  });
  ok('C5 a bag agrees with its own flight', mismatched.length === 0, `${mismatched.length}`);

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
  ok('C10 every bag starts active and undamaged',
     bags.every((b) => b.lifecycle === 'active' && b.condition === 'ok'));
  ok('C11 no bag has been credited to a flight yet (that is Milestone 3)',
     bags.every((b) => b.actualFlightId === null));
}
}

/* ── D. the containment invariant ────────────────────────────────────────── */
function sectionD() {
lines.push('--- D. one authoritative location (GDD 21.6, 31.1.10) ---');
{
  const g = newGame(7);
  g.skipMs(30000);
  const conv = g.state.world.conveyor;

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

  ok('D10 isLoose only means "on the floor"',
     isLoose({ location: { type: 'floor' } }) && !isLoose({ location: { type: 'carried' } }));

  // The real test: does the invariant survive a whole shift of the belt running?
  const g2 = newGame(1234);
  let worst = null;
  for (let i = 0; i < 60; i++) {
    g2.skipMs(10000);
    const bad = assertContainment(g2.state);
    if (bad.length && !worst) worst = `at ${g2.state.simTimeMs} ms: ${bad[0]}`;
  }
  ok('D11 the invariant holds across a full unattended shift', !worst, worst);
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

  const a = { x: 10, y: 10 }, b = { x: 10.2, y: 10 };
  ok('E6 overlapping circles are pushed apart', separate(a, b, 0.8, 0.5, 1.0));
  ok('E7 and they end up further apart than they started', Math.hypot(b.x - a.x, b.y - a.y) > 0.2);

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
    g.skipMs(2000);   // a fresh bag needs ~13 s to cross, so it cannot drop off mid-test
    near('F3 a bag advances at belt speed', first.location.t - t0, conv.speedMps * 2, 0.15);

    const p = beltPos(conv, first.location.t);
    near('F4 its drawn position follows the belt, x', first.x, p.x, 1e-6);
    near('F5 its drawn position follows the belt, y', first.y, p.y, 1e-6);
  }

  // The pressure test: nobody touches anything for a whole shift.
  const g2 = newGame(31);
  let minGap = Infinity;
  for (let i = 0; i < 120; i++) {
    g2.skipMs(5000);
    const belt = g2.state.world.conveyor.bagIds.map((id) => g2.state.bagsById[id].location.t);
    for (let k = 1; k < belt.length; k++) minGap = Math.min(minGap, Math.abs(belt[k - 1] - belt[k]));
  }
  ok('F6 bags never overlap on the belt', minGap >= CONFIG.bag.beltSpacingM * 0.98,
     `closest pair was ${minGap === Infinity ? 'n/a' : minGap.toFixed(3)} m`);

  ok('F7 the belt delivers without a player touching it', g2.state.world.conveyor.delivered > 30,
     `${g2.state.world.conveyor.delivered} delivered`);

  const counts = countByLocation(g2.state);
  ok('F8 delivered bags end up on the floor, not deleted', counts.floor > 30, `${counts.floor}`);
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
  g.skipMs(CONFIG.shift.durationMs);
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
  const t0 = performance.now();
  for (let i = 0; i < 600; i++) perf.frame(FRAME_MS, null);
  const perStep = (performance.now() - t0) / 600;
  ok('H11 a hundred loose bags cost well under a frame budget', perStep < 4,
     `${perStep.toFixed(3)} ms/step with ${n} loose bags`);
  note(`100-bag simulation step: ${perStep.toFixed(3)} ms (budget ${STEP.toFixed(2)} ms)`);
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
  for (let i = 0; i < 60 * 30; i++) game.frame(FRAME_MS, null);   // 30 s of shift
  ok('I3 bags exist after thirty seconds of play',
     Object.keys(game.state.bagsById).length > 0, `${Object.keys(game.state.bagsById).length}`);

  camera.follow(game.state.player.x, game.state.player.y, 0);
  renderer.render(game.state);
  const px = renderer.ctx.getImageData(
    Math.floor(renderer.canvas.width / 2), Math.floor(renderer.canvas.height / 2), 1, 1).data;
  ok('I4 the world still paints', (px[0] + px[1] + px[2]) > 60, `rgb(${px[0]},${px[1]},${px[2]})`);

  near('I5 the camera is at the readability zoom', camera.visibleM.w, CONFIG.render.viewWidthM, 0.6);
  ok('I6 the camera stays inside the world',
     camera.centre.x >= camera.visibleM.w / 2 - 0.01 &&
     camera.centre.x <= 120 - camera.visibleM.w / 2 + 0.01,
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

/* ── run ─────────────────────────────────────────────────────────────────── */
(async () => {
  const sections = [
    ['A', sectionA], ['B', sectionB], ['C', sectionC], ['D', sectionD], ['E', sectionE],
    ['F', sectionF], ['G', sectionG], ['H', sectionH], ['I', sectionI],
  ];
  for (const [name, fn] of sections) {
    emit(`RUNNING section ${name}...`);
    try { await fn(); }
    catch (e) { fails++; lines.push(`FAIL  section ${name} threw: ${(e && e.stack) || e}`); }
    emit(`RUNNING (section ${name} done)`);
  }
  emit();
})();
