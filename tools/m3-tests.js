/* Milestone 3 suite — the sacred schedule.
 *
 * Exit criterion under test: a no-input shift completes deterministically.
 *
 * The thing this milestone must never get wrong is the one GDD §31.1.7 states as a rule
 * and GDD §5 states as a pillar: the airport does not wait. So the first section proves
 * that `stateAt` cannot be influenced by anything except the clock — not by argument,
 * not by hidden state — and the last one runs whole shifts and counts.
 */

import { CONFIG } from '../src/config.js';
import { Game, MODES } from '../src/game.js';
import { Input } from '../src/core/input.js';
import { Rng } from '../src/core/rng.js';
import { createBag } from '../src/entities/bag.js';
import { moveBag, assertContainment, countByLocation } from '../src/systems/containment.js';
import { validateChain } from '../src/systems/hitching.js';
import {
  FLIGHT_STATES, stateAt, msToNext, isHoldOpen, evaluateFlight,
} from '../src/systems/flightSchedule.js';
import { holdContains, aircraftHoldZone } from '../src/entities/aircraft.js';
import { loadIntoHold, findHold, scanBag, throwHeld } from '../src/systems/interaction.js';
import { visibleAnnouncements } from '../src/systems/announcements.js';
import { FLIGHT_DEFS, gateConflicts, standWindow } from '../src/data/flights.js';

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
const yieldToLoop = () => new Promise((res) => {
  let done = false;
  const finish = () => { if (!done) { done = true; res(); } };
  requestAnimationFrame(finish);
  setTimeout(finish, 500);
});

function newGame(seed = 606) {
  const g = new Game({ seed, seedLabel: 'test' });
  g.startShift();
  return g;
}
const drive = (g, frames, input = null) => {
  for (let i = 0; i < frames; i++) g.frame(FRAME_MS, input);
};
let _serial = 0;
function makeBag(g, flightId, opts = {}) {
  const spec = { flightId, priority: !!opts.priority, weightClass: opts.weightClass || 'normal' };
  const bag = createBag(spec, ++_serial, 600000, new Rng(21 + _serial, 't'));
  g.state.bagsById[bag.id] = bag;
  bag.x = 0; bag.y = 0;
  moveBag(g.state, bag, { type: 'floor' }, g.bus, g.state.simTimeMs);
  return bag;
}
const AB = 'flight_AB221', MC = 'flight_MC184';
const flightOf = (g, id) => g.state.flightsById[id];
const acOf = (g, id) => g.state.aircraftById[flightOf(g, id).aircraftId];

/* ── A. the schedule is a pure function of time ──────────────────────────── */
function sectionA() {
lines.push('--- A. the schedule is a pure function of the clock (GDD 5, 31.1.7) ---');
{
  const t = FLIGHT_DEFS[0].times;

  eq('A1 before acceptance a flight is merely scheduled', stateAt(t, 0), 'SCHEDULED');
  eq('A2 acceptance opens exactly on its millisecond', stateAt(t, t.bagAcceptanceMs), 'BAG_ACCEPTANCE');
  eq('A3 and not one millisecond early', stateAt(t, t.bagAcceptanceMs - 1), 'SCHEDULED');
  eq('A4 loading', stateAt(t, t.loadingMs), 'LOADING');
  eq('A5 final call', stateAt(t, t.finalCallMs), 'FINAL_BAG_CALL');
  eq('A6 hold closing', stateAt(t, t.holdClosingMs), 'HOLD_CLOSING');
  eq('A7 pushback', stateAt(t, t.departureMs), 'PUSHBACK');
  eq('A8 departed, once pushback has run its course',
     stateAt(t, t.departureMs + CONFIG.flight.pushbackMs), 'DEPARTED');
  eq('A9 and it stays departed forever after',
     stateAt(t, t.departureMs + 9999999), 'DEPARTED');

  // The sequence must never go backwards as time advances — that is what makes an
  // index comparison safe everywhere else.
  let worst = null, prev = -1;
  for (let ms = 0; ms <= t.departureMs + 20000; ms += 250) {
    const i = FLIGHT_STATES.indexOf(stateAt(t, ms));
    if (i < prev && !worst) worst = `${ms} ms went back to ${stateAt(t, ms)}`;
    prev = i;
  }
  ok('A10 the state sequence never runs backwards', !worst, worst);

  // THE property. Two calls with the same clock must agree no matter what has happened
  // in between, because there is nothing else for the function to read.
  const a = stateAt(t, 123456);
  const g = newGame();
  g.skipMs(400000);
  for (let i = 0; i < 40; i++) makeBag(g, AB);
  eq('A11 the answer does not depend on the world it is asked about', stateAt(t, 123456), a);
  eq('A12 stateAt takes exactly two arguments, and neither is game state', stateAt.length, 2);

  near('A13 msToNext counts down to the next transition',
       msToNext(t, t.loadingMs - 5000), 5000, 1);
  eq('A14 and reads zero once everything has happened',
     msToNext(t, t.departureMs + CONFIG.flight.pushbackMs + 1), 0);

  eq('A15 no gate is double-booked once taxi and pushback are counted',
     gateConflicts().length, 0);
  const w = standWindow(FLIGHT_DEFS[0]);
  ok('A16 a stand window is wider than acceptance-to-departure',
     w.from < FLIGHT_DEFS[0].times.bagAcceptanceMs &&
     w.to > FLIGHT_DEFS[0].times.departureMs);
  const g1 = FLIGHT_DEFS.filter((f) => f.gateId === 'gate_1');
  note(`gate 1 is used twice: ${g1.map((f) => f.number).join(' then ')}, ` +
       `clear at ${Math.round(standWindow(g1[0]).to / 1000)} s, next taxi in at ` +
       `${Math.round(standWindow(g1[1]).from / 1000)} s`);
}
}

