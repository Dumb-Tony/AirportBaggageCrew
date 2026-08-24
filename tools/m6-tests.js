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
import { createBag, WEIGHT_CLASSES } from '../src/entities/bag.js';
import { memoryStorage, SaveSystem } from '../src/systems/save.js';
import { moveBag, assertContainment, countByLocation } from '../src/systems/containment.js';
import { validateChain } from '../src/systems/hitching.js';
import { aircraftHoldZone, holdContains } from '../src/entities/aircraft.js';
import { FLIGHT_DEFS, gateConflicts, standWindow } from '../src/data/flights.js';
import { WALLS, BOUNDS, ANCHORS, STANDS, rectContains, isBlocked } from '../src/data/airport.js';
import { stateAt, isHoldOpen } from '../src/systems/flightSchedule.js';
import { setPlacard } from '../src/systems/interaction.js';
import { createScore, scoreFlight } from '../src/systems/scoring.js';
import { FlightBoard } from '../src/ui/flightBoard.js';
import { playShift, SKILLS, CrewBot } from './_bot.js';
import { fuzzShift, guidedFuzz, restartTorture, recoverFuzz, recoverSpillProbe }
  from './_invariants.js';

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
/**
 * THE DETERMINISM CONTRACT, DEEPER THAN `describe()`.
 *
 * `Game.describe()` carries counts, the player pose, the carts, the vehicles, the aircraft
 * and the flight outcomes — and not one BAG coordinate. Bags are the largest entity
 * population in the game, so "a restarted shift replays the fresh one exactly" (C13) and
 * "ten seconds of frames while paused change nothing" (C6) were both blind to the biggest
 * moving thing in the airport: a bag drifting a millimetre behind the pause card, or one
 * loose bag landing a centimetre off on a replay, matched to the byte either way.
 *
 * m7 C11 found the same hole for AIRCRAFT and closed it for aircraft only, saying so in a
 * note; the same argument applies here and this closes it for bags.
 */
function snapshot(g, opts = {}) {
  const s = g.state;
  const r = (v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v);
  const d = g.describe();
  // `frames` counts RENDER frames, which keep climbing while paused because the page is
  // still painting the pause card. C6 is about the simulation, so it drops that field.
  if (opts.noFrames) delete d.frames;
  return JSON.stringify({
    describe: d,
    bags: Object.values(s.bagsById).map((b) => ({
      id: b.id, x: r(b.x), y: r(b.y), vx: r(b.vx), vy: r(b.vy), rot: r(b.rot),
      loc: b.location.type, of: b.location.id || null, life: b.lifecycle,
    })),
    aim: { x: r(s.player.aimX), y: r(s.player.aimY), charge: r(s.player.chargeMs) },
    targets: { bag: s.player.targetBagId || null, cart: s.player.targetCartId || null,
               hold: s.player.targetHoldId || null },
    scan: s.scan || null,
    guide: s.guide || null,
  });
}

/**
 * REACHABILITY ON FOOT, by flood fill from the crew's spawn.
 *
 * E6/E7 used to promise exactly this in their comment — "on the spawn side of the wall, or
 * the far side with the door between them" — and then check `!inWall(x, y)`, which is a
 * different claim with no path search and no door test in it. Wall the doorway off
 * completely and all nine assertions stayed green; and m0 F11 already checks every anchor
 * for sitting inside a wall, so they were a duplicate of a weaker test as well.
 *
 * A grid flood fill over the real `isBlocked` is the assertion that comment describes. The
 * cell is 0.25 m and the probe carries the PLAYER'S OWN RADIUS, so a gap the crew cannot
 * physically fit through does not count as reachable: measured, sealing the 6 m sort-room
 * door — or merely narrowing it to 0.5 m — drops the reachable set from 118734 cells to
 * 13440 and turns the tractor park and both gates red. That is the failure §29 means by
 * "no known blocker can make a required bag permanently unreachable".
 *
 * STATIC GEOMETRY ONLY. Aircraft and carts are entities, they move, and a cart parked
 * across the door is a situation the player made and can undo.
 */
