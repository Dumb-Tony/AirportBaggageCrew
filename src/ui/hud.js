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
import { FlightBoard } from './flightBoard.js';
import { ShiftReport } from './shiftReport.js';
import { SettingsPanel } from './settings.js';
import { visibleAnnouncements } from '../systems/announcements.js';
import { verdictFor } from '../systems/scoring.js';
import { FLIGHT_DEFS } from '../data/flights.js';

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
        <div class="hud-score" id="hudScore"></div>
        <div class="hud-slot" id="hudBoardSlot"></div>
      </div>

      <div class="toasts" id="hudToasts" role="status" aria-live="polite"></div>

      <div class="guide" id="hudGuide" role="status" aria-live="polite"></div>

      <div class="hud-bottom" id="hudBottom">
        <div class="held" id="hudHeld"></div>
        <div class="prompt" id="hudPrompt"></div>
      </div>

      <div class="screen" id="screenTitle">
        <div class="card">
          <h1>Airport Baggage Crew</h1>
          <p class="tag">Simple physical work, hilarious logistical panic.</p>
          <p class="milestone" id="titleMilestone">Milestone 6 &mdash; balance and hardening</p>
          <button class="primary" id="btnStart">Start shift</button>
          <button id="btnTitleSettings">Settings</button>
          <p class="hint"><kbd>WASD</kbd> move &middot; <kbd>E</kbd> grab, load, hitch &middot;
             <kbd>F</kbd> drive, placard &middot; <kbd>Space</kbd> throw &middot;
             <kbd>Q</kbd> scan &middot; <kbd>X</kbd> unstick &middot; <kbd>Esc</kbd> pause</p>
          <p class="scope" id="titleScope">Sort off the belt into the marked carts, haul
             them to the gate, and get them in the hold before it closes.
             <b>The aircraft leave on the clock whether you are ready or not</b>
             &mdash; and afterwards they tell you exactly what you managed.</p>
        </div>
      </div>

      <div class="screen" id="screenPause">
        <div class="card">
          <h2>Paused</h2>
          <p class="tag">Simulation clock stopped. Nothing is moving.</p>
          <button class="primary" id="btnResume">Resume</button>
          <button id="btnRestart">Restart shift</button>
          <button id="btnSettings">Settings</button>
          <button id="btnQuit">Back to title</button>
        </div>
      </div>
    `;

    const $ = (id) => this.root.querySelector('#' + id);
    this.el = {
      top: $('hudTop'), time: $('hudTime'), total: $('hudTotal'),
      bottom: $('hudBottom'), held: $('hudHeld'), prompt: $('hudPrompt'),
      boardSlot: $('hudBoardSlot'), toasts: $('hudToasts'), score: $('hudScore'),
      guide: $('hudGuide'),
      title: $('screenTitle'), pause: $('screenPause'),
    };
    this.scannerCard = new ScannerCard(this.root);
    this.board = new FlightBoard(this.el.boardSlot);
    this.report = new ShiftReport(this.root, this.game);
    this.settings = new SettingsPanel(this.root, this.game);

    // onStart is set by the bootstrap so a restart can also snap the camera. Falling
    // back to game.startShift() keeps the HUD usable when constructed on its own.
    const start = () => (this.onStart ? this.onStart() : this.game.startShift());
    $('btnStart').onclick   = start;
    $('btnResume').onclick  = () => this.game.setMode(MODES.PLAYING);
    $('btnRestart').onclick = start;
    $('btnQuit').onclick    = () => { this.game.reset(); this.game.setMode(MODES.TITLE); };
    $('btnSettings').onclick      = () => this.settings.show();
    $('btnTitleSettings').onclick = () => this.settings.show();

    this.el.total.textContent = GameClock.formatMs(this.game.state.shift.endTimeMs);

    this.el.scope = $('titleScope');
    this.el.scopeTail = this.el.scope ? this.el.scope.innerHTML : '';
  }

  /** The single funnel: which screen is up is a function of mode, nothing else. */
  _applyMode() {
    const m = this.game.state.mode;
    // An open settings panel is an 86%-opaque overlay. R restarts from the pause screen
    // WITHOUT closing it, so the shift came back with the belt feeding and the clock
    // running behind a blurred sheet, and Escape only got your view back. This funnel is
    // the one place every mode change passes through, so it is the one place to fix it.
    if (m !== MODES.TITLE && m !== MODES.PAUSED && this.settings && this.settings.open) {
      this.settings.hide();
    }
    this.el.title.classList.toggle('on', m === MODES.TITLE);
    this.el.pause.classList.toggle('on', m === MODES.PAUSED);
    this.el.top.classList.toggle('on',
      m === MODES.PLAYING || m === MODES.PAUSED || m === MODES.REPORT);
    this.el.bottom.classList.toggle('on', m === MODES.PLAYING);
  }

  /** Called once per rendered frame. Everything below is diffed against what is already
   *  on screen and only written when it changed — GDD §24.2 forbids rebuilding panels
   *  every frame, and this runs at 60 Hz next to a canvas that needs the budget. */
  update() {
    const state = this.game.state;

    const t = GameClock.formatMs(state.simTimeMs);
    if (t !== this._lastTime) { this.el.time.textContent = t; this._lastTime = t; }

    const total = GameClock.formatMs(state.shift.endTimeMs);
    if (total !== this._lastTotal) { this.el.total.textContent = total; this._lastTotal = total; }

    /* The shift the title card describes is DERIVED, never typed. It read "fifty bags,
       eight minutes" for a whole milestone after the balance pass made it thirty-four and
       eleven and a half — on the first screen anybody sees.

       Recomputed HERE rather than once in the constructor, because the schedule-pressure
       assist changes both numbers and can be changed from the title card itself: a value
       snapshotted at boot disagreed with the shift clock a few pixels away. Diffed like
       every other panel, and read off the live timetable rather than FLIGHT_DEFS, which
       is the authored shift and not necessarily the one about to be played. */
    const scopeKey = `${Object.keys(state.flightsById).length}|${state.shift.bagSchedule.length}|${total}`;
    if (this.el.scope && scopeKey !== this._lastScope) {
      this._lastScope = scopeKey;
      const nf = Object.keys(state.flightsById).length || FLIGHT_DEFS.length;
      const nb = state.shift.bagSchedule.length ||
                 FLIGHT_DEFS.reduce((n, f) => n + f.bagCount, 0);
      this.el.scope.innerHTML =
        `<b>${nf} flights, ${nb} bags, ${total}.</b> ` + this.el.scopeTail;
    }

    /* Running score. GDD §11.1: keep the HUD operational and do NOT turn the screen
       into an arcade combo counter, so this is one small figure that moves only when a
       flight departs — not a number that ticks on every bag. */
    const pts = state.score.points;
    if (pts !== this._lastPoints) {
      this._lastPoints = pts;
      this.el.score.className = 'hud-score' + (pts < 0 ? ' bad' : '') + (pts !== 0 ? ' on' : '');
      this.el.score.textContent = pts === 0 ? '' : `${pts > 0 ? '+' : ''}${pts}`;
    }

    this.report.update(state, state.report ? verdictFor(state.report) : '');

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
    const p = state.player;
    const cart = p.targetCartId ? state.cartsById[p.targetCartId] : null;
    const inCart = held && cart && cart.bagIds.length < cart.capacitySlots;
    const train = p.drivingId
      ? (state.vehiclesById[p.drivingId] || {}).nextCartId ? this._trainLength(state) : 0
      : 0;

    const atHold = !!p.targetHoldId;
    const holdOpen = p.targetHoldOpen;

    const promptKey = [
      p.drivingId ? 'd' + train : '', held ? 'h' : '', inCart ? 'c' : '',
      cart ? 'C' + cart.bagIds.length : '', p.targetBagId ? 't' : '', p.targetVehicleId ? 'v' : '',
      atHold ? (holdOpen ? 'Ho' : 'Hx') : '',
    ].join('');

    if (promptKey !== this._lastPrompt) {
      this._lastPrompt = promptKey;
      let html = '';
      if (p.drivingId) {
        html = key('E') + (train ? ' Hitch / Unhitch' : ' Hitch cart') +
               '   ' + key('F') + ' Get out' +
               (train ? `   <span class="dim">towing ${train}</span>` : '');
      } else if (held && atHold) {
        // Standing in the hold volume is the one place the game says NO — and it says
        // why, rather than going quiet (GDD §5.3).
        html = holdOpen
          ? key('E') + ' Load into hold   ' + key('Q') + ' Scan'
          : key('E') + ' Put down   <span class="warn">hold is closed</span>';
      } else if (held) {
        html = key('E') + (inCart ? ' Load into cart' : ' Put down') +
               '   ' + key('Space') + ' Hold to throw   ' + key('Q') + ' Scan';
      } else if (atHold && holdOpen) {
        html = key('E') + ' Take back off the aircraft   ' + key('Q') + ' Scan';
      } else if (p.targetBagId || (cart && cart.bagIds.length)) {
        html = key('E') + (p.targetBagId ? ' Pick up' : ' Take from cart') +
               '   ' + key('Q') + ' Scan' +
               (cart ? '   ' + key('F') + ' Set placard' : '');
      } else if (p.targetVehicleId) {
        html = key('F') + ' Drive';
      } else if (cart) {
        html = key('F') + ' Set placard';
      }
      this.el.prompt.innerHTML = html;
      this.el.prompt.classList.toggle('on', html !== '');
    }

    this.board.update(state);
    this.scannerCard.update(state);

    /* The first-minute rail — GDD §16.5. `state.guide` is null the moment the chain is
       finished or the setting is off, so the rail removes itself and never becomes
       furniture. The step number is shown because "3 of 7" is the difference between a
       nag and a visibly ending sequence. */
    const g = state.guide;
    const guideKey = g ? `${g.id}|${g.hint ? 1 : 0}` : '';
    if (guideKey !== this._lastGuide) {
      this._lastGuide = guideKey;
      this.el.guide.innerHTML = g
        ? `<div class="guide-card"><span class="guide-n">${g.n}/${g.of}</span>` +
          `<span class="guide-t">${g.text}</span>` +
          (g.hint ? `<span class="guide-h">${g.hint}</span>` : '') + '</div>'
        : '';
      this.el.guide.classList.toggle('on', !!g);
    }

    /* announcement toasts — GDD §5.3 channel two, and until Milestone 5 brings audio
       they are the ONLY way an escalation reaches a player looking at the ramp. */
    const live = visibleAnnouncements(state, state.simTimeMs);
    const toastKey = live.map((a) => a.id).join(',');
    if (toastKey !== this._lastToasts) {
      this._lastToasts = toastKey;
      this.el.toasts.innerHTML = live
        .map((a) => `<div class="toast ${a.tone}">${a.text}</div>`).join('');
      this.el.toasts.classList.toggle('on', live.length > 0);
    }
  }

  /** How many carts the player is towing. Walks the chain rather than caching a count,
   *  because the chain is the truth and a cached count is one more thing to drift. */
  _trainLength(state) {
    const v = state.vehiclesById[state.player.drivingId];
    if (!v) return 0;
    let n = 0, id = v.nextCartId;
    while (id && n < 16) { const c = state.cartsById[id]; if (!c) break; n++; id = c.nextCartId; }
    return n;
  }

  destroy() {
    if (this._unsub) this._unsub();
    this.scannerCard.destroy();
    this.board.destroy();
    this.report.destroy();
    this.settings.destroy();
    this.root.innerHTML = '';
  }
}
