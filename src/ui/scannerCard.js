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
      const flight = flightById(bag.flightId);
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
      const left = Math.max(0, bag.expectedDepartureMs - state.simTimeMs);
      this._countdown.textContent = GameClock.formatMs(left);
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