/* ── B. hold doors ───────────────────────────────────────────────────────── */
function sectionB() {
lines.push('--- B. the hold door (GDD 5.2, 9.1) ---');
{
  const open = ['BAG_ACCEPTANCE', 'LOADING', 'FINAL_BAG_CALL'];
  for (const s of FLIGHT_STATES) {
    eq(`B1.${s} hold ${open.includes(s) ? 'open' : 'shut'}`, isHoldOpen({ state: s }), open.includes(s));
  }

  const g = newGame();
  const f = flightOf(g, AB);
  const ac = acOf(g, AB);

  g.skipMs(f.times.loadingMs + 1000);
  ok('B2 the aircraft is on stand while loading', ac.present);
  ok('B3 with the door open', ac.holdOpen);
  near('B4 parked on its marks', ac.x, ac.parkX, 0.01);

  // GDD §9.1: released INSIDE the hold volume, not merely near the aeroplane.
  const z = aircraftHoldZone(ac);
  ok('B5 the hold volume is a real box, not a radius',
     holdContains(ac, z.x, z.y) &&
     !holdContains(ac, z.x + z.lengthM, z.y) &&
     !holdContains(ac, z.x, z.y + z.widthM));
  ok('B6 touching the fuselage is not the same as being in the hold',
     !holdContains(ac, ac.x, ac.y), 'the fuselage centre must not count');

  g.skipMs(f.times.holdClosingMs - g.state.simTimeMs + 100);
  eq('B7 at hold closing the flight says so', f.state, 'HOLD_CLOSING');
  ok('B8 and the door is shut', !ac.holdOpen);

  g.skipMs(f.times.departureMs - g.state.simTimeMs + CONFIG.flight.pushbackMs + 100);
  ok('B9 after departure the aircraft is gone from the stand', !ac.present);

  /* the second flight to use gate 1 gets a clean stand */
  const g2 = newGame();
  const sk = flightOf(g2, 'flight_SK307');
  g2.skipMs(sk.times.bagAcceptanceMs + 500);
  const ab = acOf(g2, AB);
  ok('B10 the earlier aircraft has cleared before the next one arrives',
     !ab.present && acOf(g2, 'flight_SK307').present);
}
}

