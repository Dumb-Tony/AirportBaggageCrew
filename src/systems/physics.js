/* Arcade physics — GDD §6.2, §21.6.
 *
 * "Phase 1 should use lightweight arcade physics rather than a full rigid-body
 * simulation if the latter threatens stability." So: circles, axis-separated wall
 * resolution, linear friction, and positional push-apart between bags. No solver, no
 * angular dynamics, no stacking constraints.
 *
 * Every function here is pure-ish: it takes an entity-shaped {x,y,vx,vy} and mutates it.
 * No canvas, no state graph, no ids — which is why the m1 suite can exercise all of it
 * without building a game.
 */

import { isBlocked, clampToBounds, wallAt } from '../data/airport.js';

/**
 * Integrate velocity against the world, one axis at a time so an entity slides along a
 * wall instead of sticking to it.
 * @param {number} restitution 0 slides (player), >0 bounces (thrown bag)
 * @returns {boolean} whether anything was hit
 */
export function moveWithWalls(ent, dtSec, radius, restitution = 0) {
  let hit = false;

  const nx = ent.x + ent.vx * dtSec;
  if (isBlocked(nx, ent.y, radius)) { ent.vx = -ent.vx * restitution; hit = true; }
  else ent.x = nx;

  const ny = ent.y + ent.vy * dtSec;
  if (isBlocked(ent.x, ny, radius)) { ent.vy = -ent.vy * restitution; hit = true; }
  else ent.y = ny;

  // GDD §24.3: clamp back into bounds if numerical error ejects something, rather than
  // losing a bag outside the airport where no player can ever reach it.
  const c = clampToBounds(ent.x, ent.y, radius);
  if (c.clamped) {
    ent.x = c.x; ent.y = c.y;
    ent.vx *= -restitution; ent.vy *= -restitution;
    hit = true;
  }
  return hit;
}

/** Linear deceleration. Snaps to a dead stop below a threshold so nothing creeps. */
export function applyFriction(ent, dtSec, decel) {
  const sp = Math.hypot(ent.vx, ent.vy);
  if (sp < 0.02) { ent.vx = 0; ent.vy = 0; return 0; }
  const next = Math.max(0, sp - decel * dtSec);
  const k = next / sp;
  ent.vx *= k; ent.vy *= k;
  return next;
}

/** Move `v` toward `target` by at most `maxDelta`. */
export function approach(v, target, maxDelta) {
  const d = target - v;
  if (d > maxDelta) return v + maxDelta;
  if (d < -maxDelta) return v - maxDelta;
  return target;
}

/**
 * Push two overlapping circles apart, positionally. `weightA` is A's share of the
 * correction: 0.5 splits it, 0 pins A in place and moves only B.
 * @returns {boolean} whether they were overlapping
 */
export function separate(a, b, minDist, weightA = 0.5, strength = 0.55) {
  let dx = b.x - a.x, dy = b.y - a.y;
  let d = Math.hypot(dx, dy);
  if (d >= minDist) return false;

  /*
   * Exactly coincident: pick a fixed axis rather than a random one, so a pile settles the
   * same way on every replay of the same seed.
   *
   * ⚠ THE NORMAL MUST BE A UNIT VECTOR. This used to set `dx = 1, dy = 0, d = 1e-6` and
   * then normalise with `dx / d` — which is 1e6, not 1, so the "unit" normal was a million
   * units long and the separation impulse was scaled by a million with it. Two bags landing
   * on exactly the same float position threw one of them 181 km along the x axis, in a
   * 120 m world, in a single step, with its velocity still reading zero. It had been in
   * here since Milestone 1 and only showed up when the shift went to 51 bags and the belt
   * piled deep enough to stack two bags precisely.
   *
   * `d` stays 0 for the OVERLAP term — coincident bags want the full push — and the
   * normal is taken separately so it cannot inherit the degenerate divisor.
   */
  let nx, ny;
  if (d < 1e-6) { nx = 1; ny = 0; d = 0; }
  else { nx = dx / d; ny = dy / d; }

  const overlap = (minDist - d) * strength;
  a.x -= nx * overlap * weightA;
  a.y -= ny * overlap * weightA;
  b.x += nx * overlap * (1 - weightA);
  b.y += ny * overlap * (1 - weightA);
  return true;
}

/**
 * Shove an entity out of any wall it has ended up inside, along the shallowest axis.
 *
 * Towed carts are positioned by a constraint rather than by integration, so they cannot
 * use moveWithWalls — a tight turn through the sort-room door can place one straight
 * through a wall. This is the cleanup pass for anything positioned rather than moved.
 * @returns {boolean} whether it had to be moved
 */
export function pushOutOfWalls(ent, radius) {
  const w = wallAt(ent.x, ent.y, radius);
  if (!w) return false;

  const left  = (ent.x) - (w.x - radius);          // distance to exit each side
  const right = (w.x + w.w + radius) - ent.x;
  const up    = (ent.y) - (w.y - radius);
  const down  = (w.y + w.h + radius) - ent.y;

  const min = Math.min(left, right, up, down);
  if (min === left)       ent.x = w.x - radius - 1e-4;
  else if (min === right) ent.x = w.x + w.w + radius + 1e-4;
  else if (min === up)    ent.y = w.y - radius - 1e-4;
  else                    ent.y = w.y + w.h + radius + 1e-4;

  const c = clampToBounds(ent.x, ent.y, radius);
  ent.x = c.x; ent.y = c.y;
  return true;
}

/** Shortest signed difference between two angles, in (-PI, PI]. */
export function angleDelta(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Unit vector from a to b, or null if they coincide. */
export function direction(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const d = Math.hypot(dx, dy);
  return d < 1e-6 ? null : { x: dx / d, y: dy / d, dist: d };
}
