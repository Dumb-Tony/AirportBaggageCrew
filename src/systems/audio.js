/* Sound — GDD §18. Synthesised end to end; no files, no external requests (§21.1).
 *
 * Structure copied from `SmallTownEmergencyServices\src\audio\audio.js` per Dev\INDEX.md
 * → "Audio", keeping the names `mixFor`, `CUES`, `atten`, `tone` and `toneP` so the
 * lineage stays greppable. That file in turn took `tone`/`toneP` from
 * `Chameleon\chameleon3d.html:2190` and `:2203`. The synth has now been written four
 * times across this tree; this is the fourth ADAPTATION, not a fifth invention.
 *
 * FOUR RULES HOLD THIS FILE TOGETHER.
 *
 * 1. INERT UNTIL `arm()`. Browsers refuse an AudioContext before a real user gesture, so
 *    every public method here is a safe no-op until one arrives, and `attach` drops
 *    events outright while unarmed. The game must behave identically with the layer dead.
 *
 * 2. AUDIO READS THE SIMULATION AND NEVER WRITES TO IT. It is the renderer's twin: same
 *    input, different output device. m5 section E runs the same seeded shift with the
 *    graph live and with none, and demands byte-identical `describe()` snapshots.
 *
 * 3. THE DECISION IS SEPARATE FROM THE PLUMBING. `mixFor(state)` is a PURE function from
 *    world state to target loudnesses, and every oscillator sits behind it. That one seam
 *    is what makes the interesting half assertable — "the engine is louder at speed",
 *    "the belt goes quiet when the game is paused" — on a headless box with no sound card
 *    and no user gesture. The same applies to `CUES`: one-shots are a DATA TABLE keyed by
 *    simulation event name, so a new event is a new row, an event with no row is silent
 *    rather than fatal, and a test can assert every cue names an event the game emits.
 *
 * 4. EVERY CUE HAS A VISUAL EQUIVALENT (GDD §18.2, §5.3). Nothing here is the only
 *    channel for anything — the board, the toasts and the hold door already carry it.
 *    Sound is confirmation, which is what makes the mute switch a preference and not a
 *    handicap.
 */

import { EVENTS } from '../core/eventBus.js';

/** Volume categories, as GDD §16.6 requires them to be adjustable separately. */
export const BUSES = ['master', 'sfx', 'ambience'];

/* ── the mix: pure, testable, no WebAudio anywhere near it ─────────────────── */

/** Distance falloff. Squared, so "across the sort room" and "across the apron" are not
 *  nearly the same number, which linear attenuation makes them. */
export function atten(d, range) {
  const g = 1 - d / range;
  return g <= 0 ? 0 : g * g;
}

/** Bed loudnesses at full volume. Applied through the ambience bus on top of these. */
export const BEDS = Object.freeze({
  belt:   { freq: 58, type: 'sawtooth', base: 0.05 },   // conveyor motor
  ramp:   { freq: 41, type: 'sine',     base: 0.035 },  // distant apron hum
  engine: { freq: 70, type: 'square',   base: 0.045 },  // tractor, pitched by speed
});

/**
 * What should be humming right now, and how loudly. PURE: reads state, returns numbers,
 * touches nothing.
 *
 * @param {object} state  the simulation state, read-only
 * @returns {{belt:number, ramp:number, engine:{gain:number, pitch:number}, speed:number}}
 */
export function mixFor(state) {
  const out = { belt: 0, ramp: 0, engine: { gain: 0, pitch: BEDS.engine.freq }, speed: 0 };
  if (!state) return out;

  // The belt hum exists while the belt is running, which is while the game is. A paused
  // airport is silent by the same argument that freezes the walk cycle mid-stride.
  const playing = state.mode === 'playing';
  if (!playing) return out;

  out.belt = BEDS.belt.base;
  out.ramp = BEDS.ramp.base;

  // The tractor engine pitches with its own speed, so you can hear yourself accelerate.
  let speed = 0;
  for (const v of Object.values(state.vehiclesById || {})) {
    if (v.driverId) speed = Math.max(speed, Math.abs(v.speed));
  }
  out.speed = speed;
  if (speed > 0.01) {
    out.engine.gain = BEDS.engine.base * (0.4 + 0.6 * Math.min(1, speed / 7));
    out.engine.pitch = BEDS.engine.freq + speed * 11;
  }
  return out;
}

