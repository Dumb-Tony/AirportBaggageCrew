/* The inbound conveyor — GDD §20.2, pillar 1 ("the airport never waits").
 *
 * The belt runs whether or not anyone is watching it. Bags ride from the check-in feed
 * to the end and then fall on the floor and stay there. There is deliberately no
 * overflow bin and no auto-stop: an unattended belt building a pile at its end IS the
 * game's first source of pressure.
 */

import { CONFIG } from '../config.js';
import { CONVEYOR } from '../data/airport.js';
import { EVENTS } from '../core/eventBus.js';
import { moveBag } from '../systems/containment.js';

export function createConveyor() {
  return {
    id: CONVEYOR.id,
    x0: CONVEYOR.x0, y0: CONVEYOR.y0,
    x1: CONVEYOR.x1, y1: CONVEYOR.y1,
    widthM: CONVEYOR.widthM,
    speedMps: CONVEYOR.speedMps,
    lengthM: CONVEYOR.lengthM,
    bagIds: [],          // ordered: index 0 is furthest along the belt
    delivered: 0,
  };
}

/** World position of a point `t` metres along the belt. */
export function beltPos(conv, t) {
  const k = conv.lengthM === 0 ? 0 : t / conv.lengthM;
  return {
    x: conv.x0 + (conv.x1 - conv.x0) * k,
    y: conv.y0 + (conv.y1 - conv.y0) * k,
  };
}

/**
 * Advance every bag on the belt, and drop the ones that reach the end.
 * @param {import('../core/rng.js').Rng} rng  the sim stream — drop scatter is seeded
 */
export function stepConveyor(state, dtSec, bus, simTimeMs, rng) {
  const conv = state.world.conveyor;
  if (conv.bagIds.length === 0) return 0;

  const dir = {
    x: (conv.x1 - conv.x0) / conv.lengthM,
    y: (conv.y1 - conv.y0) / conv.lengthM,
  };

  // Copy: dropping a bag splices conv.bagIds mid-iteration.
  const riding = conv.bagIds.slice();
  let dropped = 0;
  let aheadT = Infinity;   // the bag in front, so a fast feed queues instead of overlapping

  for (const id of riding) {
    const bag = state.bagsById[id];
    if (!bag || bag.location.type !== 'conveyor') continue;

    let t = bag.location.t + conv.speedMps * dtSec;
    const cap = aheadT - CONFIG.bag.beltSpacingM;
    if (t > cap) t = cap;
    if (t < 0) t = 0;

    if (t >= conv.lengthM) {
      // Off the end. It lands moving, with a seeded sideways kick so a pile spreads
      // instead of growing as one perfectly stacked column.
      const p = beltPos(conv, conv.lengthM);
      bag.x = p.x; bag.y = p.y;
      const scatter = rng.range(-CONFIG.bag.dropScatterMps, CONFIG.bag.dropScatterMps);
      bag.vx = dir.x * conv.speedMps - dir.y * scatter;
      bag.vy = dir.y * conv.speedMps + dir.x * scatter;
      moveBag(state, bag, { type: 'floor' }, bus, simTimeMs);
      conv.delivered++;
      dropped++;
      if (bus) bus.emit(EVENTS.BAG_LEFT_CONVEYOR, { bagId: bag.id, x: bag.x, y: bag.y }, simTimeMs);
      continue;
    }

    bag.location.t = t;
    const p = beltPos(conv, t);
    bag.x = p.x; bag.y = p.y;
    bag.rot = Math.atan2(dir.y, dir.x);
    aheadT = t;
  }
  return dropped;
}
