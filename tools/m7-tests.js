/* Milestone 7 suite — the conformance-audit gaps.
 *
 * Every section here exists because a conformance pass found working code that NO
 * assertion anywhere would miss if it were deleted. That is the only thing this suite is
 * for: it is not a second implementation of m0-m6, and where an area is already proven
 * elsewhere the check here is deliberately narrow.
 *
 *   A  GDD §21.5 — the domain events actually reach a subscriber, with a sane payload.
 *      Twenty-three of the twenty-four names were emitted somewhere in src/ and asserted
 *      nowhere. Deleting an `emit` line left every suite green while silently killing an
 *      audio cue (systems/audio.js subscribes to the same bus) and the debug trace.
 *   B  GDD §21.8 — the F3 developer overlay. src/dev/debugOverlay.js was imported by no
 *      test at all, and Game.skipToNextFlightEvent / Game.forceDeparture were called from
 *      no test file anywhere.
 *   C  restart completeness for AIRCRAFT. The existing restart assertions name the clock,
 *      the score, bags, carts, flights, stats and the event log — never `aircraftById`.
 *   D  GDD §16.6 — keyboard-only operation. Every suite happens to drive the keyboard;
 *      none of them ASSERTS that a pointer is never required.
 *   E  GDD §7.1 — the scanner card's body. Only the bag number was ever checked.
 *
 * FOR WHOEVER OWNS tools\test.ps1: it runs this suite and holds an assertion COUNT baseline
 * for it, so adding or removing an assertion here means moving that number in the same
 * commit. (An earlier version of this header said test.ps1 did not know about m7 yet. It
 * does, and it has for a while — the note went stale and nothing notices a stale comment.)
 *
 * ONE CHANGE THIS FILE CANNOT MAKE FOR ITSELF, for whoever owns src/:
 *   Section B20 pins the "." skip at 1x only. It is fed through clock.skipMs, which
 *   scales by clock.timeScale — so at 4x the overlay's "skip 10s" advances FORTY seconds
 *   of simulation. That may well be intended (a debug key at 4x arguably should), but
 *   nothing says so, and no assertion anywhere had noticed either way.
 *
 * Harness copied verbatim from tools\m6-tests.js: the same ok/eq/note helpers, the same
 * progressive emit() after every section (a section that throws still reports how far it
 * got), the same yieldToLoop() before anything touches the live page, and the same
 * hand-driven game.frame() — headless Chrome delivers 1-3 rAF callbacks in total, so a
 * test that waits for frames waits forever.
 */

import { CONFIG } from '../src/config.js';
import { Game, MODES } from '../src/game.js';
import { GameClock } from '../src/core/clock.js';
import { Input } from '../src/core/input.js';
import { Rng } from '../src/core/rng.js';
import { EventBus, EVENTS } from '../src/core/eventBus.js';
import { createBag } from '../src/entities/bag.js';
import { WALLS, rectContains } from '../src/data/airport.js';
import { FLIGHT_DEFS } from '../src/data/flights.js';
import { memoryStorage } from '../src/systems/save.js';
import { moveBag, assertContainment } from '../src/systems/containment.js';
import { validateChain, hitch } from '../src/systems/hitching.js';
import { enterVehicle, exitVehicle } from '../src/systems/interaction.js';
import { aircraftHoldZone } from '../src/entities/aircraft.js';
import { FLIGHT_STATES, stateIndex, isHoldOpen } from '../src/systems/flightSchedule.js';
import { DebugOverlay } from '../src/dev/debugOverlay.js';
import { ScannerCard } from '../src/ui/scannerCard.js';

/* ── harness ─────────────────────────────────────────────────────────────── */
const lines = [];
let passes = 0, fails = 0;
function ok(name, cond, detail = '') {
  if (cond) { passes++; lines.push(`PASS  ${name}`); }
  else { fails++; lines.push(`FAIL  ${name}${detail ? '  <- ' + detail : ''}`); }
}
const eq   = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
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
const yieldToLoop = () => new Promise((res) => {
  let done = false;
  const finish = () => { if (!done) { done = true; res(); } };
  requestAnimationFrame(finish);
  setTimeout(finish, 500);
});

/** Storage is ALWAYS injected: a suite must never write a real high score into the browser. */
function newGame(seed = 707) {
  return new Game({ seed, seedLabel: 'test', storage: memoryStorage() });
}

/**
 * A point provably INSIDE a wall, derived from the wall rather than typed in.
 *
 * Two places in this file used to hardcode `33.7, 30` with a comment reading "inside
 * room_e2 (x 33.4-34.0)" — a copy of two numbers that live in data/airport.js. Move the
 * sort-room wall ten centimetres and both would have been poking at open floor, and the
 * two assertions that depend on the crew being genuinely stuck would have been testing
 * nothing while staying green.
 */
function insideWall(id = 'room_e2') {
  const w = WALLS.find((r) => r.id === id);
  return { x: w.x + w.w / 2, y: w.y + w.h / 2 };
}
const inAnyWall = (x, y) => WALLS.some((w) => rectContains(w, x, y));

/**
 * THE DETERMINISM CONTRACT, DEEPER THAN `describe()`.
 *
 * C11 below closed this hole for AIRCRAFT and said so in a note; `describe()` has since
 * grown an aircraft roster. BAGS are still outside it — no coordinate, no velocity — and
 * they are the largest entity population in the game. So a "reads and never writes"
 * assertion measured through `describe()` alone cannot see a debug panel or an overlay
 * nudging a bag, which is precisely the kind of write B25 exists to forbid.
 */
