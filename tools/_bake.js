/* THE SPRITE BAKER — GDD §38. Renders the clay diorama into an atlas, offline.
 *
 * Run it with `tools\bake.ps1`, which loads this page, waits for the atlas, and writes
 * `assets/sprites.png` and `assets/sprites.json`. It is a DEV TOOL and never ships.
 *
 * ⚠ WHY OFFLINE. Measured on this machine the raymarcher below runs at 43 pixels per
 * millisecond in JavaScript — flat across 96, 128 and 192 px sprites, so it is
 * compute-bound and does not amortise. The full sprite set is about 1.8 M pixels, which is
 * roughly 40 seconds. Baking at load is not a slow load, it is a broken one.
 *
 * ⚠ DETERMINISM IS A REQUIREMENT, not a nicety (GDD §38.6.1): the same input must give a
 * byte-identical atlas, or "did the art change" stops being answerable from a diff. So
 * there is no randomness anywhere below, no Date, and the models are pure functions of
 * their parameters.
 *
 * Everything the baker and the live camera must agree about lives in `src/render/clay.js`
 * and is imported, never copied.
 */

import {
  BAKE_EL_RAD, HEIGHT_SCALE, LIGHT_DIR, KEY_COL, SKY_COL, BOUNCE_COL, WRAP,
  CLAY_MATERIALS, BAG_CLAY,
} from '../src/render/clay.js';
import { CONFIG } from '../src/config.js';

/* ── SDF primitives ───────────────────────────────────────────────────────── */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;

function sdRoundBox(px, py, pz, bx, by, bz, r) {
  const qx = Math.abs(px) - bx + r, qy = Math.abs(py) - by + r, qz = Math.abs(pz) - bz + r;
  const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0, oz = qz > 0 ? qz : 0;
  const m = Math.max(qx, Math.max(qy, qz));
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + (m < 0 ? m : 0) - r;
}
const sdSphere = (px, py, pz, r) => Math.sqrt(px * px + py * py + pz * pz) - r;
function sdCylZ(px, py, pz, h, r) {            // axis along z — a wheel on a side axle
  const dx = Math.sqrt(px * px + py * py) - r, dy = Math.abs(pz) - h;
  const ox = dx > 0 ? dx : 0, oy = dy > 0 ? dy : 0;
  return Math.min(Math.max(dx, dy), 0) + Math.sqrt(ox * ox + oy * oy);
}
function sdCylY(px, py, pz, h, r) {
  const dx = Math.sqrt(px * px + pz * pz) - r, dy = Math.abs(py) - h;
  const ox = dx > 0 ? dx : 0, oy = dy > 0 ? dy : 0;
  return Math.min(Math.max(dx, dy), 0) + Math.sqrt(ox * ox + oy * oy);
}

/* The scene accumulator. Module-level so the inner loop allocates nothing. */
let _d = 0, _m = '';
const put = (d, m) => { if (d < _d) { _d = d; _m = m; } };

/* ── the models ───────────────────────────────────────────────────────────────
 * Object space: +x is FORWARD (the heading the entity faces at rot = 0), +y is up,
 * z is lateral. Ground is y = 0. Every model is sized in real metres from CONFIG so a
 * change to cart width moves the art with it rather than silently disagreeing.
 * ─────────────────────────────────────────────────────────────────────────── */

const C = CONFIG.cart;

function mBag(x, y, z, p) {
  _d = 1e9; _m = p.mat;
  const s = p.scale;
  put(sdRoundBox(x, y - 0.20 * s, z, 0.34 * s, 0.20 * s, 0.24 * s, 0.11 * s), p.mat);
  /* a strap across the lid, so a bag is not a featureless pebble */
  put(sdRoundBox(x, y - 0.395 * s, z, 0.10 * s, 0.02 * s, 0.245 * s, 0.02 * s), 'rubber');
  return _d;
}

