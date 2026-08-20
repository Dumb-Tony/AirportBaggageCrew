/* Sound — GDD §18. Synthesised end to end; no files, no external requests (§21.1).
 *
 * `tone` and `toneP` are copied from Chameleon\chameleon3d.html:2190 and :2203 (see
 * Dev\INDEX.md → "Audio"), keeping the names so the lineage stays greppable. `toneP` is
 * the one that matters here: a top-down airport has the belt across the room and a gate
 * fifty metres away, so a cue that does not attenuate and pan is a cue that lies about
 * where it happened.
 *
 * THREE RULES, all learned on Something's Different and all worth keeping:
 *
 *   1. INERT UNTIL `arm()`. Browsers refuse an AudioContext before a real user gesture,
 *      so every public method here is a safe no-op until one arrives. The game must
 *      behave identically with the whole layer dead.
 *   2. AUDIO READS THE SIMULATION AND NEVER WRITES TO IT. The m5 suite runs the same
 *      shift with the graph live and dead and demands byte-identical results.
 *   3. EVERY CRITICAL CUE HAS A VISUAL EQUIVALENT (GDD §18.2, §5.3). Nothing here is the
 *      only channel for anything — the board, the toasts and the hold door already carry
 *      it. Sound is confirmation, never the sole carrier.
 */

import { EVENTS } from '../core/eventBus.js';

/** Volume categories, as GDD §16.6 requires them to be adjustable separately. */
export const BUSES = ['master', 'sfx', 'ambience'];

