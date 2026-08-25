/* Accessibility: colour, COMPUTED rather than eyeballed.
 *
 * GDD §7.2 and §16.3 both say the same thing in different words: colour is never the only
 * channel. That is a claim about the built game, and until something computes it, it is a
 * claim nobody has checked — the destination tags are red, blue and green, and red against
 * green is the single most common place this goes wrong.
 *
 * Every function here is PURE. No state, no DOM, no canvas. So "that pair collapses for a
 * deuteranope" and "that text is 3.1:1" become assertions a suite can fail rather than
 * opinions in a README.
 *
 * ── LINEAGE (Dev\INDEX.md → "Balancing / accessibility") ────────────────────
 * The colour maths is COPIED from `SmallTownEmergencyServices\src\ui\a11y.js`, keeping
 * every function name so the shared ancestry stays greppable: parseColour, composite,
 * relativeLuminance, contrastRatio, toLab, deltaE00, simulateCvd, distinguishable. That
 * module found eight indistinguishable signal pairs and seventeen sub-AA text pairs in a
 * game that looked finished, none of them visible by looking.
 *
 * ── WHAT IS DIFFERENT HERE, AND IT MATTERS ──────────────────────────────────
 * The original carries a table of colour LITERALS copied out of its own source files, and
 * a test that re-reads those files to prove the copies have not drifted. This version has
 * no literals to drift: it IMPORTS `FLIGHT_DEFS` and `PALETTE`, and reads the CSS tokens
 * off the live document. An audit that invents its own palette can only ever audit itself.
 */

import { FLIGHT_DEFS } from '../data/flights.js';
import { PALETTE } from '../render/renderer.js';

/* ── colour: parsing and compositing ──────────────────────────────────────── */

