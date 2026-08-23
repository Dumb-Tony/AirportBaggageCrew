/* The authored shift — GDD §20.4.
 *
 * Milestone 1 uses these as STATIC DEFINITIONS only: a bag needs a flight to carry on
 * its tag, and the scanner needs a departure time to count down to. The flight STATE
 * MACHINE, the board, announcements and departures are Milestone 3 — nothing here
 * advances or reacts to anything.
 *
 * `times` are ABSOLUTE simulation timestamps, per flight. GDD §22.2's sample record
 * (departure at 225000) is one flight's schedule, not a template shared by all three;
 * read as a template it contradicts §20.4, which overlaps three flights across an 8-12
 * minute shift. Balanced properly at Milestone 6.
 *
 * Tag identity is THREE channels — code, colour and icon — because GDD §7.2 forbids
 * colour being the only differentiator.
 */

import { CONFIG } from '../config.js';

export const FLIGHT_DEFS = [
  {
    id: 'flight_AB221', number: 'AB221',
    destinationCode: 'ATL', destinationName: 'Atlanta',
    gateId: 'gate_1', aircraftId: 'aircraft_1',
    tag: { color: '#e0574a', icon: 'triangle' },
    bagCount: 17,
    times: { bagAcceptanceMs: 5000, loadingMs: 30000, finalCallMs: 215000,
             holdClosingMs: 250000, departureMs: 275000 },
    // §20.4 twist: tutorial-friendly first flow — an even trickle, no surprises.
    twist: { peak: 0.25, lateBags: 1, priorityCount: 1, heavyChance: 0.10, priorityLate: false },
  },
  {
    id: 'flight_MC184', number: 'MC184',
    destinationCode: 'ORD', destinationName: 'Chicago',
    gateId: 'gate_2', aircraftId: 'aircraft_2',
    tag: { color: '#4f8fd6', icon: 'square' },
    bagCount: 17,
    times: { bagAcceptanceMs: 85000, loadingMs: 115000, finalCallMs: 360000,
             holdClosingMs: 395000, departureMs: 420000 },
    // §20.4 twist: several heavy bags.
    twist: { peak: 0.45, lateBags: 2, priorityCount: 2, heavyChance: 0.45, priorityLate: false },
  },
  {
    id: 'flight_SK307', number: 'SK307',
    destinationCode: 'MIA', destinationName: 'Miami',
    gateId: 'gate_1', aircraftId: 'aircraft_3',
    tag: { color: '#3fbf9b', icon: 'circle' },
    bagCount: 17,
    // Acceptance is late enough that SK307, which reuses gate 1, arrives after AB221's
    // aircraft is clear of the stand. GDD §20.4 forbids reusing a gate before the
    // prior aircraft clears, and that has to include the taxi in and the pushback, not
    // just the scheduled departure time. `gateConflicts()` checks the widened window.
    times: { bagAcceptanceMs: 295000, loadingMs: 315000, finalCallMs: 600000,
             holdClosingMs: 645000, departureMs: 675000 },
    // §20.4 twist: priority bags arrive late.
    twist: { peak: 0.5, lateBags: 3, priorityCount: 3, heavyChance: 0.18, priorityLate: true },
  },
];

export const flightById = (id) => FLIGHT_DEFS.find((f) => f.id === id) || null;

/** Gate 1 is reused by SK307 after AB221 leaves. GDD §20.4: a gate may only be reused
 *  once the prior aircraft clears. Asserted in the m1 suite so a timing edit cannot
 *  quietly double-book a stand. */
/**
 * The window a flight actually occupies its stand: from the moment its aircraft starts
 * taxiing in until the moment it is clear after pushback. Wider than
 * bagAcceptance..departure, and the difference is exactly where a double-booking hides.
 */
export function standWindow(flight) {
  return {
    from: flight.times.bagAcceptanceMs - CONFIG.flight.taxiInMs,
    to: flight.times.departureMs + CONFIG.flight.pushbackMs,
  };
}

