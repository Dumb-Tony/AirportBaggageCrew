/* GDD §37 — THE SKILL LADDER IS NOT A LADDER.
 *
 * `tools\_bot.js` defines three crews and two of their three columns get better as skill
 * rises. The third, `haulAt`, encodes a BELIEF — that a better player does not wait around
 * for a full cart — and it goes 10 -> 8 -> 6 as skill rises. Measured, the veteran drives
 * 40% further than the average crew and delivers 27 points fewer:
 *
 *     novice   47%   -1850    782 m    haulAt 10
 *     average  86%   +3450   1580 m    haulAt 8
 *     veteran  59%    -700   2204 m    haulAt 6
 *
 * So "veteran" measures fast reactions PLUS a worse haul policy, confounded inside one
 * preset, and every difficulty claim in this project is a comparison between these presets.
 * m6 D3/D5/D6 gate on them and the bag count was chosen by looking at all three. A ladder
 * whose top rung is below its middle one cannot support any of that.
 *
 * This file separates the axes. Each sweep holds two of the three fixed at the AVERAGE
 * preset's values and varies the third, so an effect can be attributed instead of guessed
 * at. It measures; it does not gate — what it licenses goes into m6 as an assertion.
 *
 * ⚠ Every lesson from `_corner.js` applies and is applied here: catch and print, flush on
 * every line, and pair by seed rather than differencing medians.
 */

import { CONFIG } from '../src/config.js';
import { Game } from '../src/game.js';
import { Input } from '../src/core/input.js';
import { memoryStorage } from '../src/systems/save.js';
import { playShift, SKILLS } from './_bot.js';

const lines = [];
let _pre = null;
function emit(status) {
  if (!_pre) {
    _pre = document.createElement('pre');
    _pre.id = 'test-out';
    _pre.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:#06080c;' +
      'color:#cfe;font:11px ui-monospace,Consolas,monospace;padding:12px;white-space:pre';
    document.body.appendChild(_pre);
  }
  _pre.textContent = '==ABCTEST-BEGIN==\n' + lines.join('\n') + '\n\n' +
    (status || 'ALL-PASS  0 assertions') + '\n==ABCTEST-END==';
}
const say = (s) => { lines.push(s); emit('RUNNING...'); };
const newGame = (seed) => new Game({ seed, seedLabel: 'axes', storage: memoryStorage() });
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

const SEEDS = [12345, 777, 2468];
const BASE = SKILLS.average;          // two axes held here while the third moves

/** One cell of a sweep: three seeds at one setting, summarised. */
function cell(axes, label) {
  const runs = SEEDS.map((seed) => {
    emit(`RUNNING ${label} seed ${seed}...`);
    return playShift(newGame(seed), new Input(window), 'average', 900000, { axes });
  });
  return {
    label, axes, runs,
    pct: median(runs.map((r) => r.pct)),
    correct: median(runs.map((r) => r.correct)),
    points: median(runs.map((r) => r.points)),
    driven: Math.round(mean(runs.map((r) => r.bot.drivenM))),
    walked: Math.round(mean(runs.map((r) => r.bot.walkedM))),
    hauls: +mean(runs.map((r) => r.bot.hauls)).toFixed(1),
    spills: median(runs.map((r) => r.spills)),
    idleS: Math.round(mean(runs.map((r) => r.bot.idleMs)) / 1000),
    queuePeak: Math.round(mean(runs.map((r) => r.bot.queuePeak))),
  };
}

function table(rows, varying) {
  say(`  ${varying.padEnd(12)} delivered      points   hauls   driven   walked  spills  idle  queue`);
  for (const r of rows) {
    say(`  ${String(r.label).padEnd(12)} ${String(r.correct).padStart(2)}/51 (${String(r.pct).padStart(3)}%)  ` +
        `${String(r.points).padStart(6)}   ${String(r.hauls).padStart(5)}   ` +
        `${String(r.driven).padStart(5)} m  ${String(r.walked).padStart(5)} m  ` +
        `${String(r.spills).padStart(5)}  ${String(r.idleS).padStart(4)}s  ${String(r.queuePeak).padStart(5)}`);
  }
  const best = rows.reduce((a, b) => (b.points > a.points ? b : a));
  const worst = rows.reduce((a, b) => (b.points < a.points ? b : a));
  say(`  -> best ${best.label} (${best.points} pts, ${best.pct}%), ` +
      `worst ${worst.label} (${worst.points} pts, ${worst.pct}%), ` +
      `spread ${best.points - worst.points} points`);
  say('');
  return { best, worst, spread: best.points - worst.points };
}

