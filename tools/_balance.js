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
import { sweep } from './_invariants.js';

const lines = [];
const say = (s) => lines.push(s);

let _pre = null;
/** The default status is a PASS, which is only safe because every call site passes one
 *  explicitly — see the argument at the final emit, at the bottom of the file. */
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

  /* Everything that would make the numbers below fiction rather than telemetry. A report
   * this file cannot stand behind must not print a green verdict — see the emit at the
   * bottom of the file for why that is not the free choice it looks like. */
  const problems = [];

  const rows = [];
  for (const skill of Object.keys(SKILLS)) {
    emit(`RUNNING ${skill}...`);
    for (const seed of SEEDS) {
      const g = newGame(seed);
      const input = new Input(window);
      let r = null;
      try {
        r = playShift(g, input, skill);
      } catch (e) {
        problems.push(`${skill}/${seed} threw: ${String((e && e.stack) || e).split('\n')[0]}`);
        continue;
      }
      // The same invariants `tools\_soak.js` checks after every step, checked once at the
      // whistle. A shift that ends with a bag in two places measured nothing.
      const bad = sweep(g.state, null);
      if (bad.length) problems.push(`${skill}/${seed} invariant: ${bad[0]}`);
      // A run that produced no flights, no bags or no clock is a harness failure wearing a
      // report's clothes, and every average below would quietly be computed over it.
      if (!r.perFlight.length || !r.owed || !r.simMs || !Object.keys(r.bot.phaseMs).length) {
        problems.push(`${skill}/${seed} produced no usable report: ` +
                      `${r.perFlight.length} flights, ${r.owed} owed, ${r.simMs}ms`);
      }
      rows.push({ seed, ...r });
    }
  }
  const expectedRows = Object.keys(SKILLS).length * SEEDS.length;
  if (rows.length !== expectedRows) {
    problems.push(`${rows.length} shifts reported, ${expectedRows} expected`);
  }
  // Every average, every percentage and the whole §28.4 block below is computed over
  // `avgRows`. Empty, they are all NaN and every one of them still prints.
  if (!rows.some((r) => r.skill === 'average')) problems.push('no average-skill shift ran');

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
  say(`carts swapped on the hitch ${A((r) => r.bot.cartsDropped || 0).toFixed(1)}`);
  say(`bags picked up             ${A((r) => r.bot.bagsCarried).toFixed(0)}`);
  say(`  ...loaded into carts     ${A((r) => r.bot.cartLoads).toFixed(0)}`);
  say(`  ...loaded into holds     ${A((r) => r.bot.holdLoads).toFixed(0)}`);
  say(`scan rate                  ${A((r) => r.bot.scans).toFixed(0)} scans / ${A((r) => r.bot.bagsCarried).toFixed(0)} bags`);
  say(`bags not in reach on arrival ${A((r) => r.bot.unreachable).toFixed(0)}   <- GDD §29 blocker check`);
  say(`distance walked            ${A((r) => r.bot.walkedM).toFixed(0)} m`);
  say(`distance driven            ${A((r) => r.bot.drivenM).toFixed(0)} m`);
  say(`queue depth                peak ${A((r) => r.bot.queuePeak).toFixed(0)} bags waiting, ` +
      `mean ${A((r) => r.bot.queueSum / Math.max(1, r.bot.queueSamples)).toFixed(1)}`);
  say(`idle (no progress)         ${secs(A((r) => r.bot.idleMs))} of ${secs(A((r) => r.simMs))}`);
  say(`stuck (>6 s, no progress)  ${secs(A((r) => r.bot.stuckMs))}`);
  say('');

  say('misses by reason (average skill, all seeds):');
  {
    const reasons = {};
    for (const r of avgRows) {
      for (const [k, v] of Object.entries(r.missesByReason || {})) reasons[k] = (reasons[k] || 0) + v;
    }
    const never = avgRows.reduce((t, r) => t + Math.max(0, r.neverSpawned || 0), 0);
    if (never) reasons['never reached the belt'] = never;
    const tot = Object.values(reasons).reduce((a, b) => a + b, 0) || 1;
    for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
      say(`  ${pad(k, 28)} ${num((v / avgRows.length).toFixed(1), 6)}  ` +
          `${num(Math.round((v / tot) * 100) + '%', 5)}`);
    }
    if (!Object.keys(reasons).length) say('  nothing was missed');
  }
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

  /* ── where everything ended up, for a flight that took nothing ──────────── */
  say('── END STATE (average skill, first seed) ───────────────────────────────');
  const one = avgRows[0];
  say('carts:  ' + one.carts.map((c) =>
    `${c.id}[${(c.placard || 'blank').replace('flight_', '')} x${c.bags}${c.hitched ? ' towed' : ''}]`).join('  '));
  say('bags:   ' + Object.entries(one.byLifecycle).sort()
    .map(([k, v]) => `${k}=${v}`).join('  '));
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

  say('');
  say('── IS THIS REPORT WORTH READING? ───────────────────────────────────────');
  if (problems.length) for (const p of problems) say(`  ${p}`);
  else {
    say(`  yes — ${rows.length} shifts played to the whistle, no exceptions, ` +
        `every skill and seed reported, every one ending on a sound world`);
  }

  /*
   * THE ARGUMENT AGAINST `emit()` WITH NO ARGUMENT.
   *
   * `emit`'s default status is 'ALL-PASS  balance report complete', and this used to be a
   * bare `emit()` — so the last line of the page said ALL-PASS whatever the telemetry
   * said, and `tools\smoketest.ps1` (which anchors its verdict on `^ALL-PASS`) exited 0
   * even if every shift had thrown. That is harmless exactly as long as this file stays a
   * diagnostic nobody gates on, and `tools\test.ps1` deliberately does not run it — but a
   * suite list is one line, and the day somebody adds it they get a permanently green
   * suite that can never go red. `tools\_soak.js` shares the same default and is not
   * exposed to this, because its final emit is conditional. So is this one now.
   */
  emit(problems.length
    ? `FAILURES  ${problems.length} problem${problems.length === 1 ? '' : 's'} — ` +
      'the telemetry above is not trustworthy'
    : `ALL-PASS  balance report complete across ${rows.length} played shifts`);
})().catch((e) => { say('THREW: ' + ((e && e.stack) || e)); emit('FAILURES  1 of 1'); });
