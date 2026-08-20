/* Top-down camera — GDD §19.3.
 *
 * Milestone 0 fits the whole airport on screen so route context is visible while the
 * layout is being locked. A gently-following camera arrives with the player (M1); the
 * transform below already supports it via `centre`, so that is a call-site change.
 *
 * Pure maths + a canvas transform. No game rules here (GDD §31.3).
 */

export class Camera {
  constructor({ worldW, worldH, paddingM = 0, maxPixelRatio = 2,
                viewWidthM = 62, followLerp = 7, squash = 0.75 }) {
    // OBLIQUE, not straight down. The GROUND is foreshortened vertically by `squash`,
    // as if seen from about 50 degrees; things that STAND UP are drawn upright at their
    // foreshortened base position, with their height going up the screen. That is the
    // whole 2.5D trick, and it is why there are two transforms below rather than one:
    // applyGround() for anything lying flat, beginUpright() for anything standing on it.
    this.squash = squash;
    this.worldW = worldW;
    this.worldH = worldH;
    this.paddingM = paddingM;
    this.maxPixelRatio = maxPixelRatio;
    this.viewWidthM = viewWidthM;
    this.followLerp = followLerp;

    this.cssW = 1; this.cssH = 1;   // CSS pixels
    this.dpr = 1;
    this.scale = 1;                 // screen pixels per metre
    this.centre = { x: worldW / 2, y: worldH / 2 };
    this.mode = 'follow';           // 'follow' | 'fit'
  }

  setMode(mode) {
    this.mode = mode;
    this._recomputeScale();
    if (mode === 'fit') this.centre = { x: this.worldW / 2, y: this.worldH / 2 };
    return mode;
  }

  /**
   * Ease the view toward a target and keep it inside the world.
   *
   * Clamping to the world edges matters more than it sounds: without it, standing in
   * the sort room shows a screen half full of void, and the player reads that emptiness
   * as "there is nothing over there" rather than "the airport ends here".
   * @param {number} dtSec  use 0 to snap instantly (restart, teleport)
   */
  follow(x, y, dtSec) {
    const vis = this.visibleM;
    const k = dtSec > 0 ? 1 - Math.exp(-this.followLerp * dtSec) : 1;
    this.centre.x += (x - this.centre.x) * k;
    this.centre.y += (y - this.centre.y) * k;

    const halfW = vis.w / 2, halfH = vis.h / 2;
    this.centre.x = vis.w >= this.worldW ? this.worldW / 2
      : Math.min(this.worldW - halfW, Math.max(halfW, this.centre.x));
    this.centre.y = vis.h >= this.worldH ? this.worldH / 2
      : Math.min(this.worldH - halfH, Math.max(halfH, this.centre.y));
  }

  /** Size the backing store to the element, DPR-aware but capped. @returns {boolean} changed */
  resize(canvas) {
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width  || canvas.clientWidth  || 1));
    const cssH = Math.max(1, Math.round(rect.height || canvas.clientHeight || 1));
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);

    const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (canvas.width === w && canvas.height === h && this.cssW === cssW && this.cssH === cssH) {
      return false;
    }
    canvas.width = w; canvas.height = h;
    this.cssW = cssW; this.cssH = cssH; this.dpr = dpr;
    this._recomputeScale();
    return true;
  }

  _recomputeScale() {
    if (this.mode === 'fit') {
      const w = this.worldW + this.paddingM * 2;
      const h = this.worldH + this.paddingM * 2;
      this.scale = Math.min(this.cssW / w, this.cssH / h);
    } else {
      // Zoom is set by how many metres must fit across the window — a readability
      // budget, not a taste one. See CONFIG.render.viewWidthM.
      this.scale = this.cssW / this.viewWidthM;
    }
  }

  /** The scale a 'fit' camera would use, without switching mode. */
  fitScale() {
    return Math.min(this.cssW / (this.worldW + this.paddingM * 2),
                    this.cssH / (this.worldH + this.paddingM * 2));
  }

  /** Screen-pixel size of the drawable world area, for letterbox bars. */
  get viewport() {
    return { w: this.cssW, h: this.cssH };
  }

  /**
   * The GROUND plane: metres in, foreshortened vertically. Use for anything that lies
   * flat — floor, painted markings, shadows, footprints.
   */
  applyGround(ctx) {
    const sx = this.scale * this.dpr;
    const sy = this.scale * this.squash * this.dpr;
    const ox = (this.cssW * this.dpr) / 2 - this.centre.x * sx;
    const oy = (this.cssH * this.dpr) / 2 - this.centre.y * sy;
    ctx.setTransform(sx, 0, 0, sy, ox, oy);
    return sx;
  }

  /** Kept for the 'fit' mode and anything that wants the old square mapping. */
  applyTo(ctx) { return this.applyGround(ctx); }

  /**
   * Stand an object on the ground at (wx, wy). After this, one unit is one metre in BOTH
   * axes — unsquashed — with the origin at the object's base and -y going up into the
   * air. Text and circles keep their proportions, which is why they are not drawn on the
   * ground transform.
   */
  beginUpright(ctx, wx, wy) {
    const p = this.worldToScreen(wx, wy);
    const s = this.scale * this.dpr;
    ctx.setTransform(s, 0, 0, s, p.x * this.dpr, p.y * this.dpr);
    return s;
  }

  /** How tall a metre-deep footprint appears once foreshortened. */
  get depthScale() { return this.squash; }

  /** Reset to raw device pixels — for HUD drawn on the canvas, and for clearing. */
  resetTransform(ctx) { ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); }

  worldToScreen(x, y) {
    const s = this.scale;
    return {
      x: this.cssW / 2 + (x - this.centre.x) * s,
      y: this.cssH / 2 + (y - this.centre.y) * s * this.squash,
    };
  }

  screenToWorld(sx, sy) {
    const s = this.scale;
    return {
      x: this.centre.x + (sx - this.cssW / 2) / s,
      y: this.centre.y + (sy - this.cssH / 2) / (s * this.squash),
    };
  }

  /** Metres visible across the viewport. Vertically that is MORE than it used to be:
   *  foreshortening fits more of the airport into the same pixels. */
  get visibleM() {
    return {
      w: this.cssW / this.scale,
      h: this.cssH / (this.scale * this.squash),
    };
  }
}
