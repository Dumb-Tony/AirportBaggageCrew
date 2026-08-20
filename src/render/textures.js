/* Procedural surface textures — GDD §21.1 ("prefer generated shapes over remote assets"),
 * §19.1 (clarity with many objects on screen).
 *
 * `canvasTex` is copied from SomethingsDifferent\somethingsdifferent.html:1009 (see
 * Dev\INDEX.md → "Procedural geometry & texture"), keeping the name so the lineage stays
 * greppable. Adapted: it returns a CanvasPattern rather than a THREE.CanvasTexture, and
 * it draws with a SEEDED stream so a texture is byte-identical on every run — a
 * screenshot has to be reproducible, and nothing in this project may call Math.random.
 *
 * Everything is memoised by key and built once. A tile is drawn at a fixed pixels-per-
 * metre and then scaled by the caller's transform, so the grain stays the same physical
 * size whatever the zoom.
 */

import { Rng } from '../core/rng.js';

const _cache = new Map();

/** Pixels per metre the tiles are authored at. Independent of the camera. */
export const TEX_PPM = 24;

/**
 * @param {number} w  tile width in pixels
 * @param {number} h  tile height in pixels
 * @param {string} key  memo key — MUST include every parameter that changes the result
 * @param {(ctx:CanvasRenderingContext2D, w:number, h:number, rng:Rng)=>void} draw
 * @returns {HTMLCanvasElement}
 */
export function canvasTex(w, h, key, draw) {
  if (_cache.has(key)) return _cache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  // Seeded from the key, so the same key always produces the same grain.
  draw(ctx, w, h, new Rng(hashKey(key), 'tex'));
  _cache.set(key, c);
  return c;
}

/** A repeating pattern, in METRES, for use under a world transform. */
export function pattern(ctx, tile) {
  const p = ctx.createPattern(tile, 'repeat');
  if (!p) return null;
  // The tile is authored in pixels; scale it down so one tile is tileW/TEX_PPM metres.
  const m = 1 / TEX_PPM;
  if (p.setTransform) {
    p.setTransform(new DOMMatrix([m, 0, 0, m, 0, 0]));
  }
  return p;
}

/* ── the surfaces ─────────────────────────────────────────────────────────── */

/** Ramp and apron: aggregate speckle, tyre streaks, the odd patch and crack. */
export const texAsphalt = (base, key) => canvasTex(192, 192, `asphalt|${key}`, (x, W, HH, rng) => {
  x.fillStyle = base; x.fillRect(0, 0, W, HH);

  for (let i = 0; i < 1700; i++) {
    const l = rng.range(-0.11, 0.055);   // skewed dark: a bright speckle reads as noise
    x.fillStyle = tint(base, l);
    const s = rng.range(0.7, 2.3);
    x.fillRect(rng.float() * W, rng.float() * HH, s, s);
  }
  // faint patches, so the surface is not uniformly noisy
  for (let i = 0; i < 7; i++) {
    x.globalAlpha = rng.range(0.03, 0.07);
    x.fillStyle = rng.chance(0.5) ? '#000' : '#fff';
    x.beginPath();
    x.ellipse(rng.float() * W, rng.float() * HH, rng.range(14, 44), rng.range(10, 34),
              rng.range(0, Math.PI), 0, Math.PI * 2);
    x.fill();
  }
  x.globalAlpha = 1;
  // hairline cracks
  x.strokeStyle = 'rgba(0,0,0,0.16)';
  for (let i = 0; i < 5; i++) {
    x.lineWidth = rng.range(0.5, 1.2);
    let px = rng.float() * W, py = rng.float() * HH;
    x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 6; k++) {
      px += rng.range(-22, 22); py += rng.range(-22, 22);
      x.lineTo(px, py);
    }
    x.stroke();
  }
});

/** Sort-room floor: sealed concrete in slabs with visible joints. */
export const texIndoor = (base, key) => canvasTex(192, 192, `indoor|${key}`, (x, W, HH, rng) => {
  x.fillStyle = base; x.fillRect(0, 0, W, HH);
  for (let i = 0; i < 1500; i++) {
    x.fillStyle = tint(base, rng.range(-0.06, 0.08));
    x.fillRect(rng.float() * W, rng.float() * HH, rng.range(1, 2.4), rng.range(1, 2.4));
  }
  // slab joints on a 2 m grid
  x.strokeStyle = 'rgba(0,0,0,0.22)';
  x.lineWidth = 1.4;
  x.beginPath();
  x.moveTo(0, HH / 2); x.lineTo(W, HH / 2);
  x.moveTo(W / 2, 0); x.lineTo(W / 2, HH);
  x.stroke();
  // scuffs from a decade of cart wheels
  x.strokeStyle = 'rgba(0,0,0,0.07)';
  for (let i = 0; i < 14; i++) {
    x.lineWidth = rng.range(1, 3.5);
    const y0 = rng.float() * HH;
    x.beginPath();
    x.moveTo(0, y0);
    x.bezierCurveTo(W * 0.3, y0 + rng.range(-12, 12), W * 0.7, y0 + rng.range(-12, 12), W, y0 + rng.range(-8, 8));
    x.stroke();
  }
});

/** Service road: darker, smoother, with a worn wheel path. */
export const texRoad = (base, key) => canvasTex(192, 192, `road|${key}`, (x, W, HH, rng) => {
  x.fillStyle = base; x.fillRect(0, 0, W, HH);
  for (let i = 0; i < 1800; i++) {
    x.fillStyle = tint(base, rng.range(-0.09, 0.09));
    const s = rng.range(0.8, 2.0);
    x.fillRect(rng.float() * W, rng.float() * HH, s, s);
  }
  x.globalAlpha = 0.05;
  x.fillStyle = '#000';
  x.fillRect(W * 0.18, 0, W * 0.16, HH);
  x.fillRect(W * 0.66, 0, W * 0.16, HH);
  x.globalAlpha = 1;
});

/* ── helpers ──────────────────────────────────────────────────────────────── */

/** Lighten (l>0) or darken (l<0) a #rrggbb by a fraction. */
export function tint(hex, l) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + 255 * l)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function hashKey(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Drop every cached tile. Only for tests that want a clean slate. */
export function clearTextureCache() { _cache.clear(); }
