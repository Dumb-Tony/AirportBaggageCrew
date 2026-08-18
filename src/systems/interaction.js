/* Grab, release, throw, scan — GDD §6.1, §7.1, §17.1.
 *
 * The essential verbs, and nothing else. Every one of them is allowed to be WRONG:
 * GDD §31.1.8 forbids blocking a bad action to protect the player's score, so nothing
 * below refuses an input on the grounds that it is a mistake. The scanner warns; it
 * does not veto.
 *
 * Binding note (GDD §17.1 flags the conflict itself): E grabs and releases, Space
 * charges and throws. Using the left mouse button for both a tap-grab and a hold-throw
 * made the two indistinguishable until the button came back up.
 */

import { CONFIG } from '../config.js';
import { EVENTS } from '../core/eventBus.js';
import { moveBag } from './containment.js';
import { recordScan, weightOf } from '../entities/bag.js';
import { padAt } from '../data/airport.js';
import { chargeFrac } from '../entities/player.js';

/** Bags you can reach out and take: loose on the floor, or riding past on the belt. */
const isTargetable = (bag) =>
  bag.location.type === 'floor' || bag.location.type === 'conveyor';

/**
 * Nearest reachable bag, biased toward where the player is aiming, so that facing a
 * pile and pressing E takes the one you are looking at rather than the one that happens
 * to be a centimetre closer to your feet.
 */
export function findTarget(state, grid) {
  const p = state.player;
  const reach = CONFIG.player.reachM;
  const near = grid.query(p.x, p.y, reach + 1, []);

  let best = null, bestScore = Infinity;
  for (const id of near) {
    const bag = state.bagsById[id];
    if (!bag || !isTargetable(bag)) continue;

    const dx = bag.x - p.x, dy = bag.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d > reach + bag.radiusM) continue;

    // cos of the angle between the aim and the bag; 1 is dead ahead, -1 is behind
    const cos = d < 1e-6 ? 1 : (dx * p.aimX + dy * p.aimY) / d;
    const score = d * (1 + (1 - cos) * 0.9);
    if (score < bestScore) { bestScore = score; best = id; }
  }
  return best;
}

export function stepInteraction(state, dtSec, input, bus, simTimeMs, grid) {
  const p = state.player;
  p.targetBagId = findTarget(state, grid);

  // scan card lifetime
  if (state.scan && simTimeMs - state.scan.atMs > CONFIG.interaction.scanCardMs) {
    state.scan = null;
  }
  if (!input) return;

  /* ── grab / release (E) ───────────────────────────────────────────────── */
  if (input.wasPressed('grab')) {
    if (p.carryingBagId) {
      releaseHeld(state, bus, simTimeMs);
    } else if (p.targetBagId) {
      const bag = state.bagsById[p.targetBagId];
      if (bag) {
        bag.vx = 0; bag.vy = 0;
        moveBag(state, bag, { type: 'carried', id: p.id }, bus, simTimeMs);
      }
    }
  }

  /* ── throw (hold Space, release) ──────────────────────────────────────── */
  if (p.carryingBagId) {
    if (input.isDown('throw')) {
      p.charging = true;
      p.chargeMs = Math.min(CONFIG.bag.throwChargeMs, p.chargeMs + dtSec * 1000);
    } else if (p.charging) {
      throwHeld(state, bus, simTimeMs);
    }
  } else {
    p.charging = false;
    p.chargeMs = 0;
  }

  /* ── scan (Q) ─────────────────────────────────────────────────────────── */
  if (input.wasPressed('scan')) {
    const id = p.carryingBagId || p.targetBagId;
    if (id) scanBag(state, state.bagsById[id], bus, simTimeMs);
  }
}

/** Put the held bag down where the hands are, with no velocity. */
export function releaseHeld(state, bus, simTimeMs) {
  const p = state.player;
  const bag = state.bagsById[p.carryingBagId];
  if (!bag) return null;
  bag.vx = 0; bag.vy = 0;
  p.charging = false; p.chargeMs = 0;
  moveBag(state, bag, { type: 'floor' }, bus, simTimeMs);
  return bag;
}

/** Launch the held bag along the aim, at a speed set by the charge and the weight. */
export function throwHeld(state, bus, simTimeMs) {
  const p = state.player;
  const bag = state.bagsById[p.carryingBagId];
  if (!bag) { p.charging = false; p.chargeMs = 0; return null; }

  const B = CONFIG.bag;
  const f = chargeFrac(p);
  const speed = (B.throwMinSpeed + (B.throwMaxSpeed - B.throwMinSpeed) * f)
              * weightOf(bag).throwMult;

  bag.vx = p.aimX * speed + p.vx * 0.5;   // your own momentum counts
  bag.vy = p.aimY * speed + p.vy * 0.5;
  p.charging = false; p.chargeMs = 0;

  moveBag(state, bag, { type: 'floor' }, bus, simTimeMs);
  if (bus) bus.emit(EVENTS.BAG_THROWN, { bagId: bag.id, speed }, simTimeMs);
  return bag;
}

/**
 * GDD §7.1: the scanner is an optional confidence tool, not a permission key. It reads
 * the tag and tells you what it says. It never moves the bag, never blocks a placement,
 * and never corrects a mistake — it only makes the mistake knowable.
 *
 * The verdict compares where the bag is STANDING to where it BELONGS, which is why it
 * can already say "wrong" at Milestone 1: the staging pads are gated by gate id.
 */
export function scanBag(state, bag, bus, simTimeMs) {
  if (!bag) return null;

  const pad = bag.location.type === 'floor' ? padAt(bag.x, bag.y) : null;
  let verdict = 'neutral';
  if (pad) verdict = pad.gateId === bag.gateId ? 'correct' : 'wrong';

  recordScan(bag, simTimeMs, pad ? pad.id : bag.location.type, state.player.id);

  state.scan = {
    bagId: bag.id,
    atMs: simTimeMs,
    verdict,
    padId: pad ? pad.id : null,
  };
  if (bus) bus.emit(EVENTS.BAG_SCANNED, { bagId: bag.id, verdict }, simTimeMs);
  return state.scan;
}
