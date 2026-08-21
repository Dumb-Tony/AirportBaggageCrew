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
import { pushOutOfWalls } from './physics.js';
import { cartContains, cartRoomFor, nextPlacard } from '../entities/cart.js';
import { dismountPoint } from '../entities/tractor.js';
import { hitchCandidate, hitch, unhitchTail, trainOf, updateTrain, pinCartLoad } from './hitching.js';
import { holdContains, aircraftHoldZone } from '../entities/aircraft.js';

const FLIGHT_IDS = FLIGHT_DEFS.map((f) => f.id);

/* How hard targeting favours what you are facing. `aimBiasDeg` is the half-angle at which
 * a bag is penalised by roughly its own distance again; 90 degrees maps to 1.0. */
const AIM_BIAS = Math.max(0, Math.min(2, CONFIG.interaction.aimBiasDeg / 90));

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

    // cos of the angle between the aim and the bag; 1 is dead ahead, -1 is behind.
    // The strength of the bias comes from CONFIG: it was hardcoded to 0.9 here while
    // `interaction.aimBiasDeg` sat in config.js being read by nothing, which is exactly
    // the kind of dead tuning knob GDD §31.1.15 exists to prevent — and precisely the
    // sort of thing a balance pass turns and then wonders why nothing changed.
    const cos = d < 1e-6 ? 1 : (dx * p.aimX + dy * p.aimY) / d;
    const score = d * (1 + (1 - cos) * AIM_BIAS);
    if (score < bestScore) { bestScore = score; best = id; }
  }
  return best;
}

/**
 * The cart the player is standing at, if any. Reach expands the cart footprint.
 *
 * CARTS CAN OVERLAP — parked, towed past one another, or shunted by a tractor — and
 * standing where two of them claim the same square metre made nearest-wins pick whichever
 * happened to be a centimetre closer. With a bag in your hands that is the difference
 * between loading Atlanta's cart and loading Chicago's, decided by nothing you can see.
 *
 * So a cart whose PLACARD MATCHES the bag you are holding, and which has room for it,
 * wins over a nearer one. That is the intent you already declared when you set the
 * placard, and it makes the ambiguous case do the obvious thing. It never blocks a wrong
 * load (GDD §31.1.8): with no matching cart in reach the nearest still wins, and E still
 * puts the bag wherever you are standing.
 */
