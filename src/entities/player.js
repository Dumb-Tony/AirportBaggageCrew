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
    targetCartId: null,        // the cart within reach, if any
    targetVehicleId: null,     // the vehicle that could be climbed into
    targetHoldId: null,        // the aircraft whose hold volume the player is inside
    targetHoldOpen: false,     // ...and whether its door is open
    drivingId: null,           // the vehicle being driven, or null
    charging: false,           // throw charge held
    chargeMs: 0,
    walkedM: 0,                // travel distance, for the shift report odd statistics
  };
}

/** A carried bag sits in front of the hands. Written every step so it tracks exactly,
 *  with no spring lag to desynchronise it from the reach test. */
function pinCarried(state) {
  const p = state.player;
  if (!p.carryingBagId) return;
  const bag = state.bagsById[p.carryingBagId];
  if (!bag) return;
  bag.x = p.x + p.aimX * CONFIG.bag.carryOffsetM;
  bag.y = p.y + p.aimY * CONFIG.bag.carryOffsetM;
  bag.vx = 0; bag.vy = 0;
  bag.rot = Math.atan2(p.aimY, p.aimX);
}

/**
 * @param {object} state
 * @param {number} dtSec
 * @param {object} input  may be null (headless simulation)
 */
export function stepPlayer(state, dtSec, input) {
  const p = state.player;
  const P = CONFIG.player;

  // Driving: the player IS the tractor. Keeping the position in lockstep rather than
  // hiding the player somewhere means the camera, the carried bag and every reach test
  // keep working unchanged — there is no second "are we driving" case to forget.
  if (p.drivingId) {
    const v = state.vehiclesById[p.drivingId];
    if (v) {
      p.x = v.x; p.y = v.y;
      p.vx = v.vx; p.vy = v.vy;
      p.aimX = Math.cos(v.rot); p.aimY = Math.sin(v.rot);
    } else {
      p.drivingId = null;      // defensive: the vehicle vanished, do not strand the player
    }
    pinCarried(state);
    return;
  }

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

  /*
   * AIM FOLLOWS MOVEMENT, and nothing else.
   *
   * It used to prefer the mouse whenever `pointerWorld` was set — and `main.js` sets that
   * on the first `mousemove` and every frame after, for ever. So one accidental twitch of
   * the mouse locked the crew's facing to the cursor permanently: walking north while
   * staring south, hands reaching at whatever the pointer happened to be over. There was
   * no way back to walking-aim short of reloading, which is what made it read as a lock
   * rather than as a control.
   *
   * GDD §17.1 offers "mouse position OR movement direction" and then says outright to
   * favour reliable movement over elaborate mouse aiming for a top-down prototype. This
   * is that. It also makes §16.6's keyboard-only requirement the DEFAULT path rather than
   * a fallback, which is the shape m7 section D has been asserting all along.
   *
   * Standing still HOLDS the last direction, deliberately: you line a throw up by facing
   * it, and a crew that snapped back to some resting angle the moment you stopped walking
   * could not be aimed at all.
   */
  if (moving) {
    const d = Math.hypot(ax.x, ax.y);
    p.aimX = ax.x / d; p.aimY = ax.y / d;
  }

  pinCarried(state);
}

/** Charge fraction 0..1 for the throw meter. */
export const chargeFrac = (p) =>
  Math.min(1, p.chargeMs / CONFIG.bag.throwChargeMs);