/* ── the cue table ─────────────────────────────────────────────────────────── */
/*
 * Every simulation event a player should hear, mapped to a recipe. A table rather than a
 * switch means a new event is a new row, and an event with no row is silent rather than
 * a crash.
 *
 * A part is one of:
 *   ['t', freq, seconds, type, gain, delay]   an enveloped tone
 *   ['n', seconds, freq, Q, gain]             a filtered noise burst
 *
 * `positional: true` pans and attenuates from the event's own x/y. `minGapMs` is real
 * elapsed audio time, NOT simulation time — it exists so a heap of bags landing together
 * is one thump rather than nine, and rate-limiting a cue must never be able to influence
 * anything the simulation can observe.
 *
 * `variant` picks a sub-recipe from `variants` by a key taken off the event; `_` is the
 * fallback, so an unrecognised verdict or flight state is silent rather than fatal.
 */
export const CUES = Object.freeze({
  BAG_LEFT_CONVEYOR:  { bus: 'sfx', minGapMs: 45, positional: true, parts: [['n', 0.16, 190, 1.1, 0.9]] },
  BAG_RELEASED:       { bus: 'sfx', minGapMs: 45, positional: true, parts: [['n', 0.12, 150, 1.0, 0.6]] },
  BAG_PICKED_UP:      { bus: 'sfx', minGapMs: 40, parts: [['t', 420, 0.05, 'sine', 0.35]] },
  BAG_THROWN:         { bus: 'sfx', minGapMs: 40, parts: [['t', 300, 0.09, 'triangle', 0.4]] },
  BAG_PLACED_IN_CART: { bus: 'sfx', minGapMs: 40, parts: [['t', 520, 0.06, 'square', 0.22]] },
  BAG_TAKEN_FROM_CART:{ bus: 'sfx', minGapMs: 40, parts: [['t', 460, 0.06, 'square', 0.18]] },
  BAG_SPILLED:        { bus: 'sfx', minGapMs: 90, positional: true, parts: [['n', 0.3, 130, 0.8, 1.1]] },

  CART_HITCHED:       { bus: 'sfx', minGapMs: 120, parts: [['n', 0.1, 900, 6, 0.8], ['t', 160, 0.09, 'square', 0.5]] },
  CART_UNHITCHED:     { bus: 'sfx', minGapMs: 120, parts: [['n', 0.09, 700, 6, 0.6]] },
  CART_PLACARD_SET:   { bus: 'sfx', minGapMs: 120, parts: [['t', 590, 0.07, 'square', 0.24]] },
  VEHICLE_ENTERED:    { bus: 'sfx', minGapMs: 150, parts: [['t', 120, 0.22, 'sawtooth', 0.5]] },
  VEHICLE_EXITED:     { bus: 'sfx', minGapMs: 150, parts: [['t', 150, 0.16, 'sawtooth', 0.35]] },

  // GDD §18.1: a distinctive scanner beep, a correct chirp, a wrong buzz.
  BAG_SCANNED: {
    bus: 'sfx', minGapMs: 60, variant: (e) => e.verdict,
    variants: {
      correct: { parts: [['t', 880, 0.07, 'sine', 0.5], ['t', 1320, 0.09, 'sine', 0.4, 0.06]] },
      wrong:   { parts: [['t', 180, 0.22, 'sawtooth', 0.55]] },
      _:       { parts: [['t', 1150, 0.045, 'square', 0.3]] },
    },
  },

  BAG_ENTERED_HOLD:   { bus: 'sfx', minGapMs: 45, parts: [['t', 660, 0.06, 'sine', 0.35], ['t', 990, 0.07, 'sine', 0.28, 0.05]] },
  BAG_LEFT_HOLD:      { bus: 'sfx', minGapMs: 45, parts: [['t', 520, 0.07, 'sine', 0.26]] },

  // Escalating flight cues — the pitch and the insistence climb with the state. This is
  // GDD §5.3's third urgency channel; the board and the toasts are the other two, and the
  // words in the toast already say everything this says.
  FLIGHT_STATE_CHANGED: {
    bus: 'sfx', minGapMs: 200, variant: (e) => e.state,
    variants: {
      BAG_ACCEPTANCE: { parts: [['t', 620, 0.16, 'sine', 0.5], ['t', 780, 0.16, 'sine', 0.5, 0.11]] },
      LOADING:        { parts: [['t', 700, 0.16, 'sine', 0.45], ['t', 880, 0.16, 'sine', 0.45, 0.11]] },
      FINAL_BAG_CALL: { parts: [['t', 880, 0.16, 'sine', 0.75], ['t', 1100, 0.16, 'sine', 0.75, 0.11], ['t', 880, 0.16, 'sine', 0.75, 0.22]] },
      HOLD_CLOSING:   { parts: [['n', 0.35, 90, 0.7, 1.2], ['t', 110, 0.5, 'sawtooth', 0.6]] },
      PUSHBACK:       { parts: [['t', 60, 1.3, 'sawtooth', 0.7]] },
      _:              { parts: [] },
    },
  },

  // Kept subtle — GDD §11.1 warns against turning the screen into an arcade combo
  // counter, and the same applies to its sound.
  FLIGHT_DEPARTED: {
    bus: 'sfx', minGapMs: 200, variant: (e) => (e.missed > 0 ? 'short' : 'clean'),
    variants: {
      short: { parts: [['t', 200, 0.3, 'triangle', 0.35]] },
      clean: { parts: [['t', 700, 0.1, 'sine', 0.4], ['t', 1050, 0.14, 'sine', 0.35, 0.09]] },
    },
  },
});