(async () => {
 try {
  say('== GDD §37: what each axis is actually worth =============================');
  say('');
  say(`held fixed at the AVERAGE preset unless being swept: ` +
      `reactionMs ${BASE.reactionMs}, lookaheadMs ${BASE.lookaheadMs}, haulAt ${BASE.haulAt}`);
  say(`cart capacity is ${CONFIG.cart.capacitySlots} slots, so haulAt above that can never trigger`);
  say('');

  /* ── 1. haulAt, the one under suspicion ──────────────────────────────── */
  say('-- haulAt: how full the cart has to be before the crew leaves --------------');
  const haulRows = [];
  for (const n of [4, 5, 6, 7, 8, 9, 10]) {
    haulRows.push(cell({ haulAt: n }, `haulAt ${n}`));
  }
  const haul = table(haulRows, 'setting');

  /* ── 2. reactionMs ───────────────────────────────────────────────────── */
  say('-- reactionMs: how long the crew dithers before committing -----------------');
  const reactRows = [];
  for (const n of [90, 380, 900, 1800]) {
    reactRows.push(cell({ reactionMs: n }, `react ${n}`));
  }
  const react = table(reactRows, 'setting');

  /* ── 3. lookaheadMs ──────────────────────────────────────────────────── */
  say('-- lookaheadMs: whether the crew reads the schedule ahead ------------------');
  const lookRows = [];
  for (const n of [0, 45000, 110000, 200000]) {
    lookRows.push(cell({ lookaheadMs: n }, `look ${n / 1000}s`));
  }
  const look = table(lookRows, 'setting');

  /* ── the verdict ─────────────────────────────────────────────────────── */
  say('== WHAT EACH AXIS IS WORTH ================================================');
  say('');
  const axes = [
    { name: 'haulAt', r: haul, shipped: `10 / 8 / 6 (novice / average / veteran)` },
    { name: 'reactionMs', r: react, shipped: `900 / 380 / 90` },
    { name: 'lookaheadMs', r: look, shipped: `0 / 45000 / 110000` },
  ].sort((a, b) => b.r.spread - a.r.spread);
  for (const a of axes) {
    say(`  ${a.name.padEnd(12)} spread ${String(a.r.spread).padStart(5)} points ` +
        `(best ${a.r.best.label}, worst ${a.r.worst.label})   shipped: ${a.shipped}`);
  }
  say('');

  const bestHaul = haul.best.axes.haulAt;
  say(`  The best haulAt measured is ${bestHaul}. The presets go 10 -> 8 -> 6 as skill`);
  say(`  RISES, so the veteran is furthest from it — which is the whole defect §37 is about.`);
  say('');

  /*
   * ⚠ SPREAD ALONE IS THE WRONG TEST, and the first version of this section got it wrong.
   * It compared each axis's spread against the widest seed-to-seed range found inside any
   * single cell — 5200 points, which came from one collapsed seed at a bad setting — and
   * duly labelled haulAt "NOISE" while its medians climbed 1300, 1550, 2300, 2800, 3450
   * in strict order across five consecutive settings. A monotone run like that is not
   * noise; noise does not sort itself.
   *
   * So test the TREND as well as the size. An axis is real if its whole range moves the
   * score AND the medians are ordered on the way to the best setting; it is decoration
   * only if neither holds. reactionMs fails both, and by the strongest possible margin:
   * every one of its settings returns a byte-identical shift.
   */
  const runUpIsMonotone = (rows) => {
    const bestAt = rows.reduce((bi, r, i) => (r.points > rows[bi].points ? i : bi), 0);
    for (let i = 1; i <= bestAt; i++) if (rows[i].points <= rows[i - 1].points) return false;
    return bestAt > 0;
  };
  const trend = { haulAt: runUpIsMonotone(haulRows), reactionMs: runUpIsMonotone(reactRows),
                  lookaheadMs: runUpIsMonotone(lookRows) };
  say('  is each axis a real knob? (size of effect, and whether the run-up to its best');
  say('  setting is ordered — noise does not sort itself)');
  for (const a of axes) {
    const real = a.r.spread > 0 && (a.r.spread >= 2000 || trend[a.name]);
    say(`    ${a.name.padEnd(12)} ${real ? 'REAL      ' : 'DECORATION'} ` +
        `spread ${String(a.r.spread).padStart(5)}, run-up ${trend[a.name] ? 'ordered' : 'not ordered'}`);
  }
  say('');

  /* ── 4. the grid, because a ladder is built from COMBINATIONS ─────────── */
  say('-- the two axes that matter, crossed: which presets make a real ladder? ----');
  const gridRows = [];
  for (const look of [0, 45000]) {
    for (const n of [6, 8, 10]) {
      gridRows.push(cell({ lookaheadMs: look, haulAt: n }, `look${look / 1000}s/haul${n}`));
    }
  }
  table(gridRows, 'combination');
  const ordered = [...gridRows].sort((a, b) => a.points - b.points);
  say('  ordered worst to best, which is the shape any honest ladder has to be cut from:');
  for (const r of ordered) {
    say(`    ${r.label.padEnd(16)} ${String(r.correct).padStart(2)}/51 (${String(r.pct).padStart(3)}%)  ` +
        `${String(r.points).padStart(6)} pts`);
  }
  say('');
  say(`  raw: ${JSON.stringify({
    haul: haulRows.map((r) => ({ n: r.axes.haulAt, pct: r.pct, pts: r.points, m: r.driven, h: r.hauls })),
    react: reactRows.map((r) => ({ n: r.axes.reactionMs, pct: r.pct, pts: r.points })),
    grid: gridRows.map((r) => ({ k: r.label, pct: r.pct, pts: r.points })),
    look: lookRows.map((r) => ({ n: r.axes.lookaheadMs, pct: r.pct, pts: r.points })),
  })}`);

  emit('ALL-PASS  0 assertions');
 } catch (e) {
  say('');
  say('!! THREW, and here is where:');
  say(String((e && e.stack) || e));
  emit('FAILURES  1 of 1');
 }
})();
