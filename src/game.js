/* Game — owns the authoritative state and drives the fixed-step simulation.
 * GDD §21.4 (state ownership), §21.3 (loop), §31.3 (no rules in renderer/UI).
 *
 * Structure adapted from TheBenefactors\src\engine\game-state.js `createInitialState` /
 * `GameStore` (see Dev\INDEX.md "Narrative / content-driven games"). Kept from it: one
 * authoritative state object, a subscribe/notify boundary, and an explicit initial-state
 * factory. DROPPED from it: clone-on-every-read. That store deep-clones state on each
 * getState(); correct for a turn-based narrative game, ruinous at 60 Hz with 100 bags
 * (GDD §24.1). Readers here get the live object and are trusted not to write to it —
 * enforced by assertion in dev builds rather than by copying.
 *
 * THE PAUSE INVARIANT: every simulation mutation happens inside GameClock.advance()'s
 * step callback. Nothing is driven by rAF directly, and nothing uses a browser timer.
 * So pausing the clock pauses the entire airport by construction, not by remembering to
 * check a flag in each system. GDD §29 requires exactly that.
 */

import { CONFIG } from './config.js';
import { GameClock } from './core/clock.js';
import { EventBus, EVENTS } from './core/eventBus.js';
import { Rng, hashStr } from './core/rng.js';
import { SpatialGrid } from './core/grid.js';
import { BOUNDS, WORLD, ANCHORS } from './data/airport.js';
import { buildBagSchedule } from './data/flights.js';
import { createPlayer, stepPlayer } from './entities/player.js';
import { createConveyor, stepConveyor } from './entities/conveyor.js';
import { spawnDueBags, stepBags, rebuildGrid, syncCartBagPositions, absorbIntoContainers }
  from './systems/baggageFlow.js';
import { createFlights, stepFlights } from './systems/flightSchedule.js';
import { resetAnnouncements, announce } from './systems/announcements.js';
import { createScore, createStats, stepScoring, buildReport } from './systems/scoring.js';
import { SaveSystem } from './systems/save.js';
import { createGuide, stepGuide, resetGuide } from './systems/onboarding.js';
import { DEFAULT_SETTINGS } from './ui/settings.js';
import { stepInteraction } from './systems/interaction.js';
import { countByLocation } from './systems/containment.js';
import { createCart } from './entities/cart.js';
import { createTractor, stepTractor } from './entities/tractor.js';
import { updateTrain, trainOf } from './systems/hitching.js';

export const MODES = Object.freeze({
  TITLE: 'title',
  PLAYING: 'playing',
  PAUSED: 'paused',
  REPORT: 'report',   // reached in Milestone 4, with the shift report
});

/* One named RNG stream per concern, each seeded from the shift seed with a fixed offset.
 * Separate streams mean adding a draw to one system cannot shift the sequence another
 * system sees — the bug that silently reshuffles a balanced shift. */
const STREAMS = Object.freeze({
  world: 0x00000000,   // shift composition: tag numbers, the bag timetable
  bags:  0x9e3779b9,   // per-bag appearance
  sim:   0x85ebca6b,   // runtime jitter: conveyor drop scatter
});

/**
 * The GDD §21.4 top-level shape, built fresh on every restart.
 * Entities reference each other by ID; there are no nested circular object graphs.
 */
