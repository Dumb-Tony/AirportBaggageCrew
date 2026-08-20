/* Aircraft — GDD §9.1.
 *
 * One stylised regional type, per Phase 1: a single baggage hold interaction zone, a
 * visible door state, and a scheduled arrival, presence, pushback and departure.
 *
 * The hold zone is a real oriented box in the world, not a proximity radius, because
 * GDD §9.1 is explicit: "A bag counts as loaded only when released inside the valid hold
 * volume. Do not count a bag merely because it touched the aircraft."
 *
 * The aircraft has no opinion about the schedule. `stepAircraft` reads the flight state
 * and positions itself; it never writes one.
 */

import { CONFIG } from '../config.js';

export function createAircraft(id, flightId, number, stand) {
  return {
    id,
    kind: 'aircraft',
    flightId,
    number,
    standId: stand.id,
    gateId: stand.gateId,

    // parked pose, and the lane it taxis along
    parkX: stand.park.x, parkY: stand.park.y, rot: stand.rot,
    laneX: stand.taxiIn.x, laneY: stand.taxiIn.y,
    holdOffsetX: stand.hold.x - stand.park.x,
    holdOffsetY: stand.hold.y - stand.park.y,

    x: stand.park.x, y: stand.park.y,
    present: false,        // is it on or approaching the stand at all
    holdOpen: false,
    door01: 0,             // 0 shut, 1 fully open — eased, so the door visibly moves
    lengthM: CONFIG.aircraft.lengthM,
    wingspanM: CONFIG.aircraft.wingspanM,
  };
}

/** The oriented box a bag has to be released inside to count as loaded. */
export function aircraftHoldZone(aircraft) {
  return {
    x: aircraft.x + aircraft.holdOffsetX,
    y: aircraft.y + aircraft.holdOffsetY,
    lengthM: CONFIG.flight.holdZone.lengthM,
    widthM: CONFIG.flight.holdZone.widthM,
    rot: 0,               // stands are axis-aligned; kept explicit for later stands
  };
}

/** Is this point inside the hold volume? */
export function holdContains(aircraft, x, y, pad = 0) {
  const z = aircraftHoldZone(aircraft);
  return Math.abs(x - z.x) <= z.lengthM / 2 + pad &&
         Math.abs(y - z.y) <= z.widthM / 2 + pad;
}

/**
 * Position and door state, derived entirely from the flight. Called every step.
 *
 * Taxi in finishes exactly at bagAcceptanceMs, so the aircraft is stationary on its
 * marks the instant baggage can be accepted; pushback starts exactly at departureMs.
 * Both are eased so the movement reads, but the SCHEDULE is not eased — the state
 * changes on the tick, whatever the animation is doing.
 */
export function stepAircraft(aircraft, flight, dtSec, simTimeMs) {
  const F = CONFIG.flight;
  const t = flight.times;

  const taxiInStart = t.bagAcceptanceMs - F.taxiInMs;
  const departed = simTimeMs >= t.departureMs + F.pushbackMs;

  if (simTimeMs < taxiInStart || departed) {
    aircraft.present = false;
    aircraft.holdOpen = false;
    return aircraft;
  }
  aircraft.present = true;

  if (simTimeMs < t.bagAcceptanceMs) {
    // taxiing in: slides from the lane onto its marks
    const k = ease((simTimeMs - taxiInStart) / F.taxiInMs);
    aircraft.x = lerp(aircraft.parkX + CONFIG.aircraft.taxiDistanceM, aircraft.parkX, k);
    aircraft.y = aircraft.parkY;
  } else if (simTimeMs < t.departureMs) {
    aircraft.x = aircraft.parkX;
    aircraft.y = aircraft.parkY;
  } else {
    // pushback: back out along the lane
    const k = ease((simTimeMs - t.departureMs) / F.pushbackMs);
    aircraft.x = lerp(aircraft.parkX, aircraft.parkX + CONFIG.aircraft.taxiDistanceM, k);
    aircraft.y = aircraft.parkY;
  }

  // The door state mirrors the flight state and nothing else, so "can I load this" has
  // exactly one answer no matter who is asking.
  aircraft.holdOpen = flight.state === 'BAG_ACCEPTANCE' ||
                      flight.state === 'LOADING' ||
                      flight.state === 'FINAL_BAG_CALL';

  // The door TRAVELS. `holdOpen` is the rule and flips on the tick; door01 is what the
  // player watches, and it takes about a second — so hold closing is something you can
  // see coming down rather than a state that silently changed behind you (GDD §5.3).
  const target = aircraft.holdOpen ? 1 : 0;
  const rate = 1 / 1.1;
  if (aircraft.door01 < target) aircraft.door01 = Math.min(target, aircraft.door01 + rate * dtSec);
  else if (aircraft.door01 > target) aircraft.door01 = Math.max(target, aircraft.door01 - rate * dtSec);

  return aircraft;
}

const lerp = (a, b, k) => a + (b - a) * k;
const ease = (k) => {
  const c = k < 0 ? 0 : (k > 1 ? 1 : k);
  return c * c * (3 - 2 * c);
};
