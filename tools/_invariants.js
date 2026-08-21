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
 *
 * It also checks the SCHEDULE, which is authored once and never touched again. That is on
 * purpose: the chaos track randomises the difficulty assist, the assist is one multiplier
 * applied at two authoring sites in two different files, and the sweep is the only thing
 * that runs on the other side of every restart.
 */

import { CONFIG } from '../src/config.js';
import { Game, MODES } from '../src/game.js';
import { Input } from '../src/core/input.js';
import { Rng } from '../src/core/rng.js';
import { EVENTS } from '../src/core/eventBus.js';
import { memoryStorage } from '../src/systems/save.js';
import { assertContainment, moveBag } from '../src/systems/containment.js';
import { validateChain, hitch } from '../src/systems/hitching.js';
import { cartWeight } from '../src/entities/cart.js';
import { enterVehicle } from '../src/systems/interaction.js';
import { BOUNDS, WALLS } from '../src/data/airport.js';
import { ASSIST_LEVELS } from '../src/ui/settings.js';
import { CrewBot } from './_bot.js';

export const FRAME_MS = CONFIG.sim.stepMs;

/* Every key a player can actually press.
 *
 * `KeyX` belongs here even though it looks harmless: it is GDD §24.3's recover verb and
 * the ONE verb in the game that TELEPORTS anything — the player out of a wall, and every
 * cart on the train out of whatever it is wedged in. Left out of this list, recover was
 * exercised only by the scripted single presses in m6 section I and m7, never mid-throw,
 * mid-hitch, while carrying, or while towing a loaded cart. A teleport at a moment nobody
 * scripted is precisely the shape of bug a fuzzer exists to find.
 */
export const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyQ', 'KeyX', 'Space'];

/** The verbs are EDGES, not holds — pressed and let go in the same breath. Movement and
 *  the brake are the only keys a person keeps down. */
