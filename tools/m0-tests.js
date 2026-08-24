/* Milestone 0 suite — skeleton and design locks.
 *
 * Exit criterion under test: a stable blank simulation with pause, restart and a
 * deterministic seed. Everything here is either pure logic (clock, RNG, event bus,
 * input, map geometry) or a LIVE assertion driven through the real rAF loop.
 *
 * The live section matters more than it looks. Every pure test below would still pass
 * with the render loop dead, so the last block leaves the real game alone under real
 * frames and checks that simulation time actually moves — and actually stops.
 * (Lesson paid for in Something's Different M11.)
 */

import { GameClock } from '../src/core/clock.js';
import { EventBus } from '../src/core/eventBus.js';
import { Input, DEFAULT_BINDINGS } from '../src/core/input.js';
import { mulberry32, Rng, hashStr } from '../src/core/rng.js';
import { Game, MODES, createInitialState } from '../src/game.js';
import { CONFIG } from '../src/config.js';
import { MIN_PX_PER_M } from '../src/render/camera.js';
import {
  WORLD, BOUNDS, ZONES, WALLS, ANCHORS, DOOR, STAGING_PADS, CONVEYOR,
  clampToBounds, isBlocked, zoneAt, anchorDistance, rectsOverlap, rectContains,
} from '../src/data/airport.js';

/* ── harness ─────────────────────────────────────────────────────────────── */
const lines = [];
let passes = 0, fails = 0;

function ok(name, cond, detail = '') {
  if (cond) { passes++; lines.push(`PASS  ${name}`); }
  else { fails++; lines.push(`FAIL  ${name}${detail ? '  <- ' + detail : ''}`); }
}
const eq   = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const near = (n, a, b, tol) => ok(n, Math.abs(a - b) <= tol, `got ${a}, want ${b} +/- ${tol}`);
const STEP = CONFIG.sim.stepMs;

/* Emit the result block into the DOM. Called after EVERY section, not just at the end:
 * the harness greps the dumped DOM, so a suite that hangs or throws half way must still
 * report how far it got. A silent page is the one failure mode that teaches nothing. */
let _pre = null;
function emit(status) {
  if (!_pre) {
    _pre = document.createElement('pre');
    _pre.id = 'test-out';
    _pre.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:#06080c;' +
      'color:#cfe;font:11px ui-monospace,Consolas,monospace;padding:12px;white-space:pre';
    document.body.appendChild(_pre);
  }
  const tail = status || (fails === 0 ? `ALL-PASS  ${passes} assertions` : `FAILURES  ${fails} of ${passes + fails}`);
  _pre.textContent = '==ABCTEST-BEGIN==\n' + lines.join('\n') + '\n\n' + tail + '\n==ABCTEST-END==';
}

function sectionA() {
lines.push('--- A. seeded RNG (GDD 21.7) ---');
{
  const a = mulberry32(12345), b = mulberry32(12345), c = mulberry32(12346);
  const sa = [], sb = [], sc = [];
  for (let i = 0; i < 8; i++) { sa.push(a()); sb.push(b()); sc.push(c()); }
  ok('A1 same seed gives an identical stream', sa.join() === sb.join());
  ok('A2 different seed diverges', sa.join() !== sc.join());
  ok('A3 draws stay in [0,1)', sa.every((v) => v >= 0 && v < 1));

  const r = new Rng(999);
  const first = [r.float(), r.float(), r.float()];
  eq('A4 Rng counts its draws', r.draws, 3);
  r.reset();
  ok('A5 reset restores the exact stream', [r.float(), r.float(), r.float()].join() === first.join());
  eq('A6 reset zeroes the draw counter', r.draws, 3);

  const ri = new Rng(7);
  let inRange = true;
  for (let i = 0; i < 2000; i++) { const v = ri.int(3, 9); if (v < 3 || v > 9) inRange = false; }
  ok('A7 int(lo,hi) is inclusive and in range over 2000 draws', inRange);

  const s1 = new Rng(42).shuffle([1, 2, 3, 4, 5, 6, 7, 8]).join();
  const s2 = new Rng(42).shuffle([1, 2, 3, 4, 5, 6, 7, 8]).join();
  ok('A8 shuffle is deterministic per seed', s1 === s2);

  eq('A9 hashStr is stable for the shift label', hashStr('regional_day_1'), hashStr('regional_day_1'));
  ok('A10 hashStr separates labels', hashStr('regional_day_1') !== hashStr('regional_day_2'));
  ok('A11 Game.seedFromLabel matches hashStr', Game.seedFromLabel('x') === hashStr('x'));
}

}