export function gateConflicts() {
  const out = [];
  for (let i = 0; i < FLIGHT_DEFS.length; i++) {
    for (let j = i + 1; j < FLIGHT_DEFS.length; j++) {
      const a = FLIGHT_DEFS[i], b = FLIGHT_DEFS[j];
      if (a.gateId !== b.gateId) continue;
      const wa = standWindow(a), wb = standWindow(b);
      if (wa.from < wb.to && wb.from < wa.to) out.push([a.number, b.number]);
    }
  }
  return out;
}

/**
 * Deterministic bag arrival timetable for a whole shift.
 *
 * Returns one record per bag, sorted by arrival time, describing what the conveyor will
 * emit and when. Every draw comes from the seeded stream, so the same seed produces the
 * same shift (GDD §21.7). Milestone 3 will drive this from the live flight schedule
 * instead of calling it up front; the record shape is the same either way.
 *
 * @param {import('../core/rng.js').Rng} rng
 */
export function buildBagSchedule(rng, assist = 1) {
  const out = [];
  /*
   * The assist scales the flight windows at one authoring site (`createFlights` ->
   * `scaleTimes`) and the bag timetable has to move with them, or the shift is RESHAPED
   * rather than lengthened. On Unhurried the late bags — GDD §20.4’s whole twist, "they
   * arrive after final call, when the player has moved on" — landed two minutes BEFORE
   * final call, SK307 fed the belt three minutes before its aircraft existed, and the
   * last eight minutes of the shift had no arrivals at all.
   *
   * Applied to the drawn result rather than to the inputs, so the RNG stream is
   * bit-identical at every assist level and the same seed still authors the same shift.
   */
  const k = assist > 0 ? assist : 1;

  for (const f of FLIGHT_DEFS) {
    const t = f.twist;
    // Bags stop feeding shortly before final call, leaving the late ones as the twist.
    const open = f.times.bagAcceptanceMs;
    const close = f.times.finalCallMs - 20000;
    const span = close - open;

    // A pressure peak (GDD §20.2: "bag arrival order includes pressure peaks"): a
    // fraction of the flight's bags cluster inside one short window.
    const peakCount = Math.round(f.bagCount * t.peak);
    const peakStart = open + span * rng.range(0.3, 0.55);
    const peakSpan = span * 0.18;

    const times = [];
    for (let i = 0; i < f.bagCount - t.lateBags; i++) {
      times.push(i < peakCount
        ? peakStart + rng.float() * peakSpan
        : open + rng.float() * span);
    }
    // Late bags: after final call has been announced, when the player has moved on.
    for (let i = 0; i < t.lateBags; i++) {
      times.push(f.times.finalCallMs + rng.range(2000, 18000));
    }
    times.sort((a, b) => a - b);

    // Priority bags. SK307's arrive late on purpose — that is its twist, and it is the
    // one that should make a competent player swear.
    //
    // Drawn by shuffling a candidate pool rather than by rejection-sampling into a Set:
    // a rejection loop whose target count approaches its range size can spin for a long
    // time, and one whose count EXCEEDS the range never terminates at all.
    const pool = times.map((_, i) => i);
    const candidates = t.priorityLate
      ? pool.slice(-Math.max(t.priorityCount + 2, 6))
      : pool;
    rng.shuffle(candidates);
    const priorityIdx = new Set(candidates.slice(0, Math.min(t.priorityCount, candidates.length)));

    times.forEach((atMs, i) => {
      out.push({
        atMs: Math.round(atMs * k),
        flightId: f.id,
        priority: priorityIdx.has(i),
        weightClass: rng.chance(t.heavyChance) ? 'heavy' : (rng.chance(0.18) ? 'light' : 'normal'),
      });
    });
  }

  out.sort((a, b) => a.atMs - b.atMs);
  return out;
}
