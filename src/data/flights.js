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
    bagCount: 16,
    times: { bagAcceptanceMs: 5000, loadingMs: 20000, finalCallMs: 150000,
             holdClosingMs: 175000, departureMs: 190000 },
    // §20.4 twist: tutorial-friendly first flow — an even trickle, no surprises.
    twist: { peak: 0.25, lateBags: 1, priorityCount: 1, heavyChance: 0.10, priorityLate: false },
  },
  {
    id: 'flight_MC184', number: 'MC184',
    destinationCode: 'ORD', destinationName: 'Chicago',
    gateId: 'gate_2', aircraftId: 'aircraft_2',
    tag: { color: '#4f8fd6', icon: 'square' },
    bagCount: 16,
    times: { bagAcceptanceMs: 60000, loadingMs: 80000, finalCallMs: 250000,
             holdClosingMs: 275000, departureMs: 290000 },
    // §20.4 twist: several heavy bags.
    twist: { peak: 0.45, lateBags: 2, priorityCount: 2, heavyChance: 0.45, priorityLate: false },
  },
  {
    id: 'flight_SK307', number: 'SK307',
    destinationCode: 'MIA', destinationName: 'Miami',
    gateId: 'gate_1', aircraftId: 'aircraft_3',
    tag: { color: '#3fbf9b', icon: 'circle' },
    bagCount: 18,
    // Acceptance is 205 s, not 200: SK307 reuses gate 1 after AB221, whose aircraft is
    // not clear of the stand until 195 s. GDD §20.4 forbids reusing a gate before the
    // prior aircraft clears, and that has to include the taxi in and the pushback, not
    // just the scheduled departure time. `gateConflicts()` checks the widened window.
    times: { bagAcceptanceMs: 205000, loadingMs: 220000, finalCallMs: 420000,
             holdClosingMs: 450000, departureMs: 470000 },
    // §20.4 twist: priority bags arrive late.
    twist: { peak: 0.5, lateBags: 3, priorityCount: 4, heavyChance: 0.18, priorityLate: true },
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
export function buildBagSchedule(rng) {
  const out = [];

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
        atMs: Math.round(atMs),
        flightId: f.id,
        priority: priorityIdx.has(i),
        weightClass: rng.chance(t.heavyChance) ? 'heavy' : (rng.chance(0.18) ? 'light' : 'normal'),
      });
    });
  }

  out.sort((a, b) => a.atMs - b.atMs);
  return out;
}