function snapshot(g) {
  const s = g.state;
  const r = (v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v);
  return JSON.stringify({
    describe: g.describe(),
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

let _serial = 0;
function makeBag(g, flightId, opts = {}) {
  const spec = { flightId, priority: !!opts.priority, weightClass: opts.weightClass || 'normal' };
  const bag = createBag(spec, ++_serial, 400000, new Rng(71 + _serial, 't'));
  g.state.bagsById[bag.id] = bag;
  bag.x = opts.x !== undefined ? opts.x : 0;
  bag.y = opts.y !== undefined ? opts.y : 0;
  moveBag(g.state, bag, { type: 'floor' }, g.bus, g.state.simTimeMs);
  return bag;
}

/** A bag placed exactly in the hands' reach, whichever way the player is facing. */
function bagAhead(g, flightId, opts = {}) {
  const p = g.state.player;
  return makeBag(g, flightId, { ...opts, x: p.x + p.aimX * 0.7, y: p.y + p.aimY * 0.7 });
}

/** One key, edge-consumed by exactly one simulation step. */
function tap(g, input, code) {
  input._debugPress(code);
  g.frame(FRAME_MS, input);
  input._debugRelease(code);
  g.frame(FRAME_MS, input);
}

const setKey = (input, code, down) => (down ? input._debugPress(code) : input._debugRelease(code));

/**
 * Walk to a point using ONLY the four movement keys — no teleport, no pointer. Used by
 * section D, where the whole claim is that the loop is reachable from the keyboard.
 */
function walkTo(g, input, tx, ty, maxFrames = 1200) {
  const p = g.state.player;
  let i = 0;
  for (; i < maxFrames; i++) {
    const dx = tx - p.x, dy = ty - p.y;
    if (Math.hypot(dx, dy) < 0.35) break;
    setKey(input, 'KeyD', dx > 0.2); setKey(input, 'KeyA', dx < -0.2);
    setKey(input, 'KeyS', dy > 0.2); setKey(input, 'KeyW', dy < -0.2);
    g.frame(FRAME_MS, input);
  }
  for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) input._debugRelease(c);
  g.frame(FRAME_MS, input);
  return i;
}

/** The m2 autopilot, key-only: press W and steer toward a point. */
function driveTo(g, input, tx, ty, maxFrames = 2400) {
  const v = g.state.vehiclesById.tractor_1;
  let i = 0;
  for (; i < maxFrames; i++) {
    const dx = tx - v.x, dy = ty - v.y;
    if (Math.hypot(dx, dy) < 2.2) break;
    let err = Math.atan2(dy, dx) - v.rot;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    input._debugRelease('KeyA'); input._debugRelease('KeyD');
    if (err > 0.05) input._debugPress('KeyD');
    else if (err < -0.05) input._debugPress('KeyA');
    input._debugPress('KeyW');
    g.frame(FRAME_MS, input);
  }
  for (const c of ['KeyW', 'KeyA', 'KeyD']) input._debugRelease(c);
  g.frame(FRAME_MS, input);
  return i;
}

/**
 * Record what actually reaches a subscriber. Counts and the FIRST payload only — a
 * ten-minute shift emits thousands of events and GDD §24.1 forbids an unbounded log, so a
 * test that kept them all would be breaking the rule it is here to protect.
 */
function recordEvents(bus) {
  const counts = {}, first = {};
  bus.onAny((e) => {
    counts[e.type] = (counts[e.type] || 0) + 1;
    if (!first[e.type]) first[e.type] = e;
  });
  return { counts, first, saw: (t) => (counts[t] || 0) > 0 };
}

/* ══ A. GDD §21.5 — every domain event fires, and says something true ══════ */
/*
 * GDD §21.5 names ten events and src/core/eventBus.js declares twenty-four. Every one is
 * emitted somewhere in src/, and until now only FLIGHT_STATE_CHANGED was ever asserted to
 * FIRE. That matters more than it looks: systems/audio.js and render/fx.js are pure
 * subscribers, so a deleted `emit` line is a silently missing sound and a silently missing
 * puff of dust, with no test anywhere going red.
 *
 * So this section drives the real verbs through the real input path, sets up the specific
 * situations the rarer events need, and then asserts each name arrived WITH A USABLE
 * PAYLOAD — every id in it has to resolve to a real entity. A count is never asserted
 * (m5 E4's lesson: a raw event count is a property of one seed wearing a magnitude);
 * the assertion is "this kind of event happened at all, and it was well formed".
 */
function sectionA() {
lines.push('--- A. GDD 21.5 domain events actually reach a subscriber ---');

  const g = newGame(2211);
  const rec = recordEvents(g.bus);
  const input = new Input(window);

  // FLIGHT_STATE_CHANGED must never describe a flight going backwards through §5.1's
  // lifecycle. Recorded live, because the ordering is the property — not the arrival.
  let backwards = 0;
  const lastIdx = {};
  g.bus.on(EVENTS.FLIGHT_STATE_CHANGED, (e) => {
    if (stateIndex(e.prev) >= stateIndex(e.state)) backwards++;
    if (lastIdx[e.flightId] !== undefined && stateIndex(e.state) <= lastIdx[e.flightId]) backwards++;
    lastIdx[e.flightId] = stateIndex(e.state);
  });

  /* SIM_RESET, MODE_CHANGED, SIM_PAUSED, SIM_RESUMED */
  g.startShift();
  g.togglePause();
  g.togglePause();

  /* BAG_SPAWNED and BAG_LEFT_CONVEYOR. NEVER assume WHEN a seeded bag arrives — the belt
     is 21 m at 1.6 m/s and the first spec is drawn from the seed. Loop until both have
     happened, bounded by the DERIVED shift end. */
  let guard = 0;
  while ((!rec.saw(EVENTS.BAG_SPAWNED) || !rec.saw(EVENTS.BAG_LEFT_CONVEYOR)) &&
         g.state.simTimeMs < g.state.shift.endTimeMs && guard++ < 900) {
    g.skipMs(1000);
  }
  note(`      belt running by ${(g.state.simTimeMs / 1000).toFixed(1)} s, ` +
       `${g.state.shift.spawned} bags fed`);

  /* BAG_PICKED_UP, BAG_SCANNED, BAG_THROWN, BAG_RELEASED — the hands, through the keys */
  const b1 = bagAhead(g, 'flight_AB221');
  g.frame(FRAME_MS, input);
  tap(g, input, 'KeyE');
  tap(g, input, 'KeyQ');
  input._debugPress('Space');
  for (let i = 0; i < 45; i++) g.frame(FRAME_MS, input);
  input._debugRelease('Space');
  g.frame(FRAME_MS, input);

  /* CART_PLACARD_SET, BAG_PLACED_IN_CART, BAG_TAKEN_FROM_CART. The cart is brought to the
     player rather than the other way round: this section is about the emit sites, and
     section D is where the walk has to be real. */
  const p = g.state.player;
  const cart = g.state.cartsById.cart_1;
  cart.x = p.x + 1.0; cart.y = p.y; cart.rot = 0;
  g.frame(FRAME_MS, input);
  tap(g, input, 'KeyF');                      // no vehicle in range, so F sets the placard
  const b2 = bagAhead(g, 'flight_AB221');
  g.frame(FRAME_MS, input);
  tap(g, input, 'KeyE');                      // grab
  tap(g, input, 'KeyE');                      // load into the cart
  tap(g, input, 'KeyE');                      // and take it back out

  /* VEHICLE_ENTERED, CART_HITCHED, CART_UNHITCHED, VEHICLE_EXITED. Out on the open apron:
     driving east off a marked bay arrives at the neighbouring cart, and E then hitches
     THAT instead of dropping this one (m6 B3's note). */
  const v = g.state.vehiclesById.tractor_1;
  cart.x = 46; cart.y = 30; cart.rot = 0;
  v.x = cart.x + 2.0; v.y = cart.y; v.rot = 0;
  g.frame(FRAME_MS, input);
  p.x = v.x; p.y = v.y;
  g.frame(FRAME_MS, input);
  tap(g, input, 'KeyF');                      // in
  tap(g, input, 'KeyE');                      // hitch
  tap(g, input, 'KeyE');                      // nothing else in range, so unhitch the tail
  tap(g, input, 'KeyF');                      // out

  /* BAG_ENTERED_HOLD and BAG_LEFT_HOLD, through the real verb at a real open hold. */
  const flight = g.state.flightsById.flight_AB221;
  const ac = g.state.aircraftById[flight.aircraftId];
  let holdGuard = 0;
  while (!isHoldOpen(flight) && g.state.simTimeMs < flight.times.holdClosingMs && holdGuard++ < 900) {
    g.skipMs(1000);
  }
  ok('A1 the setup reached an open hold', isHoldOpen(flight) && ac.holdOpen, flight.state);
  const z = aircraftHoldZone(ac);
  p.x = z.x; p.y = z.y; p.vx = 0; p.vy = 0;
  const b3 = makeBag(g, 'flight_AB221', { x: z.x, y: z.y });
  g.frame(FRAME_MS, input);
  tap(g, input, 'KeyE');                      // grab it off the floor of the hold volume
  tap(g, input, 'KeyE');                      // load it in
  tap(g, input, 'KeyE');                      // and pull it back out of the manifest

  /* BAG_MISROUTED, BAG_MISSED, FLIGHT_DEPARTED, SCORE_CHANGED — all written at pushback. */
  const stranger = makeBag(g, 'flight_MC184', { x: z.x, y: z.y });
  moveBag(g.state, stranger, { type: 'aircraftHold', id: ac.id }, g.bus, g.state.simTimeMs);
  const toDeparture = flight.times.departureMs + 1000 - g.state.simTimeMs;
  if (toDeparture > 0) g.skipMs(toDeparture);
  eq('A2 the flight the events describe really departed', flight.evaluated, true);

  /* BAG_SPILLED is the one event no scripted verb produces: it takes a loaded cart taken
     round a corner too fast. Its own game, because a hard circle on the apron is not a
     situation the run above can be left in. */
  const g2 = newGame(4);
  const rec2 = recordEvents(g2.bus);
  g2.startShift();
  {
    const v2 = g2.state.vehiclesById.tractor_1;
    const c2 = g2.state.cartsById.cart_2;
    c2.x = 90; c2.y = 35; c2.rot = 0;
    for (let i = 0; i < 10; i++) {
      const b = makeBag(g2, 'flight_AB221', { x: c2.x, y: c2.y, weightClass: 'light' });
      moveBag(g2.state, b, { type: 'cart', id: c2.id }, g2.bus, 0);
    }
    v2.rot = 0; v2.x = c2.x + CONFIG.tractor.towOffsetM + 1.9; v2.y = c2.y;
    enterVehicle(g2.state, v2, g2.bus, 0);
    hitch(g2.state, v2, c2, g2.bus, 0);
    const i2 = new Input(window);
    i2._debugPress('KeyD');
    for (let i = 0; i < 600; i++) { v2.speed = CONFIG.tractor.maxSpeed; g2.frame(FRAME_MS, i2); }
    i2._debugRelease('KeyD');

    /* RECOVERED (GDD §24.3). The one event that cannot happen during competent play, so
       it has to be provoked: put the crew inside the sort-room wall — the exact state
       `exitVehicle` used to be able to produce — and press X. From in there no direction
       is walkable, so if this did not fire the game would simply be frozen. */
    exitVehicle(g2.state, g2.bus, g2.state.simTimeMs);
    const stuck = g2.state.player;
    const wedgePoint = insideWall('room_e2');        // derived, not typed in
    stuck.x = wedgePoint.x; stuck.y = wedgePoint.y;
    g2.frame(FRAME_MS, i2);
    const wedged = { x: stuck.x, y: stuck.y };
    ok('A2a the crew really is wedged before X is pressed', inAnyWall(wedged.x, wedged.y),
      `${wedged.x.toFixed(2)},${wedged.y.toFixed(2)}`);
    i2._debugPress('KeyX'); g2.frame(FRAME_MS, i2); i2._debugRelease('KeyX');
    ok('A2b X frees a player wedged in a wall',
      Math.hypot(stuck.x - wedged.x, stuck.y - wedged.y) > 0.1 &&
      !inAnyWall(stuck.x, stuck.y),
      `${wedged.x},${wedged.y} -> ${stuck.x.toFixed(2)},${stuck.y.toFixed(2)}`);
  }

  /* ── the assertions ──────────────────────────────────────────────────────
   * One per event name. Each says "it fired AND its payload resolves", because an event
   * that arrives naming a bag nobody has heard of is no more use to audio or to the
   * trace than no event at all. */
  const S = g.state, S2 = g2.state;
  const known = (o, id) => !!(id && o[id]);
  const finite = (n) => typeof n === 'number' && isFinite(n);

  const CHECKS = {
    [EVENTS.SIM_RESET]:      (e) => e.seed === g.seed && typeof e.seedLabel === 'string',
    [EVENTS.MODE_CHANGED]:   (e) => e.prev !== e.mode &&
                                    Object.values(MODES).includes(e.mode) &&
                                    Object.values(MODES).includes(e.prev),
    [EVENTS.SIM_PAUSED]:     (e) => e.prev === MODES.PLAYING,
    [EVENTS.SIM_RESUMED]:    (e) => finite(e.simTimeMs) &&
                                    e.simTimeMs >= (rec.first[EVENTS.SIM_PAUSED] || {}).simTimeMs,
    [EVENTS.BAG_SPAWNED]:    (e) => known(S.bagsById, e.bagId) && known(S.flightsById, e.flightId),
    [EVENTS.BAG_LEFT_CONVEYOR]: (e) => known(S.bagsById, e.bagId) && finite(e.x) && finite(e.y),
    [EVENTS.BAG_PICKED_UP]:  (e) => known(S.bagsById, e.bagId),
    [EVENTS.BAG_RELEASED]:   (e) => known(S.bagsById, e.bagId) && finite(e.x) && finite(e.y),
    [EVENTS.BAG_THROWN]:     (e) => known(S.bagsById, e.bagId) &&
                                    e.speed >= CONFIG.bag.throwMinSpeed * 0.5,
    [EVENTS.BAG_SCANNED]:    (e) => known(S.bagsById, e.bagId) &&
                                    ['neutral', 'correct', 'wrong'].includes(e.verdict),
    [EVENTS.BAG_PLACED_IN_CART]:  (e) => known(S.bagsById, e.bagId) && known(S.cartsById, e.cartId),
    [EVENTS.BAG_TAKEN_FROM_CART]: (e) => known(S.bagsById, e.bagId) && known(S.cartsById, e.cartId),
    [EVENTS.BAG_SPILLED]:    (e) => known(S2.bagsById, e.bagId) && known(S2.cartsById, e.cartId),
    [EVENTS.CART_HITCHED]:   (e) => known(S.cartsById, e.cartId) &&
                                    (known(S.vehiclesById, e.toId) || known(S.cartsById, e.toId)),
    [EVENTS.CART_UNHITCHED]: (e) => known(S.cartsById, e.cartId) &&
                                    (known(S.vehiclesById, e.fromId) || known(S.cartsById, e.fromId)),
    // flightId may legitimately be null: the placard cycle starts at "no placard".
    [EVENTS.CART_PLACARD_SET]: (e) => known(S.cartsById, e.cartId) &&
                                      (e.flightId === null || known(S.flightsById, e.flightId)),
    [EVENTS.VEHICLE_ENTERED]: (e) => known(S.vehiclesById, e.vehicleId),
    [EVENTS.VEHICLE_EXITED]:  (e) => known(S.vehiclesById, e.vehicleId),
    [EVENTS.BAG_ENTERED_HOLD]: (e) => known(S.bagsById, e.bagId) && known(S.aircraftById, e.aircraftId),
    [EVENTS.BAG_LEFT_HOLD]:    (e) => known(S.bagsById, e.bagId) && known(S.aircraftById, e.aircraftId),
    [EVENTS.FLIGHT_STATE_CHANGED]: (e) => known(S.flightsById, e.flightId) &&
                                          FLIGHT_STATES.includes(e.prev) && FLIGHT_STATES.includes(e.state),
    [EVENTS.FLIGHT_DEPARTED]:  (e) => known(S.flightsById, e.flightId) &&
                                      e.correct + e.missed === S.flightsById[e.flightId].expectedCount,
    [EVENTS.BAG_MISROUTED]:    (e) => known(S.bagsById, e.bagId) &&
                                      e.intendedFlightId !== e.actualFlightId &&
                                      known(S.flightsById, e.actualFlightId),
    [EVENTS.BAG_MISSED]:       (e) => known(S.bagsById, e.bagId) && known(S.flightsById, e.flightId),
    // The FIRST score line starts from zero, so its delta IS the running total. Anything
    // else means the pull pass double-counted or scored a flight twice.
    [EVENTS.SCORE_CHANGED]:    (e) => known(S.flightsById, e.flightId) &&
                                      finite(e.delta) && e.total === e.delta,
    // GDD §24.3's escape hatch. `ids` names whatever it actually freed — the player, or
    // the tractor and any cart still on its drawbar.
    [EVENTS.RECOVERED]:        (e) => Array.isArray(e.ids) && e.ids.length > 0 &&
                                      e.ids.every((id) => id === S2.player.id ||
                                        known(S2.cartsById, id) || known(S2.vehiclesById, id)),
  };

  let n = 3;
  const missing = [];
  for (const type of Object.values(EVENTS)) {
    const e = rec.first[type] || rec2.first[type];
    if (!e) missing.push(type);
    const check = CHECKS[type];
    ok(`A${n++} ${type} fires with a payload that resolves`,
      !!e && !!check && check(e) === true,
      e ? JSON.stringify(e).slice(0, 140) : 'never emitted');
  }

  // The one that makes deleting an emit line impossible to miss: the vocabulary in
  // eventBus.js is fixed in one place SO THAT later milestones cannot invent near
  // duplicates, and every name in it has to mean something.
  eq(`A${n++} no name in the GDD 21.5 vocabulary went unemitted`, missing.length, 0,
    missing.join(', '));
  eq(`A${n++} and no flight was ever announced moving backwards through 5.1`, backwards, 0);

  // Every event carries the simulation time it happened at, not a wall clock. That is
  // what makes the trace replayable (GDD 21.7) and what the overlay prints.
  const badTime = Object.values(EVENTS)
    .map((t) => rec.first[t] || rec2.first[t])
    .filter((e) => e && !(finite(e.simTimeMs) && e.simTimeMs >= 0));
  eq(`A${n++} and every one is stamped with a simulation time`, badTime.length, 0);

  // GDD 24.1 forbids an unbounded trace, and the overlay and the shift report both read
  // this log. Driven on a scratch bus rather than by counting a seeded shift's events: how
  // many a shift emits is a property of one seed, and the property here is the CAP.
  const scratch = new EventBus({ logSize: CONFIG.debug.eventLogSize });
  const flood = CONFIG.debug.eventLogSize * 3;
  for (let i = 0; i < flood; i++) scratch.emit(EVENTS.BAG_SPAWNED, { i }, i);
  eq(`A${n++} the event log is bounded however much traffic it sees`,
    scratch.log.length, CONFIG.debug.eventLogSize);
  ok(`A${n++} and what it drops is the OLDEST, so the overlay shows what just happened`,
    scratch.recent(1)[0].i === flood - 1 && scratch.log[0].i === flood - CONFIG.debug.eventLogSize,
    `newest ${scratch.recent(1)[0].i}, oldest kept ${scratch.log[0].i} of ${flood}`);
  ok(`A${n++} and the live bus honours the same cap`,
    g.bus.log.length <= g.bus.logSize && g.bus.logSize === CONFIG.debug.eventLogSize,
    `${g.bus.log.length} kept of ${g.bus.emitted} emitted, cap ${g.bus.logSize}`);

  eq(`A${n++} and driving every verb corrupted nothing`, assertContainment(g.state).length, 0);
  void b1; void b2; void b3;
  note(`      ${g.bus.emitted} events on the scripted shift, ` +
       `${Object.keys(rec.counts).length} distinct kinds`);
}

/* ══ B. GDD §21.8 — the F3 developer overlay ══════════════════════════════ */
/*
 * src/dev/debugOverlay.js was imported by no test file. So were Game.skipToNextFlightEvent
 * and Game.forceDeparture, both of which §21.8 asks for by name ("time scale and
 * skip-to-next-event", "force departure").
 *
 * The overlay is built here against its own detached root and a stand-in renderer, so the
 * suite owns the object it is testing. ONE key is dispatched on the real window — enough
 * to prove the listener is attached where the constructor claims — and the rest go through
 * _key() directly, because the live page has its own overlay listening on the same window
 * and driving the shipped game's clock from a test would be a side effect, not a test.
 */
async function sectionB() {
lines.push('--- B. GDD 21.8 the developer overlay ---');
  await yieldToLoop();          // this section dispatches on the live window

  // The shipped page has its own overlay bound to the same window, so every real F3 below
  // toggles it as well. Remember how a player would have found it, and put it back.
  const liveDebug = document.getElementById('debug');
  const liveWasOn = !!liveDebug && liveDebug.classList.contains('on');

  const g = newGame(808);
  g.startShift();
  const root = document.createElement('div');
  // The overlay writes exactly two things on a renderer, and they are its own bounds and
  // grid switches. A stand-in proves that, and would break loudly if it grew a third.
  const renderer = { showBounds: false, showGrid: false };
  const dbg = new DebugOverlay(root, g, renderer);
  const K = (code) => dbg._key({ code, preventDefault() {} });

  // "Hidden by default." GDD 21.8: debug tooling must not be mixed into player-facing UI,
  // and the first half of that is that nobody sees it unless they ask.
  eq('B1 the overlay starts hidden', dbg.visible, false);
  eq('B2 and CONFIG says so, rather than a literal in the class', CONFIG.debug.enabled, false);
  ok('B3 its node carries no "on" class while hidden', !dbg.el.classList.contains('on'));
  dbg.update(FRAME_MS);
  eq('B4 and a hidden overlay renders nothing at all', dbg.el.textContent, '');

  // The window listener really is attached — dispatched for real, then balanced so the
  // live page's own overlay ends where it started.
  const key = (code) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, cancelable: true, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code, cancelable: true, bubbles: true }));
  };
  key('F3');
  eq('B5 a real F3 on the window opens it', dbg.visible, true);
  ok('B6 and the node becomes visible through its class, not inline style',
    dbg.el.classList.contains('on'));
  key('F3');
  eq('B7 and F3 again closes it', dbg.visible, false);

  // Debug keys are INERT until the overlay is open. This is the other half of "must not
  // bleed into player-facing UI": a player who never opens it cannot trip over B, G, [ or
  // ] and silently change how the game behaves.
  K('KeyB'); K('KeyG'); K('BracketRight'); K('Period');
  ok('B8 with the overlay shut, its keys do nothing',
    renderer.showBounds === false && renderer.showGrid === false && g.clock.timeScale === 1);
  const quietTime = g.state.simTimeMs;

  K('F3');
  eq('B9 the overlay reopens', dbg.visible, true);
  eq('B10 and the shut keys never moved the clock', g.state.simTimeMs, quietTime);

  // "collision/interaction bounds" and the reference grid — GDD 21.8's own list.
  K('KeyB');
  eq('B11 B turns collision bounds on', renderer.showBounds, true);
  K('KeyB');
  eq('B12 and off again', renderer.showBounds, false);
  K('KeyG');
  eq('B13 G turns the reference grid on', renderer.showGrid, true);
  K('KeyG');
  eq('B14 and off again', renderer.showGrid, false);

  // "time scale" — [ and ] step through the authored list and CLAMP at both ends rather
  // than running off it. All tuning lives in config.js, so the list is read, never typed.
  const scales = CONFIG.debug.timeScales;
  K('BracketRight');
  eq('B15 ] steps the time scale up one authored step', g.clock.timeScale, scales[scales.indexOf(1) + 1]);
  K('BracketLeft');
  eq('B16 [ steps it back down', g.clock.timeScale, 1);
  for (let i = 0; i < scales.length + 3; i++) K('BracketRight');
  eq('B17 and it clamps at the fastest authored scale', g.clock.timeScale, scales[scales.length - 1]);
  for (let i = 0; i < scales.length * 2 + 3; i++) K('BracketLeft');
  eq('B18 and at the slowest', g.clock.timeScale, scales[0]);
  while (g.clock.timeScale < 1) K('BracketRight');
  eq('B19 and returns to real time', g.clock.timeScale, 1);

  // "." skips ten seconds of SIMULATION, not ten seconds of wall clock — the whole point
  // of a debug skip is that the schedule moves without waiting for it.
  const t0 = g.state.simTimeMs;
  K('Period');
  ok('B20 . skips ten seconds of simulation',
    Math.abs((g.state.simTimeMs - t0) - 10000) <= CONFIG.sim.stepMs,
    `${(g.state.simTimeMs - t0).toFixed(1)} ms`);
  // NOTE for the owner of src/: the skip is fed through clock.skipMs, which scales by
  // clock.timeScale. At 4x, "." advances forty seconds, not ten. Deliberate or not, it is
  // undocumented; this assertion pins the 1x behaviour only and does not judge the rest.

  // A debug skip runs even while the airport is paused, and must leave the pause exactly
  // as it found it. If it did not, F3 tooling could quietly un-pause a shift.
  g.togglePause();
  const pausedAt = g.state.simTimeMs;
  K('Period');
  ok('B21 . works while paused', g.state.simTimeMs > pausedAt);
  eq('B22 and hands the pause back untouched', g.clock.paused, true);
  eq('B23 with the mode still paused', g.state.mode, MODES.PAUSED);
  g.togglePause();

  // "skip-to-next-event". The lead is 1500 ms by design: it lands you just BEFORE the
  // transition so you can watch it happen.
  K('Comma');
  const marksOf = (s) => {
    const out = [];
    for (const f of Object.values(s.flightsById)) {
      out.push(f.times.bagAcceptanceMs, f.times.loadingMs, f.times.finalCallMs,
               f.times.holdClosingMs, f.times.departureMs);
    }
    return out;
  };
  const gapTo = (s) => Math.min(...marksOf(s).filter((m) => m > s.simTimeMs)
    .map((m) => m - s.simTimeMs));
  ok('B24 , lands just before the next scheduled flight event',
    Math.abs(gapTo(g.state) - 1500) <= CONFIG.sim.stepMs * 2, `${gapTo(g.state).toFixed(0)} ms short`);

  // update() is a READER. GDD 31.3: no rule may live in a debug panel, so running it must
  // not change one measurable thing about the simulation.
  // Through `snapshot()`, not `describe()`. The overlay prints bag counts and walks the
  // containment index, and `describe()` carries no bag coordinate — so an overlay that
  // nudged a bag while measuring it was outside this assertion entirely.
  const before = snapshot(g);
  dbg.update(FRAME_MS);
  dbg.update(FRAME_MS);
  eq('B25 update() reads the simulation and never writes to it', snapshot(g), before);

  // What it actually shows is GDD 21.8's list, and the two live invariants the CLAUDE.md
  // notes say are checked in the overlay rather than only at test time.
  const text = dbg.el.textContent;
  for (const want of ['sim time', 'time scale', 'seed', 'bags', 'flights', 'carts',
                      'vehicles', 'containment', 'grid', 'recent events']) {
    ok(`B26.${want.replace(/\s/g, '-')} the overlay reports "${want}"`, text.includes(want));
  }
  ok('B27 it reports containment OK on a sound state', /containment\s+OK/.test(text));
  ok('B28 and the hitch chain too', /chain\s+OK/.test(text), text.match(/chain.*/) || '');

  // destroy() takes the listener with it. A stale overlay still bound to window would keep
  // driving a discarded game's clock on every F3.
  dbg.destroy();
  eq('B29 destroy() removes the node from the DOM', root.contains(dbg.el), false);
  const wasVisible = dbg.visible;
  key('F3');
  eq('B30 and unbinds the window listener', dbg.visible, wasVisible);

  /* ── Game.skipToNextFlightEvent and Game.forceDeparture, called by no test until now ── */
  const h = newGame(909);
  h.startShift();
  const firstMark = Math.min(...marksOf(h.state));
  const moved = h.skipToNextFlightEvent();
  ok('B31 skipToNextFlightEvent runs real steps rather than jumping the clock', moved > 0, `${moved} steps`);
  ok('B32 and stops short of the transition it is aiming at', h.state.simTimeMs < firstMark,
    `${h.state.simTimeMs} vs ${firstMark}`);
  // Step OVER the transition it just parked in front of before asking again: a second
  // call from 1.5 s out has nothing further ahead to aim at, and correctly does nothing.
  h.skipMs(gapTo(h.state) + 100);
  h.skipToNextFlightEvent(4000);
  ok('B33 the lead is a parameter, not a constant',
    Math.abs(gapTo(h.state) - 4000) <= CONFIG.sim.stepMs * 2, `${gapTo(h.state).toFixed(0)} ms short`);

  const ab = h.state.flightsById.flight_AB221;
  ok('B34 the flight it is about to force has not departed on its own', !ab.evaluated, ab.state);
  h.forceDeparture('flight_AB221');
  h.skipMs(200);
  ok('B35 forceDeparture takes a flight to pushback', stateIndex(ab.state) >= stateIndex('PUSHBACK'), ab.state);
  eq('B36 and evaluation happens exactly once, there', ab.evaluated, true);
  ok('B37 without running the clock past the flight it forced',
    h.state.simTimeMs < ab.times.departureMs + CONFIG.flight.pushbackMs,
    `${h.state.simTimeMs} vs ${ab.times.departureMs}`);
  const held = h.state.simTimeMs;
  h.forceDeparture('flight_AB221');
  eq('B38 forcing a flight that already went never rewinds the clock', h.state.simTimeMs, held);
  eq('B39 and an unknown flight id is a no-op, not a throw', h.forceDeparture('flight_NOPE'), null);

  // Past the last authored moment there is nothing left to skip to.
  const last = Math.max(...marksOf(h.state));
  if (h.state.simTimeMs < last + 500) h.skipMs(last + 500 - h.state.simTimeMs);
  const parked = h.state.simTimeMs;
  eq('B40 with the schedule exhausted, , has nowhere to go', h.skipToNextFlightEvent(), 0);
  eq('B41 and leaves the clock where it was', h.state.simTimeMs, parked);

  /* ── the shipped page: debug tooling stays out of player-facing UI ─────── */
  // Undo whatever the real F3s above did to the shipped overlay, so B45 is asking about
  // the page a player loads and not about this suite's own keystrokes.
  if (liveDebug && liveDebug.classList.contains('on') !== liveWasOn) key('F3');
  ok('B42 the shipped overlay is its own node', !!liveDebug);
  if (liveDebug) {
    const hudTop = document.getElementById('hudTop');
    const hudBottom = document.getElementById('hudBottom');
    ok('B43 and lives outside the HUD, not inside it',
      !!hudTop && !hudTop.contains(liveDebug) && !!hudBottom && !hudBottom.contains(liveDebug));
    const playerFacing = ['hudTop', 'hudBottom', 'hudToasts', 'screenTitle', 'screenPause']
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((el) => el.textContent).join(' ');
    const leaked = ['DEV OVERLAY', 'rng draws', 'containment', 'time scale', 'clamped']
      .filter((s) => playerFacing.includes(s));
    eq('B44 and no debug field has leaked into a player-facing panel', leaked.length, 0,
      leaked.join(', '));
    /* `liveWasOn` was read at the TOP of this section, before a single F3 was dispatched.
       Asserting `!liveDebug.classList.contains('on')` down here asked about the page after
       this suite had opened and closed the shipped overlay four times and then put it back
       — so it was testing the suite's own restore, not the build. The fresh-page question
       can only be answered by the value taken on the fresh page. */
    eq('B45 the shipped overlay was shut before this suite ever pressed F3', liveWasOn, false);
    eq('B45b and this suite handed it back the way it found it',
      liveDebug.classList.contains('on'), liveWasOn);
  }
}