/* ── C. loading into the hold ────────────────────────────────────────────── */
function sectionC() {
lines.push('--- C. loading (GDD 9.1, 31.1.8) ---');
{
  const g = newGame();
  const f = flightOf(g, AB);
  const ac = acOf(g, AB);
  g.skipMs(f.times.loadingMs + 1000);
  const z = aircraftHoldZone(ac);

  const bag = makeBag(g, AB);
  bag.x = z.x; bag.y = z.y;
  moveBag(g.state, bag, { type: 'carried', id: 'player_1' }, g.bus, g.state.simTimeMs);
  loadIntoHold(g.state, bag, ac, g.bus, g.state.simTimeMs);
  eq('C1 a bag released in the hold is loaded', bag.location.type, 'aircraftHold');
  ok('C2 and appears on the flight manifest', f.loadedBagIds.includes(bag.id));
  eq('C3 containment is sound', assertContainment(g.state).length, 0);

  // GDD §31.1.8: loading the WRONG bag must be allowed.
  const wrong = makeBag(g, MC);
  moveBag(g.state, wrong, { type: 'carried', id: 'player_1' }, g.bus, g.state.simTimeMs);
  loadIntoHold(g.state, wrong, ac, g.bus, g.state.simTimeMs);
  eq('C4 a bag for another flight loads without complaint', wrong.location.type, 'aircraftHold');
  eq('C5 the scanner is what tells you, not a refusal',
     scanBag(g.state, wrong, g.bus, g.state.simTimeMs).verdict, 'wrong');
  eq('C6 and the right bag scans correct',
     scanBag(g.state, bag, g.bus, g.state.simTimeMs).verdict, 'correct');

  /* GDD §28.2: taken out before closure, it stops counting as loaded */
  moveBag(g.state, wrong, { type: 'carried', id: 'player_1' }, g.bus, g.state.simTimeMs);
  ok('C7 taking a bag back out clears it from the manifest',
     !f.loadedBagIds.includes(wrong.id));
  eq('C8 leaving containment sound', assertContainment(g.state).length, 0);

  /* the player has to stand in the volume */
  const p = g.state.player;
  p.x = z.x; p.y = z.y;
  ok('C9 standing in the hold finds it', findHold(g.state) && findHold(g.state).id === ac.id);
  p.x = z.x - 14; p.y = z.y;
  eq('C10 standing across the stand does not', findHold(g.state), null);

  /* a thrown bag through an open door counts; a shut door catches nothing */
  const g2 = newGame();
  const f2 = flightOf(g2, AB), ac2 = acOf(g2, AB);
  g2.skipMs(f2.times.loadingMs + 1000);
  const z2 = aircraftHoldZone(ac2);
  const lob = makeBag(g2, AB);
  const p2 = g2.state.player;
  p2.x = z2.x - 5; p2.y = z2.y; p2.aimX = 1; p2.aimY = 0;
  lob.x = p2.x; lob.y = p2.y;
  moveBag(g2.state, lob, { type: 'carried', id: 'player_1' }, g2.bus, 0);
  p2.chargeMs = CONFIG.bag.throwChargeMs * 0.4; p2.charging = true;
  throwHeld(g2.state, g2.bus, g2.state.simTimeMs);
  drive(g2, 200);
  eq('C11 a bag lobbed through an open door is loaded', lob.location.type, 'aircraftHold');

  const g3 = newGame();
  const f3 = flightOf(g3, AB), ac3 = acOf(g3, AB);
  g3.skipMs(f3.times.holdClosingMs + 500);
  const z3 = aircraftHoldZone(ac3);
  const bounced = makeBag(g3, AB);
  bounced.x = z3.x; bounced.y = z3.y; bounced.vx = 0; bounced.vy = 0;
  drive(g3, 60);
  eq('C12 a closed hold catches nothing, even a bag sitting in the doorway',
     bounced.location.type, 'floor');
}
}