export function createInitialState(seed, seedLabel) {
  return {
    version: 1,
    seed,
    seedLabel,
    mode: MODES.TITLE,
    simTimeMs: 0,
    shift: {
      id: CONFIG.shift.id,
      endTimeMs: CONFIG.shift.durationMs,   // DERIVED in _authorShift from the last departure
      ended: false,
      bagSchedule: [],      // filled by Game.reset() from the seeded stream
      nextSpawnIdx: 0,
      tagBase: 0,
      spawned: 0,
    },

    player: createPlayer(ANCHORS.playerSpawn),
    bagsById: {},

    // Populated by their own milestones. Present now so every system can assume the
    // keys exist and no code has to defend against `undefined` containers.
    // Two carts parked on their marked bays and one spare, plus the tractor waiting
    // outside the sort-room door, lined up on it.
    cartsById: {
      cart_1: createCart('cart_1', ANCHORS.cartBay1.x, ANCHORS.cartBay1.y, 0),
      cart_2: createCart('cart_2', ANCHORS.cartBay2.x, ANCHORS.cartBay2.y, 0),
      cart_3: createCart('cart_3', ANCHORS.cartPark.x, ANCHORS.cartPark.y, 0),
    },
    vehiclesById: {
      tractor_1: createTractor('tractor_1', ANCHORS.tractorPark.x, ANCHORS.tractorPark.y, Math.PI),
    },

    // Filled by _authorShift() from FLIGHT_DEFS — the runtime flight records and their
    // aircraft. Empty here so createInitialState stays a pure shape.
    aircraftById: {},
    flightsById: {},

    world: {
      widthM: WORLD.widthM,
      heightM: WORLD.heightM,
      bounds: { ...BOUNDS },
      spawn: { ...ANCHORS.playerSpawn },
      conveyor: createConveyor(),
    },

    scan: null,           // the live scanner card, or null
    guide: null,          // mirror of Game.guideView, for readers that only see state
    score: createScore(),
    stats: createStats(),
    report: null,         // built once, when the shift ends
    announcements: [],
    settings: { showGrid: CONFIG.render.showGrid },
  };
}

export class Game {
  constructor({ seed = CONFIG.sim.defaultSeed, seedLabel = CONFIG.sim.seedLabel,
                storage } = {}) {
    // Storage is injectable so the suite runs against a fake and never writes a high
    // score into the real browser while testing.
    this.save = storage === undefined ? new SaveSystem() : new SaveSystem(storage);
    // Settings live on the Game, not in the per-shift state: they survive a restart,
    // and one of them (the assist) has to be read while the shift is being authored.
    this.settings = { ...DEFAULT_SETTINGS, ...(this.save.loadSettings() || {}) };
    this.guide = createGuide();
    this.guide.enabled = !!this.settings.guide;
    this.bus = new EventBus({ logSize: CONFIG.debug.eventLogSize });
    this.clock = new GameClock({ stepMs: CONFIG.sim.stepMs, maxFrameMs: CONFIG.sim.maxFrameMs });
    this.grid = new SpatialGrid(WORLD.widthM, WORLD.heightM, CONFIG.grid.cellM);

    this.seed = seed >>> 0;
    this.seedLabel = seedLabel;
    this.rng = {};
    for (const name of Object.keys(STREAMS)) {
      this.rng[name] = new Rng((this.seed ^ STREAMS[name]) >>> 0, name);
    }

    this.state = createInitialState(this.seed, this.seedLabel);
    this._authorShift();
    this._listeners = new Set();
    this.frames = 0;
    this._syncClockToMode();
  }

  /** Seed from a label so a named shift is reproducible without carrying a number. */
  static seedFromLabel(label) { return hashStr(label); }

  /**
   * Merge a settings change, persist it, and let the bootstrap apply the parts that live
   * outside the simulation (volumes, motion, text size).
   *
   * The ASSIST is deliberately not applied mid-shift: it rewrites the flight timetable,
   * and moving a departure the player is already racing would be worse than waiting.
   * It takes effect on the next shift, and the panel says so.
   */
  applySettings(patch) {
    Object.assign(this.settings, patch);
    this.save.saveSettings(this.settings);
    if ('guide' in patch) this.guide.enabled = !!patch.guide;
    if (this.onSettingsChanged) this.onSettingsChanged(this.settings, patch);
    this._notify();
    return this.settings;
  }

  /** clock.paused is a FUNCTION of mode and must never be set independently. Without
   *  this, a freshly constructed game sat on the title screen with a running clock and
   *  the shift silently burned time behind the title card. Caught by m0 C3. */
  _syncClockToMode() { this.clock.setPaused(this.state.mode !== MODES.PLAYING); }

