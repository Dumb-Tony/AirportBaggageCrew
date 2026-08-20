/* Grab, release, throw, scan, load, drive, hitch — GDD §6.1, §7.1, §8.1, §17.1.
 *
 * The essential verbs, and nothing else. Every one of them is allowed to be WRONG:
 * GDD §31.1.8 forbids blocking a bad action to protect the player score, so nothing
 * below refuses an input on the grounds that it is a mistake. A cart will happily take a
 * bag that contradicts its own placard. The scanner warns; it does not veto.
 *
 * Bindings (GDD §31.4 lets these be chosen if documented and consistent):
 *   E  handle the thing in front of you — grab, put down, load into a cart, take out of
 *      a cart; and while driving, hitch or unhitch.
 *   F  get in or out of a vehicle; on foot beside a cart, set its placard.
 *   Space  hold to charge a throw, release to throw. GDD §17.1 flags the conflict that
 *      arises if grab and throw share the mouse, so they are split.
 *   Q  scan.
 */

import { CONFIG } from '../config.js';
import { EVENTS } from '../core/eventBus.js';
import { moveBag } from './containment.js';
import { recordScan, weightOf } from '../entities/bag.js';
import { padAt } from '../data/airport.js';
import { FLIGHT_DEFS } from '../data/flights.js';
import { chargeFrac } from '../entities/player.js';
import { cartContains, cartRoomFor, nextPlacard } from '../entities/cart.js';
import { dismountPoint } from '../entities/tractor.js';
import { hitchCandidate, hitch, unhitchTail, trainOf } from './hitching.js';
import { holdContains, aircraftHoldZone } from '../entities/aircraft.js';

const FLIGHT_IDS = FLIGHT_DEFS.map((f) => f.id);

/** Bags you can reach out and take: loose, riding the belt, or sitting in a cart. */
const isTargetable = (bag) =>
  bag.location.type === 'floor' ||
  bag.location.type === 'conveyor' ||
  bag.location.type === 'cart';

/**
 * Nearest reachable bag, biased toward where the player is aiming, so that facing a
 * pile and pressing E takes the one you are looking at rather than the one that happens
 * to be a centimetre closer to your feet.
 */
export function findTarget(state, grid) {
  const p = state.player;
  const reach = CONFIG.player.reachM;
  const near = grid.query(p.x, p.y, reach + 1, []);

  let best = null, bestScore = Infinity;
  for (const id of near) {
    const bag = state.bagsById[id];
    if (!bag || !isTargetable(bag)) continue;

    const dx = bag.x - p.x, dy = bag.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > reach + bag.radiusM) continue;

    // cos of the angle between the aim and the bag; 1 is dead ahead, -1 is behind
    const cos = d < 1e-6 ? 1 : (dx * p.aimX + dy * p.aimY) / d;
    const score = d * (1 + (1 - cos) * 0.9);
    if (score < bestScore) { bestScore = score; best = id; }
  }
  return best;
}

/** The cart the player is standing at, if any. Reach expands the cart footprint. */
export function findCart(state) {
  const p = state.player;
  let best = null, bestD = Infinity;
  for (const cart of Object.values(state.cartsById)) {
    if (!cartContains(cart, p.x, p.y, CONFIG.player.reachM)) continue;
    const d = Math.hypot(cart.x - p.x, cart.y - p.y);
    if (d < bestD) { bestD = d; best = cart; }
  }
  return best;
}

/**
 * The aircraft whose hold the player is standing in, present or not, open or not.
 *
 * Returned even when the hold is SHUT, so the prompt can say "hold closed" rather than
 * going blank — GDD §5.3 wants the player to understand why an action is unavailable,
 * not to guess.
 */
export function findHold(state) {
  const p = state.player;
  for (const ac of Object.values(state.aircraftById)) {
    if (!ac.present) continue;
    if (holdContains(ac, p.x, p.y, CONFIG.player.reachM)) return ac;
  }
  return null;
}

