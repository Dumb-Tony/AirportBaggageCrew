/* Milestone 4 suite — outcomes and pressure.
 *
 * Exit criterion under test: full acceptance tests for all outcome paths pass.
 *
 * So this suite walks every path a bag can take to the end of a shift — delivered,
 * delivered late, put on the wrong aeroplane, left in a cart, left on the belt, never
 * spawned — and checks the arithmetic closes on each. GDD §28.2 names three of these
 * explicitly (load everything correctly, load everything wrongly, remove from a hold
 * before closure) and they are sections C and D.
 */

import { CONFIG } from '../src/config.js';
import { Game, MODES } from '../src/game.js';
import { Rng } from '../src/core/rng.js';
import { createBag } from '../src/entities/bag.js';
import { moveBag, assertContainment, countByLocation } from '../src/systems/containment.js';
import { validateChain } from '../src/systems/hitching.js';
import {
  createScore, scoreFlight, stepScoring, buildReport, onTimePercent, verdictFor,
} from '../src/systems/scoring.js';
import { SaveSystem, memoryStorage, BEST_KEY, SCHEMA_VERSION } from '../src/systems/save.js';
import { aircraftHoldZone } from '../src/entities/aircraft.js';

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

/** Always with a fake store: a suite must never write a high score into the browser. */
function newGame(seed = 404) {
  const g = new Game({ seed, seedLabel: 'test', storage: memoryStorage() });
  g.startShift();
  return g;
}
let _serial = 0;
function makeBag(g, flightId, opts = {}) {
  const spec = { flightId, priority: !!opts.priority, weightClass: opts.weightClass || 'normal' };
  const bag = createBag(spec, ++_serial, 700000, new Rng(31 + _serial, 't'));
  g.state.bagsById[bag.id] = bag;
  bag.x = 0; bag.y = 0;
  moveBag(g.state, bag, { type: 'floor' }, g.bus, g.state.simTimeMs);
  return bag;
}
const AB = 'flight_AB221', MC = 'flight_MC184', SK = 'flight_SK307';
const F = (g, id) => g.state.flightsById[id];
const AC = (g, id) => g.state.aircraftById[F(g, id).aircraftId];
const S = CONFIG.score;

/** Load n bags belonging to `owner` into `intoFlight`'s hold, mid-loading. */
function loadInto(g, intoFlight, owner, n, opts = {}) {
  const f = F(g, intoFlight), ac = AC(g, intoFlight);
  if (g.state.simTimeMs < f.times.loadingMs) {
    g.skipMs(f.times.loadingMs - g.state.simTimeMs + 500);
  }
  const made = [];
  for (let i = 0; i < n; i++) {
    const bag = makeBag(g, owner, opts);
    moveBag(g.state, bag, { type: 'aircraftHold', id: ac.id }, g.bus, g.state.simTimeMs);
    made.push(bag);
  }
  return made;
}
const runToEnd = (g) => { g.skipMs(g.state.shift.endTimeMs - g.state.simTimeMs + 1000); return g; };

