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
 * milestones. `_bot.js` now has an ANTICIPATORY ease-off (about to steer, above 2.6 m/s,
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
const say = (s) => { lines.push(s); };
const newGame = (seed) => new Game({ seed, seedLabel: 'corner', storage: memoryStorage() });
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

const SEEDS = [12345, 777, 2468];
const SKILL_ORDER = ['novice', 'average', 'veteran'];

(async () => {
  say('== GDD §36: flat out against careful, on identical shifts =================');
  say('');
  say(`ease-off rule: about to steer, above 2.6 m/s, load on the train.`);
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

  say('== THE COMPARISON, per skill ==============================================');
  say('');
  let anyCarefulWins = false, anySpillReduction = false;
  for (const skill of SKILL_ORDER) {
    const flat = rows.find((r) => r.skill === skill && !r.careful);
    const care = rows.find((r) => r.skill === skill && r.careful);
    const dPct = care.pct - flat.pct;
    const dPts = care.points - flat.points;
    const dSpill = care.spills - flat.spills;
    if (dPts > 0) anyCarefulWins = true;
    if (dSpill < 0) anySpillReduction = true;
    say(`  ${skill.padEnd(8)} careful is ${dPct >= 0 ? '+' : ''}${dPct} points of delivery, ` +
        `${dPts >= 0 ? '+' : ''}${dPts} points, ${dSpill >= 0 ? '+' : ''}${dSpill} spills`);
    /* THE ARITHMETIC THAT ACTUALLY DECIDES IT. Easing off buys bags and costs seconds;
     * both have to be in the same currency before anything can be concluded. A bag
     * delivered is CONFIG.scoring.correctBag and a bag missed is missedBag, so a bag saved
     * is worth the gap between them. */
    const S = CONFIG.scoring;
    const perBag = (S.correctBag || 0) - (S.missedBag || 0);
    say(`           ${care.easedS} s off the throttle bought ${-dSpill} spill(s); ` +
        `a bag is worth ${perBag} points, so the load saved is worth ${-dSpill * perBag} ` +
        `against a score change of ${dPts}`);
    say(`           loaded cornering above 2.6 m/s: ${flat.loadedCornerS} s flat out, ` +
        `${care.loadedCornerS} s careful (${care.lifts} lifts)`);
  }
  say('');

  say('== VERDICT ================================================================');
  say('');
  if (!anySpillReduction) {
    say('  Easing off did NOT reduce spills at any skill level. That is a finding about');
    say('  the MODEL, not about the price: the cost is not responsive to the only input a');
    say('  player has, so no amount of tuning turns it into a decision. Check the ease-off');
    say('  rule fires at all (the lift counts above) before believing this.');
  } else if (anyCarefulWins) {
    say('  Careful driving WINS somewhere. Cornering is already a decision and the shipped');
    say('  crew has been playing it wrong — which moves the balance baseline and re-opens');
    say('  the bag count. Read the per-skill lines for where the crossover sits.');
  } else {
    say('  Careful driving reduces spills and still LOSES on points at every skill. So the');
    say('  gamble is real and the price is too low: the bags saved are worth less than the');
    say('  seconds spent saving them. That is a tuning answer if a crossover exists, and a');
    say('  design answer if it does not — sweep the spill terms next, and if none of them');
    say('  produce a crossover, spill needs a different KIND of cost rather than a bigger');
    say('  one (a damaged bag, a re-collection trip) or it should be recorded as flavour.');
  }
  say('');
  say(`  raw: ${JSON.stringify(rows.map((r) => ({ s: r.skill, c: r.careful, pct: r.pct,
        pts: r.points, sp: r.spills, hc: r.corners, m: r.driven, off: r.easedS })))}`);

  emit(`ALL-PASS  0 assertions`);
})();
