/* Bags — GDD §6.2, §22.1.
 *
 * A bag is a persistent physical object with identity and operational state. It keeps
 * that identity from the conveyor to the hold to the shift report; nothing in the game
 * may create a second record for the same suitcase or quietly drop one.
 *
 * IDENTITY IS THREE CHANNELS, and body colour is not one of them. GDD §7.2 forbids
 * colour as the only differentiator, so the TAG carries a flight code, a flight colour
 * and a flight icon. The bag's own colour is cosmetic and deliberately unrelated to its
 * flight — a player who learns to sort by "the red ones" has learned a lie.
 *
 * `location` is the ONE authoritative answer to where a bag is. Only
 * systems/containment.js may write it.
 */

import { flightById } from '../data/flights.js';

/** GDD §6.3: weight changes movement speed and throw distance, nothing else yet. */
export const WEIGHT_CLASSES = {
  light:  { speedMult: 1.00, throwMult: 1.18, w: 0.60, h: 0.42, kg: 9 },
  normal: { speedMult: 0.94, throwMult: 1.00, w: 0.72, h: 0.50, kg: 17 },
  heavy:  { speedMult: 0.62, throwMult: 0.55, w: 0.88, h: 0.60, kg: 31 },
};

/** The physical sort of bag. Drawing only — no rule reads it. */
const BAG_KINDS = ['suitcase', 'suitcase', 'duffel', 'hardcase', 'backpack'];

/** Cosmetic colours. Nothing reads these for a rule — GDD 7.2 forbids colour being a
 *  shortcut for the flight, so the body deliberately says nothing. */
const BODY_COLORS = [
  '#2f3a4a', '#7d4a3a', '#3d5a4a', '#5a4a6a', '#8a7a4a', '#6a2f3a',
  '#4a4a52', '#2f5a6a', '#8a5a7a', '#3a3a2f', '#6a6a7a', '#7a3a2f',
];

/**
 * @param {object}  spec         one record from buildBagSchedule()
 * @param {number}  serial       sequential index, for the printed tag number
 * @param {number}  tagBase      seeded starting tag number, so tags look like real tags
 * @param {import('../core/rng.js').Rng} rng
 */
export function createBag(spec, serial, tagBase, rng) {
  const flight = flightById(spec.flightId);
  const wc = WEIGHT_CLASSES[spec.weightClass] || WEIGHT_CLASSES.normal;
  const tagNumber = String((tagBase + serial * 7) % 1000000).padStart(6, '0');

  return {
    id: `bag_${tagNumber}`,
    tag: tagNumber,

    // operational identity
    flightId: flight.id,
    destinationCode: flight.destinationCode,
    gateId: flight.gateId,
    priority: !!spec.priority,
    weightClass: spec.weightClass,
    handling: [],                       // fragile / oversize / live animal — post-MVP

    appearance: {
      color: rng.pick(BODY_COLORS),
      kind: rng.pick(BAG_KINDS),        // suitcase | duffel | hardcase | backpack
      icon: flight.tag.icon,
      tagColor: flight.tag.color,
      size: spec.weightClass,
      // a little variety so a pile does not look like a texture
      wobble: rng.range(-0.28, 0.28),
      strap: rng.chance(0.4),
    },

    // THE authoritative location. Written only by systems/containment.js.
    location: { type: 'conveyor', id: 'conv_1', t: 0 },

    lifecycle: 'active',                // active | loaded | missed | departed
    condition: 'ok',
    scanHistory: [],                    // GDD §7.4 — timestamped trace events
    expectedDepartureMs: flight.times.departureMs,
    actualFlightId: null,               // set at load time in Milestone 3

    // physical state, when the bag is loose in the world
    x: 0, y: 0, vx: 0, vy: 0,
    rot: rng.range(-Math.PI, Math.PI),
    radiusM: Math.max(wc.w, wc.h) * 0.5,
    widthM: wc.w, heightM: wc.h,
    kg: wc.kg,
  };
}

export const weightOf = (bag) => WEIGHT_CLASSES[bag.weightClass] || WEIGHT_CLASSES.normal;

/** GDD §7.4: every scan appends a timestamped trace event. Feeds the scanner card now,
 *  the shift report at M4, and the lost-baggage investigation system much later. */
export function recordScan(bag, simTimeMs, locationId, actorId = 'player_1') {
  bag.scanHistory.push({
    id: `trace_${bag.id}_${bag.scanHistory.length}`,
    bagId: bag.id,
    type: 'SCAN',
    simTimeMs,
    locationId,
    actorId,
    metadata: {},
  });
  // A bag scanned two hundred times must not grow without bound (GDD §24.1).
  if (bag.scanHistory.length > 12) bag.scanHistory.shift();
  return bag.scanHistory[bag.scanHistory.length - 1];
}
