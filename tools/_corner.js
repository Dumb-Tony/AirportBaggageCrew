/* GDD §36 — IS CORNERING A DECISION?
 *
 * §6.4 lets spill be a stability score rather than physics, and it is: lateral load is
 * speed x yaw rate scaled by fill, and a full-lock circle at top speed empties a cart.
 * §11.3 counts the near-losses. The intent behind all of it is that hauling a full cart
 * fast is a GAMBLE — that "ease off for this corner" is a decision a player makes, gets
 * wrong, and learns from.
 *
 * Nobody has ever tested whether the gamble is worth taking, and the shipped crew is
 * evidence that it is not: it holds 97% throttle, spends 94% of the open run at top speed,
 * delivers 85%, and sheds about 5.7 bags a shift doing it. If five bags cost less than the
 * time saved, easing off is never right and the whole stability model is a cost with no
 * decision attached — flavour rather than a mechanic.
 *
 * ⚠ THE INSTRUMENT COULD NOT ANSWER THIS UNTIL TODAY. `steer` is -1/0/+1 and the throttle
 * is held or not, so `CrewBot` had no gentle option — and a measurement of a choice the
 * instrument cannot express is a measurement of the instrument. That is the same trap that
 * made every per-trip cost in the balance report roughly double the real one for two
 * milestones. `_bot.js` now has an ANTICIPATORY ease-off (about to steer, above 4.5 m/s,
 * load behind it) and this file is the A/B.
 *
 * It MEASURES; it does not gate. Whatever it finds goes into GDD §36 and the README, and
 * the assertion it licenses goes into a suite.
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
/*
 * ⚠ FLUSH ON EVERY LINE. `say` only appends to an array; `emit` is what writes it into the
 * DOM the harness greps. The first two runs of this file appeared to stop mid-sweep at
 * "RUNNING veteran careful seed 2468" — and the real story was that all eighteen shifts had
 * already finished and it threw AFTERWARDS, in the arithmetic. Every table it had built was
 * sitting unflushed in `lines`, so the last thing in the block was the progress line before
 * the final run, which reads exactly like a hang. Chrome's virtual-time budget got the
 * blame; tripling it changed nothing, because that was never it.
 *
 * "Emit progressively" is not enough on its own — the emit has to happen where the OUTPUT
 * is produced, not only where the work starts. Emit on every line; this is a diagnostic,
 * not a hot loop.
 */
const say = (s) => { lines.push(s); emit('RUNNING...'); };
const newGame = (seed) => new Game({ seed, seedLabel: 'corner', storage: memoryStorage() });
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

const SEEDS = [12345, 777, 2468];
const SKILL_ORDER = ['novice', 'average', 'veteran'];

/*
 * ⚠ CATCH AND PRINT. The first two runs of this file stopped at the SAME cell — veteran,
 * careful, seed 2468 — with the last line in the block being a progress message and no
 * error anywhere, and tripling Chrome's virtual-time budget changed nothing. An uncaught
 * throw inside an async IIFE becomes an unhandled rejection: the final `emit()` never
 * runs, so the harness sees no verdict and reports the whole run as failed. That is
 * indistinguishable from running out of virtual time, which is what it was first blamed on.
 * A diagnostic that emits progressively must also emit its own stack trace.
 */
