/* Developer overlay — GDD §21.8.
 *
 * "Debug tools must not be mixed into player-facing UI." This is a separate DOM node,
 * hidden by default, toggled with F3, and it reads state without writing gameplay rules.
 * The only writes it makes are explicitly-labelled debug actions (time scale, skip).
 *
 * Milestone 0 shows what exists. Flight state/timers, bag counts by state, selected
 * entity ID and spawn/force-departure actions are listed as pending so a later milestone
 * has an obvious place to hang them.
 */

import { CONFIG } from '../config.js';
import { GameClock } from '../core/clock.js';
import { assertContainment } from '../systems/containment.js';

export class DebugOverlay {
  constructor(root, game, renderer) {
    this.game = game;
    this.renderer = renderer;
    this.visible = CONFIG.debug.enabled;

    this.el = document.createElement('div');
    this.el.id = 'debug';
    this.el.className = 'debug';
    root.appendChild(this.el);

    this.fps = 0;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._scaleIdx = CONFIG.debug.timeScales.indexOf(1);

    this._onKey = (e) => this._key(e);
    window.addEventListener('keydown', this._onKey);
    this._apply();
  }

  _key(e) {
    if (e.code === 'F3') { e.preventDefault(); this.visible = !this.visible; this._apply(); return; }
    if (!this.visible) return;
    switch (e.code) {
      case 'KeyB': this.renderer.showBounds = !this.renderer.showBounds; break;
      case 'KeyG': this.renderer.showGrid   = !this.renderer.showGrid;   break;
      case 'BracketLeft':  this._setScale(this._scaleIdx - 1); break;
      case 'BracketRight': this._setScale(this._scaleIdx + 1); break;
      case 'Period': this.game.skipMs(10000); break;   // skip 10 s of simulation
      default: return;
    }
    e.preventDefault();
  }

  _setScale(i) {
    const scales = CONFIG.debug.timeScales;
    this._scaleIdx = Math.max(0, Math.min(scales.length - 1, i));
    this.game.clock.timeScale = scales[this._scaleIdx];
  }

  _apply() { this.el.classList.toggle('on', this.visible); }

  /** @param {number} realDeltaMs wall-clock ms for this frame */
  update(realDeltaMs) {
    this._fpsAccum += realDeltaMs;
    this._fpsFrames++;
    if (this._fpsAccum >= 500) {
      this.fps = Math.round((this._fpsFrames * 1000) / this._fpsAccum);
      this._fpsAccum = 0; this._fpsFrames = 0;
    }
    if (!this.visible) return;

    const g = this.game;
    const s = g.state;
    const d = g.describe();
    const evts = g.bus.recent(CONFIG.debug.recentEvents)
      .map((e) => `  ${String(Math.round(e.simTimeMs)).padStart(7)}  ${e.type}`)
      .join('\n') || '  (none)';

    const L = d.byLocation;
    const held = s.player.carryingBagId || '-';
    const target = s.player.targetBagId || '-';

    // The containment invariant, checked live. GDD §31.3 asks for development
    // assertions on illegal bag locations; this is the one place a violation can be
    // seen the instant it happens rather than at the next test run.
    const bad = assertContainment(s);

    this.el.textContent =
`AIRPORT BAGGAGE CREW - DEV OVERLAY        F3 close
mode        ${d.mode}
sim time    ${GameClock.formatMs(d.simTimeMs)}  (${Math.round(d.simTimeMs)} ms)
shift left  ${GameClock.formatMs(g.shiftRemainingMs)}
steps       ${d.stepCount}      frames ${d.frames}
fps         ${this.fps}         step ${CONFIG.sim.stepMs.toFixed(3)} ms
time scale  ${d.timeScale}x     [ ] change   . skip 10s
clamped     ${d.clampedFrames} frame(s) over ${CONFIG.sim.maxFrameMs} ms
seed        ${d.seed}  "${d.seedLabel}"
rng draws   world=${d.draws.world} bags=${d.draws.bags} sim=${d.draws.sim}
events      ${d.events} emitted

bags        ${d.bags} spawned of ${s.shift.bagSchedule.length} scheduled
  belt      ${L.conveyor}   (delivered ${d.delivered})
  floor     ${L.floor}
  carried   ${L.carried}
  cart      ${L.cart}      hold ${L.aircraftHold}
containment ${bad.length === 0 ? 'OK' : 'VIOLATED: ' + bad[0]}
grid        ${g.grid.count} indexed, ${CONFIG.grid.cellM} m cells

player      ${d.player.x.toFixed(2)}, ${d.player.y.toFixed(2)}
held        ${held}
target      ${target}
bounds      ${this.renderer.showBounds ? 'ON' : 'off'} (B)    grid ${this.renderer.showGrid ? 'ON' : 'off'} (G)

recent events
${evts}

pending: flight timers (M3) - carts (M2)
         spawn bag / force departure (M3)`;
  }

  destroy() { window.removeEventListener('keydown', this._onKey); this.el.remove(); }
}
