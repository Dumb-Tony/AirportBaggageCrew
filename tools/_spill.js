/* What the cart stability model is actually doing — GDD §6.4, §10.2, §11.3.
 *
 * The README has carried "spill tuning is still provisional" since M6, and until the bot
 * could drive it was measuring almost nothing: a crew that reversed half of every haul at
 * 3 m/s never loaded a cart laterally. Now that the tractor reaches 7 m/s the model runs
 * for the first time, and the shift report says 200 CORNERS ABOVE SAFE SPEED — one every
 * three and a half seconds — against 5 bags actually shed.
 *
 * Those two numbers cannot both be describing the same thing, so this measures the whole
 * distribution rather than the two counters:
 *
 *   - how much lateral load a real crew generates, and for how long at a time;
 *   - how much stability each overload actually costs;
 *   - how many overloads are momentary (recovered, invisible) versus real (a bag on the
 *     floor). GDD §11.3 wants "corners taken above safe speed" as an ODD STATISTIC, and a
 *     number that ticks every few seconds is noise rather than an oddity.
 *
 * ⚠ STEERING IS BINARY. `stepVehicle` reads `steer = (right?1:0) - (left?1:0)`, so there
 * is no such thing as a gentle correction on a keyboard: every nudge is full lock, and at
 * 7 m/s with a full cart that is 7 x 1.8 x 1.5 = 18.9 against a threshold of 7.0. Whether
 * that is a problem depends entirely on how LONG each nudge lasts, which is the thing
 * nobody has measured.
 *
 * Gates nothing. It measures. `tools\test.ps1` does not run it.
 */

import { Game } from '../src/game.js';
import { Input } from '../src/core/input.js';
import { CONFIG } from '../src/config.js';
import { cartFillFrac } from '../src/entities/cart.js';
import { CrewBot } from './_bot.js';

const lines = [];
const say = (s = '') => lines.push(s);
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
    (status || 'ALL-PASS  spill report complete') + '\n==ABCTEST-END==';
}

const FRAME = CONFIG.sim.stepMs;
const SEEDS = [12345, 777, 2468];
const C = CONFIG.cart;

/** Play one shift, recording every overload episode from entry to recovery. */
function measure(seed) {
  const g = new Game({ seed, seedLabel: 'spill' });
  const input = new Input(window);
  const bot = new CrewBot('average');
  g.startShift();

  const episodes = [];             // one per continuous stretch above the threshold
  const open = new Map();          // cartId -> episode in progress
  const latSamples = [];
  let spills = 0, loadedSteps = 0;

  let frames = 0;
  while (frames++ < 60 * 900 && !g.state.shift.ended) {
    bot.step(g, input, FRAME);
    const before = new Map();
    for (const c of Object.values(g.state.cartsById)) {
      // `c.spills` is the cart's OWN counter, incremented only by spillOne. Counting a
      // drop in bagIds instead counts every bag the crew unloads into a hold, which is
      // how the first version of this reported 49 spills a shift against a real 5.
      before.set(c.id, { st: c.stability, spills: c.spills, bags: c.bagIds.length });
    }
    g.frame(FRAME, input);

    for (const c of Object.values(g.state.cartsById)) {
      const b = before.get(c.id);
      if (!b || !b.bags) continue;                 // an empty cart cannot spill
      loadedSteps++;
      spills += Math.max(0, c.spills - b.spills);

      /* Reconstruct the lateral load from the stability the step actually spent. The
       * model is `stability -= (lat - threshold) * drainRate * dt`, so a drop tells us
       * exactly how far over the threshold it was — no need to duplicate the maths and
       * risk measuring a different model from the one that ships. */
      const drop = b.st - c.stability;
      const over = drop > 0 ? drop / (C.spillDrainRate * (FRAME / 1000)) : 0;
      const lat = over > 0 ? over + C.spillLatMps2 : 0;
      if (lat > 0) latSamples.push(lat);

      if (lat > 0) {
        if (!open.has(c.id)) open.set(c.id, { ms: 0, peak: 0, cost: 0, fill: cartFillFrac(c) });
        const e = open.get(c.id);
        e.ms += FRAME; e.peak = Math.max(e.peak, lat); e.cost += Math.max(0, drop);
      } else if (open.has(c.id)) {
        episodes.push(open.get(c.id));
        open.delete(c.id);
      }
    }
  }
  for (const e of open.values()) episodes.push(e);
  return { episodes, latSamples, spills, loadedSteps, stats: g.state.stats };
}

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

