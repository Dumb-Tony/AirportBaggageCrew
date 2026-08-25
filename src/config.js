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
    // The shift ENDS a short wrap-up after the last aircraft is clear, not at a fixed
    // ten minutes. Derived rather than authored, so retuning the schedule can never
    // leave dead minutes at the end with nothing on the ramp to do — which is exactly
    // what a hardcoded 600000 was doing (the last flight was away at 7:55).
    // GDD §3.3 wants an 8-12 minute shift; the derived value lands at about 8:07.
    wrapUpMs: 12000,
    durationMs: 600000,    // ceiling and fallback only; see Game._authorShift
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
    // 46, not 62: foreshortening fits MORE world into the same pixels vertically, so
    // keeping the old width made everything read smaller — the opposite of the point.
    // At 46 m across a 1600 px window that is ~35 px/m: a bag is 25 px and a person is
    // 60 px tall, and the tag codes GDD 7.2 needs are comfortably legible.
    //
    // 32, not 46 (GDD §38). The clay sprites are MODELLED objects rather than icons —
    // side rails, wheels, a hard hat, a strap across a bag lid — and at 46 m none of that
    // detail survived to the screen. The player's own complaint was "hard to read at a
    // glance", and closing the camera is what answers it: ~50 px/m at 1600 px, so a bag is
    // 36 px and a person 86 px. Readability only improves, which is why the floor in
    // MIN_PX_PER_M never binds here and m1 I5c stays green.
    viewWidthM: 32,
    // Vertical foreshortening of the GROUND plane. 1.0 is straight down and reads as a
    // floorplan; lower tilts the view. 0.669 is a 42-degree camera and is what
    // makes the airport read as a place rather than a map (GDD 19.1 allows 2.5D).
    groundSquash: 0.669,
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

  /* ── carts ──────────────────────────────────────────────────────────────── */
  cart: {
    lengthM: 2.4,
    widthM: 1.5,
    linkM: 1.75,            // centre-to-tow-point distance; sets how tightly a train cuts corners
    slotCols: 2,
    slotRows: 5,
    capacitySlots: 10,
    // GDD §6.4: capacity by SPACE AND WEIGHT, not a hidden bag count. Both must be able
    // to bind or one of them is decoration: 10 normal bags weigh 170 kg (slot-limited),
    // 7 heavy weigh 217 kg (weight-limited at 6).
    capacityWeight: 210,

    // Spill. GDD §6.4 allows "a simpler stability score if reliable physics stacking is
    // too costly", and it is. Lateral load is speed * yaw rate, scaled by how full the
    // cart is; sustained load drains stability, and an empty tank throws a bag off.
    spillLatMps2: 7.0,
    spillDrainRate: 0.30,
    stabilityRecover: 0.5,
    spillEjectMps: 3.2,
    spillStabilityAfter: 0.85,

    absorbSpeedMps: 1.7,    // a bag slower than this, inside a cart, is caught by it
    reentryCooldownMs: 900, // a spilled bag cannot be re-caught instantly
    hitchRangeM: 3.0,
    placardCycleMs: 250,    // debounce, so one press does not cycle three placards
  },

  /* ── tractor ────────────────────────────────────────────────────────────── */
  tractor: {
    lengthM: 2.2,
    widthM: 1.3,
    towOffsetM: 1.3,        // hitch point behind the centre

    maxSpeed: 7.0,          // m/s — the 55 m run to gate 1 takes ~9 s at full tilt
    reverseSpeed: 3.0,
    accel: 6.0,
    brakeDecel: 14.0,
    drag: 1.4,              // coasting deceleration

    // GDD §8.2: "forgiving turning at low speed", wider turns when moving fast. Yaw rate
    // ramps to its cap at yawRefSpeed, so the turning RADIUS is a constant 3.9 m below
    // that and grows with speed above it.
    maxYawRate: 1.8,
    yawRefSpeed: 3.0,

    enterRangeM: 2.4,
    restitution: 0.15,      // bump a wall, do not stick to it
    bagShoveStrength: 1.4,  // vehicles scatter luggage — GDD §6.5
  },

  /* ── the schedule ───────────────────────────────────────────────────────── */
  // GDD §5: the schedule is the game's antagonist. Every number here is read by a PURE
  // FUNCTION OF SIMULATION TIME and by nothing else — no system may consult player
  // readiness to decide when a flight moves (GDD §31.1.7).
  flight: {
    taxiInMs: 4000,        // aircraft slides onto the stand, ending at bagAcceptanceMs
    pushbackMs: 5000,      // departureMs starts pushback; DEPARTED is this much later

    // GDD §5.2 allows "a very small, explicitly communicated operational grace window".
    // That window is not a separate mechanism here: it is the FINAL_BAG_CALL state
    // itself, which is announced, shown amber on the board, and runs from finalCallMs
    // to holdClosingMs — 25 s on AB221. After hold closing nothing more can be loaded.

    boardSlots: 4,         // GDD §16.2: a compact board showing 3-4 flights
    urgentMs: 45000,       // board counts down in red inside this
    holdZone: { lengthM: 5.0, widthM: 3.4 },
  },

  /* ── aircraft ───────────────────────────────────────────────────────────── */
  aircraft: {
    lengthM: 26,           // a regional jet, and the stand is 40 m x 22 m
    wingspanM: 21,
    fuselageWidthM: 3.2,
    taxiDistanceM: 30,     // how far it slides in and out along the taxi lane
  },

  /* ── announcements ──────────────────────────────────────────────────────── */
  // GDD §18.3: text plus simple generated sound is sufficient for Phase 1, and the
  // sound is Milestone 5. Every cue below therefore needs a visual form (GDD §5.3).
  announce: {
    toastMs: 5200,
    maxVisible: 3,
    logSize: 40,
  },

  /* ── scoring ────────────────────────────────────────────────────────────── */
  // GDD §11.1's suggested values, verbatim. The document says to tune them through
  // playtesting and that the relative cost of a wrong destination should exceed a
  // simple miss — 250 against 150 — so that ordering is the thing to preserve if these
  // move at Milestone 6.
  score: {
    correctBag: 100,
    priorityBonus: 50,        // additional, on top of correctBag
    // GDD §20.2 asks for a "priority bag bonus/penalty". Only the bonus existed, so a
    // priority bag you LOST cost exactly what any other lost bag cost — which made
    // SK307's authored twist (§20.4: its priority bags arrive late) a prize you could win
    // and never a stake you could lose. This sits on top of missedBag the same way the
    // bonus sits on top of correctBag, and mirrors it.
    priorityMissPenalty: -50,
    misroutedBag: -250,       // wrong aircraft, discovered at departure
    missedBag: -150,
    perfectFlightBonus: 250,  // §11.1 asks for a completion bonus without naming a value

    // Two entries from §11.1 are deliberately NOT implemented yet, rather than guessed:
    //   "correct bag left loose on dangerous ramp area" is explicitly optional, and
    //   "collision/equipment damage -50 to -300" needs a damage model, which does not
    //   exist. A cart spill is mishandling, not equipment damage, and scoring it would
    //   double-charge: a spilled bag usually goes on to miss its flight anyway.
  },

  /* ── audio ──────────────────────────────────────────────────────────────── */
  // Deliberately absent. GDD §31.1.3: future systems are represented by clean
  // boundaries, not half-built features.  audio -> M5
};

/** Deep-frozen so a system cannot quietly retune the game at runtime. Difficulty
 *  presets, when they arrive, must be MULTIPLIERS applied at the read site — never an
 *  assignment into CONFIG. (Learned the hard way on Something's Different, M15.) */
function deepFreeze(o) {
  for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v);
  return Object.freeze(o);
}
deepFreeze(CONFIG);