/** The vehicle the player could climb into. */
export function findVehicle(state) {
  const p = state.player;
  let best = null, bestD = CONFIG.tractor.enterRangeM;
  for (const v of Object.values(state.vehiclesById)) {
    if (v.driverId) continue;
    const d = Math.hypot(v.x - p.x, v.y - p.y);
    if (d < bestD) { bestD = d; best = v; }
  }
  return best;
}

export function stepInteraction(state, dtSec, input, bus, simTimeMs, grid) {
  const p = state.player;
  const driving = p.drivingId ? state.vehiclesById[p.drivingId] : null;

  // What the player could act on right now. The HUD and renderer read these; they are
  // recomputed every step so a prompt can never describe a bag that has moved on.
  p.targetBagId = driving ? null : findTarget(state, grid);
  const cart = driving ? null : findCart(state);
  p.targetCartId = cart ? cart.id : null;
  p.targetVehicleId = driving ? null : (findVehicle(state) || {}).id || null;
  const hold = driving ? null : findHold(state);
  p.targetHoldId = hold ? hold.id : null;
  p.targetHoldOpen = hold ? hold.holdOpen : false;

  // scan card lifetime
  if (state.scan && simTimeMs - state.scan.atMs > CONFIG.interaction.scanCardMs) {
    state.scan = null;
  }
  if (!input) return;

  /* ── F: in, out, or set a placard ─────────────────────────────────────── */
  if (input.wasPressed('interact')) {
    if (driving) {
      exitVehicle(state, bus, simTimeMs);
    } else {
      const veh = findVehicle(state);
      if (veh) enterVehicle(state, veh, bus, simTimeMs);
      else if (cart) setPlacard(state, cart, nextPlacard(cart.placardFlightId, FLIGHT_IDS), bus, simTimeMs);
    }
  }

  /* ── driving: E hitches and unhitches, and that is the whole verb set ─── */
  if (p.drivingId) {
    const v = state.vehiclesById[p.drivingId];
    if (v && input.wasPressed('grab')) {
      const candidate = hitchCandidate(state, v);
      if (candidate) hitch(state, v, candidate, bus, simTimeMs);
      else unhitchTail(state, v, bus, simTimeMs);
    }
    return;
  }

  /* ── E: grab, put down, load, unload ──────────────────────────────────── */
  if (input.wasPressed('grab')) {
    if (p.carryingBagId) {
      // Standing at a cart or an open hold with a bag in hand means "load it", which is
      // the whole sorting verb. Falling through to a floor drop when the cart is full or
      // the hold is shut is deliberate: the game never refuses the action, it just
      // cannot put the bag where you asked.
      //
      // The hold wins over a cart when both are in reach, because a cart parked at the
      // aircraft is a staging post and the aircraft is the destination.
      const held = state.bagsById[p.carryingBagId];
      if (hold && hold.holdOpen && held) {
        loadIntoHold(state, held, hold, bus, simTimeMs);
      } else if (cart && held && cartRoomFor(cart, state, held).ok) {
        loadIntoCart(state, held, cart, bus, simTimeMs);
      } else {
        releaseHeld(state, bus, simTimeMs);
      }
    } else if (hold && hold.holdOpen && !p.targetBagId &&
               !(cart && cart.bagIds.length) && manifestOf(state, hold).length) {
      // GDD §28.2: a bag taken back out of a hold before closure must stop counting as
      // loaded. Same top-of-the-pile rule as a cart.
      //
      // A LOADED CART IN REACH WINS. Balance pass (M6): the cart-to-hold shuttle was
      // 8.9 s per bag, nearly all of it walking, because a player standing at their cart
      // inside the hold volume pulled bags back OUT of the aircraft instead of taking
      // the next one off the cart. That forced a five-metre round trip per bag and made
      // the shift unfinishable. Parking the train alongside the door is now rewarded,
      // which is the skill the layout was always asking for. Emptying a hold still
      // works — step away from the cart, which is also the clearer intent.
      const manifest = manifestOf(state, hold);
      const bag = state.bagsById[manifest[manifest.length - 1]];
      if (bag) {
        bag.vx = 0; bag.vy = 0;
        moveBag(state, bag, { type: 'carried', id: p.id }, bus, simTimeMs);
      }
    } else {
      // Unloading takes the TOP of the pile when nothing specific is in reach. A cart is
      // 2.4 m long and reach is 1.7 m, so the far slots are genuinely unreachable from
      // one side — without this you could load a bag and then be unable to get it back
      // out without walking round the cart. You grab off the top of a stack in real life
      // too; picking a specific buried bag is not a verb this game wants.
      let bag = p.targetBagId ? state.bagsById[p.targetBagId] : null;
      if (!bag && cart && cart.bagIds.length) {
        bag = state.bagsById[cart.bagIds[cart.bagIds.length - 1]];
      }
      if (bag) {
        bag.vx = 0; bag.vy = 0;
        moveBag(state, bag, { type: 'carried', id: p.id }, bus, simTimeMs);
        bag.cartCooldownMs = simTimeMs + CONFIG.cart.reentryCooldownMs;
      }
    }
  }

  /* ── throw (hold Space, release) ──────────────────────────────────────── */
  if (p.carryingBagId) {
    if (input.isDown('throw')) {
      p.charging = true;
      p.chargeMs = Math.min(CONFIG.bag.throwChargeMs, p.chargeMs + dtSec * 1000);
    } else if (p.charging) {
      throwHeld(state, bus, simTimeMs);
    }
  } else {
    p.charging = false;
    p.chargeMs = 0;
  }

  /* ── scan (Q) ─────────────────────────────────────────────────────────── */
  if (input.wasPressed('scan')) {
    const id = p.carryingBagId || p.targetBagId;
    if (id) scanBag(state, state.bagsById[id], bus, simTimeMs);
  }
}