  /** Draw the shift's content from the seeded stream. Order matters and is fixed: the
   *  tag base first, then the timetable, so adding detail to the timetable later cannot
   *  renumber every bag in an already-balanced shift. */
  _authorShift() {
    this.state.shift.tagBase = this.rng.world.int(100000, 899999);
    // Same assist as the flights below: the timetable and the schedule have to be
    // stretched by the same factor or the shift is reshaped instead of lengthened.
    this.state.shift.bagSchedule = buildBagSchedule(this.rng.world, this.settings.assist || 1);
    // Flights need the timetable, because expectedCount counts bags that were scheduled
    // whether or not the conveyor ever gets to them.
    resetAnnouncements();
    // GDD §16.6's difficulty assist: schedule pressure, and nothing else. It stretches
    // the authored times at the ONE place they are turned into a runtime flight — a
    // multiplier at the read site, never an assignment into CONFIG, which is frozen for
    // exactly this reason.
    const { flightsById, aircraftById } = createFlights(this.state, this.settings.assist || 1);
    this.state.flightsById = flightsById;
    this.state.aircraftById = aircraftById;

    // The shift ends a short wrap-up after the LAST aircraft is clear, derived rather
    // than authored. A hardcoded ten minutes left two minutes of empty ramp at the end.
    let lastClear = 0;
    for (const f of Object.values(flightsById)) {
      lastClear = Math.max(lastClear, f.times.departureMs + CONFIG.flight.pushbackMs);
    }
    this.state.shift.endTimeMs = lastClear > 0
      ? lastClear + CONFIG.shift.wrapUpMs
      : CONFIG.shift.durationMs;
  }

  /* ── lifecycle ────────────────────────────────────────────────────────── */

  /** Full restart. GDD §29 UX: "Restart resets every entity and timer cleanly."
   *  Event HANDLERS survive (renderer and HUD subscribe once at boot); the event LOG
   *  does not, or a fresh shift would report the previous shift's history. */
  reset(seed = this.seed, seedLabel = this.seedLabel) {
    this.seed = seed >>> 0;
    this.seedLabel = seedLabel;
    this.clock.reset();
    for (const name of Object.keys(STREAMS)) {
      this.rng[name].reset((this.seed ^ STREAMS[name]) >>> 0);
    }
    this.grid.clear();
    this.bus.clearLog();
    this.state = createInitialState(this.seed, this.seedLabel);
    this._authorShift();
    this.frames = 0;
    this._syncClockToMode();
    this.bus.emit(EVENTS.SIM_RESET, { seed: this.seed, seedLabel }, 0);
    this._notify();
    return this;
  }

  /** Restart straight into play, skipping the title screen. */
  startShift(seed = this.seed) {
    this.reset(seed, this.seedLabel);
    resetGuide(this.guide, !!this.settings.guide);
    this.guideView = null;
    this.setMode(MODES.PLAYING);
    return this;
  }

  /* ── mode ─────────────────────────────────────────────────────────────── */

  /** The ONLY writer of state.mode and of clock.paused. Keeping them in one place is
   *  what stops the HUD from showing "paused" while the schedule keeps running. */
  setMode(mode) {
    if (this.state.mode === mode) return mode;
    const prev = this.state.mode;
    this.state.mode = mode;
    this.clock.setPaused(mode !== MODES.PLAYING);
    this.bus.emit(EVENTS.MODE_CHANGED, { prev, mode }, this.clock.simTimeMs);
    if (mode === MODES.PAUSED) this.bus.emit(EVENTS.SIM_PAUSED, { prev }, this.clock.simTimeMs);
    if (prev === MODES.PAUSED && mode === MODES.PLAYING) {
      this.bus.emit(EVENTS.SIM_RESUMED, {}, this.clock.simTimeMs);
    }
    this._notify();
    return mode;
  }

  togglePause() {
    if (this.state.mode === MODES.PLAYING) return this.setMode(MODES.PAUSED);
    if (this.state.mode === MODES.PAUSED) return this.setMode(MODES.PLAYING);
    return this.state.mode;   // title and report ignore pause
  }

  /** Focus loss auto-pauses — GDD §24.3. Never auto-RESUMES: coming back to a running
   *  airport you did not choose to restart is how a shift gets lost. */
  pauseForBlur() {
    if (this.state.mode === MODES.PLAYING) this.setMode(MODES.PAUSED);
  }

  get isRunning() { return this.state.mode === MODES.PLAYING; }

