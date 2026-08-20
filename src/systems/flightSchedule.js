/* The Sacred Schedule — GDD §5, §9, §31.1.7.
 *
 * "The flight schedule is the game's primary antagonist and must be deterministic,
 * legible, and independent of player readiness."
 *
 * `stateAt()` below is the whole antagonist: a PURE FUNCTION of simulation time and the
 * flight's authored times. It takes no state, no player, no bag counts, and no argument
 * that could carry them. A flight cannot be made to wait because there is nothing to
 * wait on — that is GDD §31.1.7 enforced by shape rather than by discipline.
 *
 * Everything else here is consequence: announce the transition, open or shut the hold,
 * move the aircraft, and at pushback evaluate what actually made it aboard.
 */

import { CONFIG } from '../config.js';
import { EVENTS } from '../core/eventBus.js';
import { FLIGHT_DEFS } from '../data/flights.js';
import { standForGate } from '../data/airport.js';
import { createAircraft, aircraftHoldZone, stepAircraft } from '../entities/aircraft.js';
import { moveBag } from './containment.js';
import { announce } from './announcements.js';

/** GDD §5.1, in order. Index comparisons are safe: the sequence never goes backwards. */
export const FLIGHT_STATES = Object.freeze([
  'SCHEDULED', 'BAG_ACCEPTANCE', 'LOADING', 'FINAL_BAG_CALL',
  'HOLD_CLOSING', 'PUSHBACK', 'DEPARTED',
]);
const ORDER = Object.fromEntries(FLIGHT_STATES.map((s, i) => [s, i]));

/** The hold accepts baggage in exactly these states. GDD §5.2: at hold closing, loose
 *  or carted bags can no longer be loaded. */
const HOLD_OPEN_IN = new Set(['BAG_ACCEPTANCE', 'LOADING', 'FINAL_BAG_CALL']);

/**
 * THE function. Pure: (authored times, simulation time) -> state.
 * @param {object} times  GDD §22.2 `times`
 * @param {number} simTimeMs
 */
export function stateAt(times, simTimeMs) {
  if (simTimeMs >= times.departureMs + CONFIG.flight.pushbackMs) return 'DEPARTED';
  if (simTimeMs >= times.departureMs)     return 'PUSHBACK';
  if (simTimeMs >= times.holdClosingMs)   return 'HOLD_CLOSING';
  if (simTimeMs >= times.finalCallMs)     return 'FINAL_BAG_CALL';
  if (simTimeMs >= times.loadingMs)       return 'LOADING';
  if (simTimeMs >= times.bagAcceptanceMs) return 'BAG_ACCEPTANCE';
  return 'SCHEDULED';
}

export const isHoldOpen = (flight) => HOLD_OPEN_IN.has(flight.state);
export const stateIndex = (s) => ORDER[s];

/** Milliseconds until the next transition — what the board counts down. */
export function msToNext(times, simTimeMs) {
  const marks = [
    times.bagAcceptanceMs, times.loadingMs, times.finalCallMs,
    times.holdClosingMs, times.departureMs, times.departureMs + CONFIG.flight.pushbackMs,
  ];
  for (const m of marks) if (simTimeMs < m) return m - simTimeMs;
  return 0;
}

/** Build the runtime flight records and their aircraft. Shape follows GDD §22.2. */
/**
 * @param {number} assist  GDD §16.6 schedule-pressure assist. 1 is the authored shift;
 *   above 1 stretches every window. Applied HERE, once, so every downstream reader —
 *   the board, the countdowns, the derived shift end — follows automatically and no
 *   system has to remember to scale anything.
 */