/* ── A. the shift ends, and ends once ────────────────────────────────────── */
function sectionA() {
lines.push('--- A. the shift ends (GDD 20.2, 29) ---');
{
  const g = newGame();
  const end = g.state.shift.endTimeMs;

  // Derived from the last departure, not authored — GDD §3.3 wants 8-12 minutes.
  let lastClear = 0;
  for (const f of Object.values(g.state.flightsById)) {
    lastClear = Math.max(lastClear, f.times.departureMs + CONFIG.flight.pushbackMs);
  }
  eq('A1 the shift ends a wrap-up after the last aircraft is clear',
     end, lastClear + CONFIG.shift.wrapUpMs);
  ok('A2 which lands inside the 8-12 minute window GDD 3.3 asks for',
     end >= 480000 && end <= 720000, `${(end / 60000).toFixed(2)} min`);
  ok('A3 and leaves no dead ramp time at the end',
     end - lastClear <= 30000, `${(end - lastClear) / 1000} s after the last departure`);
  note(`shift is ${(end / 60000).toFixed(2)} min; last aircraft clear at ${(lastClear / 1000).toFixed(0)} s`);

  eq('A4 a fresh shift has not ended', g.state.shift.ended, false);
  eq('A5 and has no report', g.state.report, null);

  runToEnd(g);
  eq('A6 running past the end ends the shift', g.state.shift.ended, true);
  eq('A7 which switches to the report screen', g.state.mode, MODES.REPORT);
  ok('A8 and builds a report', !!g.state.report);

  // Idempotent: a second call must not rebuild or re-score.
  const first = g.state.report;
  const pts = g.state.score.points;
  g.endShift();
  g.skipMs(60000);
  ok('A9 ending twice does not rebuild the report', g.state.report === first);
  eq('A10 nor re-score it', g.state.score.points, pts);

  // Nothing moves after the whistle.
  const before = JSON.stringify(countByLocation(g.state));
  const beltBefore = g.state.world.conveyor.bagIds.length;
  g.skipMs(120000);
  eq('A11 the belt stops when the shift does', g.state.world.conveyor.bagIds.length, beltBefore);
  eq('A12 and no bag moves', JSON.stringify(countByLocation(g.state)), before);

  // Replay
  g.startShift();
  eq('A13 replay clears the ended flag', g.state.shift.ended, false);
  eq('A14 and the report', g.state.report, null);
  eq('A15 and the score', g.state.score.points, 0);
  eq('A16 and puts us back in play', g.state.mode, MODES.PLAYING);
}
}

/* ── B. scoring arithmetic ───────────────────────────────────────────────── */
function sectionB() {
lines.push('--- B. scoring (GDD 11.1) ---');
{
  /*
   * GDD §11.1's VALUES, pinned — and this is the only place in the project they are.
   *
   * Everything below compares the scorer's output against `CONFIG.score`, which is the
   * same constant the scorer read: change `correctBag` from 100 to 5 and B1-B8 all stay
   * green while the game quietly stops paying for work. The numbers §11.1 actually names
   * lived only in the assertion NAMES, where nothing could check them. They are asserted
   * against literals here, once, so the arithmetic checks below can go on reading `S`.
   *
   * If a balance pass moves one of these, it moves HERE first and deliberately — §31.4
   * licences retuning, §31.1.1 asks for the departure to be reported rather than slipped
   * in, and a failing line with the GDD section in its name is how that gets noticed.
   */
  eq('B0.1 GDD 11.1 a correctly loaded bag is worth 100', S.correctBag, 100);
  eq('B0.2 GDD 11.1 a priority bag is worth 50 more', S.priorityBonus, 50);
  eq('B0.3 GDD 11.1 a bag on the wrong aircraft costs 250', S.misroutedBag, -250);
  eq('B0.4 GDD 11.1 a missed bag costs 150', S.missedBag, -150);
  eq('B0.5 and the completion bonus is 250', S.perfectFlightBonus, 250);
  // §20.2 asks for a priority "bonus/penalty" without naming a value, so what is pinned
  // is the RELATIONSHIP the penalty was built to have: it sits on top of missedBag
  // exactly as the bonus sits on top of correctBag. Drift in either half shows up here.
  eq('B0.6 GDD 20.2 the priority miss penalty mirrors the priority bonus',
     S.priorityMissPenalty, -S.priorityBonus);

  // GDD §11.1 values, checked one path at a time against a hand-built outcome.
  function scoreOf(outcome, expectedCount) {
    const st = { score: createScore(), flightsById: {}, cartsById: {}, vehiclesById: {}, stats: {} };
    const flight = { id: 'f', number: 'XX000', destinationCode: 'XXX',
                     expectedCount, outcome, evaluated: true, scored: false };
    return scoreFlight(st, flight, null, 0);
  }
  const none = { correct: 0, correctPriority: 0, misrouted: 0, missed: 0, priorityMissed: 0 };

  eq('B1 a correct bag is worth +100', scoreOf({ ...none, correct: 1 }, 1) - S.perfectFlightBonus, S.correctBag);
  eq('B2 a priority bag adds +50 on top',
     scoreOf({ ...none, correct: 1, correctPriority: 1 }, 1) - S.perfectFlightBonus,
     S.correctBag + S.priorityBonus);
  eq('B3 a wrong-aircraft load costs -250', scoreOf({ ...none, misrouted: 1 }, 0), S.misroutedBag);
  eq('B4 a missed bag costs -150', scoreOf({ ...none, missed: 1 }, 1), S.missedBag);

  // GDD §11.1: "the relative cost of a wrong destination should exceed a simple miss".
  ok('B5 a wrong destination costs more than a simple miss',
     Math.abs(S.misroutedBag) > Math.abs(S.missedBag),
     `${S.misroutedBag} vs ${S.missedBag}`);

  eq('B6 a flight with everything aboard earns the completion bonus',
     scoreOf({ ...none, correct: 4 }, 4), 4 * S.correctBag + S.perfectFlightBonus);
  eq('B7 one missed bag loses the bonus',
     scoreOf({ ...none, correct: 3, missed: 1 }, 4), 3 * S.correctBag + S.missedBag);
  eq('B8 so does one stray aboard',
     scoreOf({ ...none, correct: 4, misrouted: 1 }, 4), 4 * S.correctBag + S.misroutedBag);

  /* the pull pass cannot double-count */
  const g = newGame();
  const f = F(g, AB);
  loadInto(g, AB, AB, 3);
  g.skipMs(f.times.departureMs - g.state.simTimeMs + 200);
  const after = g.state.score.points;
  eq('B9 a departure scores once', g.state.score.flightsHandled, 1);
  stepScoring(g.state, g.bus, g.state.simTimeMs);
  stepScoring(g.state, g.bus, g.state.simTimeMs);
  eq('B10 running the scoring pass again changes nothing', g.state.score.points, after);
  eq('B11 and does not count the flight twice', g.state.score.flightsHandled, 1);

  eq('B12 on-time percent guards an empty shift', onTimePercent(createScore()), 0);
  const sc = createScore(); sc.bagsExpected = 8; sc.correct = 6;
  eq('B13 and rounds sensibly otherwise', onTimePercent(sc), 75);
}
}

