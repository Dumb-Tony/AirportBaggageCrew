/* Central tuning — GDD §31.1.15: every tunable number lives here or in src/data/.
 * Nothing may hard-code a magic constant into a system. Milestone 6 is a balance pass;
 * it should be an edit to this file and to src/data/, not a hunt through src/systems/.
 *
 * Units: distances in METRES, times in MILLISECONDS, speeds in metres/second.
 * The world is authored at real-world scale so vehicle and walking speeds stay legible.
 */

export const CONFIG = {

  /* ── simulation ─────────────────────────────────────────────────────────── */
  sim: {
    stepMs: 1000 / 60,     // GDD §21.3 recommends 1/60 s fixed step
    maxFrameMs: 250,       // frame gaps above this are DISCARDED, not banked (tab suspend)
    defaultSeed: 12345,    // GDD §21.4 sample state uses this
    seedLabel: 'regional_day_1',
  },

  /* ── shift ──────────────────────────────────────────────────────────────── */
  shift: {
    id: 'regional_day_1',
    durationMs: 600000,    // 10 min — GDD §3.3 prototype shift is 8-12 min
  },

  /* ── world ──────────────────────────────────────────────────────────────── */
  // Footprint of the whole regional airport. Route length between the sort-room door
  // and the gates is what GDD §8.3 calls the transport-planning distance; measured in
  // src/data/airport.js and tuned at Milestone 6.
  world: {
    widthM: 120,
    heightM: 70,
  },

  /* ── presentation ───────────────────────────────────────────────────────── */
  render: {
    // GDD §19.3: a gently following top-down camera "showing enough route context to
    // plan". viewWidthM sets the zoom, and it is a READABILITY number, not a taste one:
    // GDD §7.2 requires the flight code on a tag to be legible without scanning, and a
    // 0.72 m bag has to survive that. At 62 m across a 1600 px window that is ~26 px/m,
    // so a bag is ~19 px and its tag text ~11 px. Widen this and the tags stop working.
    viewWidthM: 62,
    followLerp: 7,         // camera catch-up rate, 1/s. Higher is snappier, more jarring.
    fitPaddingM: 3,        // used by the 'fit' camera mode (debug, and Milestone 0)
    maxPixelRatio: 2,      // cap DPR: a 4K display would otherwise quadruple fill cost
    gridM: 10,             // reference grid spacing
    showGrid: false,
  },

  /* ── player ─────────────────────────────────────────────────────────────── */
  player: {
    radiusM: 0.34,
    maxSpeed: 4.2,         // m/s — a brisk jog. The sort room crosses in ~7 s.
    accel: 30,             // m/s^2, reaches full speed in ~0.14 s: responsive, not floaty
    friction: 22,          // deceleration with no input
    reachM: 1.7,           // grab / scan / interact range
    pushStrength: 1.0,     // how hard walking into a bag shoves it
  },

  /* ── bags ───────────────────────────────────────────────────────────────── */
  bag: {
    friction: 6.0,         // floor deceleration, m/s^2
    restitution: 0.30,     // wall bounce
    separation: 0.55,      // positional push-apart per step, 0..1. 1 is rigid and jittery.
    carryOffsetM: 0.66,    // held this far in front of the player
    throwMinSpeed: 4.0,    // a tap
    throwMaxSpeed: 12.0,   // a fully charged heave
    throwChargeMs: 620,
    beltSpacingM: 0.95,    // minimum gap between bags riding the conveyor
    dropScatterMps: 0.6,   // sideways kick as a bag leaves the belt, so piles spread
  },

  /* ── interaction ────────────────────────────────────────────────────────── */
  interaction: {
    scanCardMs: 3400,      // how long a scan result stays up
    aimBiasDeg: 70,        // targeting cone: prefer bags roughly where the player aims
  },

  /* ── spatial index ──────────────────────────────────────────────────────── */
  grid: {
    cellM: 4,              // ~ the reach diameter; bigger cells mean longer scan lists
  },

  /* ── debug ──────────────────────────────────────────────────────────────── */
  // GDD §21.8: debug tooling must never bleed into player-facing UI.
  debug: {
    enabled: false,        // F3
    showBounds: false,     // collision/interaction bounds overlay
    timeScales: [0.25, 0.5, 1, 2, 4],
    eventLogSize: 256,     // bounded — GDD §24.1
    recentEvents: 6,
  },

  /* ── carts, tractor, flights, scoring ───────────────────────────────────── */
  // Deliberately absent. GDD §31.1.3: future systems are represented by clean
  // boundaries, not half-built features. Each block lands with its milestone:
  //   carts, tractor -> M2      flights -> M3      scoring -> M4      audio -> M5
};

/** Deep-frozen so a system cannot quietly retune the game at runtime. Difficulty
 *  presets, when they arrive, must be MULTIPLIERS applied at the read site — never an
 *  assignment into CONFIG. (Learned the hard way on Something's Different, M15.) */
function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}
deepFreeze(CONFIG);