/* ══ C. restart resets the AIRCRAFT too ══════════════════════════════════ */
/*
 * The existing restart assertions (m6 C8-C13, m0, m4) name the clock, the score, the bags,
 * the carts, the flights, the stats and the event log. `aircraftById` is named by none of
 * them — and an aircraft carries state the flight record does not: a position part-way
 * down the taxi lane, `present`, and a cargo door caught mid-travel.
 *
 * So this restarts from a moment chosen to have all three dirty at once, and proves the
 * roster is rebuilt rather than reused.
 */
function sectionC() {
lines.push('--- C. restart completeness includes aircraftById ---');

  const g = newGame(4321);
  g.startShift();

  // Mid-pushback on the first flight, which is the only moment where one aircraft is
  // displaced down the lane while another is sitting with its hold wide open.
  const ab = g.state.flightsById.flight_AB221;
  g.skipMs(ab.times.departureMs + CONFIG.flight.pushbackMs * 0.5);

  const before = Object.values(g.state.aircraftById).map((a) => ({
    id: a.id, x: a.x, present: a.present, holdOpen: a.holdOpen, door01: a.door01, ref: a,
  }));
  const displaced = before.filter((a) => Math.abs(a.x - g.state.aircraftById[a.id].parkX) > 0.5);
  const openDoors = before.filter((a) => a.present && a.holdOpen && a.door01 > 0.5);
  ok('C1 the moment chosen really has an aircraft off its parking spot', displaced.length > 0,
    JSON.stringify(before.map((a) => ({ id: a.id, x: +a.x.toFixed(1) }))));
  ok('C2 and another sitting with its hold open', openDoors.length > 0,
    JSON.stringify(before.map((a) => ({ id: a.id, open: a.holdOpen, d: +a.door01.toFixed(2) }))));
  note(`      before restart: ${displaced.length} aircraft off stand, ` +
       `${openDoors.length} with an open hold`);

  g.startShift();

  const after = Object.values(g.state.aircraftById);
  eq('C3 restart rebuilds one aircraft per flight', after.length, Object.keys(g.state.flightsById).length);
  ok('C4 and every one of them is a NEW record, not the one the last shift mutated',
    after.every((a) => !before.some((b) => b.ref === a)));
  const offStand = after.filter((a) => a.x !== a.parkX || a.y !== a.parkY);
  eq('C5 restart puts every aircraft back on its parking spot', offStand.length, 0,
    JSON.stringify(offStand.map((a) => ({ id: a.id, x: +a.x.toFixed(1), park: a.parkX }))));
  eq('C6 and none of them is present on the ramp', after.filter((a) => a.present).length, 0);
  eq('C7 and no hold is open', after.filter((a) => a.holdOpen).length, 0);
  eq('C8 and every cargo door is fully shut, not caught mid-travel',
    after.filter((a) => a.door01 !== 0).length, 0,
    JSON.stringify(after.map((a) => ({ id: a.id, door: a.door01 }))));
  ok('C9 every aircraft still points at a flight that exists',
    after.every((a) => !!g.state.flightsById[a.flightId] &&
                       g.state.flightsById[a.flightId].aircraftId === a.id));
  ok('C10 and every flight has an empty, unevaluated manifest again',
    Object.values(g.state.flightsById).every((f) =>
      f.loadedBagIds.length === 0 && f.evaluated === false &&
      f.outcome.correct === 0 && f.outcome.misrouted === 0 && f.outcome.missed === 0));

  /* The determinism contract is `describe()`, and when this section was written describe()
     did NOT carry the aircraft — so "a restart replays the fresh shift exactly" (m6 C13)
     was silent about where the aeroplanes were. src/game.js has since added an aircraft
     roster to describe() for exactly that reason, so this is no longer the only thing
     looking; it is still the FINER look, comparing a restarted shift against a fresh one
     part-way through the loading window rather than at a round number of seconds. */
  const fresh = newGame(4321);
  fresh.startShift();
  const at = ab.times.loadingMs + 20000;
  g.skipMs(at); fresh.skipMs(at);
  const pose = (s) => JSON.stringify(Object.values(s.aircraftById).map((a) => ({
    id: a.id, x: Math.round(a.x * 1e4), y: Math.round(a.y * 1e4),
    present: a.present, open: a.holdOpen, door: Math.round(a.door01 * 1e4),
  })));
  eq('C11 and a restarted shift flies its aircraft identically to a fresh one',
    pose(g.state), pose(fresh.state));
  note('      aircraft poses across a restart, at four decimals and mid-loading. m6 C13');
  note('      covers the same seed at 120 s through a snapshot that carries bags as well.');
}