function mCart(x, y, z) {
  _d = 1e9; _m = 'cart';
  const hw = C.lengthM / 2, hd = C.widthM / 2;
  put(sdRoundBox(x, y - 0.52, z, hw * 0.90, 0.10, hd * 0.83, 0.10), 'cart');   // bed
  put(sdRoundBox(x, y - 0.36, z, hw * 0.72, 0.07, hd * 0.61, 0.07), 'cart');   // chassis
  /* SIDE RAILS — the defining silhouette of a baggage cart. Without them a bed on legs
   * reads as furniture, which is exactly what the first pass did. */
  put(sdRoundBox(x, y - 0.68, z - hd * 0.80, hw * 0.88, 0.15, 0.04, 0.04), 'cart');
  put(sdRoundBox(x, y - 0.68, z + hd * 0.80, hw * 0.88, 0.15, 0.04, 0.04), 'cart');
  put(sdRoundBox(x - hw * 0.88, y - 0.68, z, 0.04, 0.15, hd * 0.80, 0.04), 'cart');
  put(sdRoundBox(x + hw * 0.88, y - 0.68, z, 0.04, 0.15, hd * 0.80, 0.04), 'cart');
  for (const wz of [-hd * 0.75, hd * 0.75]) {
    for (const wx of [-hw * 0.67, hw * 0.67]) {
      put(sdCylZ(x - wx, y - 0.25, z - wz, 0.06, 0.25), 'rubber');
    }
  }
  /* the placard post. The BOARD is drawn at runtime, not baked: it carries the flight
   * code and colour, which are per-cart data the atlas cannot know. */
  put(sdRoundBox(x - hw * 0.82, y - 0.90, z, 0.035, 0.38, 0.035, 0.03), 'metal');
  return _d;
}

function mTractor(x, y, z) {
  _d = 1e9; _m = 'tractor';
  put(sdRoundBox(x, y - 0.56, z, 0.92, 0.25, 0.56, 0.22), 'tractor');
  put(sdRoundBox(x + 0.20, y - 1.00, z, 0.40, 0.24, 0.44, 0.20), 'tractor');
  put(sdRoundBox(x - 0.60, y - 1.10, z, 0.06, 0.32, 0.42, 0.06), 'tractor');
  for (const wz of [-0.54, 0.54]) {
    put(sdCylZ(x + 0.60, y - 0.30, z - wz, 0.09, 0.28), 'rubber');
    put(sdCylZ(x - 0.66, y - 0.26, z - wz, 0.08, 0.24), 'rubber');
  }
  put(sdSphere(x + 0.20, y - 1.36, z, 0.10), 'metal');   // beacon (tinted at runtime)
  return _d;
}

/* Three heads tall, not seven — fully stylised, per the signed-off direction. A real
 * 1.72 m person at gameplay distance is a stick; a toy of one is a fat barrel with an
 * oversized head, and that is what reads. `phase` walks the legs and bobs the body, and
 * the caller picks it from `player.walkedM`, so the animation stays DERIVED. */
function mCrew(x, y, z, p) {
  _d = 1e9; _m = 'hiVis';
  const swing = Math.sin(p.phase * Math.PI * 2) * 0.13;
  const bob = Math.abs(Math.cos(p.phase * Math.PI * 2)) * 0.045;
  put(sdRoundBox(x + swing, y - 0.21, z - 0.11, 0.13, 0.17, 0.10, 0.09), 'navy');
  put(sdRoundBox(x - swing, y - 0.21, z + 0.11, 0.13, 0.17, 0.10, 0.09), 'navy');
  put(sdRoundBox(x, y - 0.74 - bob, z, 0.28, 0.34, 0.30, 0.26), 'hiVis');
  put(sdRoundBox(x - swing * 0.7, y - 0.78 - bob, z - 0.44, 0.10, 0.21, 0.10, 0.10), 'hiVis');
  put(sdRoundBox(x + swing * 0.7, y - 0.78 - bob, z + 0.44, 0.10, 0.21, 0.10, 0.10), 'hiVis');
  put(sdSphere(x, y - 1.32 - bob, z, 0.31), 'skin');
  put(sdSphere(x, (y - 1.46 - bob) * 1.7, z, 0.335), 'tractor');   // hard hat
  put(sdCylY(x, y - 1.40 - bob, z, 0.026, 0.38), 'tractor');       // brim
  return _d;
}

/*
 * The aircraft. The biggest object in the game by a long way, and the last one still
 * drawn as a flat slab — which read badly the moment everything around it had form.
 *
 * ⚠ THE DRAWN FUSELAGE IS 1.9 m, NOT THE REAL 3.2. That is a decision the renderer made
 * at M5 and it is kept: at true height the fuselage is a featureless wall that buries its
 * own wings and most of the stand, and the player has to see the stand to work it. Heights
 * here are presentation; none of them is collision, and the HOLD is a volume the
 * simulation owns (`aircraftHoldZone`), not anything drawn below.
 *
 * The cargo door and the flight number are NOT baked — they are per-aircraft state
 * (`door01` animates, the number is flight data the renderer must not import), so they
 * stay runtime overlays exactly as they were.
 */