/* ── the plumbing ──────────────────────────────────────────────────────────── */

export class Sfx {
  constructor() {
    this.ac = null;
    this.armed = false;
    this.muted = false;
    this.vol = { master: 0.8, sfx: 0.9, ambience: 0.5 };
    this._nodes = {};
    this._beds = {};
    this._bus = null;
    this._lastAt = {};        // cue name -> AudioContext time it last fired
  }

  /* ── lifecycle ────────────────────────────────────────────────────────── */

  /** Called from a real user gesture. Safe to call repeatedly. */
  arm() {
    if (this.armed) return true;
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return false;
    try {
      this.ac = new Ctor();
      if (this.ac.state === 'suspended' && this.ac.resume) this.ac.resume();
    } catch { this.ac = null; return false; }

    const ac = this.ac;
    this._nodes.master = ac.createGain();
    this._nodes.sfx = ac.createGain();
    this._nodes.ambience = ac.createGain();
    this._nodes.sfx.connect(this._nodes.master);
    this._nodes.ambience.connect(this._nodes.master);
    this._nodes.master.connect(ac.destination);
    this.armed = true;
    this._applyMix();
    this._buildBeds();
    return true;
  }

  setVolume(bus, v) {
    if (!BUSES.includes(bus)) return;
    this.vol[bus] = Math.max(0, Math.min(1, v));
    this._applyMix();
  }

  setMuted(m) { this.muted = !!m; this._applyMix(); }

  /** Squared, because perceived loudness is not linear in slider position. */
  busGain(bus) {
    const v = this.vol[bus] || 0;
    return this.muted ? 0 : v * v;
  }

  _applyMix() {
    if (!this.armed) return;
    // setTargetAtTime rather than an assignment: an instant jump clicks. This is also
    // why a test must never read gain.value straight after setting it.
    for (const b of BUSES) {
      const g = this._nodes[b];
      if (g) g.gain.setTargetAtTime(this.busGain(b), this.ac.currentTime, 0.02);
    }
  }

  /* ── the primitives ───────────────────────────────────────────────────── */