function sectionB() {
lines.push('--- B. GameClock (GDD 21.3, 5) ---');
{
  const c = new GameClock({ stepMs: STEP, maxFrameMs: 250 });

  // One real second, delivered the way a browser delivers it: sixty ordinary frames.
  // A single 1000 ms call would be clamped as a tab-suspend gap — that is B8's job.
  let seen = [];
  let steps = 0;
  for (let i = 0; i < 60; i++) steps += c.advance(1000 / 60, (dt, t) => seen.push(t));
  eq('B1 one real second is exactly 60 fixed steps', steps, 60);
  near('B2 simTime tracks the steps taken', c.simTimeMs, 1000, 1e-6);
  eq('B3 the step callback fires once per step', seen.length, 60);
  ok('B4 simTime passed to the callback increases monotonically',
     seen.every((v, i) => i === 0 || v > seen[i - 1]));
  near('B5 the callback sees the same time as the clock', seen[seen.length - 1], c.simTimeMs, 1e-9);

  c.setPaused(true);
  const before = c.simTimeMs;
  const pausedSteps = c.advance(5000, () => {});
  eq('B6 paused advance runs zero steps', pausedSteps, 0);
  eq('B7 paused advance does not move simTime', c.simTimeMs, before);
  c.setPaused(false);

  // a backgrounded tab hands back a multi-second delta; it must be DISCARDED, not banked
  const c2 = new GameClock({ stepMs: STEP, maxFrameMs: 250 });
  const burst = c2.advance(5000, () => {});
  ok('B8 a 5 s frame gap is clamped, not caught up', burst <= 15, `${burst} steps`);
  eq('B9 the clamp is counted for diagnosis', c2.clampedFrames, 1);
  ok('B10 clamped simTime never exceeds maxFrameMs', c2.simTimeMs <= 250);

  const c3 = new GameClock({ stepMs: STEP, maxFrameMs: 250 });
  c3.timeScale = 2;
  let scaled = 0;
  for (let i = 0; i < 60; i++) scaled += c3.advance(1000 / 60, () => {});
  eq('B11 timeScale 2 doubles the steps in a second', scaled, 120);

  const c4 = new GameClock({ stepMs: STEP, maxFrameMs: 250 });
  c4.advance(10, () => {});           // banks 10 ms, no step
  eq('B12 a sub-step frame runs no steps', c4.stepCount, 0);
  c4.advance(10, () => {});           // 20 ms banked -> one step
  eq('B13 banked remainder produces the step on the next frame', c4.stepCount, 1);
  ok('B14 alpha is the fraction into the next step', c4.alpha >= 0 && c4.alpha < 1);

  const c5 = new GameClock({ stepMs: STEP, maxFrameMs: 250 });
  c5.skipMs(10000, () => {});
  near('B15 skipMs advances exactly that much sim time', c5.simTimeMs, 10000, STEP);
  const c6 = new GameClock({ stepMs: STEP, maxFrameMs: 250 });
  c6.setPaused(true); c6.skipMs(1000, () => {});
  ok('B16 skipMs leaves the paused flag as it found it', c6.paused === true && c6.simTimeMs > 0);

  const c7 = new GameClock({ stepMs: STEP, maxFrameMs: 250 });
  c7.advance(1000, () => {}); c7.timeScale = 4; c7.setPaused(true); c7.reset();
  ok('B17 reset clears time, steps, accumulator, pause and scale',
     c7.simTimeMs === 0 && c7.stepCount === 0 && c7.accumulatorMs === 0 &&
     c7.paused === false && c7.timeScale === 1);

  eq('B18 formatMs 0',      GameClock.formatMs(0), '0:00');
  eq('B19 formatMs 65 s',   GameClock.formatMs(65000), '1:05');
  eq('B20 formatMs 10 min', GameClock.formatMs(600000), '10:00');
  eq('B21 formatMs clamps negatives', GameClock.formatMs(-5), '0:00');
}

}

