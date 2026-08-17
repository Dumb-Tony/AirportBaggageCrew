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
    // Milestone 0 fits the whole airport on screen so the route context is visible
    // (GDD §19.3). A following camera arrives with the player in Milestone 1.
    fitPaddingM: 3,
    maxPixelRatio: 2,      // cap DPR: a 4K display would otherwise quadruple fill cost
    gridM: 10,             // reference grid spacing
    showGrid: false,
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

  /* ── player / vehicles / bags ───────────────────────────────────────────── */
  // Deliberately absent at Milestone 0. GDD §31.1.3: future systems are represented by
  // clean boundaries, not half-built features. Each block lands with its milestone:
  //   player   -> M1      bags -> M1      carts, tractor -> M2
  //   flights  -> M3      scoring -> M4
};

/** Deep-frozen so a system cannot quietly retune the game at runtime. Difficulty
 *  presets, when they arrive, must be MULTIPLIERS applied at the read site — never an
 *  assignment into CONFIG. (Learned the hard way on Something's Different, M15.) */
function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}
deepFreeze(CONFIG);