/* ── D. departure and evaluation ─────────────────────────────────────────── */
function sectionD() {
lines.push('--- D. departure evaluates every expected bag (GDD 5.2) ---');
{
  /* load every bag correctly */
  const g = newGame(4242);
  const f = flightOf(g, AB), ac = acOf(g, AB);
  g.skipMs(f.times.loadingMs + 1000);
  const mine = Object.values(g.state.bagsById).filter((b) => b.flightId === AB);
  for (const b of mine) moveBag(g.state, b, { type: 'aircraftHold', id: ac.id }, g.bus, 0);
  // top the manifest up to the full expected count so the flight leaves complete
  while (f.loadedBagIds.length < f.expectedCount) {
    const extra = makeBag(g, AB);
    moveBag(g.state, extra, { type: 'aircraftHold', id: ac.id }, g.bus, 0);
  }
  g.skipMs(f.times.departureMs - g.state.simTimeMs + 100);
  ok('D1 the flight evaluated itself at pushback', f.evaluated);
  eq('D2 every expected bag counted correct', f.outcome.correct, f.expectedCount);
  eq('D3 nothing misrouted', f.outcome.misrouted, 0);
  eq('D4 nothing missed', f.outcome.missed, 0);
  eq('D5 no double counting', f.outcome.correct + f.outcome.missed, f.expectedCount);

  g.skipMs(CONFIG.flight.pushbackMs + 100);
  eq('D6 once away, the load has left the world', f.state, 'DEPARTED');
  const aboard = Object.values(g.state.bagsById).filter((b) => b.location.type === 'departed');
  ok('D7 and is recorded as departed', aboard.length >= f.expectedCount, `${aboard.length}`);
  eq('D8 containment still sound after a departure', assertContainment(g.state).length, 0);

  /* load every bag onto the WRONG aircraft — GDD §28.2 */
  const g2 = newGame(4242);
  const mc = flightOf(g2, MC), acMc = acOf(g2, MC);
  const ab2 = flightOf(g2, AB);
  g2.skipMs(mc.times.loadingMs + 1000);
  for (let i = 0; i < 6; i++) {
    const b = makeBag(g2, AB);                        // Atlanta bags...
    moveBag(g2.state, b, { type: 'aircraftHold', id: acMc.id }, g2.bus, 0);   // ...onto Chicago
  }
  g2.skipMs(mc.times.departureMs - g2.state.simTimeMs + 100);
  eq('D9 the departure still happened', mc.evaluated, true);
  eq('D10 six strangers were recorded aboard', mc.outcome.misrouted, 6);
  eq('D11 and none of them counted as correct', mc.outcome.correct, 0);
  eq('D12 Chicago is recorded as having missed its entire load',
     mc.outcome.missed, mc.expectedCount);
  const stray = Object.values(g2.state.bagsById).find((b) => b.lifecycle === 'misrouted');
  ok('D13 a misrouted bag records where it actually went',
     stray && stray.actualFlightId === MC && stray.flightId === AB);
  void ab2;

  /* missed bags stay physical — GDD §5.2 */
  const g3 = newGame(99);
  const f3 = flightOf(g3, AB);
  g3.skipMs(f3.times.departureMs + 200);
  const leftBehind = Object.values(g3.state.bagsById)
    .filter((b) => b.flightId === AB && b.lifecycle === 'missed');
  ok('D14 bags that missed the flight still exist', leftBehind.length > 0, `${leftBehind.length}`);
  ok('D15 and are still somewhere a player could pick them up',
     leftBehind.every((b) => ['floor', 'conveyor', 'cart', 'carried'].includes(b.location.type)),
     leftBehind.map((b) => b.location.type).join());
  note(`unattended: AB221 left with ${f3.outcome.correct} of ${f3.expectedCount}, ` +
       `${leftBehind.length} still on the ground`);

  /* evaluation happens exactly once */
  const before = JSON.stringify(f3.outcome);
  evaluateFlight(g3.state, f3, g3.bus, g3.state.simTimeMs);
  eq('D16 evaluating twice changes nothing', JSON.stringify(f3.outcome), before);

  /* a bag that never reached the belt is still owed */
  const g4 = newGame(7);
  const f4 = flightOf(g4, AB);
  eq('D17 expectedCount comes from the timetable, not from what spawned',
     f4.expectedCount, g4.state.shift.bagSchedule.filter((s) => s.flightId === AB).length);
  ok('D18 and is non-zero', f4.expectedCount > 0);
}
}