/* ── vehicles ────────────────────────────────────────────────────────────── */

export function enterVehicle(state, vehicle, bus = null, simTimeMs = 0) {
  const p = state.player;
  if (vehicle.driverId) return false;
  vehicle.driverId = p.id;
  p.drivingId = vehicle.id;
  p.vx = 0; p.vy = 0;
  if (bus) bus.emit(EVENTS.VEHICLE_ENTERED, { vehicleId: vehicle.id }, simTimeMs);
  return true;
}

export function exitVehicle(state, bus = null, simTimeMs = 0) {
  const p = state.player;
  const v = state.vehiclesById[p.drivingId];
  if (!v) { p.drivingId = null; return false; }

  const spot = dismountPoint(v);
  p.x = spot.x; p.y = spot.y;
  p.vx = 0; p.vy = 0;
  v.driverId = null;
  // A vehicle nobody is driving does not roll away on its own.
  v.speed = 0; v.yawRate = 0; v.vx = 0; v.vy = 0;
  p.drivingId = null;
  if (bus) bus.emit(EVENTS.VEHICLE_EXITED, { vehicleId: v.id }, simTimeMs);
  return true;
}

/* ── carts ───────────────────────────────────────────────────────────────── */

/** The manifest of an aircraft, via its flight. */
export function manifestOf(state, aircraft) {
  const flight = state.flightsById[aircraft.flightId];
  return flight ? flight.loadedBagIds : [];
}

/**
 * Put a bag in the hold. GDD §9.1: a bag counts as loaded only when released inside the
 * valid hold volume — so this is only ever reached from a real containment test, never
 * from proximity to the aeroplane.
 *
 * It does NOT check whether the bag belongs on this flight. Loading the wrong bag is
 * allowed and is the point (GDD §31.1.8); it becomes a misroute at departure.
 */
export function loadIntoHold(state, bag, aircraft, bus = null, simTimeMs = 0) {
  const zone = aircraftHoldZone(aircraft);
  bag.x = zone.x; bag.y = zone.y;
  bag.vx = 0; bag.vy = 0;
  moveBag(state, bag, { type: 'aircraftHold', id: aircraft.id }, bus, simTimeMs);
  state.player.charging = false;
  state.player.chargeMs = 0;
  return bag;
}

export function loadIntoCart(state, bag, cart, bus = null, simTimeMs = 0) {
  bag.vx = 0; bag.vy = 0;
  moveBag(state, bag, { type: 'cart', id: cart.id }, bus, simTimeMs);
  state.player.charging = false;
  state.player.chargeMs = 0;
  return bag;
}