/** Parse `#rgb`, `#rrggbb`, `rgb(...)` or `rgba(...)` into {r,g,b} 0-255 and a 0-1. */
export function parseColour(str) {
  if (str && typeof str === 'object' && typeof str.r === 'number') {
    return { r: str.r, g: str.g, b: str.b, a: str.a == null ? 1 : str.a };
  }
  const s = String(str).trim();
  if (s[0] === '#') {
    const h = s.slice(1);
    if (h.length === 3) {
      if (!/^[0-9a-fA-F]{3}$/.test(h)) throw new Error(`bad colour ${s}`);
      const n = parseInt(h, 16);
      const r = (n >> 8) & 15, g = (n >> 4) & 15, b = n & 15;
      return { r: r * 17, g: g * 17, b: b * 17, a: 1 };
    }
    if (h.length === 6) {
      // parseInt is far too forgiving to trust here: 'gb(20,4' parses as NaN, and
      // NaN >> 16 & 255 is 0, which is a silently black surface rather than an error.
      if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`bad colour ${s}`);
      const n = parseInt(h, 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
    }
    throw new Error(`bad colour ${s}`);
  }
  const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (!m) throw new Error(`bad colour ${s}`);
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const hex2 = (v) => Math.round(clamp255(v)).toString(16).padStart(2, '0');

/** `#rrggbb`. Alpha is dropped — flatten it with composite() first if it matters. */
export function toHex(c) {
  const p = parseColour(c);
  return `#${hex2(p.r)}${hex2(p.g)}${hex2(p.b)}`;
}

/** Source-over in sRGB, which is what a browser does for a translucent panel. */
export function composite(fg, bg) {
  const f = parseColour(fg), b = parseColour(bg);
  const a = f.a;
  return { r: f.r * a + b.r * (1 - a), g: f.g * a + b.g * (1 - a), b: f.b * a + b.b * (1 - a), a: 1 };
}

/** Flatten a stack back to front: flatten([backdrop, panel, chip]). */
export function flatten(layers) {
  let out = parseColour(layers[0]);
  for (let i = 1; i < layers.length; i++) out = composite(layers[i], out);
  return out;
}

/**
 * Apply a CSS `opacity` to a colour over a backdrop.
 *
 * Worth its own function because `opacity` is not the same as an alpha channel on the
 * text colour — it multiplies the whole element — and the board's departed rows use it
 * (`.b-row.st-departed{opacity:.55}`). Auditing the token without the opacity would
 * report a contrast the player never actually gets.
 */
export function withOpacity(fg, bg, opacity) {
  const f = parseColour(fg);
  return composite({ ...f, a: f.a * opacity }, bg);
}

/* ── colour: WCAG contrast ────────────────────────────────────────────────── */

/** WCAG 2.x sRGB channel linearisation. Not a plain 2.2 gamma — the toe matters. */
export function srgbToLinear(v01) {
  return v01 <= 0.03928 ? v01 / 12.92 : Math.pow((v01 + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(colour) {
  const c = parseColour(colour);
  const r = srgbToLinear(c.r / 255), g = srgbToLinear(c.g / 255), b = srgbToLinear(c.b / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** (L1+0.05)/(L2+0.05), lighter over darker. Black on white is exactly 21. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG "large text": 24px, or 18.66px when bold. */
export function isLargeText(px, bold) {
  return px >= 24 || (!!bold && px >= 18.66);
}

/**
 * The AA floor. 4.5:1 for body text, 3:1 for large text (1.4.3) — and 3:1 for anything
 * that is NOT text: borders, rails, state indicators, painted markings (1.4.11).
 *
 * The distinction earns its keep. The board's departed row is a three-pixel border rail,
 * and holding it to the body-text floor would have reported a failure of the wrong rule
 * at the wrong severity. It failed the right one too, at 1.87:1 against a 3:1 floor.
 */
export function requiredRatio(px, bold, nonText = false) {
  if (nonText) return 3;
  return isLargeText(px, bold) ? 3 : 4.5;
}

/* ── colour: CIELAB and CIEDE2000 ─────────────────────────────────────────── */

const D65 = { X: 0.95047, Y: 1, Z: 1.08883 };

export function toXyz(colour) {
  const c = parseColour(colour);
  const r = srgbToLinear(c.r / 255), g = srgbToLinear(c.g / 255), b = srgbToLinear(c.b / 255);
  return {
    X: 0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    Y: 0.2126729 * r + 0.7151522 * g + 0.0721750 * b,
    Z: 0.0193339 * r + 0.1191920 * g + 0.9503041 * b,
  };
}

export function toLab(colour) {
  const xyz = toXyz(colour);
  const e = 216 / 24389, k = 24389 / 27;
  const f = (t) => (t > e ? Math.cbrt(t) : (k * t + 16) / 116);
  const fx = f(xyz.X / D65.X), fy = f(xyz.Y / D65.Y), fz = f(xyz.Z / D65.Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/**
 * CIEDE2000, the standard perceptual distance. Worth the forty lines: CIE76 rates the
 * blue end of the gamut as far more different than an eye does, and this game hands a
 * player a blue tag and a green one and expects them to be told apart at a glance.
 */
export function deltaE00(lab1, lab2) {
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hue = (ap, bp) => {
    if (ap === 0 && bp === 0) return 0;
    const h = deg(Math.atan2(bp, ap));
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(a1p, b1), h2p = hue(a2p, b2);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else {
    const d = Math.abs(h1p - h2p), s = h1p + h2p;
    if (d <= 180) hbarp = s / 2;
    else if (s < 360) hbarp = (s + 360) / 2;
    else hbarp = (s - 360) / 2;
  }
  const T = 1 - 0.17 * Math.cos(rad(hbarp - 30)) + 0.24 * Math.cos(rad(2 * hbarp))
    + 0.32 * Math.cos(rad(3 * hbarp + 6)) - 0.20 * Math.cos(rad(4 * hbarp - 63));
  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;

  const tL = dLp / Sl, tC = dCp / Sc, tH = dHp / Sh;
  return Math.sqrt(tL * tL + tC * tC + tH * tH + Rt * tC * tH);
}

/** Perceptual distance between two colours. 2.3 is a just-noticeable difference. */
export function deltaE(a, b) { return deltaE00(toLab(a), toLab(b)); }

/* ── colour: the three common colour-vision deficiencies ──────────────────── */

/* Smith-Pokorny cone fundamentals and the dichromat projections onto the surviving
 * two-cone plane (Viénot, Brettel & Mollon 1999). Applied in LINEAR light rather than to
 * the gamma-encoded bytes, because a cone responds to light and not to a byte. The grey
 * axis is a fixed point of all three projections, which is the first thing the suite
 * checks — it is the cheapest possible proof the matrices were transcribed correctly.
 *
 * Out-of-gamut results are clamped. That is standard, and it slightly UNDERSTATES how far
 * apart two colours look, so this simulation is conservative about failure rather than
 * generous with it. */
const RGB_TO_LMS = [
  [17.8824, 43.5161, 4.11935],
  [3.45565, 27.1554, 3.86714],
  [0.0299566, 0.184309, 1.46709],
];
const LMS_TO_RGB = [
  [0.080944, -0.130504, 0.116721],
  [-0.0102485, 0.0540194, -0.113615],
  [-0.000365294, -0.00412163, 0.693513],
];

export const CVD_KINDS = Object.freeze(['protanopia', 'deuteranopia', 'tritanopia']);

/** L, M, S -> the same three, with one cone's response reconstructed from the others. */
function project(kind, L, M, S) {
  if (kind === 'protanopia') return [2.02344 * M - 2.52581 * S, M, S];
  if (kind === 'deuteranopia') return [L, 0.494207 * L + 1.24827 * S, S];
  if (kind === 'tritanopia') return [L, M, -0.395913 * L + 0.801109 * M];
  throw new Error(`unknown CVD ${kind}`);
}

/** What `colour` looks like to a dichromat, as `#rrggbb`. */
export function simulateCvd(colour, kind) {
  const c = parseColour(colour);
  const lin = [srgbToLinear(c.r / 255), srgbToLinear(c.g / 255), srgbToLinear(c.b / 255)];
  const L = RGB_TO_LMS[0][0] * lin[0] + RGB_TO_LMS[0][1] * lin[1] + RGB_TO_LMS[0][2] * lin[2];
  const M = RGB_TO_LMS[1][0] * lin[0] + RGB_TO_LMS[1][1] * lin[1] + RGB_TO_LMS[1][2] * lin[2];
  const S = RGB_TO_LMS[2][0] * lin[0] + RGB_TO_LMS[2][1] * lin[1] + RGB_TO_LMS[2][2] * lin[2];
  const [L2, M2, S2] = project(kind, L, M, S);
  const out = [0, 1, 2].map((i) => {
    const v = LMS_TO_RGB[i][0] * L2 + LMS_TO_RGB[i][1] * M2 + LMS_TO_RGB[i][2] * S2;
    const lv = v < 0 ? 0 : v > 1 ? 1 : v;
    const enc = lv <= 0.0031308 ? lv * 12.92 : 1.055 * Math.pow(lv, 1 / 2.4) - 0.055;
    return enc * 255;
  });
  return `#${hex2(out[0])}${hex2(out[1])}${hex2(out[2])}`;
}

/** The colour as it is, and as each of the three deficiencies sees it. */
export function cvdReport(colour) {
  const out = { normal: toHex(colour) };
  for (const k of CVD_KINDS) out[k] = simulateCvd(colour, k);
  return out;
}

/*
 * Thresholds. 2.3 is the CIE just-noticeable difference between two large adjacent
 * patches. 11 is the floor this audit uses for a SIGNAL — a small mark, never seen beside
 * its alternative, read in a hurry across a moving ramp — and it is inherited from
 * SmallTownEmergencyServices, where it was anchored by measurement between a pair nobody
 * has ever confused and a pair that was plainly wrong.
 *
 * 3:1 is WCAG 1.4.11 non-text contrast: a pair whose HUES collapse is still separable if
 * one is that much lighter than the other, and saying otherwise would be scaremongering.
 */
export const JND_DELTA_E = 2.3;
export const SIGNAL_DELTA_E = 11;
export const LUM_ESCAPE_RATIO = 3;
export const LUM_PARTIAL_RATIO = 1.5;

/**
 * Can these two still be told apart? Reports the distance as it is and under each
 * deficiency, plus the luminance ratio, because a pair that loses its hue can still be
 * carried by lightness.
 */
export function distinguishable(a, b, opts = {}) {
  const min = opts.minDeltaE == null ? SIGNAL_DELTA_E : opts.minDeltaE;
  const normal = deltaE(a, b);
  const cvd = {};
  for (const k of CVD_KINDS) cvd[k] = deltaE(simulateCvd(a, k), simulateCvd(b, k));
  const worstKind = CVD_KINDS.reduce((w, k) => (cvd[k] < cvd[w] ? k : w), CVD_KINDS[0]);
  const worst = cvd[worstKind];
  const ratio = contrastRatio(a, b);
  const verdict = worst >= min ? 'ok'
    : ratio >= LUM_ESCAPE_RATIO ? 'ok-by-lightness'
      : ratio >= LUM_PARTIAL_RATIO ? 'weak'
        : 'collapses';
  return { a: toHex(a), b: toHex(b), normal, ...cvd, worst, worstKind, ratio, verdict,
           ok: verdict.startsWith('ok') };
}

/* ── the colours this game actually uses ──────────────────────────────────── */

/**
 * Read the `:root` tokens off the LIVE document.
 *
 * Not a copied table. The original this is adapted from keeps literals and a second test
 * to prove they have not drifted; reading the cascade needs neither, and it audits what
 * the browser resolved rather than what somebody typed into an audit file.
 */
export function cssTokens(win = window) {
  const cs = win.getComputedStyle(win.document.documentElement);
  const names = ['--bg', '--panel', '--panel2', '--line', '--text', '--dim', '--paper',
                 '--lime', '--violet', '--coral',
                 '--st-scheduled', '--st-loading', '--st-final', '--st-closing', '--st-departed'];
  const out = {};
  for (const n of names) {
    const v = cs.getPropertyValue(n).trim();
    if (v) out[n] = v;
  }
  return out;
}

/**
 * SIGNALS: sets of colours the player has to tell APART, each with the non-colour channel
 * that carries the same information. GDD §7.2 is explicit that colour is never the only
 * channel, so a group whose `redundancy` is empty is itself a failure — that is section E.
 *
 * `colours` is a function so these read the live palette rather than a snapshot.
 */
export const SIGNAL_GROUPS = Object.freeze([
  {
    id: 'flight-tags',
    what: 'the three destination tags on a bag',
    redundancy: 'destination code (ATL/ORD/MIA) and an icon (triangle/square/circle)',
    colours: () => FLIGHT_DEFS.map((f) => ({ label: f.destinationCode, hex: f.tag.color })),
  },
  {
    id: 'board-status',
    what: 'the flight board status rail',
    redundancy: 'the status is spelled out in words in its own column (GDD §16.3)',
    colours: (t) => [
      { label: 'SCHEDULED', hex: t['--st-scheduled'] },
      { label: 'LOADING', hex: t['--st-loading'] },
      { label: 'FINAL CALL', hex: t['--st-final'] },
      { label: 'HOLD CLOSING', hex: t['--coral'] },
      { label: 'DEPARTED', hex: t['--st-departed'] },
    ],
  },
  {
    id: 'scanner-verdict',
    what: 'the scanner card telling you a bag is on the right pad or the wrong one',
    redundancy: 'the verdict is written out, with a tick or a cross glyph',
    colours: (t) => [
      { label: 'correct', hex: t['--st-loading'] },
      { label: 'wrong', hex: t['--coral'] },
      { label: 'neutral', hex: t['--st-scheduled'] },
    ],
  },
  {
    id: 'hold-state',
    what: 'HOLD OPEN against HOLD CLOSED, painted on the canvas beside the aircraft',
    redundancy: 'the words themselves — the renderer draws the state as text',
    colours: () => [
      { label: 'HOLD OPEN', hex: 'rgba(94,201,106,0.95)' },
      { label: 'HOLD CLOSED', hex: 'rgba(255,90,90,0.95)' },
    ],
  },
]);

/** Every unordered pair inside every signal group, audited. */
export function auditSignals(tokens, groups = SIGNAL_GROUPS) {
  const out = [];
  for (const g of groups) {
    const cols = g.colours(tokens);
    for (let i = 0; i < cols.length; i++) {
      for (let j = i + 1; j < cols.length; j++) {
        out.push({
          group: g.id, what: g.what, redundancy: g.redundancy,
          pair: `${cols[i].label} vs ${cols[j].label}`,
          ...distinguishable(cols[i].hex, cols[j].hex),
        });
      }
    }
  }
  return out;
}

/**
 * TEXT: foreground/background pairs the player reads, at the size the CSS gives them.
 *
 * `opacity` is applied where the stylesheet applies one — the departed board row is
 * `opacity:.55`, and auditing the raw token instead would report a contrast nobody gets.
 */
export const TEXT_PAIRS = Object.freeze([
  { id: 'hud-text',        fg: '--text',        bg: '--bg',     px: 14 },
  { id: 'hud-label',       fg: '--dim',         bg: '--bg',     px: 11, letterSpaced: true },
  { id: 'hud-clock',       fg: '--text',        bg: '--bg',     px: 22, bold: true },
  { id: 'panel-text',      fg: '--text',        bg: '--panel',  px: 14 },
  { id: 'panel-dim',       fg: '--dim',         bg: '--panel',  px: 12 },
  { id: 'board-scheduled', fg: '--st-scheduled', bg: '--panel', px: 12 },
  { id: 'board-loading',   fg: '--st-loading',  bg: '--panel',  px: 12 },
  { id: 'board-final',     fg: '--st-final',    bg: '--panel',  px: 12, bold: true },
  { id: 'board-closing',   fg: '--coral',       bg: '--panel',  px: 12 },
  // A 3px border rail, not text — WCAG 1.4.11, and audited through the row's own
  // `opacity:.55`, because auditing the token alone reports a contrast nobody gets.
  { id: 'board-departed',  fg: '--st-departed', bg: '--panel',  px: 12, opacity: 0.55, nonText: true },
  // The departed row dims its CONTENT with the same opacity, and that content is text.
  { id: 'board-departed-text', fg: '--text',    bg: '--panel',  px: 12, opacity: 0.55 },
  { id: 'scan-clock',      fg: '--st-final',    bg: '--panel',  px: 13 },
  { id: 'scan-correct',    fg: '--st-loading',  bg: '--panel',  px: 13, bold: true },
  { id: 'button-primary',  fg: '--bg',          bg: '--lime',   px: 15, bold: true },
]);

export function auditText(tokens, pairs = TEXT_PAIRS) {
  return pairs.map((p) => {
    const bg = tokens[p.bg];
    const fgRaw = tokens[p.fg];
    const fg = p.opacity == null ? fgRaw : withOpacity(fgRaw, bg, p.opacity);
    const ratio = contrastRatio(fg, bg);
    const need = requiredRatio(p.px, p.bold, p.nonText);
    return { ...p, fgHex: toHex(fg), bgHex: toHex(bg), ratio, need, pass: ratio >= need };
  });
}

/**
 * CANVAS text is not in the cascade, so it gets its own pairs: what the renderer writes
 * on the ground, and what it writes on the surfaces underneath.
 *
 * A painted gate number is checked against the DARKEST surface it can fall on rather than
 * an average, because a contrast floor is a worst case or it is nothing.
 */
export const CANVAS_PAIRS = Object.freeze([
  { id: 'bag-tag-code', fg: 'rgba(255,255,255,0.94)', bg: () => PALETTE.apron,  px: 12 },
  { id: 'gate-paint',   fg: () => PALETTE.paint,      bg: () => PALETTE.stand,  px: 24 },
  { id: 'gate-label',   fg: () => PALETTE.paintLabel, bg: () => PALETTE.stand,  px: 24 },
  { id: 'zone-label',   fg: () => PALETTE.label,      bg: () => PALETTE.indoor, px: 24 },
  { id: 'safety-hatch', fg: () => PALETTE.hatch,      bg: () => PALETTE.ramp,   px: 24 },
  /*
   * DECORATIVE, and that is a recorded judgement rather than an omission. The lane lines
   * measure 2.36:1 on the service road, under 1.4.11's 3:1 — but WCAG exempts pure
   * decoration, and these carry nothing. The check that the exemption is honest is not a
   * contrast number, it is whether anything else depends on telling one floor from
   * another: measured, all six surfaces sit between 1.02:1 and 1.59:1 of each other, so
   * the game NEVER distinguishes a zone by its colour. It labels every one of them in
   * words, and m9 section E asserts that instead. Brightening the lines would be paying
   * for legibility nobody needs.
   */
  { id: 'lane-marking', fg: () => PALETTE.paintDim,   bg: () => PALETTE.road,   px: 24,
    nonText: true, decorative: true },
]);

export function auditCanvas(pairs = CANVAS_PAIRS) {
  return pairs.map((p) => {
    const fgRaw = typeof p.fg === 'function' ? p.fg() : p.fg;
    const bg = typeof p.bg === 'function' ? p.bg() : p.bg;
    const fg = flatten([bg, fgRaw]);          // canvas text is composited over the ground
    const ratio = contrastRatio(fg, bg);
    const need = requiredRatio(p.px, p.bold, p.nonText);
    return { ...p, fgHex: toHex(fg), bgHex: toHex(bg), ratio, need, pass: ratio >= need };
  });
}
