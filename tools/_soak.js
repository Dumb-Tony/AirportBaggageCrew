/* Soak and fuzz — the hardening half of Milestone 6.
 *
 * `CrewBot` plays WELL, which is exactly why it cannot find this class of bug: it only
 * ever presses keys that make sense. GDD §29 asks that "a ten-minute shift runs without
 * uncaught errors" and that "no known duplication or deletion of bag identity occurs" —
 * and the way you actually earn those sentences is to mash the keyboard for hours of
 * simulated time and check every invariant after every single step.
 *
 * Four tracks, in `tools\_invariants.js`:
 *   plain   — random keys for a whole shift
 *   chaos   — plus pausing, focus loss, settings changes and dropped frames
 *   guided  — the real crew bot with a hand tremor, so the fuzz reaches the gate
 *   recover — X, GDD §24.3's teleport, pressed at every moment it could be wrong
 *
 * NOT a suite: it gates nothing and takes a couple of minutes. `tools\m6-tests.js`
 * section H runs a short version of the same code and DOES gate, so a regression is
 * caught by the suite rather than by remembering to run this.
 *
 *   tools\smoketest.ps1 -Tests tools\_soak.js
 */

import { CONFIG } from '../src/config.js';
import { ASSIST_LEVELS } from '../src/ui/settings.js';
import { fuzzShift, guidedFuzz, recoverFuzz, recoverSpillProbe, restartTorture }
  from './_invariants.js';

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

  say('── CHAOS FUZZ: plus pausing, blur, settings, dropped frames, the assist ─');
  const chaos = [];
  // The assist is CYCLED rather than drawn, so all three levels are covered every run
  // instead of most of them most of the time. GDD §16.6's stretch is authored once, at
  // startShift, and it moves the flights and the bag timetable together or not at all.
  const levels = ASSIST_LEVELS.map((a) => a.v);
  for (const [i, seed] of SEEDS.slice(0, 5).entries()) {
    emit(`RUNNING chaos seed ${seed}...`);
    const r = fuzzShift(seed ^ 0xabcd, { chaos: true, assist: levels[i % levels.length] });
    chaos.push(r);
    const status = r.threw ? 'THREW' : (r.violations.length ? 'VIOLATION' : 'clean');
    // The ASSIST is printed because it is authored per shift here, not toggled mid-run:
    // it is the multiplier the schedule invariants in `sweep` are actually being held to.
    say(`  seed ${String(r.seed).padEnd(9)} ${String(status).padEnd(10)} ` +
        `${(r.simMs / 1000).toFixed(0)}s sim, ${r.bags} bags, assist ${r.assist}, ` +
        `ended=${r.ended}`);
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

  /* X is the recover verb (GDD §24.3) and the only one that teleports anything. The three
   * tracks above reach it by chance; this one reaches it on purpose, at the moments a
   * teleport could corrupt something — carrying, mid-charge, towing a loaded train, and in
   * the same step as another verb. It also WEDGES the crew into a wall now and then,
   * because nothing in the game does that any more: an earlier run of this track pressed X
   * 5392 times across four shifts and un-stuck nothing at all, which measured a no-op. */
  say('── RECOVER FUZZ: X pressed at every bad moment there is ─────────────────');
  const recovered = [];
  for (const seed of [5, 55, 555, 5555]) {
    emit(`RUNNING recover seed ${seed}...`);
    const r = recoverFuzz(seed);
    recovered.push(r);
    const status = r.threw ? 'THREW' : (r.violations.length ? 'VIOLATION' : 'clean');
    say(`  seed ${String(seed).padEnd(6)} ${String(status).padEnd(10)} ` +
        `${String(r.presses).padStart(4)} presses of X, ${String(r.recovered).padStart(3)} ` +
        `un-stuck something, ${String(r.delivered).padStart(2)} delivered, ` +
        `${r.spills} spills (${r.spillsAfterRecover} within 2 steps of a recover)`);
    // The census, because "clean" only means something if the states it claims to have
    // covered actually occurred.
    say(`              caught: ${Object.entries(r.hit).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    report(r);
  }
  say('');

  /* The A/B behind the number above. Two identical worlds, one loaded train standing
   * perfectly still in each, and one press of X between them. */
  say('── RECOVER, ISOLATED: the same wedged train, with X and without ─────────');
  emit('RUNNING recover probe...');
  const probe = recoverSpillProbe();
  if (!probe.withX.ok || !probe.withoutX.ok) {
    say(`  inconclusive: ${probe.withX.why || probe.withoutX.why}`);
  } else {
    for (const r of [probe.withoutX, probe.withX]) {
      say(`  ${r.pressX ? 'X pressed    ' : 'X not pressed'}  tractor speed ${r.speedBefore} m/s, ` +
          `cart at (${r.before.x}, ${r.before.y}) stability ${r.before.stability} ` +
          `with ${r.before.aboard} aboard  ->  (${r.after.x}, ${r.after.y}) ` +
          `stability ${r.after.stability}, ${r.after.aboard} aboard, ${r.spilled} spilled`);
    }
    say(probe.spilledOnRecover > 0
      ? `  ONE PRESS OF X COST ${probe.spilledOnRecover} BAG(S) off a stationary train. ` +
        'src/systems/interaction.js recoverStuck teleports; src/systems/hitching.js ' +
        'updateTrain differences position across the teleport and reads it as a corner.'
      : '  no difference — recover did not cost the train anything here');
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
  const all = plain.concat(chaos).concat(guided).concat(recovered);
  const threw = all.filter((r) => r.threw).length;
  const violated = all.filter((r) => r.violations.length).length;
  const simSec = all.reduce((n, r) => n + r.simMs, 0) / 1000;
  const wallMs = plain.reduce((n, r) => n + (r.ms || 0), 0);

  say('── VERDICT ──────────────────────────────────────────────────────────────');
  say(`${all.length} fuzzed shifts, ${(simSec / 60).toFixed(1)} minutes of simulated play`);
  say(`uncaught errors      ${threw}`);
  say(`invariant violations ${violated}`);
  say(`restart problems     ${rt.problems.length}${rt.threw ? ' + threw' : ''}`);
  say(`recover presses      ${recovered.reduce((n, r) => n + r.presses, 0)} of X, ` +
      `${recovered.reduce((n, r) => n + r.recovered, 0)} of which actually un-stuck ` +
      `something, from ${recovered.reduce((n, r) => n + r.hit.wedged, 0)} manufactured wedges`);
  say(`spills after recover ${recovered.reduce((n, r) => n + r.spillsAfterRecover, 0)} of ` +
      `${recovered.reduce((n, r) => n + r.spills, 0)} — a teleport must not read as a corner`);
  /* Deliberately NOT part of the verdict below. A spilled bag breaks no invariant — GDD
   * §10.2 says a spilled bag is legal, physical and retrievable — so "soak clean" is still
   * a true statement about the invariants, which is all it has ever claimed. It is a
   * DESIGN defect in src, reported rather than fixed, and it goes here so nobody has to
   * scroll for it. */
  say(`recover cost         ${probe.spilledOnRecover > 0
    ? `${probe.spilledOnRecover} bag(s) thrown off a STANDING train by one press of X ` +
      '— src defect, reported not fixed'
    : 'nothing'}`);
  say(`speed                ${(plain.reduce((n, r) => n + r.simMs, 0) / wallMs).toFixed(0)}x ` +
      `real time, with a full invariant sweep on every single step`);

  const clean = threw === 0 && violated === 0 && rt.problems.length === 0 && !rt.threw;
  emit(clean ? `ALL-PASS  soak clean across ${all.length} fuzzed shifts`
             : `FAILURES  ${threw + violated + rt.problems.length} problems`);
})().catch((e) => { say('HARNESS THREW: ' + ((e && e.stack) || e)); emit('FAILURES  1 of 1'); });
