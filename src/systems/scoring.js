/* Scoring and the shift record — GDD §11.
 *
 * Points are awarded ONCE, at departure, from what the flight actually evaluated. There
 * is deliberately no running per-load score: a bag loaded into a hold can be taken back
 * out before closure, so awarding on load and clawing back on removal would show the
 * player a number that lies for the twenty seconds in between. GDD §11.1 permits small
 * popups for correct loads but does not require them, and the board already shows
 * loaded-of-expected live, which is honest feedback for the same information.
 *
 * This is a PULL pass, not an event handler: it looks for flights that have evaluated
 * but not yet been scored. That makes it idempotent, order-independent, and impossible
 * to double-count by emitting an event twice.
 */

import { CONFIG } from '../config.js';
import { EVENTS } from '../core/eventBus.js';
import { GameClock } from '../core/clock.js';

export function createScore() {
  return {
    points: 0,
    // GDD §11.2 service metrics
    flightsHandled: 0,
    flightsPerfect: 0,
    bagsExpected: 0,
    correct: 0,
    correctPriority: 0,
    misrouted: 0,
    missed: 0,
    priorityMissed: 0,
    lines: [],            // per-flight breakdown, for the report
  };
}

/** Odd facts worth telling at the end — GDD §11.3. Cheap counters, updated in place. */
export function createStats() {
  return {
    hardCorners: 0,       // cart corners taken above the spill threshold
    scans: 0,
    spills: 0,
    longestBagJourneyM: 0,
    longestBagTag: null,
  };
}

/**
 * Award any flight that has evaluated and not yet been scored.
 * @returns {number} how many flights were scored this call
 */
export function stepScoring(state, bus, simTimeMs) {
  let n = 0;
  for (const flight of Object.values(state.flightsById)) {
    if (!flight.evaluated || flight.scored) continue;
    scoreFlight(state, flight, bus, simTimeMs);
    flight.scored = true;
    n++;
  }
  return n;
}

export function scoreFlight(state, flight, bus = null, simTimeMs = 0) {
  const S = CONFIG.score;
  const o = flight.outcome;
  const score = state.score;

  const earned = o.correct * S.correctBag
               + o.correctPriority * S.priorityBonus
               + o.misrouted * S.misroutedBag
               + o.missed * S.missedBag
               + o.priorityMissed * S.priorityMissPenalty;

  // GDD §11.1: a completion bonus for a flight that got every expected bag. "Perfect"
  // means nothing missed AND nothing aboard that should not have been.
  const perfect = o.missed === 0 && o.misrouted === 0 && flight.expectedCount > 0;
  const bonus = perfect ? S.perfectFlightBonus : 0;

  score.points += earned + bonus;
  score.flightsHandled++;
  if (perfect) score.flightsPerfect++;
  score.bagsExpected += flight.expectedCount;
  score.correct += o.correct;
  score.correctPriority += o.correctPriority;
  score.misrouted += o.misrouted;
  score.missed += o.missed;
  score.priorityMissed += o.priorityMissed;

  score.lines.push({
    flightId: flight.id,
    number: flight.number,
    destinationCode: flight.destinationCode,
    expected: flight.expectedCount,
    correct: o.correct,
    priority: o.correctPriority,
    misrouted: o.misrouted,
    missed: o.missed,
    perfect,
    points: earned + bonus,
  });

  if (bus) {
    bus.emit(EVENTS.SCORE_CHANGED,
      { flightId: flight.id, delta: earned + bonus, total: score.points }, simTimeMs);
  }
  return earned + bonus;
}

/** GDD §11.2 asks for on-time baggage as a percentage. Guard the empty shift. */
export const onTimePercent = (score) =>
  score.bagsExpected === 0 ? 0 : Math.round((score.correct / score.bagsExpected) * 100);

/** Everything the report needs, computed once when the shift ends. */
/**
 * How many DISTINCT bags were mishandled.
 *
 * `missed + misrouted` counts a bag flown to the wrong city twice — once as misrouted on
 * the aircraft that took it, once inside the owed flight’s `expectedCount - correct`. That
 * let the report print "9 delivered" above "27 mishandled" on a 34-bag shift.
 */