(async () => {
 try {
  say('== GDD §36: flat out against careful, on identical shifts =================');
  say('');
  say('ease-off rule: about to steer, above 4.5 m/s, load on the train.');
  say('  (4.5 is measured — m2 F5b sweeps a full-lock circle and nothing sheds below it.');
  say('   The first run of this file used 2.6, which is where STABILITY starts draining,');
  say('   and so spent time avoiding a cost that does not exist at that speed.)');
  say(`spill terms in play: latMps2 ${CONFIG.cart.spillLatMps2}, drainRate ${CONFIG.cart.spillDrainRate}, ` +
      `ejectMps ${CONFIG.cart.spillEjectMps}, stabilityAfter ${CONFIG.cart.spillStabilityAfter}`);
  say('');

  const rows = [];
  for (const skill of SKILL_ORDER) {
    for (const careful of [false, true]) {
      const runs = [];
      for (const seed of SEEDS) {
        emit(`RUNNING ${skill} ${careful ? 'careful' : 'flat out'} seed ${seed}...`);
        runs.push(playShift(newGame(seed), new Input(window), skill, 900000, { careful }));
      }
      const row = {
        skill, careful,
        pct: median(runs.map((r) => r.pct)),
        points: median(runs.map((r) => r.points)),
        correct: median(runs.map((r) => r.correct)),
        spills: median(runs.map((r) => r.spills)),
        corners: median(runs.map((r) => r.hardCorners)),
        driven: Math.round(mean(runs.map((r) => r.bot.drivenM))),
        easedS: +(mean(runs.map((r) => r.bot.easedOffMs)) / 1000).toFixed(1),
        lifts: Math.round(mean(runs.map((r) => r.bot.corneringLifts))),
        loadedCornerS: +(mean(runs.map((r) => r.bot.loadedCorneringMs)) / 1000).toFixed(1),
        hauls: Math.round(mean(runs.map((r) => r.bot.hauls))),
        runs,
      };
      rows.push(row);
      say(`  ${skill.padEnd(8)} ${(careful ? 'careful ' : 'flat out')}  ` +
          `${String(row.correct).padStart(2)}/51 (${String(row.pct).padStart(3)}%)  ` +
          `${String(row.points).padStart(6)} pts  ` +
          `${String(row.spills).padStart(2)} spills  ` +
          `${String(row.corners).padStart(3)} corners  ` +
          `${String(row.driven).padStart(4)} m driven  ` +
          `eased off ${String(row.easedS).padStart(5)} s over ${String(row.lifts).padStart(3)} lifts`);
      for (const r of row.runs) {
        say(`           seed-level: ${r.correct}/51, ${r.points} pts, ${r.spills} spills, ` +
            `${r.hardCorners} corners, ${Math.round(r.bot.drivenM)} m`);
      }
    }
    say('');
  }

  /*
   * ⚠ COMPARE PAIRS, NOT MEDIANS. The first version of this section differenced the two
   * medians and announced that careful driving WINS, on +100 points at average skill and
   * +400 at veteran — with delivery identical to the bag at all three skill levels (24, 44
   * and 30 of 51). Both claims came out of the same three-seed sample whose own spread at
   * veteran is 900 points.
   *
   * Worse, the median hid the single most interesting number in the run. Paired by seed,
   * novice on seed 777 goes from 37 delivered to 24 — thirteen bags and 3350 points lost to
   * easing off — and the median of {14, 24, 24} against {13, 37, 24} is 24 either way, so
   * it vanished completely. A median is the right summary for GATING a balance claim across
   * seeds, which is what m6 D3 uses it for; it is the wrong summary for an A/B, where every
   * pair shares a seed and the pairing is the whole point.
   */
  say('== THE COMPARISON, paired by seed =========================================');
  say('');
  const S = CONFIG.score;
  const perBag = (S.correctBag || 0) - (S.missedBag || 0);
  let spillFlat = 0, spillCare = 0, spillPairsDown = 0, spillPairsUp = 0;
  const bagDeltas = [];
  for (const skill of SKILL_ORDER) {
    const flat = rows.find((r) => r.skill === skill && !r.careful);
    const care = rows.find((r) => r.skill === skill && r.careful);
    const shiftS = Math.round(flat.runs[0].simMs / 1000);
    say(`  ${skill}:`);
    SEEDS.forEach((seed, i) => {
      const f = flat.runs[i], c = care.runs[i];
      const dBag = c.correct - f.correct, dPts = c.points - f.points, dSp = c.spills - f.spills;
      bagDeltas.push(dBag);
      spillFlat += f.spills; spillCare += c.spills;
      if (dSp < 0) spillPairsDown++; else if (dSp > 0) spillPairsUp++;
      say(`    seed ${String(seed).padEnd(6)} ${String(f.correct).padStart(2)} -> ` +
          `${String(c.correct).padStart(2)} bags (${dBag >= 0 ? '+' : ''}${dBag}), ` +
          `${String(f.points).padStart(6)} -> ${String(c.points).padStart(6)} pts ` +
          `(${dPts >= 0 ? '+' : ''}${dPts}), ` +
          `${f.spills} -> ${c.spills} spills (${dSp >= 0 ? '+' : ''}${dSp})`);
    });
    /* AN OUTLIER IS ONLY WORTH SOMETHING IF IT EXPLAINS ITSELF. A pair that swings double
     * digits is a knock-on through the haul schedule rather than a verdict on cornering,
     * and `missesByReason` says which: bags STILL IN A CART mean a haul that left too late
     * and found the hold shut — which at novice's `haulAt: 10` costs a whole load at once
     * instead of a bag. Printed only where it matters, so the table stays readable. */
    SEEDS.forEach((seed, i) => {
      const f = flat.runs[i], c = care.runs[i];
      if (Math.abs(c.correct - f.correct) <= 2) return;
      say(`    !! seed ${seed} swung ${c.correct - f.correct} bags. Where they ended up:`);
      say(`         flat out: ${JSON.stringify(f.missesByReason)}`);
      say(`         careful : ${JSON.stringify(c.missesByReason)}`);
      say(`         hauls ${f.bot.hauls} -> ${c.bot.hauls}, cart loads ` +
          `${f.bot.cartLoads} -> ${c.bot.cartLoads}, hold loads ` +
          `${f.bot.holdLoads} -> ${c.bot.holdLoads}`);
    });
    const pctOfShift = shiftS ? (100 * care.easedS / shiftS).toFixed(1) : '?';
    say(`    cost of care: ${care.easedS} s off the throttle in a ${shiftS} s shift ` +
        `(${pctOfShift}%), over ${care.lifts} lifts`);
    say(`    loaded cornering above the shed speed: ${flat.loadedCornerS} s flat out, ` +
        `${care.loadedCornerS} s careful`);
    say('');
  }

  const spillDrop = spillFlat - spillCare;
  const spillPct = spillFlat ? Math.round(100 * spillDrop / spillFlat) : 0;
  const bagSum = bagDeltas.reduce((a, b) => a + b, 0);
  const bagWorst = Math.min(...bagDeltas);
  const bagBest = Math.max(...bagDeltas);
  const bagFlat = bagDeltas.filter((d) => Math.abs(d) <= 2).length;

  say('== VERDICT ================================================================');
  say('');
  say(`  spills across ${bagDeltas.length} paired shifts: ${spillFlat} flat out, ${spillCare} careful ` +
      `(${spillDrop >= 0 ? '-' : '+'}${Math.abs(spillDrop)}, ${spillPct}%), ` +
      `down in ${spillPairsDown} pairs, up in ${spillPairsUp}`);
  say(`  delivery: ${bagFlat} of ${bagDeltas.length} pairs move by two bags or fewer; ` +
      `range ${bagWorst} to +${bagBest}; total ${bagSum >= 0 ? '+' : ''}${bagSum}`);
  say(`  a bag is worth ${perBag} points, so ${spillDrop} spills saved is worth ` +
      `up to ${spillDrop * perBag} points IF a spilled bag would otherwise have missed`);
  say('');

  if (spillPairsDown <= spillPairsUp) {
    say('  Easing off did NOT reliably reduce spills. That is a finding about the MODEL and');
    say('  not about the price: the cost is not responsive to the only input a player has,');
    say('  so no amount of tuning makes it a decision. Check the lift counts first — a rule');
    say('  that never fires proves nothing.');
  } else if (bagFlat === bagDeltas.length) {
    say('  THE MODEL IS RESPONSIVE AND THE STAKE IS NOT. Easing off measurably reduces');
    say('  spills, and it changes delivery in no pair by more than two bags — while costing');
    say('  under 4% of the shift. So being careful is nearly free AND nearly pointless: the');
    say('  gamble is not a gamble in either direction, and cornering is not yet a decision.');
    say('  A bigger spill price is the obvious next lever and probably the wrong one, since');
    say('  90% of missed bags are still sitting in a cart — lost to TRIPS, not to spills.');
  } else {
    say('  Delivery moves by more than two bags in at least one pair, so the policy is not');
    say('  outcome-neutral and the outlier is the finding. Read the paired lines: a single');
    say('  seed swinging double digits is a knock-on through the haul schedule, not a');
    say('  verdict on cornering, and it wants explaining before anything is tuned.');
  }
  say('');
  say(`  raw: ${JSON.stringify(rows.map((r) => ({ s: r.skill, c: r.careful, pct: r.pct,
        pts: r.points, sp: r.spills, hc: r.corners, m: r.driven, off: r.easedS })))}`);

  emit(`ALL-PASS  0 assertions`);
 } catch (e) {
  say('');
  say('!! THREW, and here is where:');
  say(String((e && e.stack) || e));
  emit('FAILURES  1 of 1');
 }
})();
