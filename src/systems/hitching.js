/* Cart trains — GDD §8.1, §8.2, §6.4, §28.1 ("cart hitch chain validation").
 *
 * A train is a singly-linked chain: tractor.nextCartId -> cart.nextCartId -> ... Each
 * cart also records `hitchedToId` pointing back at its parent. Two links for one
 * relationship is a duplication, and duplications drift — so `validateChain()` proves
 * they still agree, and the m2 suite runs it after every hitch, unhitch and drive.
 *
 * Towed carts are POSITIONED, not integrated: each one is placed at a fixed distance
 * behind its parent hitch point, facing it. That is the classic rope constraint, and it
 * is what makes a long train cut corners and swing wide exactly as GDD §8.2 describes,
 * without a solver and without any chance of a cart drifting away from its parent.
 */

import { CONFIG } from '../config.js';
import { EVENTS } from '../core/eventBus.js';
import { cartTowPoint, cartSlotWorld, cartFillFrac } from '../entities/cart.js';
import { tractorTowPoint } from '../entities/tractor.js';
import { pushOutOfWalls, angleDelta, separate } from './physics.js';
import { moveBag } from './containment.js';

const MAX_TRAIN = 16;   // runaway guard: a cycle must never spin forever

/**
 * How much stability one overload has to cost before it counts as a CORNER.
 *
 * A quarter of a cart's grip. Measured (`tools\_spill.js`, 3 shifts at average skill):
 * the median overload costs 0.040 and the 90th percentile 0.349, so this counts roughly
 * the worst tenth — the ones that came close to putting a bag on the ramp — and ignores
 * the steering corrections that make up the rest.
 *
 * Not in `CONFIG` because it tunes a REPORTED STATISTIC and nothing the simulation does:
 * moving it changes what the end-of-shift card says and cannot change the outcome of a
 * shift. Difficulty and physics belong in config; this is a label.
 */
const CORNER_COUNTS_AT = 0.25;

/** Put one cart's bags back in its slots. The same rule `syncCartBagPositions` applies to
 *  every cart once a step; needed here because `hitch` moves a cart after that has run. */
export function pinCartLoad(state, cart) {
  for (let i = 0; i < cart.bagIds.length; i++) {
    const bag = state.bagsById[cart.bagIds[i]];
    if (!bag) continue;
    const p = cartSlotWorld(cart, i);
    bag.x = p.x; bag.y = p.y;
    bag.vx = 0; bag.vy = 0;
    bag.rot = cart.rot + bag.appearance.wobble * 0.4;
  }
}

/** Cart ids towed by this vehicle, nose to tail. */
export function trainOf(state, vehicle) {
  const out = [];
  let id = vehicle.nextCartId;
  const seen = new Set();
  while (id && out.length < MAX_TRAIN) {
    if (seen.has(id)) break;            // cycle: stop rather than hang
    seen.add(id);
    const cart = state.cartsById[id];
    if (!cart) break;
    out.push(id);
    id = cart.nextCartId;
  }
  return out;
}

/** The last cart of the train, or null. */
export function tailOf(state, vehicle) {
  const train = trainOf(state, vehicle);
  return train.length ? state.cartsById[train[train.length - 1]] : null;
}

/** Where the next cart would attach: the tail cart hitch, or the tractor hitch. */
export function hitchPointOf(state, vehicle) {
  const tail = tailOf(state, vehicle);
  return tail ? cartTowPoint(tail) : tractorTowPoint(vehicle);
}

/** A cart is free if nothing is towing it. */
export const isFree = (cart) => !cart.hitchedToId;

/**
 * The nearest free cart within hitch range of the train tail.
 * @returns {object|null}
 */
export function hitchCandidate(state, vehicle) {
  const p = hitchPointOf(state, vehicle);
  const train = new Set(trainOf(state, vehicle));
  let best = null, bestD = CONFIG.cart.hitchRangeM;
  for (const id of Object.keys(state.cartsById)) {
    if (train.has(id)) continue;
    const cart = state.cartsById[id];
    if (!isFree(cart)) continue;
    const d = Math.hypot(cart.x - p.x, cart.y - p.y);
    if (d < bestD) { bestD = d; best = cart; }
  }
  return best;
}