/* ══ D. GDD §16.6 — keyboard-only operation ══════════════════════════════ */
/*
 * "keyboard-only operation supported in Phase 1." Every suite in the project happens to
 * drive the keyboard, and not one of them ASSERTS that a pointer is never needed — so the
 * day something starts reading input.pointerWorld to decide a verb, everything stays green
 * and the game quietly stops being playable without a mouse.
 *
 * This runs the whole core loop — move, aim, grab, scan, throw, placard, load a cart,
 * unload it, drive, hitch, haul to the gate, load a hold — through Input key events ONLY,
 * on an Input that has never seen a pointer, and checks at the end that it still has not.
 */
function sectionD() {
lines.push('--- D. GDD 16.6 the whole loop, keyboard only ---');

  const g = newGame(1616);
  g.startShift();
  const input = new Input(window);
  const p = g.state.player;

  eq('D1 a fresh Input has seen no pointer', input.pointer.seen, false);
  eq('D2 and has no world aim from one', input.pointerWorld, null);

  /* Aim. This is the mechanism the whole section rests on: with no pointerWorld, the hands
     point the way the player is walking (entities/player.js). Without it a keyboard player
     would reach permanently east. */
  const x0 = p.x;
  for (let i = 0; i < 40; i++) { input._debugPress('KeyD'); g.frame(FRAME_MS, input); }
  input._debugRelease('KeyD'); g.frame(FRAME_MS, input);
  ok('D3 the player walks on the movement keys alone', p.x > x0 + 0.5, `${x0.toFixed(2)} -> ${p.x.toFixed(2)}`);
  ok('D4 and the hands aim the way they walked', p.aimX > 0.9, `aim ${p.aimX.toFixed(2)},${p.aimY.toFixed(2)}`);
  for (let i = 0; i < 40; i++) { input._debugPress('KeyW'); g.frame(FRAME_MS, input); }
  input._debugRelease('KeyW'); g.frame(FRAME_MS, input);
  ok('D5 aim follows a change of direction, not just the first one', p.aimY < -0.9,
    `aim ${p.aimX.toFixed(2)},${p.aimY.toFixed(2)}`);

  /* Grab, scan, throw. */
  const b1 = bagAhead(g, 'flight_AB221');
  g.frame(FRAME_MS, input);
  tap(g, input, 'KeyE');
  eq('D6 E grabs the bag the hands are pointing at', p.carryingBagId, b1.id);
  tap(g, input, 'KeyQ');
  ok('D7 Q scans it', !!g.state.scan && g.state.scan.bagId === b1.id);
  input._debugPress('Space');
  for (let i = 0; i < 45; i++) g.frame(FRAME_MS, input);
  input._debugRelease('Space');
  // Where it was let go of: a carried bag is PINNED to the hands, so this is its position
  // on the step before the release edge is consumed.
  const threwFrom = { x: b1.x, y: b1.y };
  g.frame(FRAME_MS, input);
  eq('D8 Space charges and releases a throw', p.carryingBagId, null);

  /* "under its own steam" was `Math.hypot(vx, vy) > 0 || location.type === 'floor'`. A
     throw that imparted ZERO velocity leaves the bag on the floor, which is the right-hand
     branch — so the condition was satisfied by the failure as readily as by the success and
     could not go red. The A-section's own BAG_THROWN payload check already names the spec
     number; use it here too, and then watch the bag actually cross some floor. */
  const launched = Math.hypot(b1.vx, b1.vy);
  ok('D9 and the bag left the hands at throwing speed',
    launched >= CONFIG.bag.throwMinSpeed,
    `${launched.toFixed(2)} m/s against a ${CONFIG.bag.throwMinSpeed} m/s tap`);
  for (let i = 0; i < 20 && b1.location.type === 'floor'; i++) g.frame(FRAME_MS, input);
  const flew = Math.hypot(b1.x - threwFrom.x, b1.y - threwFrom.y);
  ok('D9b and covered metres of floor doing it', flew > 1, `${flew.toFixed(2)} m`);

  /* Placard, load, unload — the sorting verb, at a cart the player walked to. */
  const cart = g.state.cartsById.cart_1;
  walkTo(g, input, cart.x + 1.6, cart.y);
  g.frame(FRAME_MS, input);
  ok('D10 walking put the crew at the cart', g.state.player.targetCartId === cart.id,
    `target ${g.state.player.targetCartId}`);
  tap(g, input, 'KeyF');
  ok('D11 F sets the cart placard', cart.placardFlightId !== null && !!cart.placardLabel,
    `${cart.placardFlightId}`);
  const b2 = bagAhead(g, cart.placardFlightId);
  g.frame(FRAME_MS, input);
  tap(g, input, 'KeyE');
  eq('D12 E picks the next bag up', p.carryingBagId, b2.id);
  tap(g, input, 'KeyE');
  ok('D13 and E again loads it into the cart', cart.bagIds.includes(b2.id), b2.location.type);
  tap(g, input, 'KeyE');
  eq('D14 and E with empty hands takes one back out', p.carryingBagId, b2.id);
  tap(g, input, 'KeyE');

  /* Transport. Out on the apron, because a hitch attempt on the marked bays reaches the
     cart parked on the next bay instead (m6 B3). */
  const v = g.state.vehiclesById.tractor_1;
  const cart2 = g.state.cartsById.cart_2;
  cart2.x = 46; cart2.y = 30; cart2.rot = 0;
  v.x = cart2.x + 2.0; v.y = cart2.y; v.rot = 0;
  g.frame(FRAME_MS, input);
  p.x = v.x; p.y = v.y;
  for (let i = 0; i < 3; i++) {
    const b = makeBag(g, 'flight_AB221', { x: cart2.x, y: cart2.y });
    moveBag(g.state, b, { type: 'cart', id: cart2.id }, g.bus, g.state.simTimeMs);
  }
  g.frame(FRAME_MS, input);
  tap(g, input, 'KeyF');
  eq('D15 F climbs into the tractor', p.drivingId, v.id);
  tap(g, input, 'KeyE');
  eq('D16 E hitches the cart behind it', cart2.hitchedToId, v.id);
  eq('D17 and the chain is sound', validateChain(g.state).length, 0);

  const flight = g.state.flightsById.flight_AB221;
  const ac = g.state.aircraftById[flight.aircraftId];
  let guard = 0;
  while (!isHoldOpen(flight) && guard++ < 900 && g.state.simTimeMs < flight.times.holdClosingMs) {
    g.skipMs(1000);
  }
  ok('D18 the hold the crew is driving to is open', isHoldOpen(flight) && ac.holdOpen, flight.state);

  const z = aircraftHoldZone(ac);
  const drove = driveTo(g, input, z.x + CONFIG.tractor.towOffsetM + CONFIG.cart.linkM, z.y);
  ok('D19 W and the steering keys haul the train to the stand',
    Math.hypot(v.x - z.x, v.y - z.y) < 8, `${Math.hypot(v.x - z.x, v.y - z.y).toFixed(1)} m away`);
  eq('D20 with the cart still behind it', cart2.hitchedToId, v.id);
  note(`      keyboard-only haul to gate 1: ${(drove / 60).toFixed(1)} s of driving`);

  tap(g, input, 'KeyF');
  eq('D21 F gets the crew back out', p.drivingId, null);
  walkTo(g, input, cart2.x, cart2.y, 400);
  g.frame(FRAME_MS, input);
  ok('D22 a cart parked at the door puts both the cart and the hold in reach',
    g.state.player.targetCartId === cart2.id && g.state.player.targetHoldId === ac.id,
    `cart ${g.state.player.targetCartId} hold ${g.state.player.targetHoldId}`);
  tap(g, input, 'KeyE');
  ok('D23 E takes a bag off the cart', !!p.carryingBagId, `${p.carryingBagId}`);
  const carried = p.carryingBagId;
  tap(g, input, 'KeyE');
  ok('D24 and E again puts it in the hold', flight.loadedBagIds.includes(carried),
    g.state.bagsById[carried].location.type);

  /* PARITY, which is what §16.6 actually claims.
   *
   * D25/D26 used to re-read `input.pointer.seen` and `input.pointerWorld` here and assert
   * they were still false and null. D1/D2 had already asserted exactly those two values on
   * exactly that object, and nothing in this section COULD have changed them: the Input was
   * never attached to a window and every key went in through `_debugPress`. They asserted
   * that the suite had not written to its own variable.
   *
   * The claim worth making is that the verbs do not CONSULT the pointer. So run one
   * scripted loop twice — once on an Input that has never seen a pointer, once on one
   * holding a pointer aimed exactly where the keys are already aiming — and demand the same
   * outcome. Same aim on both sides, so a divergence can only be a verb reading
   * `pointerWorld` to decide what it acts on, which is the day the game stops being
   * playable without a mouse. */
  let keyRunSawPointer = null;
  const scriptedLoop = (withPointer) => {
    const h = newGame(1616);
    h.startShift();
    const inp = new Input(window);
    const hp = h.state.player;
    for (let i = 0; i < 40; i++) { inp._debugPress('KeyD'); h.frame(FRAME_MS, inp); }
    inp._debugRelease('KeyD'); h.frame(FRAME_MS, inp);
    if (withPointer) {
      inp.pointer.seen = true;
      inp.pointerWorld = { x: hp.x + 12, y: hp.y };   // due east: the way D3/D4 just aimed
    }
    const target = makeBag(h, 'flight_AB221', { x: hp.x + 0.7, y: hp.y });
    h.frame(FRAME_MS, inp);
    tap(h, inp, 'KeyE');                              // grab
    const grabbed = hp.carryingBagId === target.id;
    tap(h, inp, 'KeyQ');                              // scan
    const scanned = !!h.state.scan && h.state.scan.bagId === target.id;
    tap(h, inp, 'KeyE');                              // and set it down again
    // `Input`'s constructor does not bind anything — `attach()` does, and this one is never
    // attached — so the key-only run cannot acquire a pointer by accident. Recorded rather
    // than assumed: a constructor that started `seen` true, or a `_debugPress` that set it,
    // would make the two runs below indistinguishable for the wrong reason.
    if (!withPointer) keyRunSawPointer = inp.pointer.seen;
    // Ids and tag numbers differ between the two runs by construction, so the signature is
    // made of ANSWERS — did the verb act on the bag it was pointed at — never of names.
    return JSON.stringify({
      grabbed, scanned,
      verdict: h.state.scan ? h.state.scan.verdict : null,
      aim: [+hp.aimX.toFixed(3), +hp.aimY.toFixed(3)],
      handsEmpty: hp.carryingBagId === null,
      where: h.state.bagsById[target.id].location.type,
    });
  };
  const keysOnly = scriptedLoop(false);
  const keysAndMouse = scriptedLoop(true);
  ok('D25 the key-only run grabbed, scanned and set down the bag it aimed at, no pointer ever seen',
    /"grabbed":true/.test(keysOnly) && /"scanned":true/.test(keysOnly) &&
    keyRunSawPointer === false, `${keysOnly} sawPointer=${keyRunSawPointer}`);
  eq('D26 and a pointer aimed the same way changes nothing about any of it',
    keysAndMouse, keysOnly);
  eq('D27 and the keyboard-only shift kept containment', assertContainment(g.state).length, 0);
}

