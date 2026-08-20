/* The flight board — GDD §16.2, §16.3, §5.3.
 *
 * "Urgency must be visible in at least three ways: flight board colour/status; audio
 * announcements and escalating cues; local feedback at the gate/aircraft. Never require
 * the player to memorise an invisible timer."
 *
 * This is channel one. Channel two is the announcement toasts; channel three is the
 * aircraft itself, whose hold door and stand markings change with the same state. Audio
 * arrives at Milestone 5 and will be a fourth, not a replacement.
 *
 * GDD §16.3 is explicit that colour is never sufficient on its own, so every row spells
 * out the status in words AND carries a countdown AND a loaded-of-expected count. Turn
 * the colours off entirely and the board still says everything.
 */

import { CONFIG } from '../config.js';
import { GameClock } from '../core/clock.js';
import { msToNext } from '../systems/flightSchedule.js';

/** GDD §16.3, plus the label the row prints next to it. */
/* GDD §16.3: "colour must be reinforced by TEXT AND ICONS". The row already carried the
 * words; the third channel — the same icon drawn on every bag in the world — was the one
 * missing, so a colourblind player matching a board row to a tag had two channels on the
 * bag and one on the board. */
const ICON = { triangle: '▲', square: '■', circle: '●' };

/*
 * The four rungs GDD §16.3 asks for, in its own words: "green: loading with adequate
 * time; amber: approaching final bag call; red/pulsing: final bag call/hold closing;
 * gray: departed."
 *
 * The ladder used to sit one state late — final bag call, the LAST moment you can still
 * act, read amber, and red arrived only once the hold had shut and there was nothing to
 * be done. Alarm belongs on the actionable state.
 *
 * The amber rung is not a flight state at all but a state plus a clock: LOADING with the
 * countdown inside `urgentMs`. That is what "approaching final bag call" means, and it is
 * why the class is chosen per row below rather than looked up here.
 */
const STATUS = {
  SCHEDULED:      { cls: 'st-scheduled', text: 'SCHEDULED' },
  BAG_ACCEPTANCE: { cls: 'st-accept',    text: 'ACCEPTING BAGS' },
  LOADING:        { cls: 'st-loading',   text: 'LOADING' },
  FINAL_BAG_CALL: { cls: 'st-closing',   text: 'FINAL BAG CALL' },
  HOLD_CLOSING:   { cls: 'st-closing',   text: 'HOLD CLOSED' },
  PUSHBACK:       { cls: 'st-departed',  text: 'PUSHING BACK' },
  DEPARTED:       { cls: 'st-departed',  text: 'DEPARTED' },
};

export class FlightBoard {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'board';
    this.el.setAttribute('aria-label', 'Flight board');
    root.appendChild(this.el);
    this._sig = '';
  }

  update(state) {
    const flights = Object.values(state.flightsById);
    if (!flights.length) { this.el.classList.remove('on'); return; }
    this.el.classList.add('on');

    // Departed flights sink to the bottom; everything else sorts by how soon it needs
    // attention, so the top row is always the one that matters most.
    const rows = flights
      .map((f) => ({ f, left: msToNext(f.times, state.simTimeMs) }))
      .sort((a, b) => {
        const ad = a.f.state === 'DEPARTED' ? 1 : 0;
        const bd = b.f.state === 'DEPARTED' ? 1 : 0;
        if (ad !== bd) return ad - bd;
        return a.f.times.departureMs - b.f.times.departureMs;
      })
      .slice(0, CONFIG.flight.boardSlots);

    // Rebuild only when something a player could see has changed — this runs at 60 Hz
    // beside a canvas that needs the budget (GDD §24.2).
    const sig = rows.map((r) =>
      `${r.f.id}:${r.f.state}:${Math.floor(r.left / 1000)}:${r.f.loadedBagIds.length}`).join('|');
    if (sig === this._sig) return;
    this._sig = sig;

    this.el.innerHTML = rows.map(({ f, left }) => {
      const s = STATUS[f.state] || STATUS.SCHEDULED;
      const gate = f.gateId.replace('gate_', '');
      const urgent = left <= CONFIG.flight.urgentMs &&
                     (f.state === 'FINAL_BAG_CALL' || f.state === 'LOADING');
      // "Approaching final bag call" is the amber rung: still loading, but the clock has
      // run down. Without it the board jumps green straight to red and the warning the
      // player is supposed to act on never appears.
      const cls = (f.state === 'LOADING' && urgent) ? 'st-final' : s.cls;
      const aboard = f.loadedBagIds.length;

      const tail = f.evaluated
        ? `<span class="b-done">${f.outcome.correct}/${f.expectedCount} away` +
          (f.outcome.misrouted ? ` · ${f.outcome.misrouted} stray` : '') + `</span>`
        : `<span class="b-count">${aboard}<span class="b-of">/${f.expectedCount}</span></span>` +
          `<span class="b-clock${urgent ? ' urgent' : ''}">${GameClock.formatMs(left)}</span>`;

      return `<div class="b-row ${cls}${urgent ? ' pulse' : ''}">
        <span class="b-chip" style="background:${f.tag.color}">${ICON[f.tag.icon] || ''}</span>
        <span class="b-num">${f.number}</span>
        <span class="b-dest">${f.destinationCode}</span>
        <span class="b-gate">G${gate}</span>
        <span class="b-state">${s.text}</span>
        ${tail}
      </div>`;
    }).join('');
  }

  destroy() { this.el.remove(); }
}