function reachableOnFoot(cellM = 0.25, radius = CONFIG.player.radiusM) {
  const cols = Math.ceil(BOUNDS.w / cellM), rows = Math.ceil(BOUNDS.h / cellM);
  const cellOf = (x, y) => [Math.floor((x - BOUNDS.x) / cellM), Math.floor((y - BOUNDS.y) / cellM)];
  const key = (cx, cy) => cy * cols + cx;
  const midX = (cx) => BOUNDS.x + (cx + 0.5) * cellM;
  const midY = (cy) => BOUNDS.y + (cy + 0.5) * cellM;

  const seen = new Set();
  const [sx, sy] = cellOf(ANCHORS.playerSpawn.x, ANCHORS.playerSpawn.y);
  const stack = [[sx, sy]];
  seen.add(key(sx, sy));
  while (stack.length) {
    const [cx, cy] = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const k = key(nx, ny);
      if (seen.has(k) || isBlocked(midX(nx), midY(ny), radius)) continue;
      seen.add(k); stack.push([nx, ny]);
    }
  }
  return {
    cells: seen.size, of: cols * rows,
    has: (x, y) => { const [cx, cy] = cellOf(x, y); return seen.has(key(cx, cy)); },
  };
}

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
  // Where it was let go of: a carried bag is PINNED to the hands, so this is its position
  // on the step before the release edge is consumed.
  const from = { x: bag.x, y: bag.y };
  g.frame(FRAME_MS, input);
  eq('A7 and throw it', g.state.player.carryingBagId, null);

  /* "and it travels" was `Math.hypot(vx, vy) > 0 || location.type === 'floor'`. A throw
     that imparted ZERO velocity leaves the bag lying on the floor — the right-hand branch —
     so the condition covered the failure exactly as well as the success and could not go
     red. Assert the SPEC number instead: CONFIG.bag.throwMinSpeed is what a bare tap
     produces, and this was a 40-frame charge, which is a full heave. */
  const launched = Math.hypot(bag.vx, bag.vy);
  ok('A8 and it leaves the hands at throwing speed', launched >= CONFIG.bag.throwMinSpeed,
    `${launched.toFixed(2)} m/s against a ${CONFIG.bag.throwMinSpeed} m/s tap`);
  for (let i = 0; i < 20 && bag.location.type === 'floor'; i++) g.frame(FRAME_MS, input);
  const flew = Math.hypot(bag.x - from.x, bag.y - from.y);
  ok('A8b and covers metres of floor, not millimetres', flew > 1, `${flew.toFixed(2)} m`);
  note(`      charged throw: ${launched.toFixed(1)} m/s off the hands, ` +
       `${flew.toFixed(1)} m in the first third of a second`);

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
  /* A16 is only as good as the window it compares, and THAT is where the double-booking
     hid. `w.to > w.from` was true the moment acceptance precedes departure, which the
     timetable guarantees for every flight — three assertions that could not go red.
     The claim worth making is the one the helper exists for (CLAUDE.md: "a gate is occupied
     for longer than acceptance-to-departure"): the window has to be STRICTLY WIDER than the
     scheduled one at both ends, and wider by the taxi-in and the pushback specifically. The
     narrower comparison passed happily while SK307 was arriving before AB221 had left. */
  for (const f of FLIGHT_DEFS) {
    const w = standWindow(f), t = f.times;
    ok(`A17.${f.number} occupies its stand from taxi-in to the end of pushback`,
      w.from < t.bagAcceptanceMs && w.to > t.departureMs &&
      w.from === t.bagAcceptanceMs - CONFIG.flight.taxiInMs &&
      w.to === t.departureMs + CONFIG.flight.pushbackMs,
      `stand ${w.from}..${w.to} against a scheduled ${t.bagAcceptanceMs}..${t.departureMs}`);
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
  /* The REAL bag width, and in the unit the criterion is written in. `0.72` was a hardcoded
     duplicate of `WEIGHT_CLASSES.normal.w`, so a bag resize would have gone unnoticed, and
     `0.72 / 46 > 1/80` was three constants arguing among themselves — a ratio nobody can
     picture. State the budget the way CLAUDE.md states it ("viewWidthM is set so a 0.72 m
     bag is ~19 px and its tag text is legible"): pixels, at a desktop width, which is what
     §29's "legible at desktop resolution" is about. The old 62 m zoom gives 14.9 px. */
  const DESKTOP_PX = 1280;
  const bagW = WEIGHT_CLASSES.normal.w;
  const bagPx = (bagW / CONFIG.render.viewWidthM) * DESKTOP_PX;
  ok('C2 a bag is at least 15 px across at a desktop width, so its tag can be read',
    bagPx >= 15, `${bagPx.toFixed(1)} px`);
  note(`      a ${bagW} m bag is ${bagPx.toFixed(1)} px across at ${DESKTOP_PX} px wide ` +
       `and ${CONFIG.render.viewWidthM} m of view`);

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
  // Through `snapshot()` rather than `describe()`: "pause is total" is a claim about every
  // moving thing, and loose bags are the largest population of moving things there is.
  const sim = () => snapshot(g, { noFrames: true });
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

  /* Overlapping carts must not decide for you. Two carts on the same square metre used to
     be resolved by whichever was a centimetre nearer, so with a bag in hand the choice
     between Atlanta's cart and Chicago's came down to nothing you could see. */
  const ov = newGame(); ov.startShift();
  const c1 = ov.state.cartsById.cart_1, c2 = ov.state.cartsById.cart_2;
  const inputC = new Input(window);
  setPlacard(ov.state, c1, 'flight_AB221', ov.bus, 0);
  setPlacard(ov.state, c2, 'flight_MC184', ov.bus, 0);
  // Park them almost on top of each other, with the WRONG one marginally nearer.
  c1.x = 20; c1.y = 20; c1.rot = 0;
  c2.x = 20.6; c2.y = 20; c2.rot = 0;
  ov.state.player.x = 20.9; ov.state.player.y = 20;

  const atl = makeBag(ov, 'flight_AB221', { x: 20.9, y: 20 });
  moveBag(ov.state, atl, { type: 'carried', id: ov.state.player.id }, ov.bus, 0);
  ov.frame(FRAME_MS, inputC);
  eq('C14 holding an ATL bag between two carts targets the ATL one',
    ov.state.player.targetCartId, c1.id);
  inputC._debugPress('KeyE'); ov.frame(FRAME_MS, inputC); inputC._debugRelease('KeyE');
  ok('C15 and E loads it there, not into the nearer neighbour',
    c1.bagIds.includes(atl.id) && !c2.bagIds.includes(atl.id));

  // With hands empty there is no intent to read, so nearest still wins — and a wrong
  // load is still allowed when no matching cart is in reach (GDD §31.1.8).
  ov.frame(FRAME_MS, inputC);
  eq('C16 with empty hands the nearest cart wins again', ov.state.player.targetCartId, c2.id);
  const ord = makeBag(ov, 'flight_MC184', { x: 20.9, y: 20 });
  moveBag(ov.state, ord, { type: 'carried', id: ov.state.player.id }, ov.bus, 0);
  c2.bagIds.length = 0;
  for (let i = 0; i < c2.capacitySlots; i++) {
    const filler = makeBag(ov, 'flight_MC184', { x: c2.x, y: c2.y });
    moveBag(ov.state, filler, { type: 'cart', id: c2.id }, ov.bus, 0);
  }
  ov.frame(FRAME_MS, inputC);
  // A FULL matching cart earns no preference — the rule is "matching AND has room". The
  // fallback is plain nearest, which here is still the full one, and E then sets the bag
  // down rather than quietly loading it into the other flight's cart. Dropping is the
  // right failure: a silent misroute would be the game deciding for you.
  eq('C17 a full matching cart earns no preference', ov.state.player.targetCartId, c2.id);
  const atlCartBefore = c1.bagIds.length;
  inputC._debugPress('KeyE'); ov.frame(FRAME_MS, inputC); inputC._debugRelease('KeyE');
  eq('C18 and E sets the bag down instead of misrouting it', ord.location.type, 'floor');
  eq('C19 the other cart is untouched', c1.bagIds.length, atlCartBefore);

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
  // Bag coordinates included. A restart that left one loose bag a centimetre off matched to
  // the byte through `describe()`, which carries no bag position at all.
  eq('C13 and a restarted shift replays the fresh one exactly', snapshot(a), snapshot(fresh));
}

