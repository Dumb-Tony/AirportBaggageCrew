/* Announcements — GDD §18.3, §5.3.
 *
 * "Use concise synthetic/recorded-style airport announcements. Avoid a huge voice
 * pipeline in Phase 1; text plus simple generated placeholder sounds are sufficient."
 * The sound is Milestone 5, so these are text toasts — and they have to work as the only
 * channel until then, which is why the copy always says what happened in words rather
 * than relying on the colour (GDD §5.3, §16.3).
 *
 * The list is BOUNDED (GDD §24.1). A ten-minute shift announces perhaps thirty times,
 * but nothing here may grow without a ceiling.
 */

import { CONFIG } from '../config.js';

let _seq = 0;

/** Reset the id counter so a restart replays identical announcement ids. */
export function resetAnnouncements() { _seq = 0; }

/**
 * @param {string} text
 * @param {'info'|'good'|'urgent'|'bad'} tone  drives colour only; the text stands alone
 */
export function announce(state, text, tone, simTimeMs, bus = null) {
  const a = { id: `ann_${++_seq}`, text, tone, atMs: simTimeMs };
  state.announcements.push(a);
  while (state.announcements.length > CONFIG.announce.logSize) state.announcements.shift();
  void bus;
  return a;
}

/** The ones a player should currently be able to read. */
export function visibleAnnouncements(state, simTimeMs) {
  const out = [];
  for (let i = state.announcements.length - 1; i >= 0; i--) {
    const a = state.announcements[i];
    if (simTimeMs - a.atMs > CONFIG.announce.toastMs) break;   // list is time-ordered
    out.push(a);
    if (out.length >= CONFIG.announce.maxVisible) break;
  }
  return out;
}
