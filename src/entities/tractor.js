/* The baggage tractor — GDD §8.2, §17.1.
 *
 * Arcade steering: throttle, reverse, brake, and a yaw rate that ramps with speed. It is
 * not a bicycle model and does not need to be; GDD §31.1.5 asks for reliable arcade
 * behaviour over elaborate physics.
 *
 * The turning shape is the design point. Yaw rate is capped, and ramps to that cap at
 * `yawRefSpeed`. Below that the turning RADIUS is constant (speed and yaw rate scale
 * together) — a tight, forgiving 3.9 m circle for manoeuvring in the baggage room. Above
 * it the radius grows with speed, so a fast run down the ramp takes a wide arc and a
 * long cart train has to be planned. That is GDD §8.2 in one formula.
 */

import { CONFIG } from '../config.js';
import { moveWithWalls, approach } from '../systems/physics.js';

export function createTractor(id, x, y, rot = 0) {
  return {
    id,
    kind: 'tractor',
    x, y, rot,
    speed: 0,                // signed, along the heading
    yawRate: 0,              // rad/s, for the trailer stability calculation
    vx: 0, vy: 0,            // kept for moveWithWalls, derived from speed each step
    nextCartId: null,        // head of the towed train
    driverId: null,          // player id, or null
    radiusM: Math.max(CONFIG.tractor.lengthM, CONFIG.tractor.widthM) * 0.5,
    odometerM: 0,
  };
}

/** The hitch point, behind the tractor. */
export function tractorTowPoint(t) {
  return {
    x: t.x - Math.cos(t.rot) * CONFIG.tractor.towOffsetM,
    y: t.y - Math.sin(t.rot) * CONFIG.tractor.towOffsetM,
  };
}

/**
 * One step of driving. Only called when a driver is aboard; a parked tractor does not
 * coast, drift, or need integrating.
 */
export function stepTractor(state, t, dtSec, input) {
  const T = CONFIG.tractor;

  let throttle = 0, steer = 0, braking = false;
  if (input) {
    throttle = (input.isDown('moveUp') ? 1 : 0) - (input.isDown('moveDown') ? 1 : 0);
    steer = (input.isDown('moveRight') ? 1 : 0) - (input.isDown('moveLeft') ? 1 : 0);
    braking = input.isDown('brake');
  }

  /* longitudinal */
  if (braking) {
    t.speed = approach(t.speed, 0, T.brakeDecel * dtSec);
  } else if (throttle > 0) {
    t.speed = approach(t.speed, T.maxSpeed, T.accel * dtSec);
  } else if (throttle < 0) {
    // S brakes first, then reverses — pressing back while rolling forward should stop
    // you, not slam into reverse.
    const rate = t.speed > 0 ? T.brakeDecel : T.accel;
    t.speed = approach(t.speed, -T.reverseSpeed, rate * dtSec);
  } else {
    t.speed = approach(t.speed, 0, T.drag * dtSec);
  }

  /* yaw. Steering is inverted in reverse, the way a real vehicle behaves. */
  const ramp = Math.min(1, Math.abs(t.speed) / T.yawRefSpeed);
  const dir = t.speed < 0 ? -1 : 1;
  t.yawRate = steer * T.maxYawRate * ramp * dir;
  t.rot += t.yawRate * dtSec;
  // keep the angle bounded; an hour of circles must not lose float precision
  if (t.rot > Math.PI) t.rot -= Math.PI * 2;
  else if (t.rot < -Math.PI) t.rot += Math.PI * 2;

  /* integrate against the world */
  t.vx = Math.cos(t.rot) * t.speed;
  t.vy = Math.sin(t.rot) * t.speed;
  const x0 = t.x, y0 = t.y;
  const hit = moveWithWalls(t, dtSec, t.radiusM, T.restitution);
  if (hit) {
    // A wall bounce must scrub speed, or you can grind along a fence at full tilt.
    // GDD §8.2 wants disruption without trapping the vehicle, so it never zeroes.
    t.speed *= 0.35;
  }
  t.odometerM += Math.hypot(t.x - x0, t.y - y0);
  return t;
}

/** Where the driver stands when they get out: beside the cab, clear of the wheels. */
export function dismountPoint(t) {
  const side = 1.15;
  return {
    x: t.x - Math.sin(t.rot) * side,
    y: t.y + Math.cos(t.rot) * side,
  };
}