  /* ── simulation ───────────────────────────────────────────────────────── */

  /**
   * One real render frame. Called from requestAnimationFrame ONLY.
   * @returns {number} fixed steps executed this frame
   */
  frame(realDeltaMs, input = null) {
    this.frames++;
    const steps = this.clock.advance(realDeltaMs, (stepMs, simTimeMs) => {
      this.step(stepMs, simTimeMs, input);
      if (input) input.endStep();   // input edges are consumed per SIM step, not per frame
    });
    /* A PAUSED frame runs zero steps, so nothing drained the edge buffer and every key
       tapped behind the pause card fired the instant you resumed. Tap F then E while
       paused and you got out of the tractor AND grabbed something on the first step back.
       Draining here keeps "edges align to simulation steps" true for every running frame
       and makes a paused keypress mean nothing, which is what a paused game promises. */
    if (input && steps === 0) input.endStep();
    return steps;
  }

  /**
   * One fixed simulation step. Every gameplay system is called from here, in this order.
   *
   * The order is load-bearing: bags must be spawned and carried along the belt before
   * the grid is rebuilt, the grid must exist before interaction can target anything, and
   * the player must have moved before a carried bag is asked to follow the hands.
   */
  step(stepMs, simTimeMs, input) {
    this.state.simTimeMs = simTimeMs;
    // Once the shift is over nothing moves — not the belt, not the clock-driven flights,
    // nothing. The report is a snapshot of a stopped airport, and a debug skip past the
    // end must not quietly keep simulating behind it.
    if (this.state.shift.ended) return;

    const dt = stepMs / 1000;

    // The schedule runs FIRST and reads nothing but the clock. Everything below is the
    // crew reacting to it — never the other way round (GDD §31.1.7).
    stepFlights(this.state, dt, this.bus, simTimeMs);

    spawnDueBags(this.state, this.rng.bags, simTimeMs, this.bus);
    stepConveyor(this.state, dt, this.bus, simTimeMs, this.rng.sim);

    // Vehicles before the player, because a driving player is positioned FROM the
    // tractor. Trains are placed by constraint straight after their tractor moves, and
    // their load is pinned to them immediately, so a cart and its bags can never be
    // rendered a step apart.
    for (const v of Object.values(this.state.vehiclesById)) {
      if (v.driverId) stepTractor(this.state, v, dt, input);
      updateTrain(this.state, v, dt, this.bus, simTimeMs);
    }
    syncCartBagPositions(this.state);

    rebuildGrid(this.state, this.grid);
    stepPlayer(this.state, dt, input);
    stepInteraction(this.state, dt, input, this.bus, simTimeMs, this.grid);
    stepBags(this.state, dt, this.grid);
    absorbIntoContainers(this.state, simTimeMs, this.bus);

    // Scoring is a PULL pass over flights that have evaluated but not been scored, so
    // it cannot double-count and does not care what order anything happened in.
    stepScoring(this.state, this.bus, simTimeMs);

    // The guide advances on SIMULATION time, so its stall timer freezes with a pause
    // rather than deciding you are stuck while the game is stopped.
    this.guideView = stepGuide(this.guide, this.state);
    this.state.guide = this.guideView;

    if (simTimeMs >= this.state.shift.endTimeMs) this.endShift(simTimeMs);
  }

  /**
   * End the shift: freeze the airport, build the report, remember it if it is the best.
   * Idempotent — a second call is a no-op, so a skip past the end cannot rebuild it.
   */
  endShift(simTimeMs = this.state.simTimeMs) {
    if (this.state.shift.ended) return this.state.report;
    this.state.shift.ended = true;

    // Anything still evaluated-but-unscored is scored before the snapshot is taken.
    stepScoring(this.state, this.bus, simTimeMs);
    this.state.report = buildReport(this.state);

    const { record, improved } = this.save.saveBest(this.state.report);
    this.state.report.best = record;
    this.state.report.improved = improved;

    announce(this.state, 'Shift over.', 'info', simTimeMs, this.bus);
    this.setMode(MODES.REPORT);
    return this.state.report;
  }