/* ══ E. GDD §7.1 — the scanner card says everything the GDD mocks up ══════ */
/*
 * §7.1 is the one piece of UI the document draws out in full:
 *
 *     BAG 004921
 *     FLIGHT 221 - ATLANTA
 *     GATE 2 - PRIORITY
 *     DEPARTS IN 06:14
 *
 * Only the BAG line was ever asserted (m1 G). Everything below it — the flight, the
 * destination, the gate, the PRIORITY and HEAVY markers, and the verdict — could be
 * deleted with no suite noticing.
 *
 * The "DEPARTS IN" countdown used to be left alone here, on the grounds that how it got its
 * time was being changed in src/ at the time. That change has landed, and the line it
 * landed on is the one the difficulty assist corrupted:
 *
 *     const departsMs = live ? live.times.departureMs : bag.expectedDepartureMs;
 *
 * Read `FLIGHT_DEFS` there instead of `state.flightsById` and the card counts down to a
 * departure the player did not choose — five minutes early on Unhurried, then sitting on
 * 0:00 while the hold is still open and the board on the same screen says otherwise. So
 * E23-E26 assert the VALUE, at the authored shift and at an assisted one, against the
 * authored number scaled by the assist rather than against whatever the card read from.
 *
 * The card is built against a detached root, so this needs no animation frame and cannot
 * disturb the shipped HUD's own card.
 */
