/* The shift report — GDD §11.2, §11.3, §20.2, §29.
 *
 * "Receive an operational report: service, accuracy, damage, revenue, penalties, and
 * memorable odd statistics." Revenue and penalties are campaign-layer and out of Phase 1
 * scope, so this reports service and accuracy, then two to four odd facts.
 *
 * It READS a report that scoring built; it computes nothing. GDD §31.3: no scoring logic
 * in UI code, and that includes "just totalling these two numbers for display".
 *
 * Tone matters here. GDD §10.4 wants a messy shift to still feel survivable and §3.2
 * keeps the game affectionate toward its crew, so the verdict line is never a scolding.
 */

import { GameClock } from '../core/clock.js';

export class ShiftReport {
  constructor(root, game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.className = 'screen report';
    root.appendChild(this.el);
    this._shown = null;
  }

  /** @param {object} state  read-only */
  update(state, verdict) {
    const r = state.report;
    const on = state.mode === 'report' && !!r;
    this.el.classList.toggle('on', on);
    if (!on) { this._shown = null; return; }
    if (this._shown === r) return;            // built once; it cannot change
    this._shown = r;

    const rows = r.lines.map((l) => `
      <tr class="${l.perfect ? 'perfect' : ''}">
        <td class="r-num">${l.number}</td>
        <td class="r-dest">${l.destinationCode}</td>
        <td class="r-n">${l.correct}<span class="r-of">/${l.expected}</span></td>
        <td class="r-n ${l.misrouted ? 'bad' : 'nil'}">${l.misrouted || '—'}</td>
        <td class="r-n ${l.missed ? 'bad' : 'nil'}">${l.missed || '—'}</td>
        <td class="r-pts ${l.points < 0 ? 'bad' : ''}">${l.points > 0 ? '+' : ''}${l.points}</td>
      </tr>`).join('');

    const odd = r.oddities.map((o) =>
      `<div class="odd"><span class="odd-l">${o.label}</span><span class="odd-v">${o.value}</span></div>`
    ).join('');

    const best = r.best
      ? (r.improved
          ? `<div class="best new">A new best — ${r.points} points</div>`
          : `<div class="best">Best so far: ${r.best.points} points · ${r.best.onTimePercent}% on time</div>`)
      : '';

    this.el.innerHTML = `
      <div class="card report-card">
        <h2>Shift report</h2>
        <p class="tag">${verdict}</p>

        <div class="headline">
          <div class="hl"><span class="hl-v">${r.onTimePercent}%</span><span class="hl-l">on-time baggage</span></div>
          <div class="hl"><span class="hl-v">${r.correct}<span class="hl-of">/${r.bagsExpected}</span></span><span class="hl-l">bags delivered</span></div>
          <div class="hl"><span class="hl-v ${r.points < 0 ? 'bad' : ''}">${r.points}</span><span class="hl-l">points</span></div>
        </div>

        <table class="r-table">
          <thead><tr>
            <th>Flight</th><th>To</th><th>Loaded</th><th>Wrong</th><th>Missed</th><th>Points</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>

        <div class="r-meta">
          ${r.flightsHandled} flights handled · ${r.flightsPerfect} perfect ·
          ${r.mishandled} mishandled · ${r.wrongDestination} to the wrong city ·
          ${r.priorityMissed} priority bag${r.priorityMissed === 1 ? '' : 's'} missed ·
          shift ${GameClock.formatMs(r.durationMs)} · seed ${r.seed}
        </div>

        <div class="oddities">${odd}</div>
        ${best}

        <button class="primary" id="btnReplay">Run it again</button>
        <button id="btnReportTitle">Back to title</button>
      </div>`;

    const replay = this.el.querySelector('#btnReplay');
    const title = this.el.querySelector('#btnReportTitle');
    if (replay) replay.onclick = () => (this.onReplay ? this.onReplay() : this.game.startShift());
    if (title) title.onclick = () => { this.game.reset(); this.game.setMode('title'); };
  }

  destroy() { this.el.remove(); }
}