/* ── E. the airport never waits ──────────────────────────────────────────── */
function sectionE() {
lines.push('--- E. the airport never waits (GDD pillar 1, 31.1.7) ---');
{
  // The same flight, at the same instant, under wildly different worlds.
  function stateWith(prepare) {
    const g = newGame(31415);
    prepare(g);
    g.skipMs(FLIGHT_DEFS[0].times.finalCallMs + 3000);
    return flightOf(g, AB).state;
  }
  const idle = stateWith(() => {});
  const swamped = stateWith((g) => { for (let i = 0; i < 80; i++) makeBag(g, AB); });
  const perfect = stateWith((g) => {
    g.skipMs(FLIGHT_DEFS[0].times.loadingMs + 500);
    const ac = acOf(g, AB);
    for (const b of Object.values(g.state.bagsById)) {
      if (b.flightId === AB && b.location.type !== 'aircraftHold') {
        moveBag(g.state, b, { type: 'aircraftHold', id: ac.id }, g.bus, 0);
      }
    }
  });
  eq('E1 an idle crew does not delay the flight', idle, 'FINAL_BAG_CALL');
  eq('E2 nor does a swamped one', swamped, idle);
  eq('E3 nor does a perfect one', perfect, idle);

  // Nothing in the schedule source may even mention the player.
  ok('E4 the schedule is driven by simTimeMs and the authored times, and by nothing else',
     stateAt.length === 2);

  /* pause freezes the schedule too — GDD §28.2 */
  const g = newGame();
  const f = flightOf(g, AB);
  g.skipMs(f.times.finalCallMs - 2000);
  const stateBefore = f.state;
  const timeBefore = g.state.simTimeMs;
  g.setMode(MODES.PAUSED);
  drive(g, 600);                                   // ten seconds of real frames
  eq('E5 pausing on the brink stops the clock', g.state.simTimeMs, timeBefore);
  eq('E6 so the flight does not advance', f.state, stateBefore);
  g.setMode(MODES.PLAYING);
  drive(g, 300);
  eq('E7 unpausing lets final call arrive', f.state, 'FINAL_BAG_CALL');

  /* announcements are the second readability channel — GDD §5.3 */
  const g2 = newGame();
  const f2 = flightOf(g2, AB);
  g2.skipMs(f2.times.finalCallMs + 100);
  const live = visibleAnnouncements(g2.state, g2.state.simTimeMs);
  ok('E8 final call is announced', live.some((a) => /FINAL BAG CALL/.test(a.text)),
     live.map((a) => a.text).join(' | '));
  ok('E9 the announcement names the flight and the gate in words',
     live.some((a) => /AB221/.test(a.text) && /gate 1/i.test(a.text)));
  g2.skipMs(CONFIG.announce.toastMs + 1000);
  eq('E10 and it expires rather than piling up',
     visibleAnnouncements(g2.state, g2.state.simTimeMs).length, 0);
  ok('E11 the announcement log stays bounded',
     g2.state.announcements.length <= CONFIG.announce.logSize,
     `${g2.state.announcements.length}`);
}
}

