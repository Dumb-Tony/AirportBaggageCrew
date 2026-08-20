/* Balance telemetry — GDD §28.4, and the evidence Milestone 6 tunes against.
 *
 * NOT a suite. It gates nothing; it plays the shift with `CrewBot` at three skill levels
 * and prints what a person would actually get done. §28.4 asks for "local debug summaries
 * for time-to-load, queue length, cart trips, scan rate, misses by reason, and player
 * idle/travel time" — that is this file's output, line for line.
 *
 *   tools\smoketest.ps1 -Tests tools\_balance.js
 */

import { CONFIG } from '../src/config.js';
import { Game } from '../src/game.js';
import { Input } from '../src/core/input.js';
import { memoryStorage } from '../src/systems/save.js';
import { GameClock } from '../src/core/clock.js';
import { playShift, SKILLS } from './_bot.js';

const lines = [];
const say = (s) => lines.push(s);

let _pre = null;
function emit(status) {
  if (!_pre) {
    _pre = document.createElement('pre');
    _pre.id = 'test-out';
    _pre.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:#06080c;' +
      'color:#cfe;font:12px ui-monospace,Consolas,monospace;padding:14px;white-space:pre';
    document.body.appendChild(_pre);
  }
  _pre.textContent = '==ABCTEST-BEGIN==\n' + lines.join('\n') +
    '\n\n' + (status || 'ALL-PASS  balance report complete') + '\n==ABCTEST-END==';
}

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
const secs = (ms) => (ms / 1000).toFixed(0) + 's';

function newGame(seed) {
  return new Game({ seed, seedLabel: 'balance', storage: memoryStorage() });
}

const SEEDS = [12345, 777, 2468];