export function mishandledBags(state) {
  let n = 0;
  for (const bag of Object.values(state.bagsById)) {
    if (bag.lifecycle === 'missed' || bag.lifecycle === 'misrouted') n++;
  }
  return n;
}

export function buildReport(state) {
  const score = state.score;
  const stats = state.stats;
  const spills = Object.values(state.cartsById).reduce((n, c) => n + c.spills, 0);
  const drivenM = Object.values(state.vehiclesById).reduce((n, v) => n + v.odometerM, 0);

  return {
    seed: state.seed,
    shiftId: state.shift.id,
    durationMs: state.shift.endTimeMs,
    points: score.points,

    // GDD §11.2
    flightsHandled: score.flightsHandled,
    flightsPerfect: score.flightsPerfect,
    bagsExpected: score.bagsExpected,
    correct: score.correct,
    onTimePercent: onTimePercent(score),
    // COUNTED FROM THE BAGS, not by adding two flight-scoped totals. A bag flown to the
    // wrong city is misrouted on the aircraft that took it AND missing from the flight it
    // was owed to, so summing those counted it twice: a shift of 34 bags could print
    // "9 delivered" directly above "27 mishandled", and in the worst case 68 of 34. The
    // POINTS are deliberately charged twice — losing a bag and then flying it to the
    // wrong city are two distinct failures — but the headline is a count of bags, and
    // there are only ever as many bags as there are.
    mishandled: mishandledBags(state),
    wrongDestination: score.misrouted,
    priorityMissed: score.priorityMissed,
    lines: score.lines.slice(),

    // GDD §11.3 — one or two odd facts, never enough to obscure the real numbers
    oddities: buildOddities(state, stats, spills, drivenM),
  };
}

function buildOddities(state, stats, spills, drivenM) {
  const out = [];

  if (stats.longestBagJourneyM > 3) {
    out.push({
      label: 'Longest loose suitcase journey',
      value: `${stats.longestBagJourneyM.toFixed(1)} m` +
             (stats.longestBagTag ? ` — bag ${stats.longestBagTag}` : ''),
    });
  }
  if (spills > 0) {
    out.push({ label: 'Bags shaken off a cart', value: `${spills}` });
  }
  if (stats.hardCorners > 0) {
    out.push({ label: 'Cart corners taken above safe speed', value: `${stats.hardCorners}` });
  }
  if (drivenM > 1) {
    out.push({ label: 'Distance driven', value: `${Math.round(drivenM)} m` });
  }
  out.push({ label: 'Bags scanned', value: `${stats.scans}` });

  // "Most confidently mishandled flight" — the one that took off with the most luggage
  // belonging to somewhere else.
  let worst = null;
  for (const line of state.score.lines) {
    if (line.misrouted > 0 && (!worst || line.misrouted > worst.misrouted)) worst = line;
  }
  if (worst) {
    out.push({
      label: 'Most confidently mishandled flight',
      value: `${worst.number} left with ${worst.misrouted} bag${worst.misrouted === 1 ? '' : 's'} ` +
             `that belonged somewhere else`,
    });
  }
  return out.slice(0, 4);
}

/** A one-line verdict. Deliberately never cruel about a bad shift — GDD §10.4 wants a
 *  messy shift to still feel survivable, and §3.2 keeps the tone affectionate. */
export function verdictFor(report) {
  const p = report.onTimePercent;
  if (report.bagsExpected === 0) return 'Nothing was ever going to arrive.';
  if (p === 100) return 'Every bag on the right aircraft. Nobody will ever know how hard that was.';
  if (p >= 90) return 'A good shift. A few passengers will be mildly inconvenienced.';
  if (p >= 75) return 'Respectable. The airline will not write a letter about it.';
  if (p >= 50) return 'Half the bags made it. Half is a number.';
  if (p >= 25) return 'A difficult day for the travelling public.';
  if (p > 0) return 'Technically some luggage did fly somewhere.';
  return 'Not one bag left the ground. The aircraft did.';
}

export const formatDuration = (ms) => GameClock.formatMs(ms);