export function hitch(state, vehicle, cart, bus = null, simTimeMs = 0) {
  if (!cart || !isFree(cart)) return false;
  if (trainOf(state, vehicle).length >= MAX_TRAIN) return false;

  /*
   * PLACE THE CART ON THE CONSTRAINT NOW, rather than letting the first `updateTrain`
   * snap it there next step.
   *
   * A towed cart is POSITIONED, not integrated, and the stability model reads its motion
   * by differencing position and heading across one step. Hitching only rewrote the link
   * ids, so the first towed step saw the cart teleport from wherever it was parked — up
   * to hitchRangeM away, at any heading — onto the drawbar, and divided that by 1/60 s.
   * Coming at a cart square-on from the side, that is a yaw rate near 90 rad/s and a
   * lateral load in the thousands: a loaded cart threw a bag off with the tractor
   * STANDING STILL. It also counted every angled hitch as a hard corner, so GDD §11.3's
   * "cart corners taken above safe speed" was really counting hitches and wall scrapes.
   *
   * The hitch point is read BEFORE the links are written. `hitchPointOf` resolves the
   * TAIL of the train, so once `cart` is attached the tail IS `cart` — and the snap would
   * place it relative to its own tow point, which moves it a metre and a half sideways
   * for no reason and spills a load off a stationary train.
   */
  const hp = hitchPointOf(state, vehicle);

  const tail = tailOf(state, vehicle);
  if (tail) { tail.nextCartId = cart.id; cart.hitchedToId = tail.id; }
  else { vehicle.nextCartId = cart.id; cart.hitchedToId = vehicle.id; }
  cart.nextCartId = null;

  let dx = cart.x - hp.x, dy = cart.y - hp.y;
  let d = Math.hypot(dx, dy);
  if (d < 1e-6) { dx = -Math.cos(cart.rot); dy = -Math.sin(cart.rot); d = 1; }
  cart.x = hp.x + (dx / d) * CONFIG.cart.linkM;
  cart.y = hp.y + (dy / d) * CONFIG.cart.linkM;
  cart.rot = Math.atan2(-dy / d, -dx / d);
  // `linkM` is 1.75 and `hitchRangeM` is 3.0, so a cart standing NEARER than the drawbar
  // gets pushed AWAY from the tow point — into a wall, if one happens to be behind it.
  // `updateTrain` pushes after positioning for the same reason; so must this.
  pushOutOfWalls(cart, Math.max(CONFIG.cart.lengthM, CONFIG.cart.widthM) * 0.5);
  // The load is pinned once a step, right after the train is placed, and `hitch` runs
  // LATER in the step than that — so without this a loaded cart is drawn a metre from its
  // own bags for exactly one frame. CLAUDE.md states the invariant it would break.
  pinCartLoad(state, cart);

  if (bus) bus.emit(EVENTS.CART_HITCHED, { cartId: cart.id, toId: cart.hitchedToId }, simTimeMs);
  return true;
}

/** Detach the LAST cart, so a train can be dropped one bay at a time. */
export function unhitchTail(state, vehicle, bus = null, simTimeMs = 0) {
  const train = trainOf(state, vehicle);
  if (!train.length) return null;

  const cart = state.cartsById[train[train.length - 1]];
  const parentId = cart.hitchedToId;
  const parent = state.cartsById[parentId] || (vehicle.id === parentId ? vehicle : null);
  if (parent) parent.nextCartId = null;
  cart.hitchedToId = null;
  cart.nextCartId = null;

  if (bus) bus.emit(EVENTS.CART_UNHITCHED, { cartId: cart.id, fromId: parentId }, simTimeMs);
  return cart;
}

/** Drop the whole train where it stands, in order. */
export function unhitchAll(state, vehicle, bus = null, simTimeMs = 0) {
  const dropped = [];
  let cart = unhitchTail(state, vehicle, bus, simTimeMs);
  while (cart) { dropped.push(cart.id); cart = unhitchTail(state, vehicle, bus, simTimeMs); }
  return dropped.reverse();
}

/**
 * Place every towed cart behind its parent, and work out whether the ride just threw a
 * bag off. Called once per step for a moving tractor.
 */
