/* The baked clay atlas, at runtime — GDD §38.
 *
 * `tools\bake.ps1` renders every object into `assets/sprites.png` offline; this loads that
 * once and blits from it. Nothing here raymarches, and nothing here knows what a bag is.
 *
 * ⚠ A MISSING FRAME IS A LOUD FAILURE (GDD §38.6.4). It would otherwise be a silent gap in
 * the picture — an object that simply is not there, on a canvas where "nothing drew" and
 * "nothing was there to draw" look identical. `frame()` throws on an unknown name, because
 * that is a programming mistake and not a runtime condition.
 */

/** Where the atlas lives, relative to the page. RELATIVE on purpose: the live build is
 *  served from /AirportBaggageCrew/, not from the domain root, so a leading slash would
 *  404 on Pages while working perfectly on localhost. */
const DEFAULT_BASE = 'assets/';

export class SpriteSheet {
  constructor() {
    this.img = null;
    this.index = null;
    this.sets = new Map();      // name -> { headings, size, span, frames: [frame] }
    this.error = null;
  }

  /** True once the atlas is usable. The boot sequence gates the first frame on this. */
  get ready() { return !!this.img && !!this.index; }

  /**
   * Load the atlas and its frame index.
   *
   * Both are SAME-ORIGIN, which is what makes them legal: m6 G4 rejects `src`/`href`
   * matching `https?://` or `//`, and m6 G6 rejects runtime resources that do not start
   * with `location.origin`. A relative path is neither. GDD §21.1's "no external requests"
   * is about external SERVICES; the ES modules themselves are already fetched this way.
   */
  async load(base = DEFAULT_BASE) {
    const [index, img] = await Promise.all([
      fetch(base + 'sprites.json', { cache: 'no-cache' }).then((r) => {
        if (!r.ok) throw new Error(`sprites.json: HTTP ${r.status}`);
        return r.json();
      }),
      new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error('sprites.png failed to load'));
        im.src = base + 'sprites.png';
      }),
    ]);

    this.index = index;
    this.img = img;
    for (const s of index.sets) {
      this.sets.set(s.n, { headings: s.headings, size: s.s, span: s.span, frames: [] });
    }
    for (const f of index.frames) {
      const set = this.sets.get(f.n);
      if (!set) continue;
      set.frames[f.h] = f;
    }
    /* Prove the atlas is complete NOW rather than discovering a hole mid-shift. */
    for (const [name, set] of this.sets) {
      for (let h = 0; h < set.headings; h++) {
        if (!set.frames[h]) throw new Error(`atlas is missing ${name} heading ${h}`);
      }
    }
    return this;
  }

  /** Every set name the atlas carries. */
  names() { return [...this.sets.keys()]; }

  /**
   * The frame for a heading in RADIANS. Object space bakes +x as forward, and entity `rot`
   * uses the same convention, so this is a direct quantisation with no offset.
   */
  frame(name, rot = 0) {
    const set = this.sets.get(name);
    if (!set) throw new Error(`no sprite set "${name}" in the atlas`);
    const turns = rot / (Math.PI * 2);
    let h = Math.round((turns - Math.floor(turns)) * set.headings) % set.headings;
    if (h < 0) h += set.headings;
    return set.frames[h];
  }

  /**
   * Blit one sprite so its ANCHOR — the object's ground origin — lands on (sx, sy), which
   * are CSS pixels in a context already scaled for devicePixelRatio.
   *
   * The sprite carries its own foreshortening, because it was baked through the same
   * orthographic camera the game uses, so this only ever scales UNIFORMLY. That is the
   * whole reason the baker and the camera share one elevation constant.
   */
  draw(ctx, name, rot, sx, sy, pxPerM, alpha = 1) {
    const f = this.frame(name, rot);
    const w = f.span * pxPerM;
    const scale = w / f.s;
    const ax = sx - (f.s / 2) * scale;
    const ay = sy - f.anchor * scale;
    if (alpha !== 1) { ctx.save(); ctx.globalAlpha = alpha; }
    ctx.drawImage(this.img, f.x, f.y, f.s, f.s, ax, ay, w, f.s * scale);
    if (alpha !== 1) ctx.restore();
  }

  /** Bounding box in CSS px, for culling and for tests that want to know where a sprite
   *  actually landed rather than inferring it. */
  boundsOf(name, rot, sx, sy, pxPerM) {
    const f = this.frame(name, rot);
    const scale = (f.span * pxPerM) / f.s;
    return {
      x: sx - (f.s / 2) * scale, y: sy - f.anchor * scale,
      w: f.s * scale, h: f.s * scale,
    };
  }
}

/** The one instance the game uses. Loaded by the bootstrap before the first frame. */
export const sprites = new SpriteSheet();