/** GDD §8.1: placards are set or ignored by the player. Nothing validates them, and
 *  nothing stops a cart labelled ATLANTA from being full of Chicago. */
export function setPlacard(state, cart, flightId, bus = null, simTimeMs = 0) {
  const flight = FLIGHT_DEFS.find((f) => f.id === flightId) || null;
  cart.placardFlightId = flightId;
  // Display copies written here and nowhere else, so the renderer never needs to know
  // what a flight is.
  cart.placardLabel = flight ? flight.destinationCode : null;
  cart.placardColor = flight ? flight.tag.color : null;
  if (bus) bus.emit(EVENTS.CART_PLACARD_SET, { cartId: cart.id, flightId }, simTimeMs);
  return cart;
}

/* ── bags in hand ────────────────────────────────────────────────────────── */

/** Put the held bag down where the hands are, with no velocity. */
export function releaseHeld(state, bus, simTimeMs) {
  const p = state.player;
  const bag = state.bagsById[p.carryingBagId];
  if (!bag) return null;
  bag.vx = 0; bag.vy = 0;
  p.charging = false; p.chargeMs = 0;
  moveBag(state, bag, { type: 'floor' }, bus, simTimeMs);
  return bag;
}

/** Launch the held bag along the aim, at a speed set by the charge and the weight. */
export function throwHeld(state, bus, simTimeMs) {
  const p = state.player;
  const bag = state.bagsById[p.carryingBagId];
  if (!bag) { p.charging = false; p.chargeMs = 0; return null; }

  const B = CONFIG.bag;
  const f = chargeFrac(p);
  const speed = (B.throwMinSpeed + (B.throwMaxSpeed - B.throwMinSpeed) * f)
              * weightOf(bag).throwMult;

  bag.vx = p.aimX * speed + p.vx * 0.5;   // your own momentum counts
  bag.vy = p.aimY * speed + p.vy * 0.5;
  p.charging = false; p.chargeMs = 0;

  // A thrown bag may land in a cart — that is the point. Clear the cooldown so it can.
  bag.cartCooldownMs = 0;
  moveBag(state, bag, { type: 'floor' }, bus, simTimeMs);
  if (bus) bus.emit(EVENTS.BAG_THROWN, { bagId: bag.id, speed }, simTimeMs);
  return bag;
}

/**
 * GDD §7.1: the scanner is an optional confidence tool, not a permission key. It reads
 * the tag and tells you what it says. It never moves the bag, never blocks a placement,
 * and never corrects a mistake — it only makes the mistake knowable.
 *
 * The verdict compares where the bag IS to where it BELONGS. In a cart that means the
 * cart placard; on the floor it means the marked bay it is standing on.
 */
export function scanBag(state, bag, bus, simTimeMs) {
  if (!bag) return null;

  let verdict = 'neutral';
  let where = bag.location.type;

  if (bag.location.type === 'aircraftHold') {
    // Aboard an aircraft the verdict is not advisory any more — it is the fact that will
    // be recorded at departure.
    const ac = state.aircraftById[bag.location.id];
    const flight = ac ? state.flightsById[ac.flightId] : null;
    where = flight ? flight.number : where;
    if (flight) verdict = flight.id === bag.flightId ? 'correct' : 'wrong';
  } else if (bag.location.type === 'cart') {
    const cart = state.cartsById[bag.location.id];
    where = cart ? cart.id : where;
    if (cart && cart.placardFlightId) {
      verdict = cart.placardFlightId === bag.flightId ? 'correct' : 'wrong';
    }
  } else if (bag.location.type === 'floor') {
    const pad = padAt(bag.x, bag.y);
    if (pad) {
      where = pad.id;
      verdict = pad.gateId === bag.gateId ? 'correct' : 'wrong';
    }
  }

  recordScan(bag, simTimeMs, where, state.player.id);
  if (state.stats) state.stats.scans++;
  state.scan = { bagId: bag.id, atMs: simTimeMs, verdict, where };
  if (bus) bus.emit(EVENTS.BAG_SCANNED, { bagId: bag.id, verdict }, simTimeMs);
  return state.scan;
}

export { trainOf };