const A = CONFIG.aircraft;
function mAircraft(x, y, z) {
  _d = 1e9; _m = 'fuselage';
  const hl = A.lengthM / 2, hw = A.wingspanM / 2;
  /* fuselage: a long rounded tube, nose tapered by a second smaller body */
  put(sdRoundBox(x, y - 1.30, z, hl * 0.86, 0.95, 1.30, 0.95), 'fuselage');
  put(sdRoundBox(x + hl * 0.80, y - 1.22, z, hl * 0.14, 0.80, 0.95, 0.78), 'fuselage');
  /* wings, swept back a little by offsetting the root */
  put(sdRoundBox(x - 0.6, y - 0.92, z, 2.6, 0.16, hw * 0.97, 0.22), 'fuselage');
  /* engines under the wings */
  for (const ez of [-hw * 0.45, hw * 0.45]) {
    put(sdRoundBox(x - 0.2, y - 0.70, z - ez, 1.5, 0.52, 0.52, 0.48), 'metal');
  }
  /* tailplane and fin */
  put(sdRoundBox(x - hl * 0.86, y - 1.30, z, 1.5, 0.13, hw * 0.34, 0.18), 'fuselage');
  put(sdRoundBox(x - hl * 0.80, y - 2.85, z, 1.4, 1.55, 0.16, 0.22), 'fuselage');
  /* undercarriage */
  put(sdCylZ(x + hl * 0.62, y - 0.30, z, 0.16, 0.30), 'rubber');
  for (const gz of [-1.5, 1.5]) put(sdCylZ(x - 1.2, y - 0.34, z - gz, 0.20, 0.34), 'rubber');
  return _d;
}

/* ── the bake ─────────────────────────────────────────────────────────────── */

function normalAt(f, p, x, y, z) {
  const e = 0.002, d = f(x, y, z, p);
  const nx = f(x + e, y, z, p) - d, ny = f(x, y + e, z, p) - d, nz = f(x, y, z + e, p) - d;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

function selfShadow(f, p, x, y, z, dx, dy, dz) {
  let res = 1, t = 0.04;
  for (let i = 0; i < 24; i++) {
    const h = f(x + dx * t, y + dy * t, z + dz * t, p);
    if (h < 0.002) return 0;
    const r = 8 * h / t; if (r < res) res = r;
    t += clamp(h, 0.03, 0.5);
    if (t > 4) break;              // a sprite is small; there is nothing far away to occlude
  }
  return clamp(res, 0, 1);
}

function aoAt(f, p, x, y, z, nx, ny, nz) {
  let occ = 0, sca = 1;
  for (let i = 1; i <= 4; i++) {
    const h = 0.03 * i * i;
    occ += (h - f(x + nx * h, y + ny * h, z + nz * h, p)) * sca;
    sca *= 0.70;
  }
  return clamp(1 - 2.2 * occ, 0, 1);
}

/**
 * Bake one orthographic view. `spanM` is the world width the sprite covers; `baseY` is
 * where the object's GROUND plane sits in that window, as a fraction from the bottom, so
 * a tall object gets headroom without moving its anchor.
 */
function bakeOne(model, params, heading, S, spanM, baseFrac) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S);
  const ch = Math.cos(heading), sh = Math.sin(heading);
  const ce = Math.cos(BAKE_EL_RAD), se = Math.sin(BAKE_EL_RAD);
  const perM = S / spanM;
  const anchorPx = S * (1 - baseFrac);

  /* Orthographic: one ray DIRECTION for every pixel. That is the whole point. */
  const dx = 0, dy = -se, dz = -ce;
  const rdx = dx * ch + dz * sh, rdz = -dx * sh + dz * ch;

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const u = (px + 0.5 - S / 2) / perM;
      const v = (anchorPx - (py + 0.5)) / perM;     // +v is up the screen from the anchor
      /* Start the ray on a plane 8 m back along the view axis. `v` walks up the screen,
       * which in world terms is a mix of "up" and "away" for a tilted camera. */
      const ox = u, oy = v * ce + 8 * se, oz = -v * se + 8 * ce;
      const rox = ox * ch + oz * sh, roz = -ox * sh + oz * ch;

      let t = 0, hit = -1;
      for (let i = 0; i < 72; i++) {
        const d = model(rox + rdx * t, oy + dy * t, roz + rdz * t, params);
        if (d < 0.0015) { hit = t; break; }
        t += d;
        if (t > 18) break;
      }
      const i4 = (py * S + px) * 4;
      if (hit < 0) { img.data[i4 + 3] = 0; continue; }

      const hx = rox + rdx * hit, hy = oy + dy * hit, hz = roz + rdz * hit;
      model(hx, hy, hz, params);
      const alb = CLAY_MATERIALS[_m] || CLAY_MATERIALS.metal;
      const n = normalAt(model, params, hx, hy, hz);
      const ndl = n[0] * LIGHT_DIR[0] + n[1] * LIGHT_DIR[1] + n[2] * LIGHT_DIR[2];
      const wrap = clamp((ndl + WRAP) / (1 + WRAP), 0, 1);
      const sh2 = selfShadow(model, params, hx + n[0] * 0.012, hy + n[1] * 0.012,
                             hz + n[2] * 0.012, LIGHT_DIR[0], LIGHT_DIR[1], LIGHT_DIR[2]);
      const occ = aoAt(model, params, hx, hy, hz, n[0], n[1], n[2]);
      const skyT = clamp(0.5 + 0.5 * n[1], 0, 1), bnc = clamp(0.5 - 0.5 * n[1], 0, 1);
      for (let k = 0; k < 3; k++) {
        const val = alb[k] * (KEY_COL[k] * wrap * mix(0.16, 1, sh2) * 1.48
                            + SKY_COL[k] * skyT * occ * 0.40
                            + BOUNCE_COL[k] * bnc * occ * 0.26);
        img.data[i4 + k] = clamp(Math.pow(val, 0.4545), 0, 1) * 255;
      }
      img.data[i4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { cv, anchorPx };
}

