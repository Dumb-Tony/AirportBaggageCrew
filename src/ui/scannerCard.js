/* The scanner result card — GDD §7.1.
 *
 * "The scanner is an optional confidence tool, not a mandatory permission key." This
 * panel only ever REPORTS. It cannot move a bag, cannot block a placement, and does not
 * appear unless the player asked for it.
 *
 * The layout follows the GDD's own example verbatim, because it is the one piece of UI
 * the document mocks up:
 *
 *     BAG 004921
 *     FLIGHT 221 · ATLANTA
 *     GATE 2 · PRIORITY
 *     DEPARTS IN 06:14
 */

import { GameClock } from '../core/clock.js';
import { flightById } from '../data/flights.js';

export class ScannerCard {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'scan-card';
    this.el.setAttribute('role', 'status');      // announced to screen readers
    this.el.setAttribute('aria-live', 'polite');
    root.appendChild(this.el);
    this._shownBagId = null;
    this._shownAt = -1;
  }

  /** @param {object} state  read-only */
  update(state) {
    const scan = state.scan;
    if (!scan) {
      if (this._shownBagId !== null) { this.el.classList.remove('on'); this._shownBagId = null; }
      return;
    }
    const bag = state.bagsById[scan.bagId];
    if (!bag) return;

    // Rebuild only when the scan changes; the countdown line is refreshed every call.
    if (scan.bagId !== this._shownBagId || scan.atMs !== this._shownAt) {
      this._shownBagId = scan.bagId;
      this._shownAt = scan.atMs;
      // The rebuild below creates a fresh countdown node reading "--:--", so the diff has
      // to forget what the OLD node said. Scan twice inside one second and the formatted
      // string is unchanged, the write is skipped, and the card sits on the placeholder.
      this._lastCountdown = null;
      // The LIVE flight, not the static def. The difficulty assist stretches every
      // window at one place (createFlights -> scaleTimes) and writes the result into
      // state.flightsById; anything reading FLIGHT_DEFS instead is reading the shift the
      // player did NOT choose. On Unhurried this card counted down to a departure five
      // minutes before the real one and then sat on 0:00 while the hold was still open,
      // disagreeing with the board on the same screen — exactly the duplicated
      // flight-time rule GDD §31.3 forbids.
      const flight = state.flightsById[bag.flightId] || flightById(bag.flightId);
      const gateNo = bag.gateId.replace('gate_', '');

      this.el.className = 'scan-card on ' + scan.verdict;
      this.el.innerHTML = `
        <div class="scan-row scan-bag">BAG ${bag.tag}</div>
        <div class="scan-row">FLIGHT ${flight.number} <span class="dot">·</span> ${flight.destinationName.toUpperCase()}</div>
        <div class="scan-row">GATE ${gateNo}${bag.priority ? ' <span class="dot">·</span> <b>PRIORITY</b>' : ''}${bag.weightClass === 'heavy' ? ' <span class="dot">·</span> HEAVY' : ''}</div>
        <div class="scan-row scan-clock">DEPARTS IN <span id="scanCountdown">--:--</span></div>
        <div class="scan-verdict">${VERDICT_TEXT[scan.verdict]}</div>
      `;
      this._countdown = this.el.querySelector('#scanCountdown');
    }

    if (this._countdown) {
      const live = state.flightsById[bag.flightId];
      const departsMs = live ? live.times.departureMs : bag.expectedDepartureMs;
      const left = Math.max(0, departsMs - state.simTimeMs);
      // Diffed like every other panel. formatMs floors to whole seconds, so this wrote
      // the SAME string 59 frames out of 60 — and every write dirties layout, which the
      // next frame's getBoundingClientRect then has to flush synchronously (GDD §24.2).
      const txt = GameClock.formatMs(left);
      if (txt !== this._lastCountdown) {
        this._countdown.textContent = txt;
        this._lastCountdown = txt;
      }
    }
  }

  destroy() { this.el.remove(); }
}

/* Text, not just colour — GDD §7.2 and §16.3 both forbid colour as the only channel. */
const VERDICT_TEXT = {
  neutral: 'TAG READ',
  correct: '✓ RIGHT STAGING PAD',
  wrong:   '✕ WRONG STAGING PAD',
};
