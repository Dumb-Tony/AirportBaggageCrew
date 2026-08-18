/* Containment — the ONE writer of bag.location. GDD §21.6, §31.1.10.
 *
 * "Preserve a single invariant: a bag has exactly one authoritative location mode."
 * Everything that moves a bag goes through moveBag(). Nothing else may assign
 * bag.location, and nothing may infer a bag's whereabouts from a second list.
 *
 * The reverse indexes (conveyor.bagIds, player.carryingBagId) exist for iteration order
 * and for cheap lookups. They are DERIVED: moveBag maintains them, and
 * assertContainment() proves they still agree with bag.location. When carts and holds
 * arrive in M2/M3 they hang off the same function and inherit the same proof.
 */

import { EVENTS } from '../core/eventBus.js';

export const LOCATION_TYPES = Object.freeze([
  'conveyor', 'floor', 'carried',
  'cart',        // Milestone 2
  'aircraftHold', // Milestone 3
  'departed',     // Milestone 3
]);

/**
 * Move a bag to a new location, detaching it from wherever it was.
 * @param {object} state     game state
 * @param {object} bag
 * @param {object} to        e.g. {type:'floor'} | {type:'carried', id:'player_1'} |
 *                                {type:'conveyor', id:'conv_1', t:0}
 * @param {object} bus       event bus (optional)
 * @param {number} simTimeMs
 */
export function moveBag(state, bag, to, bus = null, simTimeMs = 0) {
  if (!LOCATION_TYPES.includes(to.type)) {
    throw new Error(`moveBag: unknown location type "${to.type}" for ${bag.id}`);
  }
  const from = bag.location;

  // detach
  if (from) {
    if (from.type === 'conveyor') {
      const conv = state.world.conveyor;
      const i = conv.bagIds.indexOf(bag.id);
      if (i >= 0) conv.bagIds.splice(i, 1);
    } else if (from.type === 'carried') {
      if (state.player.carryingBagId === bag.id) state.player.carryingBagId = null;
    }
  }

  // attach
  if (to.type === 'conveyor') {
    const conv = state.world.conveyor;
    if (!conv.bagIds.includes(bag.id)) conv.bagIds.push(bag.id);
  } else if (to.type === 'carried') {
    // One pair of hands. A second grab must release the first, never silently orphan it.
    const held = state.player.carryingBagId;
    if (held && held !== bag.id) {
      const other = state.bagsById[held];
      if (other) moveBag(state, other, { type: 'floor' }, bus, simTimeMs);
    }
    state.player.carryingBagId = bag.id;
  }

  bag.location = { ...to };

  if (bus) {
    if (to.type === 'carried') bus.emit(EVENTS.BAG_PICKED_UP, { bagId: bag.id }, simTimeMs);
    if (from && from.type === 'carried' && to.type === 'floor') {
      bus.emit(EVENTS.BAG_RELEASED, { bagId: bag.id, x: bag.x, y: bag.y }, simTimeMs);
    }
  }
  return bag;
}

/** Is this bag loose in the world (needs physics and can be targeted)? */
export const isLoose = (bag) => bag.location.type === 'floor';

/** Development assertion. Returns a list of violations; empty means the invariant holds.
 *  Run by the m1 suite after every interesting operation, and by the debug overlay. */
export function assertContainment(state) {
  const bad = [];
  const conv = state.world.conveyor;
  const seenOnBelt = new Set();
  let carriedCount = 0;

  for (const id of Object.keys(state.bagsById)) {
    const bag = state.bagsById[id];
    const loc = bag.location;

    if (!loc || !LOCATION_TYPES.includes(loc.type)) {
      bad.push(`${id}: location type "${loc && loc.type}" is not a valid mode`);
      continue;
    }
    if (bag.id !== id) bad.push(`${id}: keyed under an id that is not its own (${bag.id})`);

    if (loc.type === 'conveyor') {
      if (!conv.bagIds.includes(id)) bad.push(`${id}: on the conveyor but missing from conveyor.bagIds`);
      if (seenOnBelt.has(id)) bad.push(`${id}: listed on the conveyor twice`);
      seenOnBelt.add(id);
    }
    if (loc.type === 'carried') {
      carriedCount++;
      if (state.player.carryingBagId !== id) bad.push(`${id}: carried but the player is not holding it`);
    }
  }

  for (const id of conv.bagIds) {
    const bag = state.bagsById[id];
    if (!bag) { bad.push(`conveyor.bagIds references unknown bag ${id}`); continue; }
    if (bag.location.type !== 'conveyor') bad.push(`${id}: in conveyor.bagIds but located "${bag.location.type}"`);
  }

  if (carriedCount > 1) bad.push(`the player is carrying ${carriedCount} bags at once`);
  if (state.player.carryingBagId && !state.bagsById[state.player.carryingBagId]) {
    bad.push(`player carries unknown bag ${state.player.carryingBagId}`);
  }
  return bad;
}

/** Count bags by location type — debug overlay and tests. */
export function countByLocation(state) {
  const out = {};
  for (const t of LOCATION_TYPES) out[t] = 0;
  for (const id of Object.keys(state.bagsById)) {
    const t = state.bagsById[id].location.type;
    out[t] = (out[t] || 0) + 1;
  }
  return out;
}