/* ── what to bake ─────────────────────────────────────────────────────────── */
const JOBS = [
  { name: 'cart',    model: mCart,    headings: 24, size: 192, span: 3.6, base: 0.20, params: {} },
  { name: 'tractor', model: mTractor, headings: 24, size: 176, span: 3.2, base: 0.20, params: {} },
  /* 8 headings is plenty: it sits on a stand at one angle and only rotates while taxiing
   * in and pushing back, which is slow and distant. 512 px because it is 26 m long. */
  { name: 'aircraft', model: mAircraft, headings: 8,  size: 512, span: 34.0, base: 0.30, params: {} },
];
for (let i = 0; i < 4; i++) {
  JOBS.push({ name: `crew${i}`, model: mCrew, headings: 12, size: 128, span: 2.4,
              base: 0.16, params: { phase: i / 4 } });
}
for (const mat of BAG_CLAY) {
  for (const [cls, scale] of [['light', 0.82], ['normal', 1.0], ['heavy', 1.18]]) {
    JOBS.push({ name: `bag_${mat}_${cls}`, model: mBag, headings: 8, size: 72, span: 1.5,
                base: 0.22, params: { mat, scale } });
  }
}

export function bakeAtlas(onProgress) {
  const frames = [];
  const cells = [];
  for (const j of JOBS) {
    for (let h = 0; h < j.headings; h++) {
      cells.push({ job: j, h, heading: h * Math.PI * 2 / j.headings });
    }
  }
  /* Shelf-pack into a square-ish atlas. Deterministic: cells are in declaration order. */
  const maxW = 2048;
  let x = 0, y = 0, rowH = 0, atlasH = 0;
  for (const c of cells) {
    const S = c.job.size;
    if (x + S > maxW) { x = 0; y += rowH; rowH = 0; }
    c.x = x; c.y = y;
    x += S; rowH = Math.max(rowH, S);
    atlasH = Math.max(atlasH, y + S);
  }
  const atlas = document.createElement('canvas');
  atlas.width = maxW; atlas.height = atlasH;
  const actx = atlas.getContext('2d');

  let done = 0;
  for (const c of cells) {
    const { cv, anchorPx } = bakeOne(c.job.model, c.job.params, c.heading,
                                     c.job.size, c.job.span, c.job.base);
    actx.drawImage(cv, c.x, c.y);
    frames.push({
      n: c.job.name, h: c.h, x: c.x, y: c.y, s: c.job.size,
      span: c.job.span, anchor: +anchorPx.toFixed(2),
    });
    done++;
    if (onProgress) onProgress(done, cells.length);
  }
  const index = {
    elevationDeg: +(BAKE_EL_RAD * 180 / Math.PI).toFixed(4),
    squash: +Math.sin(BAKE_EL_RAD).toFixed(6),
    heightScale: +HEIGHT_SCALE.toFixed(6),
    atlas: { w: atlas.width, h: atlas.height },
    sets: JOBS.map((j) => ({ n: j.name, headings: j.headings, s: j.size, span: j.span })),
    frames,
  };
  return { atlas, index, pixels: cells.reduce((t, c) => t + c.job.size * c.job.size, 0) };
}
