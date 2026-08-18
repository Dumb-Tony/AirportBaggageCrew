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
import { ScannerCard } from './scannerCard.js';

const key = (k) => `<kbd>${k}</kbd>`;

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

      <div class="hud-bottom" id="hudBottom">
        <div class="held" id="hudHeld"></div>
        <div class="prompt" id="hudPrompt"></div>
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
      bottom: $('hudBottom'), held: $('hudHeld'), prompt: $('hudPrompt'),
      title: $('screenTitle'), pause: $('screenPause'),
    };
    this.scannerCard = new ScannerCard(this.root);

    // onStart is set by the bootstrap so a restart can also snap the camera. Falling
    // back to game.startShift() keeps the HUD usable when constructed on its own.
    const start = () => (this.onStart ? this.onStart() : this.game.startShift());
    $('btnStart').onclick   = start;
    $('btnResume').onclick  = () => this.game.setMode(MODES.PLAYING);
    $('btnRestart').onclick = start;
    $('btnQuit').onclick    = () => { this.game.reset(); this.game.setMode(MODES.TITLE); };

    this.el.total.textContent = GameClock.formatMs(this.game.state.shift.endTimeMs);
  }

  /** The single funnel: which screen is up is a function of mode, nothing else. */
  _applyMode() {
    const m = this.game.state.mode;
    this.el.title.classList.toggle('on', m === MODES.TITLE);
    this.el.pause.classList.toggle('on', m === MODES.PAUSED);
    this.el.top.classList.toggle('on', m === MODES.PLAYING || m === MODES.PAUSED);
    this.el.bottom.classList.toggle('on', m === MODES.PLAYING);
  }

  /** Called once per rendered frame. Everything below is diffed against what is already
   *  on screen and only written when it changed — GDD §24.2 forbids rebuilding panels
   *  every frame, and this runs at 60 Hz next to a canvas that needs the budget. */
  update() {
    const state = this.game.state;

    const t = GameClock.formatMs(state.simTimeMs);
    if (t !== this._lastTime) { this.el.time.textContent = t; this._lastTime = t; }

    /* held-object indicator — GDD §16.1 "what am I holding?" */
    const held = state.player.carryingBagId ? state.bagsById[state.player.carryingBagId] : null;
    const heldKey = held ? `${held.id}|${held.priority}|${held.weightClass}` : '';
    if (heldKey !== this._lastHeld) {
      this._lastHeld = heldKey;
      if (held) {
        this.el.held.className = 'held on';
        this.el.held.innerHTML =
          `<span class="chip" style="background:${held.appearance.tagColor}"></span>` +
          `<b>${held.destinationCode}</b> <span class="tagno">${held.tag}</span>` +
          (held.priority ? ' <span class="pri">PRIORITY</span>' : '') +
          (held.weightClass === 'heavy' ? ' <span class="hvy">HEAVY</span>' : '');
      } else {
        this.el.held.className = 'held';
        this.el.held.innerHTML = '';
      }
    }

    /* contextual prompt — GDD §16.2, §16.5: hint at the moment, never a modal */
    const target = state.player.targetBagId;
    const promptKey = `${held ? 'h' : ''}${target ? 't' : ''}`;
    if (promptKey !== this._lastPrompt) {
      this._lastPrompt = promptKey;
      let html = '';
      if (held) html = key('E') + ' Put down   ' + key('Space') + ' Hold to throw   ' + key('Q') + ' Scan';
      else if (target) html = key('E') + ' Pick up   ' + key('Q') + ' Scan';
      this.el.prompt.innerHTML = html;
      this.el.prompt.classList.toggle('on', html !== '');
    }

    this.scannerCard.update(state);
  }

  destroy() {
    if (this._unsub) this._unsub();
    this.scannerCard.destroy();
    this.root.innerHTML = '';
  }
}