function sectionC() {
lines.push('--- C. Game state, pause, restart, determinism (GDD 21.4, 29) ---');
{
  const g = new Game({ seed: 12345, seedLabel: 'regional_day_1' });
  const keys = Object.keys(createInitialState(1, 'x'));
  const required = ['version','seed','mode','simTimeMs','shift','player','bagsById','cartsById',
                    'vehiclesById','aircraftById','flightsById','world','score','announcements','settings'];
  ok('C1 state carries every GDD 21.4 top-level key',
     required.every((k) => keys.includes(k)), required.filter((k) => !keys.includes(k)).join());

  eq('C2 a new game starts on the title screen', g.state.mode, MODES.TITLE);
  ok('C3 the clock is paused outside play', g.clock.paused === true);

  g.setMode(MODES.PLAYING);
  ok('C4 entering play unpauses the clock', g.clock.paused === false);
  g.togglePause();
  ok('C5 pause stops the clock and sets the mode together',
     g.clock.paused === true && g.state.mode === MODES.PAUSED);
  g.togglePause();
  ok('C6 unpause resumes both', g.clock.paused === false && g.state.mode === MODES.PLAYING);

  g.setMode(MODES.TITLE);
  g.togglePause();
  eq('C7 pause is a no-op on the title screen', g.state.mode, MODES.TITLE);

  // the pause guarantee: no simulation may advance while paused
  g.startShift();
  g.frame(1000, null);
  const running = g.state.simTimeMs;
  ok('C8 a live frame advances simulation time', running > 0);
  g.togglePause();
  g.frame(1000, null); g.frame(1000, null);
  eq('C9 frames while paused advance nothing', g.state.simTimeMs, running);
  g.togglePause();
  g.frame(1000, null);
  ok('C10 resuming advances again', g.state.simTimeMs > running);

  g.setMode(MODES.PLAYING);
  g.pauseForBlur();
  eq('C11 losing focus pauses a running shift', g.state.mode, MODES.PAUSED);
  g.setMode(MODES.TITLE);
  g.pauseForBlur();
  eq('C12 losing focus does not disturb the title screen', g.state.mode, MODES.TITLE);

  // restart must reset every entity and timer — GDD 29 UX
  g.startShift();
  g.skipMs(30000);
  g.rng.world.float();
  ok('C13 the shift accumulated time before restart', g.state.simTimeMs > 29000);
  g.startShift();
  // Since Milestone 1, reset() authors the shift's bag timetable from the seeded
  // stream, so "draws === 0" is no longer the invariant. The real one is that a restart
  // leaves every stream exactly where a brand-new game with that seed would leave it.
  const fresh = new Game({ seed: 12345, seedLabel: 'regional_day_1' });
  ok('C14 restart zeroes sim time and steps, and re-seeds every RNG stream',
     g.state.simTimeMs === 0 && g.clock.stepCount === 0 &&
     g.rng.world.draws === fresh.rng.world.draws &&
     g.rng.bags.draws === fresh.rng.bags.draws &&
     g.rng.sim.draws === fresh.rng.sim.draws,
     `${g.rng.world.draws} vs ${fresh.rng.world.draws}`);
  eq('C15 restart keeps the seed', g.seed, 12345);
  eq('C16 restart clears the event log', g.bus.log.filter((e) => e.simTimeMs > 0).length, 0);

  // determinism: the same seed must produce a byte-identical run
  const runA = new Game({ seed: 4242, seedLabel: 'det' });
  runA.startShift(); runA.skipMs(120000);
  const a = JSON.stringify(runA.describe());
  runA.startShift(); runA.skipMs(120000);
  const b = JSON.stringify(runA.describe());
  ok('C17 the same seed replays identically after restart', a === b, `${a}\n${b}`);

  const runB = new Game({ seed: 4242, seedLabel: 'det' });
  runB.startShift(); runB.skipMs(120000);
  eq('C18 two independent games with one seed agree',
     JSON.stringify(runB.describe()), a);

  near('C19 two simulated minutes land where they should', runB.state.simTimeMs, 120000, STEP);
  eq('C20 state.simTimeMs mirrors the clock exactly', runB.state.simTimeMs, runB.clock.simTimeMs);

  const g2 = new Game({ seed: 1 });
  g2.startShift();
  /*
   * Since Milestone 4 the shift length is DERIVED from the last departure rather than a
   * hardcoded ten minutes — but this used to compare `shiftRemainingMs` against
   * `state.shift.endTimeMs`, and `shiftRemainingMs` IS `endTimeMs - simTimeMs`. With
   * simTimeMs at 0 both sides read the same field and no code change could have turned it
   * red. Re-derive the SPEC instead (Game._authorShift: the shift ends a wrap-up after the
   * LAST aircraft is clear) from the live flights and CONFIG. Reverting to the
   * CONFIG.shift.durationMs fallback — the regression that silently truncated six suites
   * at ten minutes — now fails here, 692000 against 600000.
   */
  const lastClear = Math.max(...Object.values(g2.state.flightsById)
    .map((f) => f.times.departureMs + CONFIG.flight.pushbackMs));
  eq('C21 the shift runs a wrap-up past the last aircraft being clear',
     g2.shiftRemainingMs, lastClear + CONFIG.shift.wrapUpMs);
  g2.skipMs(60000);
  near('C21b and the remaining time counts down with simulation time',
       g2.shiftRemainingMs, lastClear + CONFIG.shift.wrapUpMs - 60000, STEP);
  g2.skipMs(g2.state.shift.endTimeMs + 60000);
  eq('C22 shift time remaining clamps at zero', g2.shiftRemainingMs, 0);
}

}