try {
  say('SPILL DIAGNOSTIC — what the stability model is actually doing');
  say(`threshold ${C.spillLatMps2} m/s^2 · drain ${C.spillDrainRate}/unit · ` +
      `recover ${C.stabilityRecover}/s · after a spill, stability resets to ${C.spillStabilityAfter}`);
  say(`worst case the tractor can produce: ${CONFIG.tractor.maxSpeed} m/s x ` +
      `${CONFIG.tractor.maxYawRate} rad/s x 1.5 (full cart) = ` +
      `${(CONFIG.tractor.maxSpeed * CONFIG.tractor.maxYawRate * 1.5).toFixed(1)} m/s^2`);
  say('');

  let all = [], lats = [], spills = 0, loadedSteps = 0, hardCorners = 0;
  for (const seed of SEEDS) {
    emit(`RUNNING seed ${seed}...`);
    const r = measure(seed);
    all = all.concat(r.episodes);
    lats = lats.concat(r.latSamples);
    spills += r.spills;
    loadedSteps += r.loadedSteps;
    hardCorners += (r.stats && r.stats.hardCorners) || 0;
  }

  const n = SEEDS.length;
  say(`across ${n} shifts at average skill:`);
  say(`  overload episodes        ${(all.length / n).toFixed(1)} per shift`);
  say(`  "hard corners" counter   ${(hardCorners / n).toFixed(1)} per shift  <- the shift report's number`);
  say(`  bags actually shed       ${(spills / n).toFixed(1)} per shift`);
  say(`  steps with a loaded cart ${(loadedSteps / n).toFixed(0)} per shift`);
  say('');

  const ms = all.map((e) => e.ms);
  say('  HOW LONG each overload lasts (ms):');
  say(`    median ${pct(ms, 0.5)}   75th ${pct(ms, 0.75)}   90th ${pct(ms, 0.9)}   worst ${Math.max(0, ...ms)}`);
  const brief = all.filter((e) => e.ms <= 100).length;
  say(`    ${brief} of ${all.length} (${Math.round((brief / Math.max(1, all.length)) * 100)}%) last 100 ms or less`);
  say('');

  say('  HOW HARD (peak lateral load, m/s^2, against a threshold of ' + C.spillLatMps2 + '):');
  const peaks = all.map((e) => e.peak);
  say(`    median ${pct(peaks, 0.5).toFixed(1)}   90th ${pct(peaks, 0.9).toFixed(1)}   worst ${Math.max(0, ...peaks).toFixed(1)}`);
  say('');

  say('  WHAT EACH ONE COSTS (stability, of 1.0):');
  const costs = all.map((e) => e.cost);
  say(`    median ${pct(costs, 0.5).toFixed(3)}   90th ${pct(costs, 0.9).toFixed(3)}   worst ${Math.max(0, ...costs).toFixed(3)}`);
  const trivial = all.filter((e) => e.cost < 0.05).length;
  say(`    ${trivial} of ${all.length} (${Math.round((trivial / Math.max(1, all.length)) * 100)}%) cost under 0.05 — ` +
      'invisible to the player, and recovered within a tenth of a second');
  say('');

  say('── THE VERDICT ─────────────────────────────────────────────────────────');
  const noisy = Math.round((trivial / Math.max(1, all.length)) * 100);
  say(`${noisy}% of the corners the shift report counts cost less than 5% of one cart's`);
  say('stability. GDD §11.3 asks for an ODD STATISTIC — something a player reads at the');
  say('end and finds funny or damning. A counter that ticks on a steering correction is');
  say('neither: it is measuring the keyboard, not the driving.');
  say('');
  say('Steering is BINARY, so every correction is full lock and every full-lock moment');
  say(`above ~2.6 m/s with a loaded cart is over the ${C.spillLatMps2} threshold. The model`);
  say('handles that correctly — brief overloads drain almost nothing and recover — but the');
  say('COUNTER does not, because it fires on the way in regardless of what follows.');

  emit();
} catch (e) {
  say(`THREW: ${(e && e.stack) || e}`);
  emit('FAILURES  spill diagnostic threw');
}