function sectionE() {
lines.push('--- E. GDD 7.1 the scanner card body ---');

  const g = newGame(717);
  g.startShift();
  const root = document.createElement('div');
  const card = new ScannerCard(root);
  const read = () => card.el.textContent.replace(/\s+/g, ' ').trim();

  // Nothing scanned: §7.1 says the card "does not appear unless the player asked for it".
  card.update(g.state);
  ok('E1 with nothing scanned the card is not shown', !card.el.classList.contains('on'));

  /* A plain bag, nowhere in particular: the tag is read, and no verdict is claimed. */
  const plain = makeBag(g, 'flight_AB221', { x: 40, y: 30 });
  g.state.scan = { bagId: plain.id, atMs: g.state.simTimeMs, verdict: 'neutral', where: 'floor' };
  card.update(g.state);
  const t1 = read();
  ok('E2 a scan shows the card', card.el.classList.contains('on'));
  ok('E3 with the bag number, which is its identity', t1.includes(`BAG ${plain.tag}`), t1.slice(0, 60));
  ok('E4 the flight number', t1.includes('FLIGHT AB221'), t1.slice(0, 90));
  ok('E5 and the destination in words, not only a colour', t1.includes('ATLANTA'), t1.slice(0, 90));
  ok('E6 and the gate the crew has to reach', /GATE 1\b/.test(t1), t1.slice(0, 120));
  ok('E7 an ordinary bag is not marked PRIORITY', !t1.includes('PRIORITY'), t1);
  ok('E8 nor HEAVY', !t1.includes('HEAVY'), t1);
  ok('E9 and the verdict says the tag was read, nothing more', t1.includes('TAG READ'), t1);
  eq('E10 reading a bag never moves it', plain.location.type, 'floor');

  /* A priority heavy bag on another flight: every optional marker at once, and a second
     gate, so E6 cannot be passing on a hardcoded 1. */
  const loud = makeBag(g, 'flight_MC184', { x: 40, y: 30, priority: true, weightClass: 'heavy' });
  g.state.scan = { bagId: loud.id, atMs: g.state.simTimeMs + 1, verdict: 'correct', where: 'cart_1' };
  card.update(g.state);
  const t2 = read();
  ok('E11 a new scan rebuilds the card body', t2.includes(`BAG ${loud.tag}`) && !t2.includes(`BAG ${plain.tag}`),
    t2.slice(0, 60));
  ok('E12 the flight and destination follow the bag', t2.includes('FLIGHT MC184') && t2.includes('CHICAGO'),
    t2.slice(0, 90));
  ok('E13 and so does the gate', /GATE 2\b/.test(t2), t2.slice(0, 120));
  ok('E14 a priority bag is marked PRIORITY', t2.includes('PRIORITY'), t2);
  ok('E15 and a heavy one HEAVY', t2.includes('HEAVY'), t2);
  ok('E16 a correct placement reads as right in WORDS', t2.includes('RIGHT STAGING PAD'), t2);
  ok('E17 and carries the verdict as a class as well, so colour is a second channel',
    card.el.classList.contains('correct'), card.el.className);

  /* Wrong. GDD §7.1: "Players may ignore warnings" — it reports and never vetoes. */
  g.state.scan = { bagId: loud.id, atMs: g.state.simTimeMs + 2, verdict: 'wrong', where: 'cart_1' };
  card.update(g.state);
  const t3 = read();
  ok('E18 a wrong placement reads as wrong in words', t3.includes('WRONG STAGING PAD'), t3);
  ok('E19 and not merely as a colour', !card.el.classList.contains('correct') &&
    card.el.classList.contains('wrong'), card.el.className);
  ok('E20 warning about a bag does not move it', loud.location.type === 'floor');

  /* And it goes away again. */
  g.state.scan = null;
  card.update(g.state);
  ok('E21 the card hides when the scan expires', !card.el.classList.contains('on'));

  /* The mock-up's fourth line. */
  g.state.scan = { bagId: plain.id, atMs: g.state.simTimeMs + 3, verdict: 'neutral', where: 'floor' };
  card.update(g.state);
  ok('E22 the DEPARTS IN line is present', read().includes('DEPARTS IN'), read());
  card.destroy();

  /* ── and it counts down to the right departure, at any assist ───────────────
   *
   * The authored departure is `FLIGHT_DEFS`; the one being PLAYED is that scaled by the
   * assist, at one authoring site (`createFlights` -> `scaleTimes`). Asserting the card
   * against `state.flightsById` would be asserting it against the thing it read, so the
   * expected string is built from the authored constant and the assist the player picked —
   * which is where the number comes from in the first place.
   *
   * Two assists, because the bug is invisible at 1.0: `FLIGHT_DEFS` and `state.flightsById`
   * agree exactly when the multiplier is 1, so a card reading the wrong one is green all
   * day on the authored shift and wrong on every assisted one. */
  const ab = FLIGHT_DEFS.find((f) => f.id === 'flight_AB221');
  for (const assist of [1, 1.6]) {
    const h = newGame(717);
    h.applySettings({ assist });
    h.startShift();
    h.skipMs(40000);                     // somewhere in the middle, not on a round boundary

    const root2 = document.createElement('div');
    const c2 = new ScannerCard(root2);
    const bag = makeBag(h, 'flight_AB221', { x: 40, y: 30 });
    h.state.scan = { bagId: bag.id, atMs: h.state.simTimeMs, verdict: 'neutral', where: 'floor' };
    c2.update(h.state);
    const shown = c2.el.textContent.replace(/\s+/g, ' ').trim();

    const wantMs = Math.round(ab.times.departureMs * assist) - h.state.simTimeMs;
    const want = GameClock.formatMs(wantMs);
    ok(`E23 (assist ${assist}) DEPARTS IN counts to the departure the player is playing`,
      shown.includes(`DEPARTS IN ${want}`),
      `wanted "${want}", card says "${(shown.match(/DEPARTS IN [^ ]*/) || [''])[0]}"`);
    // And it is a real countdown, not the placeholder the rebuild seeds the node with.
    ok(`E24 (assist ${assist}) and it is a live time, not the "--:--" placeholder`,
      !shown.includes('--:--') && wantMs > 0, shown.slice(0, 120));

    // The pair that makes E23 mean something: at 1.6 the answer must NOT be the authored
    // one. Without this, a card that ignored the assist entirely would still satisfy E23 at
    // assist 1 and fail only by coincidence.
    const unscaled = GameClock.formatMs(ab.times.departureMs - h.state.simTimeMs);
    if (assist !== 1) {
      ok('E25 an assisted shift does not count down to the authored departure',
        want !== unscaled && !shown.includes(`DEPARTS IN ${unscaled}`),
        `authored would read "${unscaled}", assisted reads "${want}"`);
    } else {
      ok('E25 the authored shift counts down to the authored departure', want === unscaled,
        `${want} vs ${unscaled}`);
    }
    c2.destroy(); root2.remove();
  }
}

/* ── run ─────────────────────────────────────────────────────────────────── */
(async () => {
  const sections = [
    ['A', sectionA], ['C', sectionC], ['D', sectionD], ['E', sectionE], ['B', sectionB],
  ];
  for (const [name, fn] of sections) {
    emit(`RUNNING section ${name}...`);
    try { await fn(); }
    catch (e) { fails++; lines.push(`FAIL  section ${name} threw: ${(e && e.stack) || e}`); }
    emit(`RUNNING (section ${name} done)`);
  }
  emit();
})();