/* ── C. every outcome path ───────────────────────────────────────────────── */
function sectionC() {
lines.push('--- C. every path a bag can take (GDD 28.2) ---');
{
  /* 1. everything loaded correctly */
  const g1 = newGame(11);
  const f1 = F(g1, AB);
  loadInto(g1, AB, AB, f1.expectedCount);
  runToEnd(g1);
  eq('C1 a fully loaded flight reports every bag correct', f1.outcome.correct, f1.expectedCount);
  eq('C2 nothing missed', f1.outcome.missed, 0);
  ok('C3 and it counts as perfect', g1.state.score.flightsPerfect >= 1);
  const line1 = g1.state.report.lines.find((l) => l.flightId === AB);
  eq('C4 the report line agrees', line1.correct, f1.expectedCount);
  eq('C5 and earned the bonus',
     line1.points, f1.expectedCount * S.correctBag + f1.outcome.correctPriority * S.priorityBonus
                   + S.perfectFlightBonus);

  /* 2. everything on the WRONG aircraft — GDD §28.2 */
  const g2 = newGame(12);
  const mc = F(g2, MC);
  loadInto(g2, MC, AB, 5);
  runToEnd(g2);
  eq('C6 strays are recorded as misrouted', mc.outcome.misrouted, 5);
  eq('C7 the flight that lost its own bags records them missed', mc.outcome.missed, mc.expectedCount);
  ok('C8 and the departure still happened', mc.evaluated);
  ok('C9 the score went down', g2.state.score.points < 0, `${g2.state.score.points}`);
  eq('C10 the report calls them wrong-destination bags', g2.state.report.wrongDestination, 5);

  /* 3. taken back out of the hold before closure — GDD §28.2 */
  const g3 = newGame(13);
  const f3 = F(g3, AB);
  const loaded = loadInto(g3, AB, AB, 4);
  moveBag(g3.state, loaded[0], { type: 'floor' }, g3.bus, g3.state.simTimeMs);
  runToEnd(g3);
  eq('C11 a bag pulled back out does not count as loaded', f3.outcome.correct, 3);
  ok('C12 it counts as missed instead', f3.outcome.missed >= 1);
  eq('C13 and it is still a physical bag on the ramp', loaded[0].location.type, 'floor');

  /* 4. still in a cart when the aircraft leaves */
  const g4 = newGame(14);
  const f4 = F(g4, AB);
  const cart = g4.state.cartsById.cart_1;
  g4.skipMs(f4.times.loadingMs + 500);
  const inCart = makeBag(g4, AB);
  moveBag(g4.state, inCart, { type: 'cart', id: cart.id }, g4.bus, g4.state.simTimeMs);
  runToEnd(g4);
  eq('C14 a bag left in a cart missed its flight', inCart.lifecycle, 'missed');
  eq('C15 and is still in the cart, not deleted', inCart.location.type, 'cart');

  /* 5. still on the belt when the aircraft leaves
   *
   * This used to sweep an untouched shift for whatever happened to be riding the belt at
   * the whistle and assert `onBelt.every(...)`. On most seeds that array is EMPTY — the
   * last bag spawns long before the last departure and a 21 m belt is a 13 s ride — and
   * `[].every()` is `true`, so the assertion proved nothing and its detail string printed
   * the count as if the author half-suspected it. The bag is placed deliberately now, and
   * the precondition that it is genuinely still on the belt is its own assertion.
   */
  const g5 = newGame(15);
  const f5 = F(g5, AB);
  g5.skipMs(f5.times.departureMs - 8000 - g5.state.simTimeMs);
  const rider = makeBag(g5, AB);
  moveBag(g5.state, rider, { type: 'conveyor', id: g5.state.world.conveyor.id, t: 0 },
          g5.bus, g5.state.simTimeMs);
  g5.skipMs(8200);                                  // past pushback, well inside the ride
  eq('C16 a bag put on the belt is still riding it when its aircraft leaves',
     rider.location.type, 'conveyor');
  ok('C16a and its flight has departed without it', f5.evaluated);
  eq('C16b a bag still on the belt is classified, not left active', rider.lifecycle, 'missed');
  runToEnd(g5);
  eq('C16c and the classification stands at the end of the shift', rider.lifecycle, 'missed');
  const onBelt = Object.values(g5.state.bagsById).filter((b) => b.location.type === 'conveyor');
  note(`${onBelt.length} bags were still on the belt when the shift ended`);

  /* 6. never spawned at all — the timetable still owes it */
  const g6 = newGame(16);
  const owed = Object.values(g6.state.flightsById).reduce((n, f) => n + f.expectedCount, 0);
  eq('C17 the shift owes every scheduled bag', owed, g6.state.shift.bagSchedule.length);
  runToEnd(g6);
  eq('C18 an untouched shift misses all of them', g6.state.report.correct, 0);
  eq('C19 and the report still balances', g6.state.report.bagsExpected, owed);

  /* 7. loaded late — after final call but before the hold shuts */
  const g7 = newGame(17);
  const f7 = F(g7, AB), ac7 = AC(g7, AB);
  g7.skipMs(f7.times.finalCallMs + 2000);
  ok('C20 the hold is still open during final bag call', ac7.holdOpen);
  const late = makeBag(g7, AB);
  moveBag(g7.state, late, { type: 'aircraftHold', id: ac7.id }, g7.bus, g7.state.simTimeMs);
  runToEnd(g7);
  eq('C21 a bag loaded during final call still counts', late.lifecycle, 'loaded');
  note('final bag call IS the grace window GDD 5.2 allows — 25 s on AB221');
}
}