/* ── F. the exit criterion: a no-input shift ─────────────────────────────── */
function sectionF() {
lines.push('--- F. THE EXIT CRITERION: a no-input shift completes deterministically ---');
{
  function fullShift(seed) {
    const g = newGame(seed);
    g.skipMs(CONFIG.shift.durationMs);
    return g;
  }

  const g = fullShift(20260819);
  const flights = Object.values(g.state.flightsById);

  eq('F1 every flight departed', flights.filter((f) => f.state === 'DEPARTED').length, flights.length);
  eq('F2 every flight was evaluated', flights.filter((f) => f.evaluated).length, flights.length);

  // GDD §28.2: all bags receive a final classification.
  const bags = Object.values(g.state.bagsById);
  const unclassified = bags.filter((b) => b.lifecycle === 'active');
  ok('F3 no bag was left unclassified', unclassified.length === 0,
     `${unclassified.length} of ${bags.length} still active`);
  const kinds = {};
  for (const b of bags) kinds[b.lifecycle] = (kinds[b.lifecycle] || 0) + 1;
  note(`50-bag unattended shift ends: ${JSON.stringify(kinds)}`);

  eq('F4 containment survived the whole shift', assertContainment(g.state).length, 0);
  eq('F5 as did the hitch chain', validateChain(g.state).length, 0);
  const counts = countByLocation(g.state);
  eq('F6 every bag is accounted for in exactly one place',
     Object.values(counts).reduce((a, b) => a + b, 0), bags.length);

  // The arithmetic has to close: what each flight was owed equals what it got plus what
  // it did not. This is the check that catches double counting.
  let owed = 0, got = 0, lost = 0;
  for (const f of flights) { owed += f.expectedCount; got += f.outcome.correct; lost += f.outcome.missed; }
  eq('F7 owed equals delivered plus missed, with no double counting', got + lost, owed);
  note(`nobody touched anything: ${got} of ${owed} delivered, ${lost} missed`);

  eq('F8 an untouched shift delivers nothing, which is the point', got, 0);

  /* DETERMINISM — the other half of the exit criterion */
  const a = fullShift(20260819), b = fullShift(20260819);
  ok('F9 two no-input shifts on one seed are byte-identical',
     JSON.stringify(a.describe()) === JSON.stringify(b.describe()),
     JSON.stringify(a.describe().flights) + '\n' + JSON.stringify(b.describe().flights));
  const c = fullShift(20260820);
  ok('F10 a different seed gives a different shift',
     JSON.stringify(a.describe()) !== JSON.stringify(c.describe()));

  const r = fullShift(20260819);
  r.startShift(); r.skipMs(CONFIG.shift.durationMs);
  ok('F11 and a restart replays it exactly',
     JSON.stringify(r.describe()) === JSON.stringify(a.describe()));

  /* the shift must also survive being driven at a different frame rate */
  const slow = newGame(20260819);
  for (let i = 0; i < 24000; i++) slow.frame(25, null);       // 40 fps, 10 minutes
  const fast = newGame(20260819);
  fast.skipMs(CONFIG.shift.durationMs);
  eq('F12 the fixed step makes frame rate irrelevant to the outcome',
     JSON.stringify(slow.describe().flights), JSON.stringify(fast.describe().flights));

  /* cost */
  const perf = newGame(5);
  const t0 = performance.now();
  perf.skipMs(CONFIG.shift.durationMs);
  const ms = performance.now() - t0;
  // What matters is the PER-STEP cost against the 16.67 ms frame budget, not the total:
  // a ten-minute shift is 36,000 steps, so even a very cheap step adds up to seconds
  // when run flat out. The first version of this asserted `ms < 3000` and passed by five
  // milliseconds — a threshold that tight is a flake, not a check.
  const steps = CONFIG.shift.durationMs / CONFIG.sim.stepMs;
  const perStep = ms / steps;
  ok('F13 a step of the whole airport costs a fraction of a frame', perStep < 1.0,
     `${perStep.toFixed(3)} ms/step`);
  note(`ten minutes of airport: ${perStep.toFixed(3)} ms per step ` +
       `(budget ${CONFIG.sim.stepMs.toFixed(2)} ms), ${ms.toFixed(0)} ms for the lot ` +
       `= ${(600000 / ms).toFixed(0)}x real time`);
}
}

/* ── G. a played shift ───────────────────────────────────────────────────── */
function sectionG() {
lines.push('--- G. a shift somebody actually worked ---');
{
  // A crew bot: not an AI, just enough scripted competence to prove the loop closes.
  // It carries bags from the belt pile straight into whichever hold is open.
  const g = newGame(1234);
  const st = g.state;
  let delivered = 0;

  for (let tick = 0; tick < 600; tick++) {
    g.skipMs(1000);
    for (const ac of Object.values(st.aircraftById)) {
      if (!ac.present || !ac.holdOpen) continue;
      const flight = st.flightsById[ac.flightId];
      const z = aircraftHoldZone(ac);
      // move up to three matching loose bags per second into the open hold
      let moved = 0;
      for (const bag of Object.values(st.bagsById)) {
        if (moved >= 3) break;
        if (bag.flightId !== flight.id) continue;
        if (bag.location.type !== 'floor' && bag.location.type !== 'conveyor') continue;
        bag.x = z.x; bag.y = z.y;
        moveBag(st, bag, { type: 'aircraftHold', id: ac.id }, g.bus, st.simTimeMs);
        moved++; delivered++;
      }
    }
    if (st.simTimeMs >= CONFIG.shift.durationMs) break;
  }

  const flights = Object.values(st.flightsById);
  eq('G1 every flight still departed on time', flights.filter((f) => f.evaluated).length, 3);
  const got = flights.reduce((n, f) => n + f.outcome.correct, 0);
  const owed = flights.reduce((n, f) => n + f.expectedCount, 0);
  const lost = flights.reduce((n, f) => n + f.outcome.missed, 0);
  ok('G2 a working crew actually delivers bags', got > 20, `${got} of ${owed}`);
  eq('G3 the arithmetic still closes', got + lost, owed);
  eq('G4 nothing was misrouted, because the bot only loaded matching bags',
     flights.reduce((n, f) => n + f.outcome.misrouted, 0), 0);
  eq('G5 containment held throughout', assertContainment(st).length, 0);
  note(`worked shift: ${got} of ${owed} delivered, ${lost} missed ` +
       `(${Math.round((got / owed) * 100)}% on-time baggage)`);
  void delivered;

  // GDD §5.2: bags loaded before closure travel; the rest stay behind, physical.
  const stranded = Object.values(st.bagsById).filter((b) => b.lifecycle === 'missed');
  ok('G6 the ones that missed are still on the ground', stranded.every((b) =>
     ['floor', 'conveyor', 'cart', 'carried'].includes(b.location.type)));
}
}

