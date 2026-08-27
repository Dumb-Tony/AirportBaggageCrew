/* The clay diorama: the geometry and light every sprite is baked under (GDD §38).
 *
 * This module holds the handful of numbers that the OFFLINE BAKER and the LIVE CAMERA both
 * have to agree on. They are here, in `src/`, rather than in the tool, because a copy in
 * the tool is a copy that can drift — and if the baker's camera angle and the game's ever
 * disagree, every object in the airport is lit and foreshortened for a camera that is not
 * there. Nothing in the picture would look obviously broken; it would just look subtly
 * wrong for ever. m8 asserts the two agree.
 *
 * ⚠ THE PROJECTION MUST STAY ORTHOGRAPHIC. A pre-baked sprite is only valid if an object's
 * appearance depends on its HEADING alone. Under perspective it also depends on where the
 * object sits in the frame — you would see the left flank of a cart on the left of the
 * screen and the right flank of the same cart on the right — so one sprite per heading
 * would be correct only dead centre. Orthographic removes that dependency and is what
 * makes the whole approach legal.
 */

import { CONFIG } from '../config.js';

/**
 * THE ONE NUMBER. `groundSquash` is how much the ground is foreshortened vertically, and
 * for an orthographic camera looking down at elevation θ above the horizontal that is
 * exactly sin θ. So the camera elevation is not a second constant to keep in step — it is
 * derived from the squash the renderer already had, and there is nothing to drift.
 *
 * 0.669 → 42.0°. Lower than the 0.75 (48.6°) the game shipped with: a shallower camera
 * shows more of an object's SIDES, which is what gives a rounded form its weight, and it
 * is what makes the diorama read as a photographed model rather than a floorplan.
 */
export const BAKE_SQUASH = CONFIG.render.groundSquash;
export const BAKE_EL_RAD = Math.asin(BAKE_SQUASH);
export const BAKE_EL_DEG = BAKE_EL_RAD * 180 / Math.PI;

/**
 * A vertical metre projects to cos θ of a horizontal metre on screen. The baker applies
 * this itself when it projects height, so a sprite arrives already correctly proportioned
 * and the renderer only ever scales it uniformly.
 */
export const HEIGHT_SCALE = Math.cos(BAKE_EL_RAD);

/**
 * The key light, in world space, pointing TOWARD the light from the surface.
 * Baked into every sprite, so it cannot be changed at runtime without re-baking — which
 * is the trade sprites make. Warm, high, and over the player's left shoulder.
 */
export const LIGHT_DIR = (() => {
  const v = [-0.40, 0.78, 0.34];
  const l = Math.hypot(v[0], v[1], v[2]);
  return Object.freeze([v[0] / l, v[1] / l, v[2] / l]);
})();

/** Light colours. `KEY` is the sun, `SKY` the dome above, `BOUNCE` the warm floor. */
export const KEY_COL    = Object.freeze([1.06, 0.99, 0.87]);
export const SKY_COL    = Object.freeze([0.33, 0.41, 0.55]);
export const BOUNCE_COL = Object.freeze([0.40, 0.31, 0.21]);

/**
 * Wrapped diffuse is the clay signature: light bleeds PAST the terminator instead of
 * stopping at it, so the shadow side stays soft and keeps its colour. `WRAP` is how far
 * past — 0 is ordinary Lambert and a hard terminator; 0.45 is putty.
 */
export const WRAP = 0.45;