export class Sfx {
  constructor() {
    this.ac = null;
    this.armed = false;
    this.muted = false;
    this.vol = { master: 0.8, sfx: 0.9, ambience: 0.5 };
    this._nodes = {};
    this._beds = {};
    this._bus = null;
    this._lastBelt = 0;
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
    const bed = (freq, type, gain) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.value = 0;
      o.connect(g); g.connect(this._nodes.ambience);
      o.start();
      return { o, g, base: gain };
    };
    this._beds.belt = bed(58, 'sawtooth', 0.05);     // conveyor motor
    this._beds.ramp = bed(41, 'sine', 0.035);        // distant ramp hum
    this._beds.engine = bed(70, 'square', 0.045);    // tractor, pitched by speed
  }

  /* ── driving it ───────────────────────────────────────────────────────── */

  /**
   * Wire one-shots to what the simulation ANNOUNCED. Read-only; nothing here writes
   * game state, and every cue below already has a visual counterpart.
   */
  attach(bus, getCamera) {
    if (this._bus) return;
    this._bus = bus;
    this._cam = getCamera;

    /* Every subscription goes through `on`, which drops the event outright while the
       audio is unarmed. Audio is unarmed for the whole title screen and for however long
       it takes a player to press a key, and the simulation emits thousands of events in a
       shift — so the guard belongs here, before any panning arithmetic, rather than at
       the bottom of tone()/noise() where the work has already been done. */
    const on = (ev, fn) => bus.on(ev, (e) => { if (this.armed) fn(e); });
    const at = (x, y) => this._pos(x, y);

    on(EVENTS.BAG_LEFT_CONVEYOR, (e) => {
      const p = at(e.x, e.y);
      this.noise(0.16, 190, 1.1, 0.9, p.pan, p.att);
    });
    on(EVENTS.BAG_PICKED_UP, () => this.tone(420, 0.05, 'sine', 0.35));
    on(EVENTS.BAG_RELEASED, (e) => {
      const p = at(e.x, e.y);
      this.noise(0.12, 150, 1.0, 0.6, p.pan, p.att);
    });
    on(EVENTS.BAG_THROWN, () => this.tone(300, 0.09, 'triangle', 0.4));
    on(EVENTS.BAG_PLACED_IN_CART, () => this.tone(520, 0.06, 'square', 0.22));
    on(EVENTS.BAG_SPILLED, () => this.noise(0.3, 130, 0.8, 1.1));
    on(EVENTS.CART_HITCHED, () => { this.noise(0.1, 900, 6, 0.8); this.tone(160, 0.09, 'square', 0.5); });
    on(EVENTS.CART_UNHITCHED, () => this.noise(0.09, 700, 6, 0.6));
    on(EVENTS.VEHICLE_ENTERED, () => this.tone(120, 0.22, 'sawtooth', 0.5));

    // GDD §18.1: a distinctive scanner beep, a correct chirp, a wrong buzz.
    on(EVENTS.BAG_SCANNED, (e) => {
      if (e.verdict === 'correct') { this.tone(880, 0.07, 'sine', 0.5); this.tone(1320, 0.09, 'sine', 0.4, 0.06); }
      else if (e.verdict === 'wrong') { this.tone(180, 0.22, 'sawtooth', 0.55); }
      else { this.tone(1150, 0.045, 'square', 0.3); }
    });

    on(EVENTS.BAG_ENTERED_HOLD, () => { this.tone(660, 0.06, 'sine', 0.35); this.tone(990, 0.07, 'sine', 0.28, 0.05); });

    // Escalating flight cues — the pitch and the insistence climb with the state.
    on(EVENTS.FLIGHT_STATE_CHANGED, (e) => {
      switch (e.state) {
        case 'BAG_ACCEPTANCE': this._chime([620, 780], 0.5); break;
        case 'LOADING':        this._chime([700, 880], 0.45); break;
        case 'FINAL_BAG_CALL': this._chime([880, 1100, 880], 0.75); break;
        case 'HOLD_CLOSING':   this.noise(0.35, 90, 0.7, 1.2); this.tone(110, 0.5, 'sawtooth', 0.6); break;
        case 'PUSHBACK':       this.tone(60, 1.3, 'sawtooth', 0.7); break;
        default: break;
      }
    });

    on(EVENTS.FLIGHT_DEPARTED, (e) => {
      // Kept subtle — GDD §11.1 warns against an arcade combo counter, and the same
      // applies to its sound.
      if (e.missed > 0) this.tone(200, 0.3, 'triangle', 0.35);
      else { this.tone(700, 0.1, 'sine', 0.4); this.tone(1050, 0.14, 'sine', 0.35, 0.09); }
    });

    on(EVENTS.SIM_RESET, () => { this._lastBelt = 0; });
  }

  _chime(freqs, vol) {
    freqs.forEach((f, i) => this.tone(f, 0.16, 'sine', vol, i * 0.11));
  }

  /** Pan and attenuation for a world point, relative to where the camera is looking. */
  _pos(x, y) {
    const cam = this._cam ? this._cam() : null;
    // The camera is handed in from the bootstrap, so this defends against its shape as
    // well as its absence: a mispanned cue is a nuisance, a throw from an event handler
    // takes the simulation step down with it.
    if (!cam || !cam.centre || !cam.visibleM) return { pan: 0, att: 1 };
    const halfW = cam.visibleM.w / 2;
    const dx = x - cam.centre.x, dy = y - cam.centre.y;
    const dist = Math.hypot(dx, dy);
    return {
      pan: Math.max(-1, Math.min(1, dx / Math.max(1, halfW))),
      att: Math.max(0, 1 - dist / (halfW * 2.2)),
    };
  }

  /**
   * Continuous beds, following simulation state. Called once a frame.
   * READS state; never writes to it.
   */
  update(state, dtSec) {
    if (!this.armed) return;
    const playing = state.mode === 'playing';
    const t = this.ac.currentTime;

    const set = (bed, gain, freq) => {
      if (!bed) return;
      bed.g.gain.setTargetAtTime(this.muted ? 0 : gain, t, 0.12);
      if (freq) bed.o.frequency.setTargetAtTime(freq, t, 0.12);
    };

    // The belt hum only exists while the belt is running, which is while the game is.
    set(this._beds.belt, playing ? this._beds.belt.base : 0, 58);
    set(this._beds.ramp, playing ? this._beds.ramp.base : 0, 41);

    // The tractor engine pitches with its speed, so you can hear yourself accelerate.
    let speed = 0;
    for (const v of Object.values(state.vehiclesById)) {
      if (v.driverId) speed = Math.max(speed, Math.abs(v.speed));
    }
    const driving = playing && speed > 0.01;
    set(this._beds.engine,
        driving ? this._beds.engine.base * (0.4 + 0.6 * Math.min(1, speed / 7)) : 0,
        70 + speed * 11);

    void dtSec;
  }

  /** Test hook: tear the graph down so a suite can prove the game runs without it. */
  _reset() {
    try { if (this.ac && this.ac.close) this.ac.close(); } catch { /* ignore */ }
    this.ac = null; this.armed = false; this._nodes = {}; this._beds = {};
  }
}
