/* Loose bags moving through the world — GDD §6.2, §21.6, §24.2.
 *
 * Only bags whose authoritative location is 'floor' are simulated here. Bags on the
 * belt are the conveyor's business; a carried bag is pinned to the player's hands; a
 * bag in a cart or a hold (M2/M3) will be pinned to its container. That split is what
 * keeps "exactly one authoritative location" cheap to honour.
 */

import { CONFIG } from '../config.js';
import { moveWithWalls, applyFriction, separate } from './physics.js';
import { moveBag } from './containment.js';
import { createBag } from '../entities/bag.js';
import { EVENTS } from '../core/eventBus.js';
import { cartContains, cartRoomFor, cartSlotWorld } from '../entities/cart.js';
import { holdContains } from '../entities/aircraft.js';

/**
 * Put every bag whose scheduled moment has passed onto the belt.
 *
 * Driven by simTimeMs crossing a threshold, never by a timer — so it pauses when the
 * clock pauses, and a skipped-forward debug jump emits the backlog it should have.
 * @returns {number} how many spawned this step
 */
export function spawnDueBags(state, rng, simTimeMs, bus) {
  const shift = state.shift;
  const conv = state.world.conveyor;
  let n = 0;
  while (shift.nextSpawnIdx < shift.bagSchedule.length &&
         shift.bagSchedule[shift.nextSpawnIdx].atMs <= simTimeMs) {

    // The feed backs up rather than stacking bags on top of each other at the entry.
    // The belt never stops, so the entry always clears and a deferred bag always
    // arrives — just late, which is exactly what a real backlog does.
    const newest = conv.bagIds.length ? state.bagsById[conv.bagIds[conv.bagIds.length - 1]] : null;
    if (newest && newest.location.t < CONFIG.bag.beltSpacingM) break;

    const spec = shift.bagSchedule[shift.nextSpawnIdx];
    const bag = createBag(spec, shift.nextSpawnIdx, shift.tagBase, rng);

    state.bagsById[bag.id] = bag;
    // Re-assert the location through moveBag so conveyor.bagIds is maintained by the
    // one writer that is allowed to maintain it.
    moveBag(state, bag, { type: 'conveyor', id: state.world.conveyor.id, t: 0 }, bus, simTimeMs);

    // The flight is now owed this specific bag — GDD §22.2 `expectedBagIds`. The COUNT
    // was known up front from the timetable; this is the list of the ones that actually
    // reached the belt, which is what the missed-bag pass walks.
    const flight = state.flightsById[bag.flightId];
    if (flight && !flight.expectedBagIds.includes(bag.id)) flight.expectedBagIds.push(bag.id);

    shift.nextSpawnIdx++;
    shift.spawned++;
    n++;
    if (bus) bus.emit(EVENTS.BAG_SPAWNED, { bagId: bag.id, flightId: bag.flightId }, simTimeMs);
  }
  return n;
}

/** Rebuild the spatial index from every bag that has a world position. */
export function rebuildGrid(state, grid) {
  grid.clear();
  for (const id of Object.keys(state.bagsById)) {
    const bag = state.bagsById[id];
    const t = bag.location.type;
    if (t === 'floor' || t === 'conveyor' || t === 'cart') grid.insert(id, bag.x, bag.y);
  }
  return grid;
}

/**
 * Pin every bag in a cart to its slot. GDD §21.6 — a bag in a cart is not simulated, it
 * is a local position on a moving frame. This runs AFTER the train has been placed, so a
 * cart and its load can never be seen a step apart.
 */
export function syncCartBagPositions(state) {
  for (const cart of Object.values(state.cartsById)) {
    for (let i = 0; i < cart.bagIds.length; i++) {
      const bag = state.bagsById[cart.bagIds[i]];
      if (!bag) continue;
      const p = cartSlotWorld(cart, i);
      bag.x = p.x; bag.y = p.y;
      bag.vx = 0; bag.vy = 0;
      bag.rot = cart.rot + bag.appearance.wobble * 0.4;
    }
  }
}

/**
 * A loose bag that comes to rest inside a cart is caught by it — so throwing luggage
 * into a cart works, which is most of the fantasy (GDD §1: "Grab. Throw.").
 *
 * The cooldown matters: without it a bag that spills on a corner is instantly swallowed
 * again by the cart that just threw it, and the spill never reads as a mistake.
 */