/* ── D. §29 QUALITY: can it be played, and does anything strand you? ─────── */
function sectionD() {
lines.push('--- D. GDD §29 Quality: a shift somebody played ---');

  // The closest a suite gets to §28.3's usability playtest: CrewBot drives the real
  // input path — walking, grabbing, placarding, hitching, driving, loading holds.
  /* THREE SEEDS, and the balance claims gate on the MEDIAN of them.
   *
   * One seed is one shift. D3's "60%" was measured on seed 12345 alone, where the crew
   * happens to manage 79% — so the margin it was defending was a property of that seed, and
   * a seed that stranded the crew once would have turned a green suite red with nothing
   * having changed. Worse, `tools/_balance.js`, which only MEASURES, ran three seeds while
   * the suite that GATES ran one. It now runs the same three, and takes the middle result:
   * a median survives one unlucky shift and still moves when the balance really does. */
  const SEEDS = [12345, 777, 2468];
  const SKILL_ORDER = ['novice', 'average', 'veteran'];
  const runs = {};
  const results = [];
  const played = {};                 // the game objects, kept — see D13 below
  for (const skill of SKILL_ORDER) {
    runs[skill] = SEEDS.map((seed) => {
      const g = newGame(seed);
      const r = playShift(g, new Input(window), skill);
      played[`${skill}.${seed}`] = g;
      results.push({ seed, r });
      return r;
    });
  }
  // Three samples, so the middle one after sorting IS the median.
  const midBy = (skill, field) => [...runs[skill]].sort((a, b) => a[field] - b[field])[1];
  const med = (skill, field) => midBy(skill, field)[field];

  for (const skill of SKILL_ORDER) {
    SEEDS.forEach((seed, i) => {
      const r = runs[skill][i];
      note(`      ${r.skill.padEnd(8)} seed ${String(seed).padEnd(6)} ${r.correct}/${r.owed} ` +
           `delivered (${r.pct}%), ${r.points} points, ${r.bot.hauls} cart trips, ` +
           `${(r.bot.walkedM).toFixed(0)} m walked, ${(r.bot.drivenM).toFixed(0)} m driven`);
    });
    note(`      ${skill.padEnd(8)} MEDIAN of ${SEEDS.length}: ${med(skill, 'pct')}% ` +
         `and ${med(skill, 'points')} points`);
  }

  // "No known blocker can make a required bag permanently unreachable."
  for (const { seed, r } of results) {
    // `ok`, not `eq`: eq takes three arguments, so the JSON detail on the end of this was
    // being dropped on the floor and a failure printed "got 8, want 0" with no hint of
    // WHERE the crew was stranded. Same shape as the m4 E6 bug the suite meta-audit found.
    ok(`D1.${r.skill}.${seed} nothing stranded the crew`, r.bot.deadEnds.length === 0,
      `${r.bot.deadEnds.length} stranded: ${JSON.stringify(r.bot.deadEnds.slice(0, 3))}`);
    // §29 forbids a bag being PERMANENTLY unreachable. One that has ridden on down the
    // belt by the time you get there is not that — the bot sets it aside and comes back,
    // and D9/D10 prove every bag is eventually accounted for. A real blocker would be one
    // the crew reaches for over and over and never gets.
    ok(`D2.${r.skill}.${seed} out-of-reach arrivals stay incidental`,
      r.bot.unreachable <= Math.max(3, r.bot.bagsCarried * 0.15),
      `${r.bot.unreachable} misses against ${r.bot.bagsCarried} pickups`);
  }

  // The shift has to be WINNABLE — the M6 balance target. A competent crew clears most
  // of it and scores positive; an unskilled one does not. Both halves matter: a game
  // nobody can finish is broken, and one anybody can finish has no pressure.
  ok('D3 a competent crew delivers most of the shift', med('average', 'pct') >= 60,
    `median ${med('average', 'pct')}% of ${runs.average.map((r) => r.pct + '%').join(', ')}`);
  ok('D4 and finishes in credit', med('average', 'points') > 0,
    `median ${med('average', 'points')} of ${runs.average.map((r) => r.points).join(', ')}`);
  ok('D5 a careless one does not', med('novice', 'pct') < med('average', 'pct'),
    `novice ${med('novice', 'pct')}% vs average ${med('average', 'pct')}%`);
  ok('D6 nobody clears it without trying', med('novice', 'points') < 0,
    `median ${med('novice', 'points')} of ${runs.novice.map((r) => r.points).join(', ')}`);
  const avgMid = midBy('average', 'pct');
  ok('D7 every flight gets a share of the crew',
    avgMid.perFlight.every((f) => f.correct > 0),
    JSON.stringify(avgMid.perFlight));

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

  /*
   * ⚠ GDD §11.3'S ODD STATISTIC HAS TO BE A STATISTIC, AND ONLY A WHOLE SHIFT CAN TELL.
   *
   * "Cart corners taken above safe speed" read 168 a shift — one every three and a half
   * seconds — against 5.7 bags actually shed. Both numbers cannot describe the same thing.
   * Steering is binary, so every course correction is full lock, and full lock above about
   * 2.6 m/s with a loaded cart clears the lateral threshold: the counter was counting
   * KEYSTROKES. `CORNER_COUNTS_AT` fixed it by requiring an overload to have cost a
   * quarter of the cart's grip first, which gives 22 against 5.7.
   *
   * m2 F6c already bounds corners against spills and could not see this: its scenario is a
   * full-lock circle at top speed, which is ONE long overload episode, and `overLimit` is a
   * once-per-episode latch. The artefact only appears across hundreds of brief corrections,
   * which means across a played shift. `tools\_mutate.ps1` set CORNER_COUNTS_AT to 0 and
   * m2 (159), m4 (131) and m6 (180) all stayed green.
   *
   * The bound is deliberately loose — this is not a tuning assertion, it is the difference
   * between a statistic and a keyboard trace. Measured 7.4x on this shift (37 corners, 5
   * spills); the bug gives about 33x, because it counts every overload entry and there are
   * 168 of those a shift. 15x sits cleanly between the two with room either side.
   */
  const cg = played['average.12345'];
  const hardCorners = cg.state.stats.hardCorners;
  const spilled = Object.values(cg.state.cartsById).reduce((n, c) => n + c.spills, 0);
  ok('D13.pre the played shift really cornered hard and really shed load',
     hardCorners > 0 && spilled > 0, `${hardCorners} corners, ${spilled} spills`);
  ok('D13 §11.3 counts near-losses, not keystrokes: hard corners stay within 15x of spills',
     hardCorners <= Math.max(1, spilled) * 15,
     `${hardCorners} corners against ${spilled} spills — ` +
     `${(hardCorners / Math.max(1, spilled)).toFixed(1)}x, and a counter that ticks every ` +
     'few seconds is noise rather than an odd statistic');
  note(`      §11.3 over a played shift: ${hardCorners} hard corners, ${spilled} spills ` +
       `(${(hardCorners / Math.max(1, spilled)).toFixed(1)}x)`);
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
  note(`      ${bagCount} bags, ${STEPS} steps: ${perStep.toFixed(3)} ms per step ` +
       `(budget ${CONFIG.sim.stepMs.toFixed(2)} ms) — ${(CONFIG.sim.stepMs / perStep).toFixed(0)}x headroom`);

  /* TWO gates, because the budget one alone is nearly unfailable. A quarter of the frame
     budget is 4.17 ms and this measures 0.079 — a 53x regression could land here in total
     silence, and the printed headroom line is the part anybody actually reads.
     So the budget check stays (it is §29's own criterion) and the regression gate is the
     RECORDED baseline with room for a loaded machine: this box runs several agents at once
     and the same measurement has been seen at 0.119 ms under that load, so 25x is generous
     and still catches an order of magnitude. Move the baseline deliberately, in the same
     commit as whatever made it move. */
  const E2_BASELINE_MS = 0.079;    // CLAUDE.md M6: 124 bags and three loaded carts, per step
  ok('E2 a step with 100+ bags fits the frame budget', perStep < CONFIG.sim.stepMs / 4,
    `${perStep.toFixed(3)} ms/step`);
  ok('E2b and is still within 25x of the recorded per-step baseline',
    perStep < E2_BASELINE_MS * 25,
    `${perStep.toFixed(3)} ms against a ${E2_BASELINE_MS} ms baseline`);
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

  /* Every place a bag must be able to reach has to be REACHABLE ON FOOT from where the crew
     starts. That is a path question and it used to be answered with `!inWall(x, y)` — no
     path search, no door test, and a duplicate of m0 F11, which already checks every anchor
     for sitting inside a wall. Sealing the doorway left all nine green.
     `reachableOnFoot` walks the real `isBlocked` from `ANCHORS.playerSpawn` with the
     player's own radius, so these now fail if the only route is ever closed off — and they
     subsume the old check, since a point inside a wall is never reached. */
  const walk = reachableOnFoot();
  note(`      ${walk.cells} of ${walk.of} grid cells are walkable from the crew's spawn ` +
       `(0.25 m cells, ${CONFIG.player.radiusM} m body). Sealing the sort-room door drops ` +
       `that to 13440 and strands both gates.`);
  const wp = [
    ['conveyorEnd', ANCHORS.conveyorEnd], ['cartBay1', ANCHORS.cartBay1],
    ['cartBay2', ANCHORS.cartBay2], ['cartPark', ANCHORS.cartPark],
    ['tractorPark', ANCHORS.tractorPark], ['gate1Hold', ANCHORS.gate1Hold],
    ['gate2Hold', ANCHORS.gate2Hold],
  ];
  for (const [name, p] of wp) {
    ok(`E6 ${name} (${p.x},${p.y}) is walkable from the crew's spawn`, walk.has(p.x, p.y));
  }
  for (const s of STANDS) {
    ok(`E7 ${s.id} hold door is walkable from the crew's spawn`, walk.has(s.hold.x, s.hold.y));
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
  // `modules: true, // this file is one` was a LITERAL, and the loop below asserted it —
  // the only assertion in the project whose condition was a constant. Ask the browser the
  // question instead: HTMLScriptElement.supports('module') is the real feature detection,
  // it can answer false, and it is what a cross-browser surface check is supposed to be.
  const need = {
    canvas2d: !!document.createElement('canvas').getContext('2d'),
    modules: typeof HTMLScriptElement !== 'undefined' &&
             typeof HTMLScriptElement.supports === 'function' &&
             HTMLScriptElement.supports('module') === true,
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
  // TWO runs, because they answer two different questions and weakening one to satisfy
  // the other would have thrown away information. At a real tremor the game must not
  // break; at a gentle one the crew must still complete the loop, which is what puts the
  // fuzz through loading, misrouting and hold closure at all.
  const rough = guidedFuzz(7, 0.02);
  ok('H5a a real tremor raises no error', !rough.threw,
    rough.threw && String(rough.threw).split('\n')[0]);
  eq('H5b and violates no invariant', rough.violations.length, 0,
    JSON.stringify(rough.violations.slice(0, 2)));
  const gz = guidedFuzz(11, 0.005);
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

  /*
   * ⚠ THE RECOVER VERB, WHICH HAD A PURPOSE-BUILT PROBER THAT NO GATING SUITE RAN.
   *
   * `recoverStuck` must re-seat the train before it returns, because its pushes are
   * teleports and it runs LATER in the step than `updateTrain` — without that, the next
   * step's constraint snap is differenced as motion and one press of X throws a bag off a
   * train standing perfectly still. `_invariants.js` has `recoverFuzz` and
   * `recoverSpillProbe` written specifically for it, and `tools\_soak.js` was the only
   * caller. Soak MEASURES; it does not gate.
   *
   * `tools\_mutate.ps1` reverted the re-seat and the whole project stayed green: m7 159,
   * m6 180. A prober for a known bug, sitting in a diagnostic, is not coverage — so both
   * are now wired in here, where a red run fails the build.
   *
   * H12 is the one that matters and it is an A/B: two identical worlds, one loaded train
   * standing still in each, and one press of X between them. Measured with the bug in
   * place, stability 1 and 3 aboard became 0.875 and 2 aboard with nobody touching the
   * throttle.
   */
  for (const seed of [5, 555]) {
    const rf = recoverFuzz(seed);
    ok(`H10.${seed} X pressed at every bad moment raises no error`, !rf.threw,
       rf.threw && String(rf.threw).split('\n')[0]);
    eq(`H11.${seed} and violates no invariant`, rf.violations.length, 0,
       JSON.stringify(rf.violations.slice(0, 2)));
    note(`      seed ${seed}: ${rf.presses} presses of X, ${rf.recovered} un-stuck something, ` +
         `${rf.delivered} delivered, ${rf.spills} spills (${rf.spillsAfterRecover} within 2 steps of a recover)`);
  }
  const probe = recoverSpillProbe();
  ok('H12.pre the isolated probe really set up a loaded train, so the A/B is not vacuous',
     probe.withX.ok && probe.withoutX.ok && probe.withX.before.aboard > 0 &&
     Math.abs(probe.withX.speedBefore) < 0.01,
     `${probe.withX.why || probe.withoutX.why || ''} aboard=${probe.withX.ok && probe.withX.before.aboard}, ` +
     `speed=${probe.withX.ok && probe.withX.speedBefore}`);
  eq('H12 one press of X sheds nothing from a train standing perfectly still',
     probe.spilledOnRecover, 0,
     `with X: ${JSON.stringify(probe.withX.after)}  without: ${JSON.stringify(probe.withoutX.after)}`);
  if (probe.withX.ok) {
    note(`      wedged train, X vs no X: aboard ${probe.withoutX.after.aboard} -> ` +
         `${probe.withX.after.aboard}, stability ${probe.withoutX.after.stability} -> ` +
         `${probe.withX.after.stability}`);
  }
}

/* ── I. GDD requirements a conformance pass found missing ────────────────── */
function sectionI() {
lines.push('--- I. GDD §24.3 recover, §23.1 onboarding flag, §20.2 priority penalty ---');

  /* §24.3: "Provide a recover/stuck action for tractor and player." Nothing implemented
     it, and `exitVehicle` could put you inside a wall — from where `moveWithWalls` will
     never commit a move in ANY direction, so the game reads as frozen. */
  const g = newGame(); g.startShift();
  const input = new Input(window);
  const p = g.state.player;

  /* The wedge point is DERIVED from the wall, not typed in. `33.7, 30` with a comment
     saying "inside room_e2, x 33.4-34.0" was a copy of two numbers that live in
     data/airport.js, and a 10 cm move of the sort-room wall would have left this poking at
     open floor and quietly testing nothing. */
  const room = WALLS.find((w) => w.id === 'room_e2');
  const wedgePoint = { x: room.x + room.w / 2, y: room.y + room.h / 2 };
  p.x = wedgePoint.x; p.y = wedgePoint.y;
  g.frame(FRAME_MS, input);
  // Not "a player can end up inside a wall" — the test had just put them there, so that
  // was asserting its own setup. What a step must NOT do is quietly teleport them out:
  // if it did, I2's "no amount of walking moves them" would be measuring nothing.
  ok('I1 a simulation step does not eject a player already inside a wall',
    WALLS.some((w) => rectContains(w, p.x, p.y)), `${p.x.toFixed(2)},${p.y.toFixed(2)}`);
  const wedged = { x: p.x, y: p.y };
  input._debugPress('KeyD');
  for (let i = 0; i < 60; i++) g.frame(FRAME_MS, input);
  input._debugRelease('KeyD');
  ok('I2 and from in there no amount of walking moves them',
    Math.hypot(p.x - wedged.x, p.y - wedged.y) < 0.01,
    `moved ${Math.hypot(p.x - wedged.x, p.y - wedged.y).toFixed(3)} m`);

  input._debugPress('KeyX'); g.frame(FRAME_MS, input); input._debugRelease('KeyX');
  ok('I3 X frees them', !WALLS.some((w) => rectContains(w, p.x, p.y)),
    `${p.x.toFixed(2)},${p.y.toFixed(2)}`);
  input._debugPress('KeyD');
  for (let i = 0; i < 30; i++) g.frame(FRAME_MS, input);
  input._debugRelease('KeyD');
  // Let the walk bleed off before sampling: the player decelerates over several frames,
  // and a residual velocity would show up as "X moved me" in I5.
  for (let i = 0; i < 40; i++) g.frame(FRAME_MS, input);
  ok('I4 and they can walk again', Math.hypot(p.x - wedged.x, p.y - wedged.y) > 0.3);

  // It is an escape hatch, not a movement ability: pressed when nothing is stuck it
  // must do nothing at all, or it becomes a free sidestep.
  g.frame(FRAME_MS, input);
  const free = { x: p.x, y: p.y };
  input._debugPress('KeyX'); g.frame(FRAME_MS, input); input._debugRelease('KeyX');
  ok('I5 pressing X when nothing is stuck does nothing',
    Math.abs(p.x - free.x) < 0.01 && Math.abs(p.y - free.y) < 0.01);

  // The tractor half of §24.3, and the train with it.
  const v = g.state.vehiclesById.tractor_1;
  input._debugRelease('KeyX');
  g.state.player.x = v.x; g.state.player.y = v.y;
  g.frame(FRAME_MS, input);
  input._debugPress('KeyF'); g.frame(FRAME_MS, input); input._debugRelease('KeyF');
  eq('I6 aboard the tractor', g.state.player.drivingId, v.id);
  v.x = wedgePoint.x; v.y = wedgePoint.y;
  g.frame(FRAME_MS, input);
  input._debugPress('KeyX'); g.frame(FRAME_MS, input); input._debugRelease('KeyX');
  ok('I7 X frees a wedged tractor too', !WALLS.some((w) => rectContains(w, v.x, v.y)),
    `${v.x.toFixed(2)},${v.y.toFixed(2)}`);
  eq('I8 and stops it dead rather than firing it out', v.speed, 0);

  /* §23.1 lists an "onboarding complete flag" among the three things localStorage is
     for. Without it the seven-step rail restarts on every single shift, forever. */
  const store = memoryStorage();
  const a = new Game({ seed: 5, seedLabel: 't', storage: store });
  a.startShift();
  // `!!a.guideView || a.guide.enabled` never needed its left branch: `guide.enabled`
  // defaults true and I14 asserts that separately, so the whole condition was one default
  // wearing a disjunction. The claim is that the rail is ON SCREEN, which means a live view
  // with text in it — and `guideView` is written inside step(), so run one.
  a.step(FRAME_MS, a.state.simTimeMs, null);
  ok('I9 a first shift shows the rail', !!a.guideView && !!a.guideView.text,
    JSON.stringify(a.guideView));
  a.guide.index = 999;                       // as if the player worked through it
  a.step(FRAME_MS, a.state.simTimeMs, null);
  ok('I10 finishing it marks the guide complete', a.guide.complete);
  ok('I11 and that is remembered', new SaveSystem(store).loadOnboarded());

  const b = new Game({ seed: 5, seedLabel: 't', storage: store });
  b.startShift();
  eq('I12 so the next shift does not re-teach it', b.guide.enabled, false);
  eq('I13 and shows no rail', b.guideView, null);

  const fresh = new Game({ seed: 5, seedLabel: 't', storage: memoryStorage() });
  fresh.startShift();
  eq('I14 a player who has never played still gets it', fresh.guide.enabled, true);

  /* §20.2 asks for a priority bag "bonus/penalty". Only the bonus existed, so a priority
     bag you LOST cost exactly what any other lost bag cost. */
  ok('I15 a priority miss carries its own penalty', CONFIG.score.priorityMissPenalty < 0);
  const s = createScore();
  const plain = { correct: 0, correctPriority: 0, misrouted: 0, missed: 2, priorityMissed: 0 };
  const withPri = { correct: 0, correctPriority: 0, misrouted: 0, missed: 2, priorityMissed: 1 };
  const f1 = { id: 'x', number: 'X', destinationCode: 'X', expectedCount: 2, outcome: plain };
  const f2 = { id: 'y', number: 'Y', destinationCode: 'Y', expectedCount: 2, outcome: withPri };
  const g1 = newGame(); g1.state.score = createScore();
  scoreFlight(g1.state, f1);
  const afterPlain = g1.state.score.points;
  g1.state.score = createScore();
  scoreFlight(g1.state, f2);
  ok('I16 losing a priority bag costs more than losing an ordinary one',
    g1.state.score.points < afterPlain,
    `${g1.state.score.points} vs ${afterPlain}`);
  void s;

  /* §16.3: "colour must be reinforced by text AND ICONS". The board carried the words and
     a bare colour swatch; the icon — the third channel drawn on every bag — was missing,
     so a colourblind player matching a tag to a row had two channels on one side and one
     on the other. */
  const root = document.createElement('div');
  document.body.appendChild(root);
  const board = new FlightBoard(root);
  const bg = newGame(); bg.startShift(); bg.skipMs(30000);
  board.update(bg.state);
  const chips = [...root.querySelectorAll('.b-chip')];
  ok('I17 every board row carries an icon as well as a colour',
    chips.length > 0 && chips.every((c) => c.textContent.trim().length > 0),
    chips.map((c) => JSON.stringify(c.textContent)).join());
  eq('I18 and the icons distinguish the flights',
    new Set(chips.map((c) => c.textContent)).size, chips.length);
  board.destroy(); root.remove();
}

/* ── J. the instrument reads the game and never writes to it ─────────────── */
/*
 * EVERY BALANCE NUMBER IN THIS SUITE AND IN `_balance.js` RESTS ON ONE LINE: `CrewBot`
 * reads state and presses keys, and never writes to it. CLAUDE.md states that as a rule
 * and until this section existed nothing checked it. A bot that nudged a bag into reach,
 * or cached a route ON a cart, would stop being a measurement and become a second, worse
 * implementation of the game — and it would do that with every assertion above still
 * green, because the shift it produced would still look played.
 *
 * Two independent checks, because each misses what the other catches:
 *
 *   1. A DEEP SNAPSHOT either side of `bot.step()`, sampled once per simulated second
 *      through a whole live shift so every phase of the decision tree runs against a real
 *      state. It walks the entire state graph rather than `describe()` — a write to a
 *      field `describe()` omits is exactly the kind this is for — but it cannot see a
 *      write of an identical value, or one JSON does not carry.
 *   2. A DEEP FREEZE at three checkpoints. ES modules are strict mode, so an assignment
 *      to a frozen object THROWS instead of failing silently. That catches what a snapshot
 *      cannot: a same-value write, a push onto an array, a new key on an existing object.
 *
 * Both are guarded against passing VACUOUSLY, which is the failure mode this hardening
 * pass exists to remove — a bot that pressed nothing would never write to anything
 * either. So J1 asserts the probe watched a live shift, J1b that the crew was really
 * playing it, J3 that each frozen checkpoint was actually reached, and J6 that the bot
 * pressed real keys while the state under it was frozen.
 */
function deepSnap(root) {
  const seen = new Set();
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return typeof v === 'function' ? '<fn>' : v;
    if (seen.has(v)) return '<seen>';
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out = {};
    for (const k of Object.keys(v)) out[k] = walk(v[k]);
    return out;
  };
  return JSON.stringify(walk(root));
}

function deepFreeze(v, seen = new Set()) {
  if (v === null || typeof v !== 'object' || seen.has(v)) return v;
  seen.add(v);
  Object.freeze(v);
  for (const k of Object.keys(v)) deepFreeze(v[k], seen);
  return v;
}

/** Where two snapshots first disagree, with enough either side to name the field. */
function firstDiffOf(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 70);
  return `char ${i}\n        was: ...${a.slice(from, i + 30)}\n        now: ...${b.slice(from, i + 30)}`;
}