function sectionD() {
lines.push('--- D. event bus (GDD 21.5, 24.1) ---');
{
  const bus = new EventBus({ logSize: 4 });
  let hits = 0, anyHits = 0;
  const off = bus.on('T', () => hits++);
  bus.onAny(() => anyHits++);
  bus.emit('T', {}, 10); bus.emit('T', {}, 20);
  eq('D1 handlers receive their type', hits, 2);
  off();
  bus.emit('T', {}, 30);
  eq('D2 unsubscribe stops delivery', hits, 2);
  eq('D3 onAny sees every event', anyHits, 3);

  bus.emit('X', {}, 40); bus.emit('X', {}, 50); bus.emit('X', {}, 60);
  eq('D4 the log is bounded to logSize', bus.log.length, 4);
  eq('D5 the log keeps the newest', bus.log[bus.log.length - 1].simTimeMs, 60);
  eq('D6 recent() is newest-first', bus.recent(2)[0].simTimeMs, 60);

  // a handler that unsubscribes itself mid-dispatch must not break the dispatch
  const b2 = new EventBus();
  let n = 0;
  const offSelf = b2.on('S', () => { n++; offSelf(); });
  b2.on('S', () => { n++; });
  let threw = false;
  try { b2.emit('S', {}, 0); } catch (e) { threw = true; }
  ok('D7 a self-unsubscribing handler does not break dispatch', !threw && n === 2);

  const g = new Game({ seed: 5 });
  const types = [];
  g.bus.onAny((e) => types.push(e.type));
  g.startShift();
  ok('D8 restart emits SIM_RESET and MODE_CHANGED',
     types.includes('SIM_RESET') && types.includes('MODE_CHANGED'), types.join());
  g.togglePause();
  ok('D9 pausing emits SIM_PAUSED', types.includes('SIM_PAUSED'));
  g.togglePause();
  ok('D10 resuming emits SIM_RESUMED', types.includes('SIM_RESUMED'));
}

}

function sectionE() {
lines.push('--- E. input abstraction (GDD 17, 16.6) ---');
{
  const i = new Input(window);   // not attached: no listeners, driven directly
  ok('E1 every action has at least one binding',
     Object.values(DEFAULT_BINDINGS).every((codes) => codes.length > 0));

  i._debugPress('KeyW');
  ok('E2 a bound key reports its action held', i.isDown('moveUp'));
  ok('E3 and reports the press edge', i.wasPressed('moveUp'));
  i.endStep();
  ok('E4 endStep consumes the edge but not the hold', !i.wasPressed('moveUp') && i.isDown('moveUp'));
  i._debugRelease('KeyW');
  ok('E5 release drops the hold and reports the edge', !i.isDown('moveUp') && i.wasReleased('moveUp'));
  i.endStep();

  i._debugPress('ArrowUp');
  ok('E6 alternate bindings map to the same action', i.isDown('moveUp'));
  i._debugRelease('ArrowUp');

  i._debugPress('KeyD');
  const ax1 = i.moveAxis();
  ok('E7 a single axis is full magnitude', Math.abs(Math.hypot(ax1.x, ax1.y) - 1) < 1e-9);
  i._debugPress('KeyS');
  const ax2 = i.moveAxis();
  near('E8 diagonals are normalised, not 1.41x faster', Math.hypot(ax2.x, ax2.y), 1, 1e-9);

  i._debugPress('KeyE');
  i.clear();
  ok('E9 clear() drops every held key (focus loss)',
     !i.isDown('grab') && !i.isDown('moveDown') && !i.wasPressed('grab'));
  ok('E10 an unbound action never reports down', !i.isDown('nonsense'));
}

}

