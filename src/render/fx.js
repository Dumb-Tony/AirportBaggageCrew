/* The effects layer — dust, grit, puffs.
 *
 * Copied in shape from Brainrot\animations.js:11 `class FX` (Dev\INDEX.md → "Narrative /
 * content-driven games"), keeping the class name so the lineage stays greppable. Three
 * changes for this project:
 *
 *   - SEEDED, not Math.random. Nothing in this repo may call Math.random (m0 G1), and a
 *     screenshot has to be reproducible.
 *   - WORLD SPACE, in metres, not screen pixels — particles have to sit correctly under
 *     an oblique camera, so they are drawn on the ground transform and given a height.
 *   - No screen shake. Brainrot's version has one; GDD §16.6 requires adjustable screen
 *     shake as an accessibility setting, and there is no settings screen until M5, so it
 *     is not worth shipping something that cannot yet be turned off.
 *
 * This is PRESENTATION. It reads events and never writes to game state (GDD §31.3), and
 * it is driven by the frame delta, so a paused game gets dt = 0 and freezes.
 */

import { Rng } from '../core/rng.js';

const MAX = 260;          // hard cap — GDD §24.1 forbids unbounded particle lists

export class FX {
  constructor(seed = 0xBEEF) {
    this.parts = [];
    this.rng = new Rng(seed, 'fx');
    this.enabled = true;
  }

  reset() { this.parts.length = 0; this.rng.reset(); }

  get count() { return this.parts.length; }
  _room() { return this.enabled && this.parts.length < MAX; }

  /**
   * @param x,y  world metres
   * @param z    height above the ground, metres
   */
  _add(x, y, z, vx, vy, vz, life, r, color, gravity) {
    if (!this._room()) return;
    this.parts.push({ x, y, z, vx, vy, vz, life, max: life, r, color, g: gravity });
  }

  /** A bag hitting the floor: a low ring of dust. */
  dust(x, y, strength = 1) {
    const n = Math.round(5 + 5 * strength);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rng.range(-0.3, 0.3);
      const sp = this.rng.range(0.5, 1.8) * strength;
      this._add(x, y, 0.05,
        Math.cos(a) * sp, Math.sin(a) * sp * 0.6, this.rng.range(0.3, 1.1),
        this.rng.range(0.35, 0.7), this.rng.range(0.06, 0.15),
        'rgba(210,205,190,', 2.2);
    }
  }

  /** A bag thrown off a cart on a corner: dust plus a bit of grit. */
  spill(x, y, dirX, dirY) {
    this.dust(x, y, 1.4);
    for (let i = 0; i < 7; i++) {
      this._add(x, y, this.rng.range(0.1, 0.5),
        dirX * this.rng.range(0.4, 2.0) + this.rng.range(-0.6, 0.6),
        dirY * this.rng.range(0.4, 2.0) + this.rng.range(-0.6, 0.6),
        this.rng.range(1.0, 2.4),
        this.rng.range(0.4, 0.8), this.rng.range(0.03, 0.07),
        'rgba(120,112,96,', 5.5);
    }
  }

  /* An `exhaust()` emitter and a `_exhaustAccum` field in the renderer used to live here
   * as the two halves of a tractor-exhaust effect whose CALL SITE was never written.
   * Both removed: dead code that looks finished is worse than no code, because the next
   * reader spends time working out which half is broken. If exhaust is wanted, it wants
   * a rate accumulator driven by the real frame delta like the rest of this file, and
   * it should be written then rather than half-restored from here. */

  /** A bag going into the hold: a small confirming sparkle. */
  tick(x, y, color = 'rgba(120,220,140,') {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this._add(x, y, 0.5,
        Math.cos(a) * 0.9, Math.sin(a) * 0.5, this.rng.range(0.6, 1.2),
        0.45, 0.05, color, 1.2);
    }
  }

  /** @param dtSec real frame time; pass 0 while paused and nothing moves. */
  update(dtSec) {
    if (dtSec <= 0) return;
    const p = this.parts;
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      q.life -= dtSec;
      if (q.life <= 0) { p[i] = p[p.length - 1]; p.pop(); continue; }
      q.x += q.vx * dtSec;
      q.y += q.vy * dtSec;
      q.z += q.vz * dtSec;
      q.vz -= q.g * dtSec;
      if (q.z < 0) { q.z = 0; q.vz = 0; q.vx *= 0.6; q.vy *= 0.6; }
      q.vx *= 1 - 1.6 * dtSec;
      q.vy *= 1 - 1.6 * dtSec;
    }
  }

  /**
   * Drawn through the camera so a particle sits at the right place on an oblique
   * ground and rises correctly with its height.
   */
  draw(ctx, camera) {
    if (!this.parts.length) return;
    for (const q of this.parts) {
      const a = Math.max(0, Math.min(1, q.life / q.max));
      const s = camera.beginUpright(ctx, q.x, q.y);
      ctx.fillStyle = q.color + (a * 0.75).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(0, -q.z, q.r * (0.6 + a * 0.6), 0, Math.PI * 2);
      ctx.fill();
      void s;
    }
  }
}