export function createFlights(state, assist = 1) {
  const flightsById = {};
  const aircraftById = {};
  const k = assist > 0 ? assist : 1;

  for (const def of FLIGHT_DEFS) {
    const stand = standForGate(def.gateId);
    const aircraft = createAircraft(def.aircraftId, def.id, def.number, stand);
    aircraftById[aircraft.id] = aircraft;

    flightsById[def.id] = {
      id: def.id,
      number: def.number,
      destinationCode: def.destinationCode,
      destinationName: def.destinationName,
      gateId: def.gateId,
      aircraftId: def.aircraftId,
      tag: { ...def.tag },
      state: stateAt(scaleTimes(def.times, k), 0),
      times: scaleTimes(def.times, k),

      expectedBagIds: [],     // grows as bags spawn — GDD §22.2
      loadedBagIds: [],       // what is physically in the hold right now
      expectedCount: 0,       // filled from the timetable, so unspawned bags still count
      evaluated: false,

      // outcome, written once at pushback
      outcome: { correct: 0, correctPriority: 0, misrouted: 0, missed: 0, priorityMissed: 0 },
    };
  }

  // Every bag on the timetable is expected, whether or not it ever reaches the belt.
  for (const spec of state.shift.bagSchedule) {
    const f = flightsById[spec.flightId];
    if (f) f.expectedCount++;
  }
  return { flightsById, aircraftById };
}

/**
 * One step of the schedule. Called from Game.step with simulation time and nothing else
 * that could influence a transition.
 */
export function stepFlights(state, dtSec, bus, simTimeMs) {
  for (const flight of Object.values(state.flightsById)) {
    const next = stateAt(flight.times, simTimeMs);
    const aircraft = state.aircraftById[flight.aircraftId];

    if (next !== flight.state) {
      const prev = flight.state;
      flight.state = next;
      if (bus) {
        bus.emit(EVENTS.FLIGHT_STATE_CHANGED,
          { flightId: flight.id, prev, state: next }, simTimeMs);
      }
      announce(state, transitionText(flight, next), toneFor(next), simTimeMs, bus);

      // Evaluation happens ONCE, at pushback. GDD §5.2: at departure the game evaluates
      // every expected bag's outcome.
      //
      // STATE REACHED, not transition INTO. Bound to the transition, a single step that
      // crossed the whole pushback window would skip evaluation while `departLoad` still
      // ran — emptying the manifest and leaving the flight classified by nothing. Not
      // reachable at a 16.67 ms step against a 5 s pushback, but it becomes reachable the
      // moment anyone raises stepMs, lowers pushbackMs, or restores a saved state.
      // `evaluateFlight` already guards itself, so this costs nothing.
      if (stateIndex(next) >= stateIndex('PUSHBACK') && !flight.evaluated) {
        evaluateFlight(state, flight, bus, simTimeMs);
      }
      // The aircraft physically leaves with its load still aboard.
      if (next === 'DEPARTED') departLoad(state, flight, bus, simTimeMs);
    }

    if (aircraft) stepAircraft(aircraft, flight, dtSec, simTimeMs);
  }
}

/**
 * Decide what happened to every bag this flight was owed.
 *
 * Bags in the hold that belong here are correct. Bags in the hold that belong somewhere
 * else are misrouted and TRAVEL ANYWAY (GDD §5.2 — wrongly loaded bags go with the
 * aircraft and generate downstream records). Everything else is missed, and stays
 * exactly where it is: GDD §5.2 requires missed bags to remain physical and actionable
 * after the aircraft leaves, so nothing here touches their position.
 *
 * Counts only. Points and the report are Milestone 4.
 */