export function absorbIntoContainers(state, simTimeMs, bus) {
  const carts = Object.values(state.cartsById);
  const aircraft = Object.values(state.aircraftById || {});
  if (!carts.length && !aircraft.length) return 0;
  let n = 0;

  for (const id of Object.keys(state.bagsById)) {
    const bag = state.bagsById[id];
    if (bag.location.type !== 'floor') continue;
    if (Math.hypot(bag.vx, bag.vy) > CONFIG.cart.absorbSpeedMps) continue;
    if (bag.cartCooldownMs && simTimeMs < bag.cartCooldownMs) continue;

    // An OPEN hold takes precedence: a bag lobbed through the door is loaded, which is
    // GDD §9.1 read literally — it was released inside the valid hold volume. A CLOSED
    // hold catches nothing, so a bag thrown at a sealed aircraft just lands on the ramp.
    let placed = false;
    for (const ac of aircraft) {
      if (!ac.present || !ac.holdOpen) continue;
      if (!holdContains(ac, bag.x, bag.y)) continue;
      bag.vx = 0; bag.vy = 0;
      moveBag(state, bag, { type: 'aircraftHold', id: ac.id }, bus, simTimeMs);
      placed = true; n++;
      break;
    }
    if (placed) continue;

    for (const cart of carts) {
      if (!cartContains(cart, bag.x, bag.y)) continue;
      if (!cartRoomFor(cart, state, bag).ok) break;    // full: it stays on the floor
      bag.vx = 0; bag.vy = 0;
      moveBag(state, bag, { type: 'cart', id: cart.id }, bus, simTimeMs);
      n++;
      break;
    }
  }
  return n;
}

/**
 * Integrate loose bags, then resolve overlaps.
 *
 * Separation is a single positional pass, not an iterated solver: a pile of forty bags
 * settles in a few steps and looks like luggage rather than like a physics demo. GDD
 * §6.4 explicitly allows a simpler model "if reliable physics stacking is too costly".
 */
export function stepBags(state, dtSec, grid) {
  const B = CONFIG.bag;
  const ids = Object.keys(state.bagsById);
  const near = [];

  // 1. integrate
  for (const id of ids) {
    const bag = state.bagsById[id];
    if (bag.location.type !== 'floor') continue;
    if (bag.vx !== 0 || bag.vy !== 0) {
      moveWithWalls(bag, dtSec, bag.radiusM, B.restitution);
      applyFriction(bag, dtSec, B.friction);
      // spin while sliding, purely cosmetic
      bag.rot += (bag.vx * 0.06 + bag.vy * 0.04) * dtSec * 6;
    }
  }

  // 2. bag vs bag — grid-local, so this stays linear in bag count
  for (const id of ids) {
    const a = state.bagsById[id];
    if (a.location.type !== 'floor') continue;
    grid.query(a.x, a.y, a.radiusM * 2.2, near);
    for (const otherId of near) {
      if (otherId === id) continue;
      const b = state.bagsById[otherId];
      if (!b || b.location.type !== 'floor') continue;
      // Resolve each pair once: only the lexicographically smaller id acts.
      if (id > otherId) continue;
      separate(a, b, a.radiusM + b.radiusM, 0.5, B.separation);
    }
  }

  // 3. the player shoves bags aside rather than being blocked by them. Being unable to
  //    walk through your own mess would be realistic and miserable; GDD §6.5 wants
  //    readable, reversible disruption instead.
  const p = state.player;
  if (!p.drivingId) {
    grid.query(p.x, p.y, p.radiusM + 1.2, near);
    for (const id of near) {
      const bag = state.bagsById[id];
      if (!bag || bag.location.type !== 'floor') continue;
      // weightA = 0 pins the player and moves only the bag
      separate(p, bag, p.radiusM + bag.radiusM, 0, CONFIG.player.pushStrength);
    }
  }

  // 4. vehicles scatter luggage harder than people do — GDD §6.5, §8.2.
  for (const v of Object.values(state.vehiclesById)) {
    if (!v.driverId) continue;
    grid.query(v.x, v.y, v.radiusM + 1.4, near);
    for (const id of near) {
      const bag = state.bagsById[id];
      if (!bag || bag.location.type !== 'floor') continue;
      if (separate(v, bag, v.radiusM + bag.radiusM, 0, CONFIG.tractor.bagShoveStrength)) {
        // give it a shove so it visibly skitters rather than sliding silently aside
        const dx = bag.x - v.x, dy = bag.y - v.y;
        const d = Math.hypot(dx, dy) || 1;
        const kick = Math.min(3.5, Math.abs(v.speed || 0) * 0.6);
        bag.vx += (dx / d) * kick;
        bag.vy += (dy / d) * kick;
      }
    }
  }
}