const TAP_KEYS = new Set(['KeyE', 'KeyF', 'KeyQ', 'KeyX']);

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const inBounds = (e, pad) => e.x >= BOUNDS.x - pad && e.x <= BOUNDS.x + BOUNDS.w + pad &&
                             e.y >= BOUNDS.y - pad && e.y <= BOUNDS.y + BOUNDS.h + pad;

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
  const schedule = st.shift.bagSchedule;

  /* IDENTITY, which outranks position: a shift may end with bags anywhere at all, but
   * never with one that stopped existing or one that exists twice.
   *
   * THE HISTORY CHECK ONLY CATCHES DELETION. `bagsById` is KEYED by id, so a duplicate key
   * is impossible by construction and looking for one proves nothing — a CLONE arrives
   * under a new id, which makes the population GROW, and `ids.length < expectedIds.size`
   * permits growth explicitly. So duplication needs a ceiling, and the timetable is the
   * only honest one: `spawnDueBags` is the single place a bag is created, one per authored
   * row, and nothing anywhere deletes one (a departed bag keeps its record with location
   * 'departed'). That makes the count checks below EQUALITIES rather than bounds, and they
   * hold with no history to compare against — which is why `restartTorture` can use them.
   */
  if (expectedIds) {
    for (const id of expectedIds) if (!(id in st.bagsById)) out.push(`bag vanished: ${id}`);
    if (ids.length < expectedIds.size) out.push(`bag count fell: ${ids.length} < ${expectedIds.size}`);
  }
  if (ids.length !== st.shift.spawned) {
    out.push(`bag count ${ids.length} disagrees with ${st.shift.spawned} spawned`);
  }
  if (st.shift.spawned > schedule.length) {
    out.push(`more bags than the timetable authored: ${st.shift.spawned} > ${schedule.length}`);
  }
  if (st.shift.nextSpawnIdx !== st.shift.spawned) {
    out.push(`spawn cursor ${st.shift.nextSpawnIdx} disagrees with ${st.shift.spawned} spawned`);
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
  if (!inBounds(p, 1)) out.push(`player escaped at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);

  /* The tractor is integrated through `moveWithWalls` and a towed cart is positioned and
   * then `pushOutOfWalls`'d — both of which end in `clampToBounds`. So neither can leave
   * the airport either, and only the bag was ever asked to prove it. The tolerance is the
   * same 1 m the bags get: the perimeter wall starts exactly at the bounds edge, so
   * anything genuinely outside is inside a wall and gets pushed back the same step. */
  for (const v of Object.values(st.vehiclesById)) {
    if (!finite(v.x) || !finite(v.y) || !finite(v.rot) || !finite(v.speed)) {
      out.push(`vehicle ${v.id} not finite`);
    } else if (!inBounds(v, 1)) {
      out.push(`vehicle ${v.id} escaped at ${v.x.toFixed(1)},${v.y.toFixed(1)}`);
    }
  }
  for (const c of Object.values(st.cartsById)) {
    if (!finite(c.x) || !finite(c.y) || !finite(c.rot)) out.push(`cart ${c.id} not finite`);
    else if (!inBounds(c, 1)) out.push(`cart ${c.id} escaped at ${c.x.toFixed(1)},${c.y.toFixed(1)}`);
    if (c.bagIds.length > c.capacitySlots) {
      out.push(`cart ${c.id} over capacity: ${c.bagIds.length}/${c.capacitySlots}`);
    }
    /* A cart has DUAL capacity — ten slots and 210 kg — and only the slots were ever
     * checked. `loadIntoCart` validates neither; it trusts its callers, and both of them
     * ask `cartRoomFor` first. That is exactly the arrangement worth an invariant: it is
     * sound today and one new caller away from not being. */
    const kg = cartWeight(c, st);
    if (kg > c.capacityWeight) {
      out.push(`cart ${c.id} overweight: ${kg.toFixed(1)}/${c.capacityWeight} kg`);
    }
    if (new Set(c.bagIds).size !== c.bagIds.length) out.push(`cart ${c.id} holds a duplicate`);
  }
  for (const f of Object.values(st.flightsById)) {
    if (new Set(f.loadedBagIds).size !== f.loadedBagIds.length) {
      out.push(`flight ${f.number} manifest holds a duplicate`);
    }
    // Evaluation is a SUBTRACTION over the timetable (`missed = expectedCount - correct`),
    // so the arithmetic closing is also a statement that no bag was invented: one cloned
    // bag delivered correctly pushes `correct` past what the flight was ever owed and the
    // sum stops closing. m3 F7 makes this claim once, at the end of one shift; here it
    // holds after every step of every fuzzed one.
    if (f.evaluated && f.outcome.correct + f.outcome.missed !== f.expectedCount) {
      out.push(`flight ${f.number}: ${f.outcome.correct} correct + ${f.outcome.missed} ` +
               `missed != ${f.expectedCount} owed`);
    }
  }

  out.push(...sweepSchedule(st, schedule));
  return out;
}

/**
 * THE SACRED SCHEDULE, checked against the timetable that feeds it.
 *
 * The assist is one multiplier applied at two authoring sites in two different files —
 * `createFlights` scales the flight windows, `buildBagSchedule` scales the bag arrivals.
 * When they drifted apart the shift was RESHAPED rather than lengthened: GDD §20.4's late
 * bags landed two minutes BEFORE final call, and SK307 fed the belt three minutes before
 * its aircraft existed. The chaos track randomised the assist and the sweep had nothing to
 * say about any of it; worse, the randomisation went in through `applySettings`, which
 * deliberately does not rewrite a running timetable, so every fuzzed shift was in fact
 * authored at Standard. `fuzzShift` now picks the level BEFORE `startShift`.
 *
 * None of these are properties of one assist level — they are what "the same shift, but
 * slower" MEANS, so each holds at every level, which is what makes them worth asserting
 * after every step rather than once at authoring time.
 *
 * Reads `state.flightsById` and never `FLIGHT_DEFS`: the authored times are the wrong
 * shift the moment an assist is in play.
 */
function sweepSchedule(st, schedule) {
  const out = [];
  if (!schedule.length) return out;
  const last = {};                 // flightId -> latest authored arrival

  for (const spec of schedule) {
    const f = st.flightsById[spec.flightId];
    if (!f) { out.push(`timetable row for unknown flight ${spec.flightId}`); break; }
    // The belt fed before the aircraft existed. This is the regression, verbatim.
    if (spec.atMs < f.times.bagAcceptanceMs) {
      out.push(`${f.number}: a bag is due at ${spec.atMs}ms, before it accepts ` +
               `baggage at ${f.times.bagAcceptanceMs}ms`);
      break;
    }
    // A bag the conveyor is asked to emit after its own aircraft has gone is a bag the
    // arithmetic owes and the world can never supply.
    if (spec.atMs > f.times.departureMs) {
      out.push(`${f.number}: a bag is due at ${spec.atMs}ms, after it departs ` +
               `at ${f.times.departureMs}ms`);
      break;
    }
    if (last[f.id] === undefined || spec.atMs > last[f.id]) last[f.id] = spec.atMs;
  }
  // A row that failed above stopped the scan, so `last` is only half built — reporting
  // "nothing arrives after final call" off a truncated pass would be noise on top of a
  // real finding.
  if (out.length) return out;

  for (const [id, atMs] of Object.entries(last)) {
    const f = st.flightsById[id];
    // §20.4's twist: every flight has late bags, and LATE means after final call — "when
    // the player has moved on". That is the half that broke, and it broke silently.
    if (atMs <= f.times.finalCallMs) {
      out.push(`${f.number}: nothing arrives after final call — last bag ${atMs}ms, ` +
               `final call ${f.times.finalCallMs}ms`);
    }
    // ...and a late bag must still be loadable when it lands, or the twist is a deletion
    // dressed up as difficulty.
    if (atMs > f.times.holdClosingMs) {
      out.push(`${f.number}: a bag arrives at ${atMs}ms, after the hold shuts ` +
               `at ${f.times.holdClosingMs}ms`);
    }
  }

  const owed = Object.values(st.flightsById).reduce((n, f) => n + f.expectedCount, 0);
  if (owed !== schedule.length) {
    out.push(`the flights are owed ${owed} bags but the timetable authors ${schedule.length}`);
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
      if (TAP_KEYS.has(k)) { held.delete(k); input._debugRelease(k); }
    }
  };
}

/** One shift under pure random input. `opts.chaos` adds pause, blur, settings and jitter. */
export function fuzzShift(seed, opts = {}) {
  const g = newSoakGame(seed);
  const input = new Input(window);
  const rng = new Rng(seed ^ 0x5f3a, 'mash');
  const mash = makeMasher(rng);

  /* THE ASSIST HAS TO BE CHOSEN BEFORE THE SHIFT IS AUTHORED.
   *
   * `applySettings` deliberately does not rewrite a running timetable — moving a departure
   * the player is already racing would be worse than making them wait — so the mid-shift
   * changes in the chaos block below prove a running shift is NOT reshaped, and prove
   * nothing whatever about a shift AUTHORED at 1.15 or 1.35. Every fuzzed shift ran at
   * Standard, so the schedule invariants in `sweep` only ever saw the one multiplier they
   * cannot fail on. `startShift` re-authors; this is where the stretched schedule enters.
   */
  const assist = opts.assist ||
    (opts.chaos ? ASSIST_LEVELS[rng.int(0, ASSIST_LEVELS.length - 1)].v : 1);
  if (assist !== 1) g.applySettings({ assist });
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
    seed, violations, threw, assist,
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

/*
 * The sort-room shell — four walls and a doorway, and the only geometry a player is ever
 * near. The perimeter is deliberately excluded: it straddles the edge of BOUNDS, so
 * something parked inside it reads as having escaped the airport, which would be the
 * harness inventing its own violation.
 */
const ROOM_WALLS = WALLS.filter((w) => w.id.startsWith('room_'));

/**
 * Put an entity inside a wall — by hand, because nothing in the game does it any more.
 *
 * THE HARNESS MAY WRITE TO STATE; `CrewBot` may not. This is the same manufactured start
 * m6 section I uses, and it is the only way to reach the code recover exists for: measured,
 * 5392 presses of X across four played shifts un-stuck exactly nothing, because
 * `moveWithWalls` never commits a move into geometry in the first place. Fuzzing X without
 * this is fuzzing a function that returns 0.
 *
 * @returns {boolean} whether it landed inside one
 */
function wedgeIntoWall(ent) {
  let best = null, bestD = Infinity;
  for (const w of ROOM_WALLS) {
    const cx = Math.min(Math.max(ent.x, w.x), w.x + w.w);
    const cy = Math.min(Math.max(ent.y, w.y), w.y + w.h);
    const d = Math.hypot(ent.x - cx, ent.y - cy);
    if (d < bestD) { bestD = d; best = { w, cx, cy }; }
  }
  if (!best) return false;
  // Well INSIDE the rectangle, not a millimetre over the line: a wall is 0.6 m thick and
  // an entity balanced on its face is a different, much less interesting state.
  ent.x = Math.min(Math.max(best.cx, best.w.x + 0.05), best.w.x + best.w.w - 0.05);
  ent.y = Math.min(Math.max(best.cy, best.w.y + 0.05), best.w.y + best.w.h - 0.05);
  ent.vx = 0; ent.vy = 0;
  return true;
}

/**
 * X, pressed at the moments it is most likely to be wrong.
 *
 * `recover` (GDD §24.3) is the only verb that TELEPORTS anything: the player out of a
 * wall, and every cart on the train out of whatever it is wedged in. `pushOutOfWalls` is
 * a teleport, and CLAUDE.md already records what a teleport costs when something
 * differences position across it — a stationary train threw a bag off the back.
 *
 * A uniform coin flip is a poor instrument for it. A shift is mostly walking about with
 * nothing stuck, which is the one state recover is DEFINED to do nothing in, so nearly
 * every press would land there. This runs the real crew and presses X hard at the states a
 * teleport could actually corrupt — carrying, mid-charge, towing a loaded train, standing
 * in an open hold — and sometimes in the same STEP as another verb, which is the ordering
 * the scripted presses in m6 and m7 cannot reach at all.
 *
 * The census of what it caught comes back with the result: "clean" is only evidence if the
 * moments it claims to have covered actually happened.
 */
export function recoverFuzz(seed, opts = {}) {
  const g = newSoakGame(seed);
  const input = new Input(window);
  const rng = new Rng(seed ^ 0x2463, 'recover');
  const bot = new CrewBot(opts.skill || 'average');
  /* Tuned DOWN from 0.12/0.01, which fired 1955 presses in a shift and buried the crew:
   * every co-pressed E and F is a bag put down or a cart dropped, and at that rate the run
   * delivered nothing at all — so the states on the far side of a delivery (a hold closing
   * with a loaded cart alongside, a bag going aboard) were never reached with X in play.
   * A fuzz that stops the game before the interesting half is a fuzz of the first half. */
  const hot = opts.hot === undefined ? 0.06 : opts.hot;
  const cold = opts.cold === undefined ? 0.005 : opts.cold;
  g.startShift();

  // What the presses actually landed on, and what they moved. `recovered` counts the
  // presses that genuinely un-stuck something — the rest were no-ops by design.
  const hit = { carrying: 0, charging: 0, driving: 0, towing: 0, loaded: 0, inHold: 0,
                onFoot: 0, withVerb: 0, wedged: 0 };
  let presses = 0, recovered = 0, spills = 0, spillsAfterRecover = 0;
  let frame = 0, lastRecoverFrame = -99;
  g.bus.on(EVENTS.RECOVERED, () => { recovered++; lastRecoverFrame = frame; });
  // A spill in the two steps after a teleport is the signature CLAUDE.md warns about:
  // `pushOutOfWalls` is a teleport, `updateTrain` differences cart position across a step,
  // and a stationary train that throws a bag off is that difference read as a hard corner.
  g.bus.on(EVENTS.BAG_SPILLED, () => {
    spills++;
    if (frame - lastRecoverFrame <= 2) spillsAfterRecover++;
  });

  const expectedIds = new Set();
  const violations = [];
  const maxFrames = opts.frames || Math.ceil((g.state.shift.endTimeMs + 4000) / FRAME_MS);
  let threw = null;

  let wedgeIn = -1;              // frames until the clumsy hand reaches for X
  try {
    for (let i = 0; i < maxFrames && !g.state.shift.ended; i++) {
      frame = i;
      bot.step(g, input, FRAME_MS);

      const st = g.state, p = st.player;
      const v = p.drivingId ? st.vehiclesById[p.drivingId] : null;
      const towed = v && v.nextCartId ? st.cartsById[v.nextCartId] : null;
      const interesting = !!p.carryingBagId || p.charging || !!towed || !!p.targetHoldId;
      let extra = null;

      /* Manufacture the stuck state, then reach for X — sometimes at once, sometimes a
       * few frames later, because a wedged tractor whose train is still being placed by
       * the constraint every step is a different world from one that has just arrived
       * there. Something ALWAYS presses X afterwards: nothing else can free it, so a run
       * that forgot would simply stop moving for the rest of the shift. */
      if (wedgeIn < 0 && rng.chance(opts.wedge === undefined ? 0.0015 : opts.wedge)) {
        if (wedgeIntoWall(v || p)) { hit.wedged++; wedgeIn = rng.int(0, 12); }
      }
      const forced = wedgeIn === 0;
      if (wedgeIn >= 0) wedgeIn--;

      if (forced || rng.chance(interesting ? hot : cold)) {
        presses++;
        if (p.carryingBagId) hit.carrying++;
        if (p.charging) hit.charging++;
        if (v) hit.driving++;
        if (towed) hit.towing++;
        if (towed && towed.bagIds.length) hit.loaded++;
        if (p.targetHoldId) hit.inHold++;
        if (!v) hit.onFoot++;
        // Recover is checked BEFORE every other verb in `stepInteraction`, so firing both
        // on one step is a genuinely different code path from firing them a frame apart.
        if (rng.chance(0.15)) {
          extra = ['KeyE', 'KeyF', 'Space'][rng.int(0, 2)];
          input._debugPress(extra);
          hit.withVerb++;
        }
        input._debugPress('KeyX');
      }

      g.frame(FRAME_MS, input);
      input._debugRelease('KeyX');
      if (extra) input._debugRelease(extra);

      for (const id of Object.keys(g.state.bagsById)) expectedIds.add(id);
      const bad = sweep(g.state, expectedIds);
      if (bad.length) {
        violations.push({ atMs: Math.round(g.state.simTimeMs), frame: i, bad: bad.slice(0, 3) });
        if (violations.length >= 3) break;
      }
    }
  } catch (e) { threw = String((e && e.stack) || e); }

  return {
    seed, violations, threw, presses, recovered, spills, spillsAfterRecover, hit,
    simMs: Math.round(g.state.simTimeMs),
    bags: Object.keys(g.state.bagsById).length,
    delivered: Object.values(g.state.flightsById).reduce((n, f) => n + f.outcome.correct, 0),
    misrouted: Object.values(g.state.flightsById).reduce((n, f) => n + f.outcome.misrouted, 0),
    points: g.state.score.points,
  };
}

/**
 * The one DETERMINISTIC probe in this file, and an A/B: does pressing X throw a bag off a
 * train that is standing perfectly still?
 *
 * The recover fuzz above found four spills inside two steps of a recover, which is not a
 * coincidence anybody should have to take on trust. This isolates it. Two identical
 * worlds, same seed, same loaded train, same tractor wedged in the same wall, settled to
 * full stability with nobody touching the throttle. The ONLY difference is one press of X.
 *
 * The mechanism, if it fires: `recoverStuck` calls `pushOutOfWalls`, which is a TELEPORT,
 * and the NEXT `updateTrain` measures the cart's motion by differencing position and
 * heading across one step. `updateTrain` already guards against the push IT performs — it
 * differences `solvedX/solvedY`, captured before its own `pushOutOfWalls` — but nothing
 * guards against a teleport applied from outside it.
 *
 * @returns {{withX: object, withoutX: object, spilledOnRecover: number}}
 */
export function recoverSpillProbe(seed = 4242) {
  const run = (pressX) => {
    const g = newSoakGame(seed);
    const input = new Input(window);
    g.startShift();
    const st = g.state;

    // NEVER ASSUME WHEN A SEEDED BAG ARRIVES — run until four are here, bounded.
    let f = 0;
    while (Object.keys(st.bagsById).length < 4 && f < 9000) { g.frame(FRAME_MS, input); f++; }
    const ids = Object.keys(st.bagsById).slice(0, 4);
    const v = Object.values(st.vehiclesById)[0];
    const cart = st.cartsById.cart_1;
    if (ids.length < 4 || !v || !cart) return { ok: false, why: `${ids.length} bags in ${f} frames` };

    /* A loaded train parked across the top of the sort room, facing east, so the drawbar
     * runs east-west and the wall above it pushes north-south — across the drawbar rather
     * than along it. Along it, the constraint solve is collinear, the heading does not
     * change, and lateral load stays zero however far the thing teleports. */
    v.x = 20; v.y = 11; v.rot = 0; v.speed = 0; v.yawRate = 0; v.vx = 0; v.vy = 0;
    enterVehicle(st, v, g.bus, st.simTimeMs);
    const tow = { x: v.x - CONFIG.tractor.towOffsetM, y: v.y };
    cart.x = tow.x - CONFIG.cart.linkM; cart.y = tow.y; cart.rot = 0;
    hitch(st, v, cart, g.bus, st.simTimeMs);
    for (const id of ids) moveBag(st, st.bagsById[id], { type: 'cart', id: cart.id }, g.bus, st.simTimeMs);

    // The state GDD §24.3 exists for: jack-knifed into the sort-room wall. Then two full
    // seconds of nobody touching anything, which is long enough for `stabilityRecover` to
    // put the cart back at 1.0 whatever the wedge itself cost.
    wedgeIntoWall(v);
    for (let i = 0; i < 120; i++) g.frame(FRAME_MS, input);

    const before = { spills: cart.spills, aboard: cart.bagIds.length,
                     stability: +cart.stability.toFixed(3),
                     x: +cart.x.toFixed(2), y: +cart.y.toFixed(2) };
    const speedBefore = +v.speed.toFixed(4);

    if (pressX) input._debugPress('KeyX');
    g.frame(FRAME_MS, input);
    input._debugRelease('KeyX');
    for (let i = 0; i < 4; i++) g.frame(FRAME_MS, input);

    return {
      ok: true, pressX, before, speedBefore,
      after: { spills: cart.spills, aboard: cart.bagIds.length,
               stability: +cart.stability.toFixed(3),
               x: +cart.x.toFixed(2), y: +cart.y.toFixed(2) },
      spilled: cart.spills - before.spills,
    };
  };

  const withX = run(true);
  const withoutX = run(false);
  return {
    withX, withoutX,
    spilledOnRecover: (withX.spilled || 0) - (withoutX.spilled || 0),
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
