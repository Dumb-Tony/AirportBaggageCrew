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
    if (t === 'floor' || t === 'conveyor') grid.insert(id, bag.x, bag.y);
  }
  return grid;
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
  grid.query(p.x, p.y, p.radiusM + 1.2, near);
  for (const id of near) {
    const bag = state.bagsById[id];
    if (!bag || bag.location.type !== 'floor') continue;
    // weightA = 0 pins the player and moves only the bag
    separate(p, bag, p.radiusM + bag.radiusM, 0, CONFIG.player.pushStrength);
  }
}
