/* Persistence — GDD §23.1.
 *
 * Phase 1 stores four things and no more: settings, the onboarding flag, the best shift
 * report, and the last seed. GDD §23.1 is explicit that there are NO mid-shift saves in
 * Phase 1, so there is no serialisation of bags, carts or flights here and there should
 * not be one until the campaign arrives.
 *
 * Shape copied from TheBenefactors\src\engine\save-system.js (Dev\INDEX.md → "Save /
 * persistence"), keeping the class name so the lineage stays greppable: injectable
 * storage, a versioned key, and a parse that returns null rather than throwing. Dropped
 * from it: slots, migrations and whole-state snapshots — this stores one small record,
 * and inheriting a save graph it does not need would be the wrong kind of reuse.
 */

export const BEST_KEY = 'airport-baggage-crew.best.v1';
export const SETTINGS_KEY = 'airport-baggage-crew.settings.v1';
// GDD §23.1 names three things localStorage is for, and this was the missing one. Without
// it a player who has already worked a whole shift is walked through the seven-step rail
// again on the next one, because `resetGuide` zeroes the runtime flag at every start.
export const ONBOARDED_KEY = 'airport-baggage-crew.onboarded.v1';
export const SCHEMA_VERSION = 1;

export class SaveSystem {
  /** @param storage anything with getItem/setItem/removeItem; injectable so the suite
   *  can run against a fake and never touch the real browser store. */
  constructor(storage = safeLocalStorage()) {
    this.storage = storage;
  }

  /* ── best shift ───────────────────────────────────────────────────────── */

  loadBest() {
    const raw = this._get(BEST_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      // A record from a future version is not guessed at — it is ignored.
      if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) return null;
      if (typeof parsed.points !== 'number') return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Keep the better of the two. Returns {record, improved}.
   * Points decide it; on-time percentage breaks a tie.
   */
  saveBest(report) {
    const prev = this.loadBest();
    const next = {
      schemaVersion: SCHEMA_VERSION,
      points: report.points,
      onTimePercent: report.onTimePercent,
      correct: report.correct,
      bagsExpected: report.bagsExpected,
      flightsPerfect: report.flightsPerfect,
      seed: report.seed,
      shiftId: report.shiftId,
    };
    const improved = !prev ||
      next.points > prev.points ||
      (next.points === prev.points && next.onTimePercent > prev.onTimePercent);

    if (improved) this._set(BEST_KEY, JSON.stringify(next));
    return { record: improved ? next : prev, improved };
  }

  clearBest() { this._remove(BEST_KEY); }

  /* ── onboarding (GDD §23.1) ──────────────────────────────────── */

  loadOnboarded() { return this._get(ONBOARDED_KEY) === '1'; }
  setOnboarded()  { this._set(ONBOARDED_KEY, '1'); }
  clearOnboarded(){ this._remove(ONBOARDED_KEY); }

  /* ── settings ─────────────────────────────────────────────────────────── */

  loadSettings() {
    const raw = this._get(SETTINGS_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && parsed.schemaVersion === SCHEMA_VERSION ? parsed : null;
    } catch {
      return null;
    }
  }

  saveSettings(settings) {
    const record = { schemaVersion: SCHEMA_VERSION, ...settings };
    this._set(SETTINGS_KEY, JSON.stringify(record));
    return record;
  }

  /* ── storage, defensively ─────────────────────────────────────────────── */
  // Private browsing and disabled storage both throw on access rather than returning
  // null, so every call is guarded. Losing a high score must never break a shift.

  _get(k)    { try { return this.storage ? this.storage.getItem(k) : null; } catch { return null; } }
  _set(k, v) { try { if (this.storage) this.storage.setItem(k, v); } catch { /* ignore */ } }
  _remove(k) { try { if (this.storage) this.storage.removeItem(k); } catch { /* ignore */ } }
}

function safeLocalStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

/** An in-memory stand-in, for tests and for browsers that refuse storage. */
export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}
