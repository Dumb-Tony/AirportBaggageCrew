/* The player — GDD §20.2, §17.1.
 *
 * One local ground-handler. Top-down, accelerating movement, no jump, no stamina, no
 * classes (GDD §13: every player has the same verbs). Carrying a heavy bag slows them
 * down; that is the only stat the game has and it is GDD §6.3.
 */

import { CONFIG } from '../config.js';
import { moveWithWalls, applyFriction, approach } from '../systems/physics.js';
import { weightOf } from './bag.js';

export function createPlayer(spawn) {
  return {
    id: 'player_1',
    x: spawn.x, y: spawn.y,
    vx: 0, vy: 0,
    aimX: 1, aimY: 0,          // unit vector; where the hands are pointing
    radiusM: CONFIG.player.radiusM,

    carryingBagId: null,       // written only by systems/containment.js
    targetBagId: null,         // what a grab would pick up right now
    charging: false,           // throw charge held
    chargeMs: 0,
    walkedM: 0,                // travel distance, for the shift report's odd statistics
  };
}

/**
 * @param {object} state
 * @param {number} dtSec
 * @param {object} input  may be null (headless simulation)
 */
export function stepPlayer(state, dtSec, input) {
  const p = state.player;
  const P = CONFIG.player;

  // Carrying weight is the only thing that changes how the player moves.
  let speedMult = 1;
  if (p.carryingBagId) {
    const bag = state.bagsById[p.carryingBagId];
    if (bag) speedMult = weightOf(bag).speedMult;
  }

  const ax = input ? input.moveAxis() : { x: 0, y: 0 };
  const moving = ax.x !== 0 || ax.y !== 0;
  const maxSpeed = P.maxSpeed * speedMult;
  const rate = (moving ? P.accel : P.friction) * dtSec;

  p.vx = approach(p.vx, ax.x * maxSpeed, rate);
  p.vy = approach(p.vy, ax.y * maxSpeed, rate);

  const before = { x: p.x, y: p.y };
  moveWithWalls(p, dtSec, p.radiusM, 0);        // 0 restitution: slide along walls
  p.walkedM += Math.hypot(p.x - before.x, p.y - before.y);

  if (!moving) applyFriction(p, dtSec, P.friction);

  // Aim: the mouse if the player is using it, otherwise the way they are walking.
  // Keyboard-only play must work (GDD §16.6), so movement direction is a real fallback,
  // not a degraded one.
  const pw = input && input.pointerWorld;
  if (pw) {
    const dx = pw.x - p.x, dy = pw.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.25) { p.aimX = dx / d; p.aimY = dy / d; }
  } else if (moving) {
    const d = Math.hypot(ax.x, ax.y);
    p.aimX = ax.x / d; p.aimY = ax.y / d;
  }

  // Where a carried bag sits: in front of the hands. Written every step so the bag
  // tracks the player exactly, with no spring lag to desynchronise it from the reach.
  if (p.carryingBagId) {
    const bag = state.bagsById[p.carryingBagId];
    if (bag) {
      bag.x = p.x + p.aimX * CONFIG.bag.carryOffsetM;
      bag.y = p.y + p.aimY * CONFIG.bag.carryOffsetM;
      bag.vx = 0; bag.vy = 0;
      bag.rot = Math.atan2(p.aimY, p.aimX);
    }
  }
}

/** Charge fraction 0..1 for the throw meter. */
export const chargeFrac = (p) =>
  Math.min(1, p.chargeMs / CONFIG.bag.throwChargeMs);