function sectionJ() {
  lines.push('--- J. the instrument reads the game and never writes to it ---');

  const FRAME = CONFIG.sim.stepMs;
  const cap = Math.ceil(900000 / FRAME);

  /* 1. the sampled snapshot, over a whole shift the bot really plays */
  const g = newGame(12345);
  const input = new Input(window);
  const bot = new CrewBot('average');
  const SAMPLE_EVERY = 60;                            // once per simulated second
  g.startShift();
  let frames = 0, samples = 0, dirty = 0, firstDiff = '';
  while (frames < cap && !g.state.shift.ended) {
    if (frames % SAMPLE_EVERY === 0) {
      const before = deepSnap(g.state);
      bot.step(g, input, FRAME);
      const after = deepSnap(g.state);
      samples++;
      if (before !== after) {
        dirty++;
        if (!firstDiff) firstDiff = `${(g.state.simTimeMs / 1000).toFixed(1)}s, ${firstDiffOf(before, after)}`;
      }
    } else {
      bot.step(g, input, FRAME);
    }
    g.frame(FRAME, input);
    frames++;
  }
  const flights = Object.values(g.state.flightsById);
  const owed = flights.reduce((n, f) => n + f.expectedCount, 0);
  const correct = flights.reduce((n, f) => n + f.outcome.correct, 0);

  ok('J1 the probe watched a whole live shift rather than a stalled one',
     samples >= 300 && g.state.shift.ended, `${samples} samples, ended=${g.state.shift.ended}`);
  ok('J1b ...and the crew was really playing it, so the decision tree actually ran',
     correct > 0, `${correct} of ${owed} delivered`);
  ok('J2 not one sampled bot.step() changed the game state',
     dirty === 0, `${dirty} of ${samples} samples mutated state — first at ${firstDiff}`);
  note(`${samples} sampled bot.step() calls across ${(g.state.simTimeMs / 1000).toFixed(0)}s of play, ` +
       `${correct}/${owed} delivered, ${dirty} mutations`);

  /* 2. the deep freeze, at three points in the shift with different work in hand */
  let pressesTotal = 0;
  for (const atSec of [45, 240, 480]) {
    const fg = newGame(12345);
    const fi = new Input(window);
    const realPress = fi._debugPress.bind(fi);
    const realRelease = fi._debugRelease.bind(fi);
    let presses = 0;
    fi._debugPress = (code) => { presses++; realPress(code); };
    fi._debugRelease = (code) => { presses++; realRelease(code); };
    const fb = new CrewBot('average');
    fg.startShift();
    let f = 0;
    while (f < cap && fg.state.simTimeMs < atSec * 1000 && !fg.state.shift.ended) {
      fb.step(fg, fi, FRAME);
      fg.frame(FRAME, fi);
      f++;
    }
    ok(`J3.${atSec}s the ${atSec}s checkpoint was reached, so the freeze is not vacuous`,
       fg.state.simTimeMs >= atSec * 1000, `stopped at ${(fg.state.simTimeMs / 1000).toFixed(1)}s`);

    deepFreeze(fg.state);
    presses = 0;
    let threw = '';
    try { for (let k = 0; k < 60; k++) fb.step(fg, fi, FRAME); }
    catch (e) { threw = (e && e.stack) || String(e); }
    ok(`J4.${atSec}s a simulated second of bot.step() against a DEEP-FROZEN state throws nothing`,
       !threw, threw);
    pressesTotal += presses;
  }
  ok('J6 the bot pressed real keys while the state under it was frozen',
     pressesTotal > 0, `${pressesTotal} key edges across the three checkpoints`);
  note(`the frozen probe pressed ${pressesTotal} key edges — a bot that pressed none would ` +
       'pass J4 by doing nothing at all');
}