function sectionF() {
lines.push('--- F. map bounds and geometry (GDD 20.2, 24.3, 8.3) ---');
{
  const c = clampToBounds(-40, 900, 0.4);
  ok('F1 an out-of-bounds point is pulled back inside',
     c.x >= BOUNDS.x && c.y <= BOUNDS.y + BOUNDS.h && c.clamped === true);
  const inside = clampToBounds(60, 35, 0.4);
  ok('F2 an in-bounds point is untouched and unflagged',
     inside.x === 60 && inside.y === 35 && inside.clamped === false);

  ok('F3 the perimeter blocks', isBlocked(0.5, 35) && isBlocked(119.5, 35));
  ok('F4 the sort-room wall blocks', isBlocked(20, 8.3));
  ok('F5 open floor does not block', !isBlocked(20, 24) && !isBlocked(90, 19));
  const doorMidY = (DOOR.y0 + DOOR.y1) / 2;
  ok('F6 the sort-room doorway is actually open', !isBlocked(33.7, doorMidY));
  ok('F7 the doorway is bounded by wall above and below',
     isBlocked(33.7, DOOR.y0 - 1) && isBlocked(33.7, DOOR.y1 + 1));

  eq('F8 the player spawns in the sort room', zoneAt(ANCHORS.playerSpawn.x, ANCHORS.playerSpawn.y).id, 'sort_room');
  eq('F9 gate 1 hold sits on stand 1', zoneAt(ANCHORS.gate1Hold.x, ANCHORS.gate1Hold.y).id, 'stand_1');
  eq('F10 gate 2 hold sits on stand 2', zoneAt(ANCHORS.gate2Hold.x, ANCHORS.gate2Hold.y).id, 'stand_2');

  const badAnchor = Object.entries(ANCHORS).find(([, p]) =>
    isBlocked(p.x, p.y) || p.x < BOUNDS.x || p.x > BOUNDS.x + BOUNDS.w ||
    p.y < BOUNDS.y || p.y > BOUNDS.y + BOUNDS.h);
  ok('F11 no anchor sits inside a wall or outside the bounds', !badAnchor, badAnchor && badAnchor[0]);

  /*
   * THE BAY ANCHORS AND THE PAINTED BAYS ARE TWO COPIES OF ONE FACT, so they can drift —
   * and they nearly did: the pads moved north 1.5 m to sit where a competent crew actually
   * parks, and an anchor left behind would start each cart on bare floor beside its own
   * marked bay, which is exactly the "paint that points at the wrong place" problem the
   * move was made to fix. Checked as containment rather than as equal numbers, because the
   * anchor is meant to be the pad's CENTRE and a pad could legitimately be resized.
   */
  for (const [name, gate] of [['cartBay1', 'gate_1'], ['cartBay2', 'gate_2']]) {
    const a = ANCHORS[name];
    const pad = STAGING_PADS.find((p) => p.gateId === gate);
    ok(`F11b.${name} starts a cart inside its own painted bay`,
       !!pad && rectContains(pad, a.x, a.y),
       `anchor ${a.x},${a.y} against pad ${pad && `${pad.x}..${pad.x + pad.w}, ${pad.y}..${pad.y + pad.h}`}`);
    // ...and clear of the belt, which is the thing directly north of them.
    ok(`F11c.${name} is clear of the conveyor`,
       a.y > CONVEYOR.y0 + CONVEYOR.widthM + CONFIG.cart.lengthM * 0.5,
       `bay y ${a.y}, belt ends at ${CONVEYOR.y0 + CONVEYOR.widthM}`);
  }

  const outside = ZONES.find((z) => z.x < 0 || z.y < 0 ||
    z.x + z.w > WORLD.widthM || z.y + z.h > WORLD.heightM);
  ok('F12 every zone fits inside the world', !outside, outside && outside.id);

  const s1 = ZONES.find((z) => z.id === 'stand_1'), s2 = ZONES.find((z) => z.id === 'stand_2');
  ok('F13 the two stands do not overlap', !rectsOverlap(s1, s2));

  // GDD 8.3: long enough that transport planning matters, short enough that a wasted
  // trip is not dead time. Balanced properly at Milestone 6; this is the sanity band.
  const d1 = anchorDistance('sortDoor', 'gate1Hold');
  const d2 = anchorDistance('sortDoor', 'gate2Hold');
  ok('F14 gate 1 is a meaningful drive from the sort room', d1 > 25 && d1 < 90, `${d1.toFixed(1)} m`);
  ok('F15 gate 2 is a meaningful drive from the sort room', d2 > 25 && d2 < 90, `${d2.toFixed(1)} m`);
  ok('F16 the two gates are genuinely different trips', Math.abs(d1 - d2) > 5,
     `${d1.toFixed(1)} vs ${d2.toFixed(1)} m`);
  lines.push(`      route: sortDoor->gate1 ${d1.toFixed(1)} m, ->gate2 ${d2.toFixed(1)} m`);
  // Renamed to what it can actually check. A WALLS record is {x,y,w,h} and both the
  // collision test and the renderer treat it as a rect, so there is no representation for
  // a non-axis-aligned wall and the old name could never be violated. Positive area
  // INSIDE the world is falsifiable: a wall authored with a negative width blocks nothing
  // and draws nothing, and one authored past the perimeter blocks somewhere unreachable.
  const badWall = WALLS.find((w) => !(w.w > 0 && w.h > 0) ||
    w.x < 0 || w.y < 0 || w.x + w.w > WORLD.widthM || w.y + w.h > WORLD.heightM);
  ok('F17 every wall is a positive-area rectangle inside the world', !badWall,
     JSON.stringify(badWall));
}

}