  /** A plain enveloped tone. Copied from chameleon3d.html:2190. */
  tone(freq, dur, type, volMul, delay, bus) {
    if (!this.armed || this.muted) return;
    const ac = this.ac, t0 = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.22 * (volMul || 1)), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(this._nodes[bus || 'sfx']);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  /**
   * POSITIONAL. Copied from chameleon3d.html:2203 — distance attenuation plus a stereo
   * pan taken from where the sound is relative to the camera.
   */
  toneP(freq, dur, type, volMul, delay, pan, att, bus) {
    if (!this.armed || this.muted) return;
    if (att <= 0.02) return;                        // too far to bother synthesising
    const ac = this.ac, t0 = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.22 * (volMul || 1) * att), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    let tail = g;
    if (ac.createStereoPanner) {
      const p = ac.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan || 0));
      g.connect(p); tail = p;
    }
    tail.connect(this._nodes[bus || 'sfx']);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  /** A filtered noise burst — thumps, skids, clanks. */
  noise(dur, freq, q, volMul, pan, att, bus) {
    if (!this.armed || this.muted) return;
    if (att !== undefined && att <= 0.02) return;
    const ac = this.ac, t0 = ac.currentTime;
    const n = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const d = buf.getChannelData(0);
    // Deterministic pseudo-noise: no Math.random anywhere in this project.
    let s = 0x2545f491;
    for (let i = 0; i < n; i++) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s |= 0;
      d[i] = (s / 0x7fffffff) * (1 - i / n);
    }
    const src = ac.createBufferSource(); src.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1;
    const g = ac.createGain();
    g.gain.value = 0.3 * (volMul || 1) * (att === undefined ? 1 : att);
    src.connect(f); f.connect(g);
    let tail = g;
    if (ac.createStereoPanner && pan !== undefined) {
      const p = ac.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p); tail = p;
    }
    tail.connect(this._nodes[bus || 'sfx']);
    src.start(t0);
  }

  /* ── ambient beds ─────────────────────────────────────────────────────── */

  _buildBeds() {
    const ac = this.ac;
    const bed = (spec) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = spec.type; o.frequency.value = spec.freq;
      g.gain.value = 0;
      o.connect(g); g.connect(this._nodes.ambience);
      o.start();
      return { o, g };
    };
    for (const name of Object.keys(BEDS)) this._beds[name] = bed(BEDS[name]);
  }

  /* ── driving it ───────────────────────────────────────────────────────── */

  /**
   * Play one row of CUES. Public so a suite can drive it without an event bus; returns
   * the recipe it chose (or null), which is the assertable half of a one-shot.
   */
  play(name, e = {}) {
    const cue = CUES[name];
    if (!cue) return null;                        // an unlisted event is silent, not fatal
    const recipe = cue.variant
      ? (cue.variants[cue.variant(e)] || cue.variants._ || null)
      : cue;
    if (!recipe || !recipe.parts || !recipe.parts.length) return null;

    if (!this.armed) return recipe;               // decided, but nothing to play it on

    // Rate limit on REAL audio time. Simulation time must never reach this decision.
    const now = this.ac.currentTime;
    const gap = (cue.minGapMs || 0) / 1000;
    if (gap && this._lastAt[name] !== undefined && now - this._lastAt[name] < gap) return recipe;
    this._lastAt[name] = now;

    const p = cue.positional ? this._pos(e.x, e.y) : null;
    for (const part of recipe.parts) {
      if (part[0] === 'n') {
        const [, dur, freq, q, vol] = part;
        this.noise(dur, freq, q, vol, p ? p.pan : undefined, p ? p.att : undefined, cue.bus);
      } else {
        const [, freq, dur, type, vol, delay] = part;
        if (p) this.toneP(freq, dur, type, vol, delay || 0, p.pan, p.att, cue.bus);
        else this.tone(freq, dur, type, vol, delay || 0, cue.bus);
      }
    }
    return recipe;
  }

  /**
   * Subscribe every row of CUES to the event of the same name. Read-only; nothing here
   * writes game state, and every cue already has a visual counterpart.
   */
  attach(bus, getCamera) {
    if (this._bus) return;
    this._bus = bus;
    this._cam = getCamera;

    /* The `armed` guard sits at the SUBSCRIPTION, before any panning or table lookup.
       Audio is unarmed for the whole title screen and for however long it takes a player
       to press a key, and a shift emits thousands of events. */
    for (const name of Object.keys(CUES)) {
      if (!EVENTS[name]) continue;                // a row naming no real event stays inert
      bus.on(EVENTS[name], (e) => { if (this.armed) this.play(name, e || {}); });
    }

    bus.on(EVENTS.SIM_RESET, () => { this._lastAt = {}; });
  }

  /** Pan and attenuation for a world point, relative to where the camera is looking. */
  _pos(x, y) {
    const cam = this._cam ? this._cam() : null;
    // The camera is handed in from the bootstrap, so this defends against its shape as
    // well as its absence: a mispanned cue is a nuisance, but a throw from an event
    // handler takes the simulation step down with it.
    if (!cam || !cam.centre || !cam.visibleM || x === undefined || y === undefined) {
      return { pan: 0, att: 1 };
    }
    const halfW = cam.visibleM.w / 2;
    const dx = x - cam.centre.x, dy = y - cam.centre.y;
    return {
      pan: Math.max(-1, Math.min(1, dx / Math.max(1, halfW))),
      att: atten(Math.hypot(dx, dy), halfW * 2.2),
    };
  }

  /**
   * Apply `mixFor` to the beds. Called once a frame. READS state; never writes to it,
   * and every decision it acts on was already made by the pure function above.
   */
  update(state, dtSec) {
    if (!this.armed) return;
    const mix = mixFor(state);
    const t = this.ac.currentTime;

    const set = (bed, gain, freq) => {
      if (!bed) return;
      bed.g.gain.setTargetAtTime(this.muted ? 0 : gain, t, 0.12);
      if (freq) bed.o.frequency.setTargetAtTime(freq, t, 0.12);
    };

    set(this._beds.belt, mix.belt, BEDS.belt.freq);
    set(this._beds.ramp, mix.ramp, BEDS.ramp.freq);
    set(this._beds.engine, mix.engine.gain, mix.engine.pitch);

    void dtSec;
  }

  /** Test hook: tear the graph down so a suite can prove the game runs without it. */
  _reset() {
    try { if (this.ac && this.ac.close) this.ac.close(); } catch { /* ignore */ }
    this.ac = null; this.armed = false; this._nodes = {}; this._beds = {}; this._lastAt = {};
  }
}