/* ── Z. what a suite cannot close ────────────────────────────────────────── */
function sectionZ() {
lines.push('--- Z. GDD §29 criteria that need people, not a test runner ---');
  open('Z1 "a first-time player can complete the basic loop without a manual" (§29 UX)');
  open('Z2 "at least three external playtesters understand that the airport will not wait"');
  open('Z3 "at least two report a memorable unscripted mistake or recovery"');
  open('Z4 "repeated play produces improved organization or routing"');
  // The fifth. §29's Design validation has four bullets, not three, and this suite is
  // meant to be §29 bullet by bullet — so leaving it out silently undercounted what is
  // actually open, in the one section whose whole job is to be honest about that.
  open('Z5 "pressure comes from overlapping simple work, not confusing controls"');
  note('      Section D is the closest a program gets: it plays whole shifts through the');
  note('      real input path and shows a competent crew clearing most of the schedule');
  note('      and a careless one going backwards. It cannot tell you whether the game');
  note('      TEACHES that, and it is reported open rather than assumed green.');
}

/* ── run ─────────────────────────────────────────────────────────────────── */
(async () => {
  const sections = [
    ['A', sectionA], ['B', sectionB], ['C', sectionC], ['D', sectionD],
    ['E', sectionE], ['F', sectionF], ['H', sectionH], ['I', sectionI], ['J', sectionJ], ['G', sectionG], ['Z', sectionZ],
  ];
  for (const [name, fn] of sections) {
    emit(`RUNNING section ${name}...`);
    try { await fn(); }
    catch (e) { fails++; lines.push(`FAIL  section ${name} threw: ${(e && e.stack) || e}`); }
    emit(`RUNNING (section ${name} done)`);
  }
  emit();
})();