(async () => {
  say('BALANCE TELEMETRY — GDD §28.4');
  say('Every number below was produced by CrewBot playing through the real input path:');
  say('walking, grabbing, placarding, hitching, driving and carrying bags into holds.');
  say('');

  const rows = [];
  for (const skill of Object.keys(SKILLS)) {
    emit(`RUNNING ${skill}...`);
    for (const seed of SEEDS) {
      const g = newGame(seed);
      const input = new Input(window);
      const r = playShift(g, input, skill);
      rows.push({ seed, ...r });
    }
  }

  /* ── headline: can a person actually do this shift? ─────────────────────── */
  say('── DELIVERY BY SKILL ───────────────────────────────────────────────────');
  say(pad('skill', 10) + pad('seed', 8) + num('bags', 9) + num('%', 6) +
      num('missed', 8) + num('wrong', 7) + num('points', 9) + num('shift', 8));
  for (const r of rows) {
    say(pad(r.skill, 10) + pad(r.seed, 8) +
        num(`${r.correct}/${r.owed}`, 9) + num(r.pct + '%', 6) +
        num(r.missed, 8) + num(r.misrouted, 7) + num(r.points, 9) +
        num(GameClock.formatMs(r.simMs), 8));
  }
  say('');

  for (const skill of Object.keys(SKILLS)) {
    const rs = rows.filter((r) => r.skill === skill);
    const avg = (f) => (rs.reduce((n, r) => n + f(r), 0) / rs.length);
    say(`${pad(skill, 9)} mean ${avg((r) => r.pct).toFixed(0)}% delivered, ` +
        `${avg((r) => r.points).toFixed(0)} points, ` +
        `${avg((r) => r.missed).toFixed(1)} missed per shift`);
  }
  say('');

  /* ── per flight: which one is the impossible one? ───────────────────────── */
  say('── PER FLIGHT (average skill, all seeds) ───────────────────────────────');
  const avgRows = rows.filter((r) => r.skill === 'average');
  const byNumber = {};
  for (const r of avgRows) {
    for (const f of r.perFlight) {
      byNumber[f.number] = byNumber[f.number] || { correct: 0, owed: 0, missed: 0, n: 0 };
      const b = byNumber[f.number];
      b.correct += f.correct; b.owed += f.owed; b.missed += f.missed; b.n++;
    }
  }
  say(pad('flight', 10) + num('delivered', 12) + num('%', 7) + num('missed', 9));
  for (const [number, b] of Object.entries(byNumber)) {
    say(pad(number, 10) + num(`${(b.correct / b.n).toFixed(1)}/${(b.owed / b.n).toFixed(0)}`, 12) +
        num(Math.round((b.correct / b.owed) * 100) + '%', 7) + num((b.missed / b.n).toFixed(1), 9));
  }
  say('');

  /* ── §28.4's list, verbatim ─────────────────────────────────────────────── */
  say('── §28.4 TELEMETRY (average skill, all seeds) ──────────────────────────');
  const A = (f) => (avgRows.reduce((n, r) => n + f(r), 0) / avgRows.length);
  const firstLoads = avgRows.map((r) => r.bot.firstLoadMs).filter((v) => v !== null);
  say(`time to first bag aboard   ${firstLoads.length ? secs(firstLoads.reduce((a, b) => a + b, 0) / firstLoads.length) : 'NEVER'}`);
  say(`cart trips to the gates    ${A((r) => r.bot.hauls).toFixed(1)}`);
  say(`bags picked up             ${A((r) => r.bot.bagsCarried).toFixed(0)}`);
  say(`  ...loaded into carts     ${A((r) => r.bot.cartLoads).toFixed(0)}`);
  say(`  ...loaded into holds     ${A((r) => r.bot.holdLoads).toFixed(0)}`);
  say(`scan rate                  ${A((r) => r.bot.scans).toFixed(0)} scans / ${A((r) => r.bot.bagsCarried).toFixed(0)} bags`);
  say(`bags not in reach on arrival ${A((r) => r.bot.unreachable).toFixed(0)}   <- GDD §29 blocker check`);
  say(`distance walked            ${A((r) => r.bot.walkedM).toFixed(0)} m`);
  say(`distance driven            ${A((r) => r.bot.drivenM).toFixed(0)} m`);
  say(`idle (no progress)         ${secs(A((r) => r.bot.idleMs))} of ${secs(A((r) => r.simMs))}`);
  say(`stuck (>6 s, no progress)  ${secs(A((r) => r.bot.stuckMs))}`);
  say('');

  say('time spent per phase (average skill, mean of seeds):');
  const phases = {};
  for (const r of avgRows) {
    for (const [k, v] of Object.entries(r.bot.phaseMs)) phases[k] = (phases[k] || 0) + v;
  }
  const total = Object.values(phases).reduce((a, b) => a + b, 0) || 1;
  for (const [k, v] of Object.entries(phases).sort((a, b) => b[1] - a[1])) {
    say(`  ${pad(k, 12)} ${num(secs(v / avgRows.length), 7)}  ${num(Math.round((v / total) * 100) + '%', 5)}`);
  }
  say('');

  /* ── the quality criterion: did anything strand the crew? ───────────────── */
  say('── DEAD ENDS (GDD §29 "no known blocker can make a bag unreachable") ───');
  const ends = rows.flatMap((r) => r.bot.deadEnds.map((d) => ({ skill: r.skill, seed: r.seed, ...d })));
  if (!ends.length) say('none — the bot never went 4 s without progress in any run');
  else for (const d of ends.slice(0, 24)) {
    say(`  ${pad(d.skill, 8)} seed ${pad(d.seed, 7)} ${pad(d.phase, 10)} ` +
        `at (${d.x}, ${d.y}) ${d.driving ? 'driving' : 'on foot'} @ ${secs(d.tMs)}` +
        `  speed ${d.speed === null ? '-' : d.speed}  rot ${d.rot === null ? '-' : d.rot}` +
        `  aiming at ${d.want}${d.carrying ? '  (hands full)' : ''}` +
        `  job ${d.job} hitched=${d.hitched} train=${d.train} clear=${d.clearMs}`);
  }
  if (ends.length > 24) say(`  ...and ${ends.length - 24} more`);
  say('');

  /* ── the authored shift, for reference while tuning ─────────────────────── */
  const ref = newGame(12345);
  ref.startShift();
  say('── THE AUTHORED SHIFT ──────────────────────────────────────────────────');
  say(`shift ends ${GameClock.formatMs(ref.state.shift.endTimeMs)} ` +
      `(GDD §3.3 wants 8-12 minutes)`);
  for (const f of Object.values(ref.state.flightsById)) {
    const t = f.times;
    say(`  ${pad(f.number, 8)} ${pad(f.destinationCode, 5)} ${pad(f.gateId, 8)} ` +
        `${num(f.expectedCount, 3)} bags   accept ${num(secs(t.bagAcceptanceMs), 6)}` +
        `  final ${num(secs(t.finalCallMs), 6)}  closes ${num(secs(t.holdClosingMs), 6)}` +
        `  goes ${num(secs(t.departureMs), 6)}`);
  }
  say(`  cart capacity ${CONFIG.cart.capacitySlots} slots / ${CONFIG.cart.capacityWeight} kg` +
      `   tractor top speed ${CONFIG.tractor.maxSpeed} m/s` +
      `   walk ${CONFIG.player.maxSpeed} m/s`);

  emit();
})().catch((e) => { say('THREW: ' + ((e && e.stack) || e)); emit('FAILURES  1 of 1'); });