/* ── D. the report ───────────────────────────────────────────────────────── */
function sectionD() {
lines.push('--- D. the shift report (GDD 11.2, 11.3) ---');
{
  const g = newGame(21);
  loadInto(g, AB, AB, 9, { priority: true });
  // Two Miami bags onto Chicago — and PRIORITY ones. §11.2's "priority bags missed" was
  // the metric nothing in this section ever drove: with no priority bag going astray,
  // `0` satisfied the old presence check exactly as well as the right answer would have.
  loadInto(g, MC, SK, 2, { priority: true });
  runToEnd(g);
  const r = g.state.report;

  // GDD §11.2 metrics, all present — and all real NUMBERS. `typeof r[k] === 'number'` is
  // also true of NaN, which is precisely what a metric derived from a renamed or missing
  // field looks like, so the presence check now demands a finite one.
  for (const k of ['flightsHandled', 'flightsPerfect', 'bagsExpected', 'correct',
                   'onTimePercent', 'mishandled', 'wrongDestination', 'priorityMissed']) {
    ok(`D1.${k} the report carries it as a real number`, Number.isFinite(r[k]), `${r[k]}`);
  }
  eq('D2 every flight is handled', r.flightsHandled, 3);
  eq('D3 one line per flight', r.lines.length, 3);
  eq('D4 the two strays are reported', r.wrongDestination, 2);

  /*
   * The VALUES of the other three §11.2 metrics. D5-D9 below check four of the eight
   * against the hand-built outcome; these are the three that were satisfied by any
   * number at all, including the wrong one.
   */
  eq('D4a nothing was perfect — every flight lost bags', r.flightsPerfect, 0);
  eq('D4b and the headline agrees with the lines',
     r.flightsPerfect, r.lines.filter((l) => l.perfect).length);

  // `mishandled` is a count of BAGS. Every bag in the world either flew on its own
  // aircraft or it did not, so the count is exactly the difference — and it can never be
  // larger than the shift had bags. Summing `missed + misrouted` instead once printed
  // "9 delivered" above "27 mishandled" on a 34-bag shift, which is the shape of bug
  // this line exists to catch.
  const inWorld = Object.keys(g.state.bagsById).length;
  eq('D4c mishandled counts every bag that did not fly correctly, exactly once',
     r.mishandled, inWorld - r.correct);

  const priorityInWorld = Object.values(g.state.bagsById).filter((b) => b.priority).length;
  const priorityFlown = Object.values(g.state.bagsById)
    .filter((b) => b.priority && b.lifecycle === 'loaded').length;
  ok('D4d the two priority bags flown to the wrong city count as priority misses',
     r.priorityMissed >= 2, `${r.priorityMissed}`);
  ok('D4e and never more priority bags than the shift actually had',
     r.priorityMissed <= priorityInWorld - priorityFlown,
     `${r.priorityMissed} counted, ${priorityInWorld - priorityFlown} priority bags did not fly`);
  note(`priority bags: ${priorityInWorld} in the shift, ${priorityFlown} flown, ` +
       `${r.priorityMissed} counted as missed`);

  // the arithmetic has to close, or the report is lying
  const owed = r.lines.reduce((n, l) => n + l.expected, 0);
  const got = r.lines.reduce((n, l) => n + l.correct, 0);
  const lost = r.lines.reduce((n, l) => n + l.missed, 0);
  eq('D5 owed equals delivered plus missed', got + lost, owed);
  eq('D6 and the headline matches the lines', r.correct, got);
  eq('D7 as does bags expected', r.bagsExpected, owed);
  eq('D8 on-time percent is delivered over expected',
     r.onTimePercent, Math.round((got / owed) * 100));
  eq('D9 points equal the sum of the lines',
     r.points, r.lines.reduce((n, l) => n + l.points, 0));
  note(`report: ${r.correct}/${r.bagsExpected} on time (${r.onTimePercent}%), ` +
       `${r.wrongDestination} to the wrong city, ${r.points} points`);

  // GDD §11.3 — one or two odd facts, never enough to obscure the real numbers
  ok('D10 the report carries odd statistics', r.oddities.length > 0);
  ok('D11 but not so many they bury the result', r.oddities.length <= 4, `${r.oddities.length}`);
  ok('D12 each is a labelled value',
     r.oddities.every((o) => typeof o.label === 'string' && typeof o.value === 'string'));
  note(`oddities: ${r.oddities.map((o) => o.label).join(' · ')}`);

  ok('D13 the most confidently mishandled flight is named',
     r.oddities.some((o) => /mishandled/i.test(o.label)),
     r.oddities.map((o) => o.label).join());

  // GDD §10.4 / §3.2: a bad shift must not be scolded
  const verdicts = [0, 30, 60, 80, 95, 100].map((p) => verdictFor({ onTimePercent: p, bagsExpected: 50 }));
  ok('D14 every outcome gets a verdict', verdicts.every((v) => typeof v === 'string' && v.length > 0));
  ok('D15 and none of them are cruel',
     !verdicts.some((v) => /fail|useless|terrible|idiot|pathetic/i.test(v)), verdicts.join(' | '));
  note(`0%: "${verdicts[0]}"`);
  note(`100%: "${verdicts[5]}"`);
}
}

