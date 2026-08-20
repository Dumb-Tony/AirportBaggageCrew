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
import { pushOutOfWalls, angleDelta } from './physics.js';
import { moveBag } from './containment.js';

const MAX_TRAIN = 16;   // runaway guard: a cycle must never spin forever

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

  const tail = tailOf(state, vehicle);
  if (tail) { tail.nextCartId = cart.id; cart.hitchedToId = tail.id; }
  else { vehicle.nextCartId = cart.id; cart.hitchedToId = vehicle.id; }
  cart.nextCartId = null;

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
    pushOutOfWalls(cart, radius);

    /* stability: lateral load is speed x yaw rate, weighted by how full the bed is */
    if (dtSec > 0) {
      const moved = Math.hypot(cart.x - prevX, cart.y - prevY) / dtSec;
      const omega = angleDelta(cart.rot, prevRot) / dtSec;
      const lat = Math.abs(moved * omega) * (0.5 + cartFillFrac(cart));

      if (lat > C.spillLatMps2) {
        cart.stability -= (lat - C.spillLatMps2) * C.spillDrainRate * dtSec;
        // GDD §11.3 "cart corners taken above safe speed" — counted on the way IN to
        // the overload, so one long corner is one corner and not two hundred steps.
        if (!cart.overLimit) {
          cart.overLimit = true;
          if (state.stats) state.stats.hardCorners++;
        }
      } else {
        cart.stability = Math.min(1, cart.stability + C.stabilityRecover * dtSec);
        cart.overLimit = false;
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