/* ── async: source hygiene + the live page ───────────────────────────────── */
/* HARNESS LIMIT, measured — do not "fix" the live tests by waiting for frames.
 *
 * Headless Chrome in --dump-dom mode delivers 1-3 requestAnimationFrame callbacks in
 * total and then stops, while setTimeout and performance.now keep running normally.
 * Measured with tools\_raf.js across three flag sets: --run-all-compositor-stages-
 * before-draw gave 3, swiftshader-with-GPU gave 1, dropping --virtual-time-budget gave
 * no output at all. There is no BeginFrame source without a CDP client, and there is no
 * Node on this machine to drive one.
 *
 * So section H below asserts what CAN be proven headlessly:
 *   - the real rAF loop ran at boot and called game.frame() (H8) and painted (H7);
 *   - everything downstream is driven through drive(), which calls game.frame() — the
 *     exact entry point main.js's rAF callback calls, with the same arguments.
 * What is NOT proven here is that the browser keeps calling it. That is five lines in
 * main.js and is checked by eye in a real browser (play.bat). Noted in CLAUDE.md. */
const FRAME_MS = 1000 / 60;

/**
 * A cheap hash of the whole painted canvas.
 *
 * One pixel proves the canvas is not blank and NOTHING else — the ground fill clears any
 * brightness threshold on its own, so H7 stayed green with every entity draw call
 * deleted. Comparing two whole frames does prove something: if moving an entity changes
 * no pixel anywhere, that entity is not being drawn.
 *
 * Strided by 7 rather than summed byte by byte: a 1262x700 frame is 3.5 MB, the change
 * being looked for is entity-sized rather than pixel-sized, and 7 is coprime with the
 * 4-byte RGBA period so the walk rotates through all four channels.
 */
function frameSignature(renderer) {
  const d = renderer.ctx.getImageData(0, 0, renderer.canvas.width, renderer.canvas.height).data;
  let h = 2166136261;
  for (let i = 0; i < d.length; i += 7) h = Math.imul(h ^ d[i], 16777619);
  return h >>> 0;
}

/* Comments are stripped before any of these rules are applied. They are about what the
 * CODE does, and the header comment explaining each rule names the very thing it forbids
 * — the first version of G1 failed its own rule on the comment that documents it. */
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * Fetch a module and everything it imports, transitively.
 *
 * There is no glob inside a browser, so the file list is CRAWLED rather than typed: start
 * at the bootstrap and follow every relative specifier, which is precisely the set of
 * modules that can run. A file joins the sweep the moment something imports it, and a
 * file nothing imports is dead code rather than an exemption from the rules.
 *
 * Specifiers are resolved with the URL parser rather than by string surgery, so
 * '../core/rng.js' seen from src/data/ lands exactly where the browser would put it.
 *
 * @returns {Promise<{bodies: Object<string,string>, unreachable: string[]}>}
 *   comment-stripped bodies keyed by repo-relative path
 */
async function crawlModules(entry) {
  const bodies = {};
  const unreachable = [];
  const queue = [entry];
  while (queue.length) {
    const path = queue.shift();
    if (path in bodies) continue;
    const res = await fetch('/' + path);
    if (!res.ok) { unreachable.push(`${path} -> HTTP ${res.status}`); bodies[path] = ''; continue; }
    const body = stripComments(await res.text());
    bodies[path] = body;
    const specs = [
      ...body.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g),      // import { x } from './y.js'
      ...body.matchAll(/\bimport\s*['"]([^'"]+)['"]/g),    // import './y.js'  (side effect)
    ];
    for (const m of specs) {
      if (!m[1].startsWith('.')) continue;                 // bare specifiers: none, zero deps
      const abs = new URL(m[1], new URL('/' + path, location.origin)).pathname.slice(1);
      if (!(abs in bodies)) queue.push(abs);
    }
  }
  return { bodies, unreachable };
}

/* Measured 2026-08-20: 38 files live under src/, and the crawl from main.js reaches all
 * 38 of them. The floor exists because a crawl that silently stopped matching imports —
 * one changed quote style would do it — would shrink the sweep to a single file and still
 * report ALL-PASS, which is the same way the old hardcoded twelve-file list hid 26 files
 * from rules CLAUDE.md states as "anywhere in src/". Raise it when modules are added;
 * lower it only when one is deliberately deleted. */
const SRC_FLOOR = 38;