export function updateTrain(state, vehicle, dtSec, bus = null, simTimeMs = 0) {
  const C = CONFIG.cart;
  const radius = Math.max(C.lengthM, C.widthM) * 0.5;
  let parentPoint = tractorTowPoint(vehicle);
  let id = vehicle.nextCartId;
  const seen = new Set();
  let guard = 0;

  while (id && guard++ < MAX_TRAIN) {
    if (seen.has(id)) break;
    seen.add(id);
    const cart = state.cartsById[id];
    if (!cart) break;

    const prevRot = cart.rot;
    const prevX = cart.x, prevY = cart.y;

    let dx = cart.x - parentPoint.x, dy = cart.y - parentPoint.y;
    let d = Math.hypot(dx, dy);
    // Degenerate: cart exactly on the hitch. Fall back to its own heading rather than
    // to a random direction, so a replay of the same seed lands identically.
    if (d < 1e-6) { dx = -Math.cos(cart.rot); dy = -Math.sin(cart.rot); d = 1; }
    const ux = dx / d, uy = dy / d;

    cart.x = parentPoint.x + ux * C.linkM;
    cart.y = parentPoint.y + uy * C.linkM;
    cart.rot = Math.atan2(-uy, -ux);          // the cart faces its parent

    /* The CONSTRAINT solution, before any wall correction. The stability model below
       differences position across one step, and `pushOutOfWalls` is a teleport — so a
       cart scraping the sort-room doorway was measured as having moved most of a metre in
       16 ms, which is a lateral load in the thousands and a bag off the back. A wall
       correction is the world pushing the cart, not the driver throwing it about, and
       GDD §11.3's "corners taken above safe speed" should count corners. */
    const solvedX = cart.x, solvedY = cart.y;
    pushOutOfWalls(cart, radius);

    /* stability: lateral load is speed x yaw rate, weighted by how full the bed is */
    if (dtSec > 0) {
      cart.rolledM += Math.hypot(cart.x - prevX, cart.y - prevY);   // turns the wheels
      const moved = Math.hypot(solvedX - prevX, solvedY - prevY) / dtSec;
      const omega = angleDelta(cart.rot, prevRot) / dtSec;
      const lat = Math.abs(moved * omega) * (0.5 + cartFillFrac(cart));

      if (lat > C.spillLatMps2) {
        const drain = (lat - C.spillLatMps2) * C.spillDrainRate * dtSec;
        cart.stability -= drain;
        cart.cornerDrain = (cart.cornerDrain || 0) + drain;
        /*
         * GDD §11.3 "cart corners taken above safe speed" — counted once per overload,
         * and ONLY when the overload actually cost something.
         *
         * ⚠ IT USED TO FIRE ON THE WAY IN, and that counted keystrokes rather than
         * corners. Steering is BINARY (`steer` is -1, 0 or +1), so every course
         * correction is full lock, and full lock above about 2.6 m/s with a loaded cart
         * is over this threshold — which meant the shift report claimed 168 hard corners
         * a shift, one every three and a half seconds, against 5.7 bags actually shed.
         * Measured, 56% of them cost under 0.05 stability and recovered within a tenth
         * of a second: invisible to the player, and not a corner by any reading.
         *
         * A quarter of a cart's grip is the bar now. It is a statistic a player is
         * supposed to read at the end and wince at, so it has to mean "I nearly lost
         * that load", not "I nudged the stick".
         */
        if (!cart.overLimit && cart.cornerDrain >= CORNER_COUNTS_AT) {
          cart.overLimit = true;
          if (state.stats) state.stats.hardCorners++;
        }
      } else {
        cart.stability = Math.min(1, cart.stability + C.stabilityRecover * dtSec);
        cart.overLimit = false;
        cart.cornerDrain = 0;
      }

      if (cart.stability <= 0 && cart.bagIds.length > 0) {
        spillOne(state, cart, omega, bus, simTimeMs);
        cart.stability = C.spillStabilityAfter;
      }
      if (cart.stability < 0) cart.stability = 0;
    }

    parentPoint = cartTowPoint(cart);
    id = cart.nextCartId;
  }
}

/**
 * Keep PARKED carts off each other.
 *
 * Two carts sharing a square metre both answer to `E`, and `findCart` hands you whichever
 * centre is nearest — so standing between them loads the one you did not mean, or nothing
 * at all if that one is full. The README carried it as a known limitation and called it
 * "the single most common way the bot lost time"; the bot carries a whole workaround for
 * it, circling a quarter turn every couple of seconds to find a side where the cart it
 * wants is unambiguously nearest.
 *
 * ⚠ FREE CARTS ONLY. A towed cart is POSITIONED by the drawbar constraint every step
 * (`updateTrain`), so pushing it anywhere else just starts a fight the constraint wins,
 * and the stability model would read the shoving as cornering and throw the load off.
 * A cart on the drawbar is the tractor's problem.
 *
 * Circle-on-circle at half a cart's width, which is not the true footprint and does not
 * need to be: the goal is that two centres are never close enough to be ambiguous, not a
 * rectangle solver. Pushed out of walls afterwards, because this positions rather than
 * moves — the rule this file already learned twice.
 */