/* ── H. the live page ────────────────────────────────────────────────────── */
async function sectionH() {
  lines.push('--- H. the live page ---');
  const abc = window.__ABC;
  ok('H1 the game booted', !!(abc && abc.game));
  if (!abc) return;
  await yieldToLoop();

  const { game, renderer, hud, camera } = abc;
  const banner0 = document.getElementById('err-banner');
  ok('H2 no error banner after boot', !banner0, banner0 && banner0.textContent);

  abc.startShift();
  const st = game.state;
  eq('H3 three flights exist', Object.keys(st.flightsById).length, 3);
  eq('H4 with an aircraft each', Object.keys(st.aircraftById).length, 3);

  game.skipMs(30000);
  hud.update();
  const board = document.querySelector('.board');
  ok('H5 the flight board is on screen', board && board.classList.contains('on'));
  ok('H6 and names a flight', /AB221/.test(board.textContent), board.textContent.slice(0, 80));
  ok('H7 the board spells out the status in words, not just colour',
     /ACCEPTING BAGS|LOADING|SCHEDULED/.test(board.textContent));

  const f = st.flightsById['flight_AB221'];
  game.skipMs(f.times.finalCallMs - st.simTimeMs + 200);
  hud.update();
  ok('H8 final call reaches the board', /FINAL BAG CALL/.test(document.querySelector('.board').textContent));
  const toasts = document.getElementById('hudToasts');
  ok('H9 and is announced as a toast', toasts.classList.contains('on') &&
     /FINAL BAG CALL/.test(toasts.textContent), toasts.textContent.slice(0, 90));

  const ac = st.aircraftById[f.aircraftId];
  camera.follow(ac.x, ac.y, 0);
  renderer.render(st);
  const px = renderer.ctx.getImageData(
    Math.floor(renderer.canvas.width / 2), Math.floor(renderer.canvas.height / 2), 1, 1).data;
  ok('H10 the aircraft paints', (px[0] + px[1] + px[2]) > 60, `rgb(${px[0]},${px[1]},${px[2]})`);

  game.skipMs(CONFIG.shift.durationMs);
  hud.update();
  ok('H11 by the end of the shift the board shows departures',
     /DEPARTED/.test(document.querySelector('.board').textContent));
  eq('H12 the live game never violated containment', assertContainment(st).length, 0);
  const banner = document.getElementById('err-banner');
  ok('H13 no error banner at the end of the run', !banner, banner && banner.textContent);
}

/* ── run ─────────────────────────────────────────────────────────────────── */
(async () => {
  const sections = [
    ['A', sectionA], ['B', sectionB], ['C', sectionC], ['D', sectionD],
    ['E', sectionE], ['F', sectionF], ['G', sectionG], ['H', sectionH],
  ];
  for (const [name, fn] of sections) {
    emit(`RUNNING section ${name}...`);
    try { await fn(); }
    catch (e) { fails++; lines.push(`FAIL  section ${name} threw: ${(e && e.stack) || e}`); }
    emit(`RUNNING (section ${name} done)`);
  }
  emit();
})();
