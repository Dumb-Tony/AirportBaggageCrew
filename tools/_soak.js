/* Soak and fuzz — the hardening half of Milestone 6.
 *
 * `CrewBot` plays WELL, which is exactly why it cannot find this class of bug: it only
 * ever presses keys that make sense. GDD §29 asks that "a ten-minute shift runs without
 * uncaught errors" and that "no known duplication or deletion of bag identity occurs" —
 * and the way you actually earn those sentences is to mash the keyboard for hours of
 * simulated time and check every invariant after every single step.
 *
 * Three tracks, in `tools\_invariants.js`:
 *   plain   — random keys for a whole shift
 *   chaos   — plus pausing, focus loss, settings changes and dropped frames
 *   guided  — the real crew bot with a hand tremor, so the fuzz reaches the gate
 *
 * NOT a suite: it gates nothing and takes a couple of minutes. `tools\m6-tests.js`
 * section H runs a short version of the same code and DOES gate, so a regression is
 * caught by the suite rather than by remembering to run this.
 *
 *   tools\smoketest.ps1 -Tests tools\_soak.js
 */

import { CONFIG } from '../src/config.js';
import { fuzzShift, guidedFuzz, restartTorture } from './_invariants.js';

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
    '\n\n' + (status || 'ALL-PASS  soak complete') + '\n==ABCTEST-END==';
}

const short = (e) => String(e).split('\n').slice(0, 3).join(' | ');
const report = (r) => {
  if (r.threw) say(`      THREW: ${short(r.threw)}`);
  for (const v of r.violations) say(`      @${v.atMs}ms  ${v.bad.join('  |  ')}`);
};

(async () => {
  say('SOAK AND FUZZ — random input, every invariant, every step');
  say('');

  const SEEDS = [1, 7, 42, 1337, 90210, 555001, 8675309, 20260820];
  const plain = [];

  say('── PLAIN FUZZ: random keys for a whole shift ────────────────────────────');
  for (const seed of SEEDS) {
    emit(`RUNNING fuzz seed ${seed}...`);
    const t0 = performance.now();
    const r = fuzzShift(seed);
    r.ms = performance.now() - t0;
    plain.push(r);
    const status = r.threw ? 'THREW' : (r.violations.length ? 'VIOLATION' : 'clean');
    say(`  seed ${String(seed).padEnd(9)} ${String(status).padEnd(10)} ` +
        `${String(r.delivered).padStart(2)} delivered, ${String(r.bags).padStart(3)} bags, ` +
        `${(r.simMs / 1000).toFixed(0)}s sim in ${r.ms.toFixed(0)}ms`);
    report(r);
  }
  say('');

  say('── CHAOS FUZZ: plus pausing, blur, settings changes, dropped frames ─────');
  const chaos = [];
  for (const seed of SEEDS.slice(0, 5)) {
    emit(`RUNNING chaos seed ${seed}...`);
    const r = fuzzShift(seed ^ 0xabcd, { chaos: true });
    chaos.push(r);
    const status = r.threw ? 'THREW' : (r.violations.length ? 'VIOLATION' : 'clean');
    say(`  seed ${String(r.seed).padEnd(9)} ${String(status).padEnd(10)} ` +
        `${(r.simMs / 1000).toFixed(0)}s sim, ${r.bags} bags, ended=${r.ended}`);
    report(r);
  }
  say('');

  say('── GUIDED FUZZ: the real crew bot, with a hand tremor ───────────────────');
  const guided = [];
  for (const [seed, noise] of [[11, 0.01], [22, 0.05], [33, 0.15], [44, 0.35]]) {
    emit(`RUNNING guided seed ${seed} at ${noise * 100}% noise...`);
    const r = guidedFuzz(seed, noise);
    guided.push(r);
    const status = r.threw ? 'THREW' : (r.violations.length ? 'VIOLATION' : 'clean');
    say(`  ${String(Math.round(noise * 100)).padStart(3)}% noise  ${String(status).padEnd(10)} ` +
        `${String(r.delivered).padStart(2)} delivered, ${r.misrouted} misrouted, ` +
        `${String(r.points).padStart(6)} points, ${r.nudges} stray keypresses`);
    report(r);
  }
  say('');

  say('── RESTART TORTURE: 40 restarts mid-shift on one game object ────────────');
  emit('RUNNING restart torture...');
  const rt = restartTorture(31337, 40);
  if (rt.threw) say(`  THREW: ${short(rt.threw)}`);
  else if (rt.problems.length) for (const p of rt.problems.slice(0, 10)) say(`  ${p}`);
  else say('  clean — 40 restarts left nothing behind');
  // Both counters are cleared by reset(), so this reads the LAST restart, not the run. It
  // proves a fresh game starts with an empty log; m0 D4 proves the ring itself works.
  say(`  after the final restart the log holds ${rt.logLen} of ${CONFIG.debug.eventLogSize} ` +
      `entries — reset() clears it, as GDD §24.1 requires`);
  say('');

  /* ── verdict ───────────────────────────────────────────────────────────── */
  const all = plain.concat(chaos).concat(guided);
  const threw = all.filter((r) => r.threw).length;
  const violated = all.filter((r) => r.violations.length).length;
  const simSec = all.reduce((n, r) => n + r.simMs, 0) / 1000;
  const wallMs = plain.reduce((n, r) => n + (r.ms || 0), 0);

  say('── VERDICT ──────────────────────────────────────────────────────────────');
  say(`${all.length} fuzzed shifts, ${(simSec / 60).toFixed(1)} minutes of simulated play`);
  say(`uncaught errors      ${threw}`);
  say(`invariant violations ${violated}`);
  say(`restart problems     ${rt.problems.length}${rt.threw ? ' + threw' : ''}`);
  say(`speed                ${(plain.reduce((n, r) => n + r.simMs, 0) / wallMs).toFixed(0)}x ` +
      `real time, with a full invariant sweep on every single step`);

  const clean = threw === 0 && violated === 0 && rt.problems.length === 0 && !rt.threw;
  emit(clean ? `ALL-PASS  soak clean across ${all.length} fuzzed shifts`
             : `FAILURES  ${threw + violated + rt.problems.length} problems`);
})().catch((e) => { say('HARNESS THREW: ' + ((e && e.stack) || e)); emit('FAILURES  1 of 1'); });