/* ── E. the best-shift record ────────────────────────────────────────────── */
function sectionE() {
lines.push('--- E. persistence (GDD 23.1) ---');
{
  const store = memoryStorage();
  const save = new SaveSystem(store);

  eq('E1 nothing saved yet', save.loadBest(), null);
  const a = save.saveBest({ points: 900, onTimePercent: 60, correct: 30, bagsExpected: 50,
                            flightsPerfect: 0, seed: 1, shiftId: 's' });
  ok('E2 the first shift is always a best', a.improved && a.record.points === 900);
  eq('E3 and it round-trips', save.loadBest().points, 900);

  const worse = save.saveBest({ points: 400, onTimePercent: 30, correct: 15, bagsExpected: 50,
                               flightsPerfect: 0, seed: 1, shiftId: 's' });
  ok('E4 a worse shift does not overwrite it', !worse.improved && worse.record.points === 900);
  eq('E5 storage still holds the better one', save.loadBest().points, 900);

  const better = save.saveBest({ points: 1500, onTimePercent: 80, correct: 40, bagsExpected: 50,
                                flightsPerfect: 1, seed: 2, shiftId: 's' });
  /*
   * `ok(name, cond, detail)`. The third argument is the DETAIL STRING printed on failure,
   * NOT an expected value — so `ok('E6 ...', better.improved && save.loadBest().points, 1500)`
   * looked like an equality check and was not one. Worse, it passed in exactly the case it
   * was written to catch: if the record had NOT been replaced the condition evaluated to
   * `900`, which is truthy. An expected value belongs in eq(), and the two claims in that
   * one line are two claims.
   */
  ok('E6 a better shift reports that it improved', better.improved, JSON.stringify(better.record));
  eq('E6a and the stored record really is the better one', save.loadBest().points, 1500);

  const tie = save.saveBest({ points: 1500, onTimePercent: 90, correct: 45, bagsExpected: 50,
                              flightsPerfect: 1, seed: 3, shiftId: 's' });
  ok('E7 a tie on points is broken by on-time percentage', tie.improved);

  /*
   * Corrupt, future and PAST records — GDD §28.1 asks for "save parsing/version
   * migration".
   *
   * The key comes from the module rather than being spelled out again here. A hardcoded
   * key that stopped matching would have made every check below vacuous: `loadBest()`
   * returns null for a record it cannot find just as readily as for one it refuses, so
   * all three would still have passed while testing nothing. E7a writes a VALID record
   * through the same door first, which is what makes the three nulls below mean "refused"
   * rather than "never seen".
   */
  store.setItem(BEST_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, points: 4200 }));
  eq('E7a a hand-written record at the current version is read back',
     save.loadBest() && save.loadBest().points, 4200);

  store.setItem(BEST_KEY, '{not json');
  eq('E8 corrupt storage reads as nothing rather than throwing', save.loadBest(), null);
  store.setItem(BEST_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION + 98, points: 5 }));
  eq('E9 a record from a future version is ignored', save.loadBest(), null);

  /*
   * THERE IS NO MIGRATION PATH, and this pins that rather than inventing one.
   * `loadBest` accepts only `schemaVersion === SCHEMA_VERSION`, so a record written by an
   * OLDER build is discarded exactly like a corrupt one: the player's best shift is
   * silently lost at the first schema bump. That is defensible for one small record —
   * save.js says so in its header, having deliberately dropped TheBenefactors' migration
   * machinery — but it is a decision, not an accident, and nothing was holding it. These
   * two lines are what a future `SCHEMA_VERSION = 2` has to walk past on purpose.
   */
  store.setItem(BEST_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION - 1,
                                           points: 4200, onTimePercent: 90 }));
  eq('E9a a record from an OLDER version is dropped, not migrated', save.loadBest(), null);
  store.setItem(BEST_KEY, JSON.stringify({ points: 4200, onTimePercent: 90 }));
  eq('E9b and so is an unversioned one, which is what a pre-schema build wrote',
     save.loadBest(), null);

  // storage that refuses must never break a shift
  const hostile = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  const guarded = new SaveSystem(hostile);
  let threw = false;
  try { guarded.loadBest(); guarded.saveBest({ points: 1, onTimePercent: 1 }); } catch { threw = true; }
  ok('E10 storage that refuses everything is survived silently', !threw);

  eq('E11 a game with no storage at all still runs',
     (() => { const g = new Game({ seed: 5, storage: null }); g.startShift();
              g.skipMs(g.state.shift.endTimeMs + 1000); return g.state.report !== null; })(), true);

  /* the real thing: a shift records its best */
  const g = newGame(31);
  loadInto(g, AB, AB, 6);
  runToEnd(g);
  ok('E12 finishing a shift records a best', !!g.state.report.best);
  eq('E13 and says it is a new one', g.state.report.improved, true);
}
}