/** Material albedos, indexed. The baker writes these; nothing at runtime reads them. */
export const CLAY_MATERIALS = Object.freeze({
  cart:      [0.26, 0.52, 0.88],
  tractor:   [0.98, 0.60, 0.14],
  hiVis:     [0.86, 0.95, 0.16],
  navy:      [0.19, 0.23, 0.35],
  skin:      [0.92, 0.74, 0.56],
  rubber:    [0.15, 0.15, 0.17],
  metal:     [0.30, 0.32, 0.36],
  fuselage:  [0.90, 0.90, 0.92],
  bagRed:    [0.88, 0.26, 0.20],
  bagBlue:   [0.22, 0.46, 0.84],
  bagGreen:  [0.26, 0.74, 0.42],
  bagAmber:  [0.90, 0.66, 0.20],
  bagPlum:   [0.58, 0.40, 0.70],
  bagSlate:  [0.45, 0.50, 0.58],
  bagSand:   [0.80, 0.72, 0.56],
  bagTeal:   [0.24, 0.62, 0.66],
  /* Surfaces that stay DRAWN rather than baked — walls and the conveyor. Albedos, not
   * finished colours: `clayLit` turns each into a lit face or a lit lid, so they share a
   * lamp with everything in the atlas instead of being matched by eye. */
  /* Chosen against the FLOOR, not by eye. Concrete sits at luminance 118; the lighting
   * model multiplies albedo by ~1.46 before gamma, so an albedo that looks dark on paper
   * comes out lighter than the ground. These are the values that put the belt below the
   * floor and the wall's lid above it. */
  wall:      [0.30, 0.27, 0.23],
  beltBody:  [0.055, 0.053, 0.050],
  beltDeck:  [0.075, 0.072, 0.068],
  beltRail:  [0.86, 0.68, 0.22],
});

/*
 * ── LIGHTING A SURFACE THE BAKER IS NOT GOING TO BAKE ────────────────────────
 *
 * Some things cannot be sprites. Walls come in whatever sizes `WALLS` says, and the
 * conveyor is 21 m of belt whose length is data — tiling a baked segment across either
 * means seams, and stretching one means the rounded corners smear. They stay drawn.
 *
 * But "drawn" must not mean "lit differently", which is what a hand-picked pair of greys
 * would be. `clayLit` runs the SAME arithmetic `tools\_bake.js` runs per pixel — same
 * wrapped diffuse, same key, sky and bounce terms, same gamma — for one flat surface with
 * one normal. So a wall face and a cart's flank are the same material under the same lamp
 * by construction, and neither can drift from the other without this file changing.
 *
 * What it cannot do is shadows and ambient occlusion, which need geometry the sprite baker
 * had and a flat quad does not. `shadow` and `occ` are therefore parameters: pass 1 for an
 * unoccluded surface, or less to darken a face that sits in its own pocket.
 */
const _clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function clayLit(albedo, nx, ny, nz, shadow = 1, occ = 1) {
  const ndl = nx * LIGHT_DIR[0] + ny * LIGHT_DIR[1] + nz * LIGHT_DIR[2];
  const wrap = _clamp((ndl + WRAP) / (1 + WRAP), 0, 1);
  const sky = _clamp(0.5 + 0.5 * ny, 0, 1);
  const bnc = _clamp(0.5 - 0.5 * ny, 0, 1);
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const v = albedo[i] * (
      KEY_COL[i] * wrap * (0.16 + (1 - 0.16) * shadow) * 1.48 +
      SKY_COL[i] * sky * occ * 0.40 +
      BOUNCE_COL[i] * bnc * occ * 0.26
    );
    out[i] = Math.round(_clamp(Math.pow(v, 0.4545), 0, 1) * 255);
  }
  return `rgb(${out[0]},${out[1]},${out[2]})`;
}

/** The surface normals a standing box shows this camera: its lid, and the flank that
 *  faces the viewer. Named so call sites read as geometry rather than as three numbers. */
export const N_TOP   = Object.freeze([0, 1, 0]);
export const N_FRONT = Object.freeze([0, 0, 1]);

/** The bag body colours, in the order the bag entity indexes them.
 *  ⚠ Deliberately NOT the flight — GDD §7.2, and m1 C6 asserts they are shared across
 *  flights. A player who learns to sort by "the red ones" has learned a lie. */
export const BAG_CLAY = Object.freeze([
  'bagRed', 'bagBlue', 'bagGreen', 'bagAmber',
  'bagPlum', 'bagSlate', 'bagSand', 'bagTeal',
]);
