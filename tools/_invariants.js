/* The invariant sweep, and the fuzzers that exercise it.
 *
 * Shared by `tools\_soak.js` (which runs it for minutes and gates nothing) and
 * `tools\m6-tests.js` section H (which runs a short version and DOES gate). One
 * implementation on purpose: a duplicated invariant check is a check that drifts, and the
 * copy that drifts is always the one guarding the thing you care about.
 *
 * `sweep()` is everything that must be true of the world after ANY step, whatever was
 * pressed. It is deliberately paranoid — it is cheap next to a step, and the whole value
 * of a fuzzer is that it looks after every single one.
 */

import { CONFIG } from '../src/config.js';
import { Game, MODES } from '../src/game.js';
import { Input } from '../src/core/input.js';
import { Rng } from '../src/core/rng.js';
import { memoryStorage } from '../src/systems/save.js';
import { assertContainment } from '../src/systems/containment.js';
import { validateChain } from '../src/systems/hitching.js';
import { BOUNDS } from '../src/data/airport.js';
import { ASSIST_LEVELS } from '../src/ui/settings.js';
import { CrewBot } from './_bot.js';

export const FRAME_MS = CONFIG.sim.stepMs;
export const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyQ', 'Space'];

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * @param {object} st  live game state
 * @param {Set<string>|null} expectedIds  every bag id ever seen, or null to skip identity
 * @returns {string[]} violations; empty means healthy
 */
