/* HUD — DOM/CSS panels over the canvas. GDD §16, §21.1.
 *
 * The HUD OBSERVES game state (Game.subscribe) and reads the clock. It never computes a
 * rule: no scoring, no flight timing, no schedule logic (GDD §31.3). Every panel below
 * is driven by `mode` alone, through one funnel — `_applyMode` — so a screen can never
 * be visible while the simulation it belongs to is in a different state.
 *
 * Milestone 0 ships the shell only: title, pause, shift clock. The flight board, scanner
 * card, held-object indicator and shift report land with M3/M1/M4 respectively.
 */

import { MODES } from '../game.js';
import { GameClock } from '../core/clock.js';

export class Hud {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.el = {};
    this._build();
    this._unsub = game.subscribe(() => this._applyMode());
    this._applyMode();
  }

  _build() {
    this.root.innerHTML = `
      <div class="hud-top" id="hudTop">
        <div class="hud-clock"><span class="hud-label">SHIFT</span>
          <span id="hudTime" class="hud-time">0:00</span>
          <span class="hud-sep">/</span>
          <span id="hudTotal" class="hud-total">10:00</span>
        </div>
        <div class="hud-slot" id="hudBoardSlot">
          <span class="hud-pending">FLIGHT BOARD &mdash; MILESTONE 3</span>
        </div>
      </div>

      <div class="screen" id="screenTitle">
        <div class="card">
          <h1>Airport Baggage Crew</h1>
          <p class="tag">Simple physical work, hilarious logistical panic.</p>
          <p class="milestone">Milestone 0 &mdash; skeleton &amp; design locks</p>
          <button class="primary" id="btnStart">Start shift</button>
          <p class="hint">The airport does not wait. <kbd>Esc</kbd> pauses everything.
             <kbd>F3</kbd> opens the developer overlay.</p>
          <p class="scope">No bags, carts, tractor or flights yet &mdash; this milestone
             proves the clock, input, seeded RNG, map bounds, pause and restart.</p>
        </div>
      </div>

      <div class="screen" id="screenPause">
        <div class="card">
          <h2>Paused</h2>
          <p class="tag">Simulation clock stopped. Nothing is moving.</p>
          <button class="primary" id="btnResume">Resume</button>
          <button id="btnRestart">Restart shift</button>
          <button id="btnQuit">Back to title</button>
        </div>
      </div>
    `;

    const $ = (id) => this.root.querySelector('#' + id);
    this.el = {
      top: $('hudTop'), time: $('hudTime'), total: $('hudTotal'),
      title: $('screenTitle'), pause: $('screenPause'),
    };

    $('btnStart').onclick   = () => this.game.startShift();
    $('btnResume').onclick  = () => this.game.setMode(MODES.PLAYING);
    $('btnRestart').onclick = () => this.game.startShift();
    $('btnQuit').onclick    = () => { this.game.reset(); this.game.setMode(MODES.TITLE); };

    this.el.total.textContent = GameClock.formatMs(this.game.state.shift.endTimeMs);
  }

  /** The single funnel: which screen is up is a function of mode, nothing else. */
  _applyMode() {
    const m = this.game.state.mode;
    this.el.title.classList.toggle('on', m === MODES.TITLE);
    this.el.pause.classList.toggle('on', m === MODES.PAUSED);
    this.el.top.classList.toggle('on', m === MODES.PLAYING || m === MODES.PAUSED);
  }

  /** Called once per rendered frame. Cheap: two text writes, and only when changed
   *  (GDD §24.2 — UI updates must not rebuild panels every frame). */
  update() {
    const t = GameClock.formatMs(this.game.state.simTimeMs);
    if (t !== this._lastTime) { this.el.time.textContent = t; this._lastTime = t; }
  }

  destroy() { if (this._unsub) this._unsub(); this.root.innerHTML = ''; }
}
