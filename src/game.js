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
import { BOUNDS, WORLD, ANCHORS } from './data/airport.js';

export const MODES = Object.freeze({
  TITLE: 'title',
  PLAYING: 'playing',
  PAUSED: 'paused',
  REPORT: 'report',   // reached in Milestone 4, with the shift report
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
    shift: { id: CONFIG.shift.id, endTimeMs: CONFIG.shift.durationMs },

    // Populated by their own milestones. Present now so every system can assume the
    // keys exist and no code has to defend against `undefined` containers.
    player: {},
    bagsById: {},
    cartsById: {},
    vehiclesById: {},
    aircraftById: {},
    flightsById: {},

    world: {
      widthM: WORLD.widthM,
      heightM: WORLD.heightM,
      bounds: { ...BOUNDS },
      spawn: { ...ANCHORS.playerSpawn },
    },

    score: { points: 0, correct: 0, wrong: 0, missed: 0 },
    announcements: [],
    settings: { showGrid: CONFIG.render.showGrid },
  };
}

export class Game {
  constructor({ seed = CONFIG.sim.defaultSeed, seedLabel = CONFIG.sim.seedLabel } = {}) {
    this.bus = new EventBus({ logSize: CONFIG.debug.eventLogSize });
    this.clock = new GameClock({ stepMs: CONFIG.sim.stepMs, maxFrameMs: CONFIG.sim.maxFrameMs });

    // One named stream per concern, so adding a draw to one system cannot shift the
    // sequence another system sees. `world` is the only stream at Milestone 0.
    this.rng = { world: new Rng(seed, 'world') };

    this.seed = seed >>> 0;
    this.seedLabel = seedLabel;
    this.state = createInitialState(this.seed, this.seedLabel);
    this._listeners = new Set();
    this.frames = 0;
    this._syncClockToMode();
  }

  /** clock.paused is a FUNCTION of mode and must never be set independently. Without
   *  this, a freshly constructed game sat on the title screen with a running clock and
   *  the shift silently burned time behind the title card. Caught by m0 C3. */
  _syncClockToMode() { this.clock.setPaused(this.state.mode !== MODES.PLAYING); }

  /** Seed from a label so a named shift is reproducible without carrying a number. */
  static seedFromLabel(label) { return hashStr(label); }

  /* ── lifecycle ────────────────────────────────────────────────────────── */

  /** Full restart. GDD §29 UX: "Restart resets every entity and timer cleanly."
   *  Event HANDLERS survive (renderer and HUD subscribe once at boot); the event LOG
   *  does not, or a fresh shift would report the previous shift's history. */
  reset(seed = this.seed, seedLabel = this.seedLabel) {
    this.seed = seed >>> 0;
    this.seedLabel = seedLabel;
    this.clock.reset();
    for (const r of Object.values(this.rng)) r.reset(this.seed);
    this.bus.clearLog();
    this.state = createInitialState(this.seed, this.seedLabel);
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
   * One fixed simulation step. Every gameplay system is called from here, in order.
   * Milestone 0 has no systems; simTimeMs mirroring is the whole body.
   */
  step(stepMs, simTimeMs /*, input */) {
    this.state.simTimeMs = simTimeMs;

    // Milestone order, once these exist:
    //   conveyor.step -> player.step -> vehicles.step -> containment.step
    //   -> flightSchedule.step -> scoring.step -> announcements.step
    // flightSchedule reads ONLY simTimeMs. It must never ask whether the player is
    // ready. GDD §31.1.7: never make a flight wait for task completion.
  }

  /** Debug: fast-forward simulation time without real frames. GDD §21.8. */
  skipMs(ms) {
    return this.clock.skipMs(ms, (stepMs, t) => this.step(stepMs, t));
  }

  get shiftRemainingMs() {
    return Math.max(0, this.state.shift.endTimeMs - this.state.simTimeMs);
  }

  /* ── observation boundary ─────────────────────────────────────────────── */

  /** Renderers and UI subscribe; they never mutate. @returns {() => void} unsubscribe */
  subscribe(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }

  _notify() { for (const fn of Array.from(this._listeners)) fn(this.state); }

  /** Compact snapshot for the debug overlay and for tests. */
  describe() {
    return {
      mode: this.state.mode,
      seed: this.seed,
      seedLabel: this.seedLabel,
      simTimeMs: this.state.simTimeMs,
      stepCount: this.clock.stepCount,
      paused: this.clock.paused,
      timeScale: this.clock.timeScale,
      clampedFrames: this.clock.clampedFrames,
      worldDraws: this.rng.world.draws,
      events: this.bus.emitted,
      frames: this.frames,
    };
  }
}
