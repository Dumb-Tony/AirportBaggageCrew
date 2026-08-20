/* Baggage carts — GDD §8.1, §6.4, §22.3.
 *
 * A cart is an open frame that holds bags in fixed local slots, carries a placard the
 * player may set or ignore, and hitches to a tractor or to another cart.
 *
 * Bags in a cart are NOT simulated. GDD §21.6: "Bags inside carts may be represented by
 * local positions attached to the cart rather than continuously resolving full rigid-body
 * collisions." A bag in slot 3 is at slot 3, transformed by the cart. That is what makes
 * "a full cart travels to the gate without state corruption" a property rather than a
 * hope — there is nothing to go wrong in transit.
 *
 * A cart may hold a mix of destinations. GDD §7.3: "Mixed carts are allowed and often
 * disastrous, but the game records their contents." Nothing here refuses a bag because
 * it does not match the placard.
 */

import { CONFIG } from '../config.js';
import { weightOf } from './bag.js';

export function createCart(id, x, y, rot = 0) {
  return {
    id,
    // GDD §22.3 calls this `transform`; kept flat as x/y/rot to match every other
    // entity, so one collision or render helper works on all of them.
    x, y, rot,
    bagIds: [],                 // ordered; index IS the slot index. Written only by containment.js
    capacitySlots: CONFIG.cart.capacitySlots,
    capacityWeight: CONFIG.cart.capacityWeight,
    placardFlightId: null,      // what the player SAYS is in it. May be a lie.
    // Display copies of the placard, written by setPlacard() at the same moment as the
    // id. Denormalised on purpose: it keeps the renderer from importing flight data,
    // which is the boundary GDD §31.3 draws. One writer, so it cannot drift.
    placardLabel: null,
    placardColor: null,
    hitchedToId: null,          // parent: a tractor id or another cart id
    nextCartId: null,           // child
    stability: 1,               // 1 steady, 0 about to throw a bag off
    spills: 0,
  };
}

/** Local slot offsets, computed once: 2 columns down the length of the bed. */
const SLOTS = (() => {
  const { slotCols, slotRows, lengthM, widthM } = CONFIG.cart;
  const out = [];
  const usableL = lengthM - 0.85, usableW = widthM - 0.45;
  for (let r = 0; r < slotRows; r++) {
    for (let c = 0; c < slotCols; c++) {
      out.push({
        lx: -usableL / 2 + (usableL * r) / (slotRows - 1),
        ly: -usableW / 2 + (usableW * c) / (slotCols - 1),
      });
    }
  }
  return out;
})();

export const SLOT_COUNT = SLOTS.length;

/** World position of slot `i` on this cart. */
export function cartSlotWorld(cart, i) {
  const s = SLOTS[i % SLOTS.length];
  const cos = Math.cos(cart.rot), sin = Math.sin(cart.rot);
  return {
    x: cart.x + s.lx * cos - s.ly * sin,
    y: cart.y + s.lx * sin + s.ly * cos,
  };
}

/** The point a following cart is towed from: behind this one. */
export function cartTowPoint(cart) {
  const back = CONFIG.cart.lengthM / 2 + 0.15;
  return { x: cart.x - Math.cos(cart.rot) * back, y: cart.y - Math.sin(cart.rot) * back };
}

export function cartWeight(cart, state) {
  let kg = 0;
  for (const id of cart.bagIds) {
    const bag = state.bagsById[id];
    if (bag) kg += bag.kg;
  }
  return kg;
}

export const cartFillFrac = (cart) =>
  Math.min(1, cart.bagIds.length / cart.capacitySlots);

/**
 * Both limits, reported separately so the HUD and the tests can say WHICH one bit.
 * @returns {{ok:boolean, reason:string, slots:number, kg:number}}
 */
export function cartRoomFor(cart, state, bag) {
  const slots = cart.bagIds.length;
  const kg = cartWeight(cart, state);
  if (slots >= cart.capacitySlots) return { ok: false, reason: 'full', slots, kg };
  const add = bag ? bag.kg : weightOf({ weightClass: 'normal' }).kg;
  if (kg + add > cart.capacityWeight) return { ok: false, reason: 'overweight', slots, kg };
  return { ok: true, reason: 'ok', slots, kg };
}

/** Is (x,y) inside the cart bed? Oriented box, so a turning cart still catches throws. */
export function cartContains(cart, x, y, pad = 0) {
  const dx = x - cart.x, dy = y - cart.y;
  const cos = Math.cos(-cart.rot), sin = Math.sin(-cart.rot);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return Math.abs(lx) <= CONFIG.cart.lengthM / 2 + pad &&
         Math.abs(ly) <= CONFIG.cart.widthM / 2 + pad;
}

/** Placards cycle through "no placard" and every authored flight — GDD §8.1. */
export function nextPlacard(current, flightIds) {
  const order = [null, ...flightIds];
  const i = order.indexOf(current === undefined ? null : current);
  return order[(i + 1) % order.length];
}

/** Does the cart contain anything that contradicts its placard? Reported, never
 *  enforced — a mixed cart is legal and is supposed to be a problem the player made. */
export function cartMismatches(cart, state) {
  if (!cart.placardFlightId) return 0;
  let n = 0;
  for (const id of cart.bagIds) {
    const bag = state.bagsById[id];
    if (bag && bag.flightId !== cart.placardFlightId) n++;
  }
  return n;
}