export function sweep(st, expectedIds) {
  const out = [];

  const cont = assertContainment(st);
  if (cont.length) out.push(`containment: ${JSON.stringify(cont.slice(0, 2))}`);

  const chain = validateChain(st);
  if (chain.length) out.push(`hitch chain: ${JSON.stringify(chain.slice(0, 2))}`);

  const ids = Object.keys(st.bagsById);
  if (expectedIds) {
    // A shift may end with bags anywhere at all, but never with one that stopped existing
    // or one that exists twice. Identity is the invariant that outranks position.
    for (const id of expectedIds) if (!(id in st.bagsById)) out.push(`bag vanished: ${id}`);
    if (ids.length < expectedIds.size) out.push(`bag count fell: ${ids.length} < ${expectedIds.size}`);
  }

  for (const bag of Object.values(st.bagsById)) {
    if (!finite(bag.x) || !finite(bag.y) || !finite(bag.vx) || !finite(bag.vy) || !finite(bag.rot)) {
      out.push(`bag ${bag.id} not finite: ${bag.x},${bag.y} v${bag.vx},${bag.vy} r${bag.rot}`);
      break;
    }
    // Only FLOOR bags are integrated. A carted or carried one is PINNED and may sit
    // momentarily outside the bounds while the vehicle holding it is pushed out of a wall.
    if (bag.location.type === 'floor') {
      if (bag.x < BOUNDS.x - 1 || bag.x > BOUNDS.x + BOUNDS.w + 1 ||
          bag.y < BOUNDS.y - 1 || bag.y > BOUNDS.y + BOUNDS.h + 1) {
        out.push(`bag ${bag.id} escaped the airport at ${bag.x.toFixed(1)},${bag.y.toFixed(1)}`);
        break;
      }
    }
  }

  const p = st.player;
  if (!finite(p.x) || !finite(p.y)) out.push(`player not finite: ${p.x},${p.y}`);
  if (p.x < BOUNDS.x - 1 || p.x > BOUNDS.x + BOUNDS.w + 1 ||
      p.y < BOUNDS.y - 1 || p.y > BOUNDS.y + BOUNDS.h + 1) {
    out.push(`player escaped at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
  }

  for (const v of Object.values(st.vehiclesById)) {
    if (!finite(v.x) || !finite(v.y) || !finite(v.rot) || !finite(v.speed)) {
      out.push(`vehicle ${v.id} not finite`);
    }
  }
  for (const c of Object.values(st.cartsById)) {
    if (!finite(c.x) || !finite(c.y) || !finite(c.rot)) out.push(`cart ${c.id} not finite`);
    if (c.bagIds.length > c.capacitySlots) {
      out.push(`cart ${c.id} over capacity: ${c.bagIds.length}/${c.capacitySlots}`);
    }
    if (new Set(c.bagIds).size !== c.bagIds.length) out.push(`cart ${c.id} holds a duplicate`);
  }
  for (const f of Object.values(st.flightsById)) {
    if (new Set(f.loadedBagIds).size !== f.loadedBagIds.length) {
      out.push(`flight ${f.number} manifest holds a duplicate`);
    }
  }
  return out;
}

export function newSoakGame(seed) {
  return new Game({ seed, seedLabel: 'soak', storage: memoryStorage() });
}

/**
 * Random keys with HUMAN-SHAPED holds: a movement key stays down for a while, a verb is a
 * tap. Uniform per-frame coin flips produce a player who vibrates on the spot and goes
 * nowhere, which fuzzes nothing at all.
 */
export function makeMasher(rng) {
  const held = new Set();
  let nextChangeMs = 0;
  return function mash(input, tMs) {
    if (tMs < nextChangeMs) return;
    nextChangeMs = tMs + rng.range(90, 700);

    if (held.size && rng.chance(0.55)) {
      const k = [...held][rng.int(0, held.size - 1)];
      held.delete(k); input._debugRelease(k);
    }
    if (rng.chance(0.85)) {
      const k = KEYS[rng.int(0, KEYS.length - 1)];
      held.add(k); input._debugPress(k);
      // A verb is an edge, not a hold — press and let go in the same breath.
      if (k === 'KeyE' || k === 'KeyF' || k === 'KeyQ') {
        held.delete(k); input._debugRelease(k);
      }
    }
  };
}

/** One shift under pure random input. `opts.chaos` adds pause, blur, settings and jitter. */
export function fuzzShift(seed, opts = {}) {
  const g = newSoakGame(seed);
  const input = new Input(window);
  const rng = new Rng(seed ^ 0x5f3a, 'mash');
  const mash = makeMasher(rng);
  g.startShift();

  const expectedIds = new Set();
  const violations = [];
  const maxFrames = opts.frames || Math.ceil((g.state.shift.endTimeMs + 4000) / FRAME_MS);
  let threw = null;

  try {
    for (let i = 0; i < maxFrames; i++) {
      mash(input, g.state.simTimeMs);

      // CHAOS: the things a real player does that a bot never would.
      if (opts.chaos && rng.chance(0.0006)) g.togglePause();
      if (opts.chaos && rng.chance(0.0002)) g.pauseForBlur();
      if (opts.chaos && rng.chance(0.0004)) {
        g.applySettings({ assist: ASSIST_LEVELS[rng.int(0, ASSIST_LEVELS.length - 1)].v });
      }
      if (opts.chaos && rng.chance(0.0002) && g.state.mode === MODES.PAUSED) {
        g.setMode(MODES.PLAYING);
      }
      // A dropped frame, a tab suspend, a 5 fps stretch: the clock absorbs all of it.
      const dt = opts.chaos && rng.chance(0.02) ? rng.range(FRAME_MS, 400) : FRAME_MS;
      g.frame(dt, input);

      for (const id of Object.keys(g.state.bagsById)) expectedIds.add(id);
      const bad = sweep(g.state, expectedIds);
      if (bad.length) {
        violations.push({ atMs: Math.round(g.state.simTimeMs), frame: i, bad: bad.slice(0, 3) });
        if (violations.length >= 3) break;
      }
      if (g.state.shift.ended && !opts.chaos) break;
    }
  } catch (e) {
    threw = String((e && e.stack) || e);
  }

  return {
    seed, violations, threw,
    ended: g.state.shift.ended,
    simMs: Math.round(g.state.simTimeMs),
    bags: Object.keys(g.state.bagsById).length,
    expected: expectedIds.size,
    points: g.state.score.points,
    delivered: Object.values(g.state.flightsById).reduce((n, f) => n + f.outcome.correct, 0),
  };
}

/**
 * A competent crew with a hand tremor.
 *
 * Pure mashing delivers zero bags on every seed — it never walks the sixty metres to a
 * gate, so it never touches loading, hold closure, or a departure with a cart alongside,
 * which is exactly where a containment bug would live. This runs the real `CrewBot` and
 * corrupts it, so the fuzz reaches the interesting states AND does stupid things there.
 * At 1% it delivers most of a shift and misroutes a handful; at 15% it delivers nothing,
 * which is a fair description of a player that clumsy rather than a defect.
 */
export function guidedFuzz(seed, noise, opts = {}) {
  const g = newSoakGame(seed);
  const input = new Input(window);
  const rng = new Rng(seed ^ 0x77aa, 'guided');
  const bot = new CrewBot(opts.skill || 'average');
  g.startShift();

  const expectedIds = new Set();
  const violations = [];
  const maxFrames = opts.frames || Math.ceil((g.state.shift.endTimeMs + 4000) / FRAME_MS);
  let threw = null, nudges = 0;
  const stuck = new Map();          // key -> simTime at which the clumsy hand lets go

  try {
    for (let i = 0; i < maxFrames && !g.state.shift.ended; i++) {
      bot.step(g, input, FRAME_MS);

      // The nudge must RELEASE what it pressed. The bot clears only the four movement keys
      // each frame, so a stray Space stayed down for the rest of the shift — and held
      // Space is the brake, which pins the tractor at a standstill forever. That models a
      // jammed keyboard, not a clumsy player, and it swamped every other result.
      for (const [k, until] of stuck) {
        if (g.state.simTimeMs >= until) { input._debugRelease(k); stuck.delete(k); }
      }
      if (rng.chance(noise)) {
        nudges++;
        const k = KEYS[rng.int(0, KEYS.length - 1)];
        input._debugPress(k);
        stuck.set(k, g.state.simTimeMs + rng.range(60, 380));
      }
      g.frame(FRAME_MS, input);

      for (const id of Object.keys(g.state.bagsById)) expectedIds.add(id);
      const bad = sweep(g.state, expectedIds);
      if (bad.length) {
        violations.push({ atMs: Math.round(g.state.simTimeMs), frame: i, bad: bad.slice(0, 3) });
        if (violations.length >= 3) break;
      }
    }
  } catch (e) { threw = String((e && e.stack) || e); }

  return {
    seed, violations, threw, nudges,
    simMs: Math.round(g.state.simTimeMs),
    bags: Object.keys(g.state.bagsById).length,
    delivered: Object.values(g.state.flightsById).reduce((n, f) => n + f.outcome.correct, 0),
    misrouted: Object.values(g.state.flightsById).reduce((n, f) => n + f.outcome.misrouted, 0),
    points: g.state.score.points,
  };
}

/** Restart the same game object over and over mid-shift: the reset path, hammered. */
export function restartTorture(seed, rounds) {
  const g = newSoakGame(seed);
  const input = new Input(window);
  const rng = new Rng(seed ^ 0x1234, 'restart');
  const problems = [];
  let threw = null;
  try {
    for (let r = 0; r < rounds; r++) {
      g.startShift();
      const n = Math.round(rng.range(30, 900));
      const mash = makeMasher(rng);
      for (let i = 0; i < n; i++) { mash(input, g.state.simTimeMs); g.frame(FRAME_MS, input); }
      // GDD §29: "restart resets every entity and timer cleanly". A leak shows up here as
      // state that survived the reset.
      g.startShift();
      if (g.state.simTimeMs !== 0) problems.push(`round ${r}: clock at ${g.state.simTimeMs}`);
      if (Object.keys(g.state.bagsById).length) problems.push(`round ${r}: bags survived`);
      if (g.state.score.points !== 0) problems.push(`round ${r}: score survived`);
      if (g.state.shift.ended) problems.push(`round ${r}: ended flag survived`);
      if (Object.values(g.state.cartsById).some((c) => c.bagIds.length || c.hitchedToId)) {
        problems.push(`round ${r}: a cart survived loaded or hitched`);
      }
      const bad = sweep(g.state, null);
      if (bad.length) problems.push(`round ${r}: ${bad[0]}`);
    }
  } catch (e) { threw = String((e && e.stack) || e); }
  return { problems, threw, events: g.bus.emitted, logLen: g.bus.log.length };
}