/* ── F. a full shift, end to end ─────────────────────────────────────────── */
function sectionF() {
lines.push('--- F. whole shifts ---');
{
  /* a crew bot that loads matching bags into whichever hold is open */
  function workedShift(seed) {
    const g = newGame(seed);
    const st = g.state;
    while (!st.shift.ended && st.simTimeMs < 900000) {
      g.skipMs(1000);
      for (const ac of Object.values(st.aircraftById)) {
        if (!ac.present || !ac.holdOpen) continue;
        const flight = st.flightsById[ac.flightId];
        const z = aircraftHoldZone(ac);
        let moved = 0;
        for (const bag of Object.values(st.bagsById)) {
          if (moved >= 3) break;
          if (bag.flightId !== flight.id) continue;
          if (bag.location.type !== 'floor' && bag.location.type !== 'conveyor') continue;
          bag.x = z.x; bag.y = z.y;
          moveBag(st, bag, { type: 'aircraftHold', id: ac.id }, g.bus, st.simTimeMs);
          moved++;
        }
      }
    }
    return g;
  }

  const g = workedShift(41);
  const r = g.state.report;
  ok('F1 a worked shift ends with a report', !!r);
  ok('F2 and a positive score', r.points > 0, `${r.points}`);
  ok('F3 with most bags delivered', r.onTimePercent > 50, `${r.onTimePercent}%`);
  eq('F4 the arithmetic closes', r.correct + r.lines.reduce((n, l) => n + l.missed, 0), r.bagsExpected);
  eq('F5 containment survived', assertContainment(g.state).length, 0);
  eq('F6 as did the hitch chain', validateChain(g.state).length, 0);
  note(`worked shift: ${r.correct}/${r.bagsExpected} (${r.onTimePercent}%), ${r.points} points, ` +
       `${r.flightsPerfect} perfect`);

  const idle = newGame(41);
  runToEnd(idle);
  ok('F7 an untouched shift scores far worse than a worked one',
     idle.state.report.points < r.points,
     `${idle.state.report.points} vs ${r.points}`);
  note(`untouched shift: ${idle.state.report.correct}/${idle.state.report.bagsExpected}, ` +
       `${idle.state.report.points} points`);

  /* determinism, including the report */
  const a = workedShift(77), b = workedShift(77);
  ok('F8 the same seed and the same work give the same report',
     JSON.stringify(a.state.report) === JSON.stringify(b.state.report),
     JSON.stringify(a.state.report.lines) + '\n' + JSON.stringify(b.state.report.lines));
  ok('F9 and the same describe()',
     JSON.stringify(a.describe()) === JSON.stringify(b.describe()));

  const c = workedShift(78);
  ok('F10 a different seed reports differently',
     JSON.stringify(a.state.report) !== JSON.stringify(c.state.report));

  /* replay really resets */
  const rep = workedShift(41);
  rep.startShift();
  eq('F11 replay clears the score', rep.state.score.points, 0);
  eq('F12 and the bags', Object.keys(rep.state.bagsById).length, 0);
  eq('F13 and the flights', Object.values(rep.state.flightsById).filter((f) => f.evaluated).length, 0);
  eq('F14 and the stats', rep.state.stats.scans, 0);
  runToEnd(rep);
  ok('F15 and a replayed shift produces its own report', !!rep.state.report);
}
}