  /** Debug: fast-forward simulation time without real frames. GDD §21.8. */
  skipMs(ms) {
    return this.clock.skipMs(ms, (stepMs, t) => this.step(stepMs, t, null));
  }

  get shiftRemainingMs() {
    return Math.max(0, this.state.shift.endTimeMs - this.state.simTimeMs);
  }

  /* ── observation boundary ─────────────────────────────────────────────── */

  /** Renderers and UI subscribe; they never mutate. @returns {() => void} unsubscribe */
  subscribe(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }

  _notify() { for (const fn of Array.from(this._listeners)) fn(this.state); }

  /** Compact snapshot for the debug overlay and for tests. Everything here is part of
   *  the determinism contract: two runs of one seed must produce identical output. */
  describe() {
    const p = this.state.player;
    return {
      mode: this.state.mode,
      seed: this.seed,
      seedLabel: this.seedLabel,
      simTimeMs: this.state.simTimeMs,
      stepCount: this.clock.stepCount,
      paused: this.clock.paused,
      timeScale: this.clock.timeScale,
      clampedFrames: this.clock.clampedFrames,
      draws: { world: this.rng.world.draws, bags: this.rng.bags.draws, sim: this.rng.sim.draws },
      events: this.bus.emitted,
      frames: this.frames,
      spawned: this.state.shift.spawned,
      bags: Object.keys(this.state.bagsById).length,
      byLocation: countByLocation(this.state),
      player: { x: round4(p.x), y: round4(p.y), carrying: p.carryingBagId, driving: p.drivingId },
      delivered: this.state.world.conveyor.delivered,
      // Carts and the tractor are part of the determinism contract too: a train that
      // drifts by a millimetre between two runs of one seed is a bug, and this is where
      // it shows up.
      carts: Object.values(this.state.cartsById).map((c) => ({
        id: c.id, x: round4(c.x), y: round4(c.y), rot: round4(c.rot),
        bags: c.bagIds.length, placard: c.placardFlightId,
        hitchedTo: c.hitchedToId, stability: round4(c.stability), spills: c.spills,
      })),
      vehicles: Object.values(this.state.vehiclesById).map((v) => ({
        id: v.id, x: round4(v.x), y: round4(v.y), rot: round4(v.rot),
        speed: round4(v.speed), driver: v.driverId,
        train: trainOf(this.state, v), odo: round4(v.odometerM),
      })),
      flights: Object.values(this.state.flightsById).map((f) => ({
        id: f.id, state: f.state, aboard: f.loadedBagIds.length,
        expected: f.expectedCount, evaluated: f.evaluated, outcome: { ...f.outcome },
      })),
      announcements: this.state.announcements.length,
      ended: this.state.shift.ended,
      score: {
        points: this.state.score.points,
        correct: this.state.score.correct,
        misrouted: this.state.score.misrouted,
        missed: this.state.score.missed,
        flightsPerfect: this.state.score.flightsPerfect,
      },
    };
  }

  /** Debug: jump the clock to just before a flight transition. GDD §21.8 asks for a
   *  skip-to-next-event control, and a ten-minute schedule is unusable without one. */
  skipToNextFlightEvent(leadMs = 1500) {
    let best = Infinity;
    for (const f of Object.values(this.state.flightsById)) {
      for (const t of [f.times.bagAcceptanceMs, f.times.loadingMs, f.times.finalCallMs,
                       f.times.holdClosingMs, f.times.departureMs]) {
        if (t > this.state.simTimeMs && t < best) best = t;
      }
    }
    if (!isFinite(best)) return 0;
    return this.skipMs(Math.max(0, best - leadMs - this.state.simTimeMs));
  }

  /** Debug: force a flight to pushback now, whatever the clock says. GDD §21.8. */
  forceDeparture(flightId) {
    const f = this.state.flightsById[flightId];
    if (!f) return null;
    const target = f.times.departureMs - this.state.simTimeMs;
    if (target > 0) this.skipMs(target);
    return f;
  }
}

/* Positions are compared across runs for determinism; rounding keeps a last-bit float
 * difference from reading as a failure while still catching any real divergence. */
const round4 = (v) => Math.round(v * 10000) / 10000;