async function sectionG() {
  lines.push('--- G. source hygiene (GDD 21.7, 31.3) ---');
  /*
   * This used to run over a hardcoded list of twelve files. src/ holds 38 — so every
   * system, every entity, fx.js, sprites.js, textures.js, data/flights.js, core/grid.js
   * and most of ui/ were exempt, including render/fx.js, which CLAUDE.md cites BY NAME as
   * obeying the Math.random rule that was not being checked on it.
   */
  const { bodies, unreachable } = await crawlModules('src/main.js');
  const SRC = Object.keys(bodies).sort();
  ok('G0 every module in the import graph was fetched', unreachable.length === 0,
     unreachable.join());
  ok('G0b the sweep reaches the whole of src/, not a hand-picked list',
     SRC.length >= SRC_FLOOR, `${SRC.length} modules, floor ${SRC_FLOOR}`);
  lines.push(`      source-hygiene sweep covers ${SRC.length} modules`);

  const rand = SRC.filter((f) => /Math\.random/.test(bodies[f]));
  ok('G1 no gameplay source calls Math.random', rand.length === 0, rand.join());

  const timers = SRC.filter((f) => /\b(setTimeout|setInterval)\s*\(/.test(bodies[f]));
  ok('G2 no per-entity browser timers drive the simulation', timers.length === 0, timers.join());

  // Only the bootstrap may read wall-clock time; the schedule reads simTimeMs alone.
  const wall = SRC.filter((f) => f !== 'src/main.js' &&
    /(Date\.now|performance\.now)\s*\(/.test(bodies[f]));
  ok('G3 only main.js touches wall-clock time', wall.length === 0, wall.join());

  // Tests for LOGIC, not for words: a renderer is allowed to draw a flight code on an
  // aircraft or a placard, and will have to from Milestone 3. What it may never do is
  // compute a score or read the schedule (GDD §31.3).
  const leakRules = [
    /\bscore\b/i, /\.points\b/, /departureMs|finalCallMs|holdClosingMs|bagAcceptanceMs/,
    /FLIGHT_DEFS|flightById|buildBagSchedule/, /simTimeMs\s*[<>]=?/,
  ];
  const leaks = leakRules.filter((re) => re.test(bodies['src/render/renderer.js'])).map(String);
  ok('G4 the renderer holds no scoring or schedule logic', leaks.length === 0, leaks.join());

  // The same rule over the REST of the render layer. "Rendering owns nothing" (GDD §31.3)
  // was only ever checked on renderer.js, while sprites.js, textures.js and fx.js draw
  // just as much and are just as able to grow a rule of their own.
  const otherRender = SRC.filter((f) => f.startsWith('src/render/') && f !== 'src/render/renderer.js');
  const rendLeaks = otherRender.filter((f) => leakRules.some((re) => re.test(bodies[f])));
  ok('G5 nor does the rest of the render layer', rendLeaks.length === 0,
     `${rendLeaks.join()} of ${otherRender.length} checked`);
}

async function sectionH() {
  lines.push('--- H. the live page under real frames ---');
  const abc = window.__ABC;
  ok('H1 the game booted and published its debug handle', !!(abc && abc.game));

  if (abc) {
    const { game, renderer, camera, input } = abc;
    /** Drive real frames through the same call main.js's rAF callback makes. Counted, so
     *  H16 can assert against the frames this section actually drove. */
    let driven = 0;
    const drive = (n) => { for (let i = 0; i < n; i++) { game.frame(FRAME_MS, input); driven++; } };
    const bootFrames = game.frames;          // produced by the REAL rAF loop, before we touch anything
    const banner = document.getElementById('err-banner');
    ok('H2 no error banner after boot', !banner, banner && banner.textContent);
    eq('H3 the page opens on the title screen', game.state.mode, MODES.TITLE);
    ok('H4 the title card is showing', document.getElementById('screenTitle').classList.contains('on'));
    ok('H5 the canvas has a real backing store',
       renderer.canvas.width > 0 && renderer.canvas.height > 0,
       `${renderer.canvas.width}x${renderer.canvas.height}`);
    // Since Milestone 1 the default camera follows the player at a zoom set by tag
    // readability (CONFIG.render.viewWidthM). Fit mode still exists and still fits.
    const fitS = camera.fitScale();
    // `viewWidthM` is a ceiling on the world shown; MIN_PX_PER_M is a floor under the
    // text size, and it wins below a ~1290 px window. See m1 I5 for the reasoning.
    ok('H6 the camera is at the configured zoom, and fit mode would still show it all',
       Math.abs(camera.visibleM.w -
                Math.min(CONFIG.render.viewWidthM, camera.cssW / MIN_PX_PER_M)) < 0.01 &&
       camera.scale >= MIN_PX_PER_M - 1e-9 &&
       fitS * WORLD.widthM <= camera.cssW + 1 && fitS * WORLD.heightM <= camera.cssH + 1,
       `${camera.visibleM.w.toFixed(1)} m across at ${camera.scale.toFixed(1)} px/m`);

    // the renderer really painted: sample the world centre, which sits on the ramp
    const px = renderer.ctx.getImageData(
      Math.floor(renderer.canvas.width / 2), Math.floor(renderer.canvas.height / 2), 1, 1).data;
    ok('H7 the world is actually drawn, not a blank canvas',
       !(px[0] === 11 && px[1] === 10 && px[2] === 18) && (px[0] + px[1] + px[2]) > 60,
       `rgb(${px[0]},${px[1]},${px[2]})`);

    /* H7 is a floor fill and cannot tell you any more than that. Delete every entity draw
     * call from _drawUpright and it stays green, because the ground beneath them is what
     * it samples. So diff two frames instead: nothing else moves between them — fx is
     * handed dt 0, every animation is derived from simulation values, and no frame() runs
     * in between — so any difference at all is the player being drawn. */
    const px0 = game.state.player.x, py0 = game.state.player.y;
    camera.follow(px0, py0, 0);
    renderer.render(game.state);
    const withPlayer = frameSignature(renderer);
    game.state.player.x = px0 + 30;            // the camera stays where it was told to look
    renderer.render(game.state);
    const movedAway = frameSignature(renderer);
    game.state.player.x = px0; game.state.player.y = py0;
    renderer.render(game.state);
    ok('H7b the entities are drawn too, not only the ground under them',
       withPlayer !== movedAway, `identical signature ${withPlayer} with the player 30 m apart`);

    // The real rAF loop ran at boot and reached game.frame(). That is the wiring proof;
    // see the FRAME_MS note above for why the count is necessarily small.
    ok('H8 the real rAF loop drove game.frame() at boot', bootFrames >= 1, `${bootFrames} frames`);
    eq('H9 those boot frames advanced no sim time, because the title screen is paused',
       game.state.simTimeMs, 0);

    game.startShift();
    const framesAtStart = game.frames;   // reset() zeroes it; derived rather than assumed
    driven = 0;
    drive(60);
    const t1 = game.state.simTimeMs;
    near('H10 one second of driven frames is one second of shift', t1, 1000, STEP);
    ok('H11 the shift clock is on screen',
       document.getElementById('hudTop').classList.contains('on'));
    abc.hud.update();
    eq('H12 the HUD prints the shift clock it was given',
       document.getElementById('hudTime').textContent, GameClock.formatMs(t1));

    game.togglePause();
    drive(60);
    eq('H13 pausing freezes the driven simulation', game.state.simTimeMs, t1);
    ok('H14 the pause card is showing',
       document.getElementById('screenPause').classList.contains('on'));

    game.togglePause();
    drive(60);
    near('H15 resuming advances again', game.state.simTimeMs, t1 * 2, STEP * 2);
    /* Derived from the frames this section actually drove, not from a hardcoded 180. The
     * literal was only ever safe because nothing awaits between H8 and here: add one
     * `await` anywhere in this block and a real rAF callback lands, the counter reads 181,
     * and a correct frame counter reports a failure. The harness delivers 1-3 rAF
     * callbacks in total (see the note above section G), so allow for those and no more —
     * a counter that MISSED a driven frame still fails. */
    const counted = game.frames - framesAtStart;
    ok('H16 the frame counter tracked every driven frame',
       counted >= driven && counted <= driven + 3, `${counted} counted for ${driven} driven`);

    // A whole shift at the fixed step: the Milestone 0 stability check. Driven well past
    // the end — since Milestone 4 the shift STOPS itself there and the clock pauses, so
    // the simulation should come to rest on the end time rather than run on.
    game.startShift();
    const shiftEnd = game.state.shift.endTimeMs;
    // Enough frames for the DERIVED shift, plus a margin. Driving a hardcoded 36,000
    // steps was exactly ten minutes, and stopped 92 s short once M6 stretched the
    // schedule to 11:32.
    drive(Math.ceil(shiftEnd / STEP) + 600);
    near('H17 a whole shift runs to its end and stops there',
         game.state.simTimeMs, shiftEnd, STEP * 2);
    eq('H18 and the shift clock has run out', Math.round(game.shiftRemainingMs), 0);
    ok('H19 the event log stayed bounded across the shift',
       game.bus.log.length <= CONFIG.debug.eventLogSize, `${game.bus.log.length}`);

    game.startShift();
    drive(1);
    ok('H20 restart returns to a fresh shift',
       game.state.simTimeMs < 20 && game.frames === 1 && game.clock.stepCount <= 1,
       `${game.state.simTimeMs} ms, ${game.frames} frames`);
    eq('H21 no frame was ever clamped during a normal run', game.clock.clampedFrames, 0);
    const endBanner = document.getElementById('err-banner');
    ok('H22 still no error banner at the end of the run', !endBanner,
       endBanner && endBanner.textContent);
  }
}

/* Run each section, emitting after every one. If a section throws or hangs, the block
 * already in the DOM shows exactly which one, instead of a blank page. */
(async () => {
  const sections = [
    ['A', sectionA], ['B', sectionB], ['C', sectionC], ['D', sectionD],
    ['E', sectionE], ['F', sectionF], ['G', sectionG], ['H', sectionH],
  ];
  for (const [name, fn] of sections) {
    emit(`RUNNING section ${name}...`);
    try {
      await fn();
    } catch (e) {
      fails++;
      lines.push(`FAIL  section ${name} threw: ${(e && e.stack) || e}`);
    }
    emit(`RUNNING (section ${name} done)`);
  }
  emit();
})();