/* ── G. the live page ────────────────────────────────────────────────────── */
async function sectionG() {
  lines.push('--- G. the live page ---');
  const abc = window.__ABC;
  ok('G1 the game booted', !!(abc && abc.game));
  if (!abc) return;
  await yieldToLoop();

  const { game, hud } = abc;
  const banner0 = document.getElementById('err-banner');
  ok('G2 no error banner after boot', !banner0, banner0 && banner0.textContent);

  abc.startShift();
  const st = game.state;
  game.skipMs(st.shift.endTimeMs + 1000);
  hud.update();

  eq('G3 the shift ended', st.mode, MODES.REPORT);
  const card = document.querySelector('.report');
  ok('G4 the report screen is up', card && card.classList.contains('on'));
  ok('G5 and names every flight',
     /AB221/.test(card.textContent) && /MC184/.test(card.textContent) && /SK307/.test(card.textContent));
  ok('G6 it prints an on-time percentage', /on-time baggage/i.test(card.textContent));
  ok('G7 and a verdict', card.querySelector('.tag') && card.querySelector('.tag').textContent.length > 5,
     card.querySelector('.tag') && card.querySelector('.tag').textContent);
  ok('G8 with a replay button', !!card.querySelector('#btnReplay'));

  card.querySelector('#btnReplay').click();
  hud.update();
  // Read game.state, NOT the `st` captured above: startShift() replaces the state object,
  // so the old reference still says "report" forever. Third time this trap has appeared.
  eq('G9 replay starts a fresh shift', game.state.mode, MODES.PLAYING);
  eq('G10 the report screen is gone', document.querySelector('.report').classList.contains('on'), false);
  eq('G11 with a clean slate', game.state.score.points, 0);

  eq('G12 the live game never violated containment', assertContainment(game.state).length, 0);
  const banner = document.getElementById('err-banner');
  ok('G13 no error banner at the end of the run', !banner, banner && banner.textContent);
}

/* ── run ─────────────────────────────────────────────────────────────────── */
(async () => {
  const sections = [
    ['A', sectionA], ['B', sectionB], ['C', sectionC],
    ['D', sectionD], ['E', sectionE], ['F', sectionF], ['G', sectionG],
  ];
  for (const [name, fn] of sections) {
    emit(`RUNNING section ${name}...`);
    try { await fn(); }
    catch (e) { fails++; lines.push(`FAIL  section ${name} threw: ${(e && e.stack) || e}`); }
    emit(`RUNNING (section ${name} done)`);
  }
  emit();
})();
