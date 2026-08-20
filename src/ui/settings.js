/* Settings — GDD §16.6 accessibility basics.
 *
 * The section asks for eight things. Four were already true by construction and are
 * listed here so nobody has to rediscover it:
 *
 *   - keyboard-only operation          already: mouse aim is optional, movement aims too
 *   - colourblind-safe symbols/codes   already: a tag is code + colour + icon (§7.2)
 *   - visual equivalents for audio     already: board, toasts and hold door carry it all
 *   - remappable keys                  §16.6 scopes these to "the full product", and the
 *                                      binding table is already data (core/input.js), so
 *                                      it is a UI away rather than a rewrite
 *
 * The four this panel adds: volume categories, reduced motion, text scaling, and a
 * difficulty assist that alters schedule pressure without touching the verbs.
 */

import { BUSES } from '../systems/audio.js';

export const DEFAULT_SETTINGS = {
  master: 0.8,
  sfx: 0.9,
  ambience: 0.5,
  muted: false,
  reducedMotion: false,
  textScale: 1,
  guide: true,
  // GDD §16.6: "difficulty assists that alter schedule pressure without changing core
  // verbs". This stretches every flight's authored times; nothing about grabbing,
  // driving or loading changes, there is simply more clock to do it in.
  assist: 1,
};

/*
 * Re-proportioned at Milestone 6. These multiply the AUTHORED shift, which the balance
 * pass lengthened from 8:07 to 11:32 — so the old 1.25 and 1.6 quietly became fourteen
 * and eighteen minute shifts, and eighteen minutes of this is not a kindness.
 *
 * An assist deliberately takes the shift past the 8-12 minutes GDD §3.3 scopes. That
 * window describes the shift AS DESIGNED; §16.6 asks for an accessibility override of it,
 * and more time is the whole substance of the override.
 */
export const ASSIST_LEVELS = [
  { v: 1,    label: 'Standard',  note: 'The shift as designed.' },
  { v: 1.15, label: 'Relaxed',   note: 'A sixth more time on every flight.' },
  { v: 1.35, label: 'Unhurried', note: 'A third again. Nothing else changes.' },
];

export class SettingsPanel {
  constructor(root, game) {
    this.game = game;
    this.el = document.createElement('div');
    this.el.className = 'screen settings';
    root.appendChild(this.el);
    this.open = false;
    this._build();
  }

  _build() {
    const s = this.game.settings;
    const vol = (id, label) => `
      <label class="set-row">
        <span class="set-l">${label}</span>
        <input type="range" id="set-${id}" min="0" max="100" value="${Math.round(s[id] * 100)}">
        <span class="set-v" id="setv-${id}">${Math.round(s[id] * 100)}</span>
      </label>`;

    this.el.innerHTML = `
      <div class="card set-card">
        <h2>Settings</h2>

        <div class="set-group"><div class="set-head">Sound</div>
          ${vol('master', 'Master')}
          ${vol('sfx', 'Effects')}
          ${vol('ambience', 'Ambience')}
          <label class="set-row set-check">
            <input type="checkbox" id="set-muted" ${s.muted ? 'checked' : ''}>
            <span>Mute everything</span>
          </label>
          <p class="set-note">Every sound in the game has a visual equivalent. Nothing is
             only audible.</p>
        </div>

        <div class="set-group"><div class="set-head">Display</div>
          <label class="set-row set-check">
            <input type="checkbox" id="set-reducedMotion" ${s.reducedMotion ? 'checked' : ''}>
            <span>Reduced motion &mdash; no dust, no flashing beacons</span>
          </label>
          <label class="set-row">
            <span class="set-l">Text size</span>
            <input type="range" id="set-textScale" min="90" max="150" step="5"
                   value="${Math.round(s.textScale * 100)}">
            <span class="set-v" id="setv-textScale">${Math.round(s.textScale * 100)}</span>
          </label>
        </div>

        <div class="set-group"><div class="set-head">Help</div>
          <label class="set-row set-check">
            <input type="checkbox" id="set-guide" ${s.guide ? 'checked' : ''}>
            <span>Show the step-by-step guide</span>
          </label>
        </div>

        <div class="set-group"><div class="set-head">Schedule pressure</div>
          <div class="set-assist" id="set-assist">
            ${ASSIST_LEVELS.map((a) => `
              <button class="assist${s.assist === a.v ? ' on' : ''}" data-v="${a.v}">
                <b>${a.label}</b><span>${a.note}</span>
              </button>`).join('')}
          </div>
          <p class="set-note">Applies to the next shift. The aircraft still leave without
             you &mdash; you simply get longer to catch them.</p>
        </div>

        <button class="primary" id="set-close">Done</button>
      </div>`;

    const on = (id, ev, fn) => {
      const el = this.el.querySelector('#set-' + id);
      if (el) el.addEventListener(ev, fn);
    };

    for (const b of BUSES) {
      on(b, 'input', (e) => {
        const v = Number(e.target.value) / 100;
        this.el.querySelector('#setv-' + b).textContent = Math.round(v * 100);
        this.game.applySettings({ [b]: v });
      });
    }
    on('muted', 'change', (e) => this.game.applySettings({ muted: e.target.checked }));
    on('reducedMotion', 'change', (e) => this.game.applySettings({ reducedMotion: e.target.checked }));
    on('textScale', 'input', (e) => {
      const v = Number(e.target.value) / 100;
      this.el.querySelector('#setv-textScale').textContent = Math.round(v * 100);
      this.game.applySettings({ textScale: v });
    });
    on('guide', 'change', (e) => this.game.applySettings({ guide: e.target.checked }));
    on('close', 'click', () => this.hide());

    this.el.querySelectorAll('.assist').forEach((b) => {
      b.addEventListener('click', () => {
        const v = Number(b.dataset.v);
        this.game.applySettings({ assist: v });
        this.el.querySelectorAll('.assist').forEach((o) => o.classList.toggle('on', o === b));
      });
    });
  }

  show() { this.open = true; this.el.classList.add('on'); }
  hide() { this.open = false; this.el.classList.remove('on'); }
  toggle() { return this.open ? this.hide() : this.show(); }
  destroy() { this.el.remove(); }
}