export function separateFreeCarts(state) {
  const all = Object.values(state.cartsById);
  const free = all.filter((c) => !c.hitchedToId);
  if (!free.length) return 0;
  const minDist = CONFIG.cart.widthM;
  const radius = Math.max(CONFIG.cart.lengthM, CONFIG.cart.widthM) * 0.5;
  let moved = 0;

  // Free against free: both give way. Gentle, so they ease apart over a few frames and
  // read as trolleys being nudged rather than as a physics demo.
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      if (separate(free[i], free[j], minDist, 0.5, 0.35)) moved++;
    }
  }

  /*
   * ⚠ A TOWED CART DOES NOT PUSH PARKED ONES OUT OF ITS WAY, and that was tried.
   *
   * Pinning the towed cart and shoving the free one aside (`separate(towed, free, d, 0)`)
   * is a two-line change and it turns a passing train into a bulldozer: parked carts get
   * driven into the sort-room doorway and against walls, and the crew is then stuck
   * behind them. Measured, six dead ends across average and veteran where there had been
   * none — the crew stranded at (32.3, 18.9) beside the door, and at (8.9, 22) in the
   * west of the room.
   *
   * It is also a HALF collision model, which is the deeper reason not to ship it: the
   * tractor drives through parked carts, so pushing them adds the disruption without the
   * blocking that would make it read as a collision. The README's complaint was two
   * PARKED carts sharing a spot, and that is what this fixes.
   */
  void all;
  for (const c of free) pushOutOfWalls(c, radius);
  return moved;
}

/** Throw the top bag off the outside of the turn. GDD §10.2: it stays on the ramp,
 *  physical and retrievable, and costs the player time rather than deleting anything. */
function spillOne(state, cart, omega, bus, simTimeMs) {
  const bagId = cart.bagIds[cart.bagIds.length - 1];
  const bag = state.bagsById[bagId];
  if (!bag) return null;

  const slot = cartSlotWorld(cart, cart.bagIds.length - 1);
  bag.x = slot.x; bag.y = slot.y;

  // outside of the turn: perpendicular to the heading, opposite the yaw
  const side = omega > 0 ? -1 : 1;
  const nx = -Math.sin(cart.rot) * side, ny = Math.cos(cart.rot) * side;
  bag.vx = nx * CONFIG.cart.spillEjectMps + Math.cos(cart.rot) * 1.2;
  bag.vy = ny * CONFIG.cart.spillEjectMps + Math.sin(cart.rot) * 1.2;
  bag.cartCooldownMs = simTimeMs + CONFIG.cart.reentryCooldownMs;

  moveBag(state, bag, { type: 'floor' }, bus, simTimeMs);
  cart.spills++;
  if (bus) bus.emit(EVENTS.BAG_SPILLED, { bagId: bag.id, cartId: cart.id }, simTimeMs);
  return bag;
}

/**
 * Prove the two halves of every link still agree. Empty means the chains are sound.
 * GDD §28.1 lists this as a required unit test; it is cheap enough to also run live in
 * the debug overlay, which is where a corruption gets noticed the instant it happens.
 */
export function validateChain(state) {
  const bad = [];
  const parents = new Map();   // childId -> parentId, to catch two parents on one cart

  const heads = [...Object.values(state.vehiclesById), ...Object.values(state.cartsById)];
  for (const node of heads) {
    const childId = node.nextCartId;
    if (!childId) continue;
    const child = state.cartsById[childId];
    if (!child) { bad.push(`${node.id}: tows unknown cart ${childId}`); continue; }
    if (child.hitchedToId !== node.id) {
      bad.push(`${node.id} tows ${childId}, but ${childId} thinks it is hitched to ${child.hitchedToId}`);
    }
    if (parents.has(childId)) {
      bad.push(`${childId} is towed by both ${parents.get(childId)} and ${node.id}`);
    }
    parents.set(childId, node.id);
  }

  for (const cart of Object.values(state.cartsById)) {
    if (!cart.hitchedToId) continue;
    const parent = state.cartsById[cart.hitchedToId] || state.vehiclesById[cart.hitchedToId];
    if (!parent) { bad.push(`${cart.id}: hitched to unknown ${cart.hitchedToId}`); continue; }
    if (parent.nextCartId !== cart.id) {
      bad.push(`${cart.id} claims ${cart.hitchedToId} as parent, but that tows ${parent.nextCartId}`);
    }
    if (cart.hitchedToId === cart.id) bad.push(`${cart.id} is hitched to itself`);
  }

  // cycles
  for (const v of Object.values(state.vehiclesById)) {
    const seen = new Set();
    let id = v.nextCartId, n = 0;
    while (id && n++ <= MAX_TRAIN) {
      if (seen.has(id)) { bad.push(`${v.id}: cart chain contains a cycle at ${id}`); break; }
      seen.add(id);
      const c = state.cartsById[id];
      if (!c) break;
      id = c.nextCartId;
    }
  }
  return bad;
}