export function findCart(state, forLoad = true) {
  const p = state.player;
  const held = forLoad && p.carryingBagId ? state.bagsById[p.carryingBagId] : null;
  let best = null, bestD = Infinity;
  let match = null, matchD = Infinity;

  for (const cart of Object.values(state.cartsById)) {
    if (!cartContains(cart, p.x, p.y, CONFIG.player.reachM)) continue;
    const d = Math.hypot(cart.x - p.x, cart.y - p.y);
    if (d < bestD) { bestD = d; best = cart; }
    if (held && cart.placardFlightId === held.flightId && d < matchD &&
        cartRoomFor(cart, state, held).ok) {
      matchD = d; match = cart;
    }
  }
  return match || best;
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

  /* ── X: get unstuck (GDD §24.3) ──────────────────────────────── */
  // Checked before every other verb, because the state it exists for is the one where
  // nothing else works.
  if (input.wasPressed('recover')) recoverStuck(state, bus, simTimeMs);

  /* ── F: in, out, or set a placard ─────────────────────────────────────── */
  if (input.wasPressed('interact')) {
    if (driving) {
      exitVehicle(state, bus, simTimeMs);
    } else {
      const veh = findVehicle(state);
      if (veh) enterVehicle(state, veh, bus, simTimeMs);
      else {
        /* PLAIN NEAREST, not the load-intent cart. Re-placarding is about the cart you
           are standing at; the "matching placard wins" rule answers a different question
           ("where does this bag go?"). Sharing one answer between them meant that holding
           an ATL bag beside a blank cart and an ATL cart, F relabelled the ATL one —
           taking the only correctly labelled cart off its flight, silently, while you
           were standing at the other one. */
        const placardCart = findCart(state, false);
        if (placardCart) {
          setPlacard(state, placardCart,
            nextPlacard(placardCart.placardFlightId, FLIGHT_IDS), bus, simTimeMs);
        }
      }
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

/**
 * X — get unstuck. GDD §24.3: "provide a recover/stuck action for tractor and player".
 *
 * It is a LOCAL unstick, not a teleport home. `moveWithWalls` only commits a move whose
 * destination is clear and never updates the position while blocked, so anything that
 * ends up inside geometry can never walk out of it — and from a player's side that reads
 * as the game having frozen rather than as a bug with a workaround.
 *
 * Deliberately does nothing when you are not stuck, so it cannot be mashed as a free
 * sidestep, and it never moves you toward where you were going: the drive to the gate is
 * the game, and an escape hatch that shortened it would be a movement ability.
 */
export function recoverStuck(state, bus = null, simTimeMs = 0) {
  const p = state.player;
  const moved = [];

  if (p.drivingId) {
    const v = state.vehiclesById[p.drivingId];
    if (v && pushOutOfWalls(v, v.radiusM)) {
      v.speed = 0; v.yawRate = 0; v.vx = 0; v.vy = 0;
      moved.push(v.id);
    }
    // The train follows the tractor, so free every cart on it too — a jack-knifed cart
    // wedged in the doorway pins the whole thing just as effectively as the tractor does.
    for (const cart of Object.values(state.cartsById)) {
      if (!cart.hitchedToId) continue;
      if (pushOutOfWalls(cart, Math.max(CONFIG.cart.lengthM, CONFIG.cart.widthM) * 0.5)) {
        moved.push(cart.id);
      }
    }
  } else if (pushOutOfWalls(p, p.radiusM)) {
    p.vx = 0; p.vy = 0;
    moved.push(p.id);
  }

  /*
   * SETTLE THE TRAIN BEFORE LEAVING, or one press of X throws a bag off a train that is
   * standing perfectly still.
   *
   * `pushOutOfWalls` is a teleport, and every push above knocks the train off its
   * drawbar constraint — moving the TRACTOR is enough on its own, because the tow point
   * goes with it. `updateTrain` guards against the push it performs itself (that is what
   * `solvedX/solvedY` are for) but it cannot guard a teleport applied from outside, and
   * `recoverStuck` runs LATER in the step than it does. So the next step's constraint
   * snap gets differenced as motion: measured, a loaded cart standing at (17.68, 9.97)
   * with full stability and nobody touching the throttle lost a bag to a single press.
   *
   * Re-seating it here leaves nothing to snap. `dtSec = 0` is the point — the whole
   * stability model is inside `if (dtSec > 0)`, so this places the carts and skips the
   * differencing rather than feeding it a teleport. `hitch()` solves the identical
   * problem the identical way, and CLAUDE.md already records the rule this is the second
   * call site of: nothing may difference position across a push.
   */
  if (moved.length && p.drivingId) {
    const v = state.vehiclesById[p.drivingId];
    if (v) {
      updateTrain(state, v, 0);
      // The load is pinned once a step, right after the train is placed, and that has
      // already happened by now — so without this a recovered cart is drawn a metre from
      // its own bags for exactly one frame.
      for (const id of trainOf(state, v)) {
        const cart = state.cartsById[id];
        if (cart) pinCartLoad(state, cart);
      }
    }
  }

  if (moved.length && bus) bus.emit(EVENTS.RECOVERED, { ids: moved }, simTimeMs);
  return moved.length;
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
  /*
   * The dismount is a fixed 1.15 m to the left of the tractor, whose own collision radius
   * is 1.10 m — so parked hard against a wall it puts the crew 5 cm INSIDE it.
   * `moveWithWalls` only commits a move whose destination is clear, and never updates the
   * position while blocked, so from inside a wall no direction is walkable at all and the
   * game reads as frozen. `pushOutOfWalls` is the cleanup pass for exactly this case:
   * anything POSITIONED rather than moved.
   */
  pushOutOfWalls(p, p.radiusM);
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
