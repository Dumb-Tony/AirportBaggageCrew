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
import { spawnDueBags, stepBags, rebuildGrid } from './systems/baggageFlow.js';
import { stepInteraction } from './systems/interaction.js';
import { countByLocation } from './systems/containment.js';

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
      endTimeMs: CONFIG.shift.durationMs,
      bagSchedule: [],      // filled by Game.reset() from the seeded stream
      nextSpawnIdx: 0,
      tagBase: 0,
      spawned: 0,
    },

    player: createPlayer(ANCHORS.playerSpawn),
    bagsById: {},

    // Populated by their own milestones. Present now so every system can assume the
    // keys exist and no code has to defend against `undefined` containers.
    cartsById: {},
    vehiclesById: {},
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
    score: { points: 0, correct: 0, wrong: 0, missed: 0 },
    announcements: [],
    settings: { showGrid: CONFIG.render.showGrid },
  };
}

export class Game {
  constructor({ seed = CONFIG.sim.defaultSeed, seedLabel = CONFIG.sim.seedLabel } = {}) {
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

  /** clock.paused is a FUNCTION of mode and must never be set independently. Without
   *  this, a freshly constructed game sat on the title screen with a running clock and
   *  the shift silently burned time behind the title card. Caught by m0 C3. */
  _syncClockToMode() { this.clock.setPaused(this.state.mode !== MODES.PLAYING); }

  /** Draw the shift's content from the seeded stream. Order matters and is fixed: the
   *  tag base first, then the timetable, so adding detail to the timetable later cannot
   *  renumber every bag in an already-balanced shift. */
  _authorShift() {
    this.state.shift.tagBase = this.rng.world.int(100000, 899999);
    this.state.shift.bagSchedule = buildBagSchedule(this.rng.world);
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
    return this.clock.advance(realDeltaMs, (stepMs, simTimeMs) => {
      this.step(stepMs, simTimeMs, input);
      if (input) input.endStep();   // input edges are consumed per SIM step, not per frame
    });
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
    const dt = stepMs / 1000;

    spawnDueBags(this.state, this.rng.bags, simTimeMs, this.bus);
    stepConveyor(this.state, dt, this.bus, simTimeMs, this.rng.sim);
    rebuildGrid(this.state, this.grid);
    stepPlayer(this.state, dt, input);
    stepInteraction(this.state, dt, input, this.bus, simTimeMs, this.grid);
    stepBags(this.state, dt, this.grid);

    // Milestone order, once these exist:
    //   vehicles.step -> flightSchedule.step -> scoring.step -> announcements.step
    // flightSchedule reads ONLY simTimeMs. It must never ask whether the player is
    // ready. GDD §31.1.7: never make a flight wait for task completion.
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
      player: { x: round4(p.x), y: round4(p.y), carrying: p.carryingBagId },
      delivered: this.state.world.conveyor.delivered,
    };
  }
}

/* Positions are compared across runs for determinism; rounding keeps a last-bit float
 * difference from reading as a failure while still catching any real divergence. */
const round4 = (v) => Math.round(v * 10000) / 10000;