export function evaluateFlight(state, flight, bus, simTimeMs) {
  if (flight.evaluated) return flight.outcome;

  const inHold = flight.loadedBagIds.slice();
  let correct = 0, correctPriority = 0, misrouted = 0;

  for (const bagId of inHold) {
    const bag = state.bagsById[bagId];
    if (!bag) continue;
    if (bag.flightId === flight.id) {
      correct++;
      if (bag.priority) correctPriority++;
      bag.lifecycle = 'loaded';
      bag.actualFlightId = flight.id;
    } else {
      misrouted++;
      bag.lifecycle = 'misrouted';
      bag.actualFlightId = flight.id;      // it is going to OUR destination, not its own
      if (bus) {
        bus.emit(EVENTS.BAG_MISROUTED,
          { bagId, intendedFlightId: bag.flightId, actualFlightId: flight.id }, simTimeMs);
      }
    }
  }

  // expectedCount comes from the timetable, so a bag the conveyor never even got to
  // still counts as missed rather than quietly vanishing from the arithmetic.
  const missed = Math.max(0, flight.expectedCount - correct);
  let priorityMissed = 0;

  // Walks EVERY bag belonging to this flight, not just `expectedBagIds`. The two are
  // the same list in normal play, but a bag that arrived by any other route would
  // otherwise finish the shift still marked 'active' — classified by nothing. GDD §5.2
  // says departure evaluates every expected bag; the flight is the owner of record, so
  // ownership is what gets walked.
  for (const bagId of Object.keys(state.bagsById)) {
    const bag = state.bagsById[bagId];
    if (bag.flightId !== flight.id) continue;
    if (bag.lifecycle === 'loaded') continue;
    // Already flown, on somebody else's aircraft. It missed this flight too, and the
    // count above says so, but 'misrouted' is the more specific truth about the bag.
    if (bag.lifecycle === 'misrouted') continue;
    bag.lifecycle = 'missed';
    if (bag.priority) priorityMissed++;
    if (bus) bus.emit(EVENTS.BAG_MISSED, { bagId, flightId: flight.id }, simTimeMs);
  }

  /*
   * `missed` is a SUBTRACTION over the timetable; `priorityMissed` is a COUNT from the
   * ownership walk. They describe the same set of bags, so the specific one cannot exceed
   * the total — and without this they can disagree, because the walk sees every bag the
   * flight owns while the subtraction only ever sees `expectedCount`. A flight reported
   * as PERFECT could carry a priority miss, which is a contradiction in terms and, once
   * the priority penalty existed, cost points on a flawless flight.
   */
  priorityMissed = Math.min(priorityMissed, missed);

  flight.outcome = { correct, correctPriority, misrouted, missed, priorityMissed };
  flight.evaluated = true;

  if (bus) {
    bus.emit(EVENTS.FLIGHT_DEPARTED,
      { flightId: flight.id, ...flight.outcome }, simTimeMs);
  }
  announce(state, departureText(flight), missed > 0 ? 'bad' : 'good', simTimeMs, bus);
  return flight.outcome;
}

/** The aircraft is gone; its load goes with it and stops existing in the world. */
function departLoad(state, flight, bus, simTimeMs) {
  for (const bagId of flight.loadedBagIds.slice()) {
    const bag = state.bagsById[bagId];
    if (!bag) continue;
    moveBag(state, bag, { type: 'departed', id: flight.id }, bus, simTimeMs);
  }
}

/* ── announcement copy — GDD §18.3, concise and operational ───────────────── */

function transitionText(f, state) {
  const gate = f.gateId.replace('gate_', '');
  switch (state) {
    case 'BAG_ACCEPTANCE':
      return `${f.number} to ${f.destinationName} — now accepting baggage, gate ${gate}`;
    case 'LOADING':
      return `${f.number} — loading at gate ${gate}`;
    case 'FINAL_BAG_CALL':
      return `FINAL BAG CALL — ${f.number} to ${f.destinationName}, gate ${gate}`;
    case 'HOLD_CLOSING':
      return `${f.number} — hold closed. Nothing further can be loaded.`;
    case 'PUSHBACK':
      return `${f.number} — pushing back from gate ${gate}`;
    case 'DEPARTED':
      return `${f.number} has departed`;
    default:
      return `${f.number} — scheduled`;
  }
}

function departureText(f) {
  const o = f.outcome;
  const bits = [`${f.number} away with ${o.correct} of ${f.expectedCount}`];
  if (o.misrouted) bits.push(`${o.misrouted} that should not be aboard`);
  if (o.missed) bits.push(`${o.missed} left behind`);
  return bits.join(' · ');
}

/** Tone drives the toast colour. GDD §16.3: colour is never the only channel, so the
 *  text above already says what happened on its own. */
function toneFor(state) {
  if (state === 'FINAL_BAG_CALL') return 'urgent';
  if (state === 'HOLD_CLOSING') return 'bad';
  if (state === 'BAG_ACCEPTANCE') return 'info';
  return 'info';
}

/** Stretch every authored moment by the assist. Rounded, so the schedule stays on whole
 *  milliseconds and two runs of one seed still land on identical ticks. */
function scaleTimes(times, k) {
  if (k === 1) return { ...times };
  const out = {};
  for (const key of Object.keys(times)) out[key] = Math.round(times[key] * k);
  return out;
}
