/* Top-down camera — GDD §19.3.
 *
 * Milestone 0 fits the whole airport on screen so route context is visible while the
 * layout is being locked. A gently-following camera arrives with the player (M1); the
 * transform below already supports it via `centre`, so that is a call-site change.
 *
 * Pure maths + a canvas transform. No game rules here (GDD §31.3).
 */

export class Camera {
  constructor({ worldW, worldH, paddingM = 0, maxPixelRatio = 2 }) {
    this.worldW = worldW;
    this.worldH = worldH;
    this.paddingM = paddingM;
    this.maxPixelRatio = maxPixelRatio;

    this.cssW = 1; this.cssH = 1;   // CSS pixels
    this.dpr = 1;
    this.scale = 1;                 // screen pixels per metre
    this.centre = { x: worldW / 2, y: worldH / 2 };
    this.mode = 'fit';              // 'fit' | 'follow'
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
    this._recomputeFit();
    return true;
  }

  _recomputeFit() {
    const w = this.worldW + this.paddingM * 2;
    const h = this.worldH + this.paddingM * 2;
    this.scale = Math.min(this.cssW / w, this.cssH / h);
  }

  /** Screen-pixel size of the drawable world area, for letterbox bars. */
  get viewport() {
    return { w: this.cssW, h: this.cssH };
  }

  /** Apply world->screen to a 2D context. Everything drawn after this is in METRES. */
  applyTo(ctx) {
    const s = this.scale * this.dpr;
    const ox = (this.cssW * this.dpr) / 2 - this.centre.x * s;
    const oy = (this.cssH * this.dpr) / 2 - this.centre.y * s;
    ctx.setTransform(s, 0, 0, s, ox, oy);
    return s;
  }

  /** Reset to raw device pixels — for HUD drawn on the canvas, and for clearing. */
  resetTransform(ctx) { ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); }

  worldToScreen(x, y) {
    const s = this.scale;
    return {
      x: this.cssW / 2 + (x - this.centre.x) * s,
      y: this.cssH / 2 + (y - this.centre.y) * s,
    };
  }

  screenToWorld(sx, sy) {
    const s = this.scale;
    return {
      x: this.centre.x + (sx - this.cssW / 2) / s,
      y: this.centre.y + (sy - this.cssH / 2) / s,
    };
  }

  /** Metres visible across the viewport — used to decide label density. */
  get visibleM() { return { w: this.cssW / this.scale, h: this.cssH / this.scale }; }
}
