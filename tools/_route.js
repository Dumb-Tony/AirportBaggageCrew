/* Where the haul actually goes — a route diagnostic, not a suite.
 *
 * The balance telemetry says a round trip to a gate costs about 80 s. The straight-line
 * distance is roughly 140 m there and back, and the tractor's top speed is 7 m/s, so the
 * floor is about 20 s. Four times the floor is not a distance problem, and CLAUDE.md has
 * already paid twice for reasoning about a stall instead of instrumenting it.
 *
 * So: play real shifts, sample the tractor EVERY STEP, and bin what it was doing by where
 * it was. The output is a strip chart of the route from the sort room to the ramp — time
 * spent, mean speed, and how much of it was spent below walking pace — which turns "the
 * haul is too long" into a claim about a specific ten metres of the map.
 *
 * Gates nothing. It measures. `tools\test.ps1` does not run it.
 *
 * ── WHAT IT FOUND, 2026-08-21 ───────────────────────────────────────────────
 *
 * The tractor reaches 7.00 m/s in 1.5 s with the throttle simply held down, towing or
 * not — that is the CONTROL section at the bottom, and it is the number the vehicle is
 * capable of. Across fifty-two metres of completely empty ramp the bot averages
 * 4.16 m/s, holds the throttle 31% of the time and reverse or brake 69%, and has a mean
 * SIGNED speed of 0.03 m/s. It travels backwards almost exactly as far as it travels
 * forwards, at the 3 m/s reverse cap, while believing it is driving to the gate.
 *
 * So THE HAUL IS NOT LONG; THE INSTRUMENT CANNOT DRIVE. Every per-trip cost in the
 * balance report is roughly double the real one, and "the constraint is trips to the
 * gate, shorten the haul before touching the timetable again" was a conclusion drawn
 * from it. The map is not the problem. Do not move the gates.
 *
 * ── AND WHY THE OBVIOUS FIX IS NOT IN `_bot.js` ─────────────────────────────
 *
 * The cause is `_driveTo`'s reverse branch: it steers to aim the tractor's REAR at the
 * waypoint, so when the target is directly behind, the steering error is zero, no
 * steering is applied, and it reverses in a dead straight line for as far as the target
 * happens to be. Correcting that is four lines and it works — the open run goes to
 * 6.96 m/s, throttle 100%, reverse 0%, 98% at top speed.
 *
 * DELIVERY THEN FALLS FROM 79% TO 54%, because the rest of the bot was tuned around the
 * broken driving. Five rounds of follow-on fixes were tried and each moved the failure
 * somewhere else: forbidding reverse beyond ten metres banned it in the sort room too,
 * where the turning circle does not fit, and hitching went from 10 s a shift to 157 s
 * with twenty-four dead ends; capping reverse by duration let it chatter instead;
 * splitting the steering by intent (aim the nose when travelling, the tow point when
 * backing onto a drawbar) fixed both of those and exposed the next one — the bot now
 * arrives at the drop point and STOPS on it, and the drop requires `speed > 1`, so it
 * parks a three-cart train at (15, 23.2) at 0.07 m/s and SK307 loses all twelve bags.
 * That last one is not reachable at all until the driving works.
 *
 * All of it reverted. A regression shipped to chase an improvement is still a
 * regression, and the finding above is worth more than a half-converged bot. The next
 * person to pick this up should fix the driving FIRST and then expect to re-tune the
 * hitch, drop and unload phases against it — they encode the old speeds.
 */

import { Game } from '../src/game.js';
import { Input } from '../src/core/input.js';
import { CONFIG } from '../src/config.js';
import { WORLD, DOOR, ANCHORS } from '../src/data/airport.js';
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
    (status || 'ALL-PASS  route report complete') + '\n==ABCTEST-END==';
}

const FRAME_MS = 1000 / 60;
const BIN_M = 5;                                   // one bin per five metres of x
const BINS = Math.ceil(WORLD.widthM / BIN_M);
const SEEDS = [12345, 777, 2468];

/** One bin: how long the tractor spent here, how fast, and how often it was crawling. */
const blank = () => Array.from({ length: BINS }, () => ({ ms: 0, dist: 0, slow: 0, stopped: 0 }));

function playAndSample(seed) {
  const g = new Game({ seed, seedLabel: 'route' });
  const input = new Input(window);
  const bot = new CrewBot('average');
  g.startShift();
  const bins = blank();
  const open = { ms: 0, speedSum: 0, absSum: 0, reverseMs: 0, atTopMs: 0,
                 throttleMs: 0, brakeMs: 0, steerMs: 0, phase: {} };
  let lastX = null, lastY = null;
  let drivingMs = 0;

  let frames = 0;
  while (frames++ < 60 * 900 && !g.state.shift.ended) {
    bot.step(g, input, FRAME_MS);
    g.frame(FRAME_MS, input);

    const st = g.state;
    const v = st.vehiclesById[st.player.drivingId];
    if (!v) { lastX = null; continue; }            // only sample while somebody is driving

    drivingMs += FRAME_MS;
    const b = Math.min(BINS - 1, Math.max(0, Math.floor(v.x / BIN_M)));
    const bin = bins[b];
    bin.ms += FRAME_MS;
    if (lastX !== null) bin.dist += Math.hypot(v.x - lastX, v.y - lastY);
    const sp = Math.abs(v.speed);
    if (sp < CONFIG.player.maxSpeed) bin.slow += FRAME_MS;
    if (sp < 0.5) bin.stopped += FRAME_MS;
    lastX = v.x; lastY = v.y;

    /* On the OPEN RUN only — fifty metres with nothing in the way — record what the
     * tractor was actually doing. A mean of 4.2 m/s against a 7 m/s top speed is either
     * a throttle that is not held, a reverse that should not be happening, or time spent
     * parked; these three counters tell them apart without another guess. */
    if (v.x >= 36 && v.x <= 88) {
      open.ms += FRAME_MS;
      open.speedSum += v.speed;                   // SIGNED: reverse cancels forward
      open.absSum += sp;
      if (v.speed < -0.1) open.reverseMs += FRAME_MS;
      if (sp >= 6.9) open.atTopMs += FRAME_MS;
      if (input.isDown('moveUp')) open.throttleMs += FRAME_MS;
      if (input.isDown('moveDown')) open.brakeMs += FRAME_MS;
      if (input.isDown('moveLeft') || input.isDown('moveRight')) open.steerMs += FRAME_MS;
      open.phase[bot.phase] = (open.phase[bot.phase] || 0) + FRAME_MS;
    }
  }
  return { bins, drivingMs, open, stats: bot.stats };
}

/* ── run ─────────────────────────────────────────────────────────────────── */
try {
  say('ROUTE DIAGNOSTIC — where the haul actually goes');
  say('Sampled every simulation step while somebody is driving, across 3 seeds at average skill.');
  say('');

  const total = blank();
  const open = { ms: 0, speedSum: 0, absSum: 0, reverseMs: 0, atTopMs: 0,
                 throttleMs: 0, brakeMs: 0, steerMs: 0, phase: {} };
  let drivingMs = 0, trips = 0;
  for (const seed of SEEDS) {
    emit(`RUNNING seed ${seed}...`);
    const r = playAndSample(seed);
    drivingMs += r.drivingMs;
    trips += r.stats.hauls || 0;
    for (const k of ['ms','speedSum','absSum','reverseMs','atTopMs','throttleMs','brakeMs','steerMs']) {
      open[k] += r.open[k];
    }
    for (const [p, ms] of Object.entries(r.open.phase)) open.phase[p] = (open.phase[p] || 0) + ms;
    for (let i = 0; i < BINS; i++) {
      total[i].ms += r.bins[i].ms;
      total[i].dist += r.bins[i].dist;
      total[i].slow += r.bins[i].slow;
      total[i].stopped += r.bins[i].stopped;
    }
  }

  const top = CONFIG.tractor.maxSpeed;
  say(`total time with a driver: ${(drivingMs / 1000).toFixed(0)}s across ${SEEDS.length} shifts, ${trips} cart trips`);
  say(`tractor top speed ${top} m/s, walking pace ${CONFIG.player.maxSpeed} m/s`);
  say('');
  say('  x range      time    dist   mean speed   below walk   stopped   what is here');
  say('  ' + '-'.repeat(86));

  const label = (x0, x1) => {
    const mid = (x0 + x1) / 2;
    if (x1 <= 34) return 'sort room (cart bays)';
    if (x0 < 36 && x1 > 34) return `THE DOORWAY (${DOOR.y1 - DOOR.y0} m gap)`;
    if (mid < 56) return 'staging';
    if (mid < 66) return 'service road';
    if (mid < 70) return 'ramp edge';
    if (mid < 88) return 'ramp, approaching the stands';
    if (mid < 94) return `at the hold doors (gate 1 x=${ANCHORS.gate1Hold.x})`;
    return 'ramp, beyond the holds';
  };

  let worst = null;
  for (let i = 0; i < BINS; i++) {
    const b = total[i];
    if (b.ms < 200) continue;                      // nothing meaningful happened here
    const x0 = i * BIN_M, x1 = x0 + BIN_M;
    const sec = b.ms / 1000;
    const mean = b.dist / (b.ms / 1000);
    const slowPct = Math.round((b.slow / b.ms) * 100);
    const stopPct = Math.round((b.stopped / b.ms) * 100);
    const bar = '#'.repeat(Math.min(20, Math.round(sec / 2)));
    say(`  ${String(x0).padStart(3)}-${String(x1).padStart(3)} m ` +
        `${sec.toFixed(1).padStart(7)}s ${b.dist.toFixed(0).padStart(6)}m ` +
        `${mean.toFixed(2).padStart(8)} m/s ${String(slowPct).padStart(9)}% ` +
        `${String(stopPct).padStart(8)}%   ${label(x0, x1)} ${bar}`);
    if (!worst || b.ms > worst.ms) worst = { ...b, x0, x1, sec, mean };
  }

  say('');
  say('── THE VERDICT ─────────────────────────────────────────────────────────');
  const doorBin = total[Math.floor(34 / BIN_M)];
  const doorSec = doorBin.ms / 1000;
  say(`the single most expensive five metres is x=${worst.x0}-${worst.x1}: ` +
      `${worst.sec.toFixed(1)}s at ${worst.mean.toFixed(2)} m/s`);
  say(`the doorway strip (x=30-35) costs ${doorSec.toFixed(1)}s, ` +
      `${Math.round((doorBin.ms / drivingMs) * 100)}% of all driving time`);

  const openRoad = [];
  for (let i = Math.floor(36 / BIN_M); i < Math.floor(88 / BIN_M); i++) openRoad.push(total[i]);
  const orMs = openRoad.reduce((n, b) => n + b.ms, 0);
  const orDist = openRoad.reduce((n, b) => n + b.dist, 0);
  say(`the open run (x=36-88, ${52} m of nothing in the way) costs ` +
      `${(orMs / 1000).toFixed(1)}s at ${(orDist / (orMs / 1000)).toFixed(2)} m/s mean ` +
      `— ${Math.round((orMs / drivingMs) * 100)}% of all driving time`);
  say('');
  say('── WHAT THE TRACTOR IS DOING ON THE OPEN RUN (x=36-88) ─────────────────');
  const pct = (n) => `${Math.round((n / open.ms) * 100)}%`.padStart(4);
  say(`  time here                ${(open.ms / 1000).toFixed(1)}s`);
  say(`  mean SIGNED speed        ${(open.speedSum / (open.ms / FRAME_MS)).toFixed(2)} m/s   (reverse cancels forward)`);
  say(`  mean speed regardless    ${(open.absSum / (open.ms / FRAME_MS)).toFixed(2)} m/s   against a ${top} m/s top speed`);
  say(`  throttle held            ${pct(open.throttleMs)}`);
  say(`  reverse/brake held       ${pct(open.brakeMs)}`);
  say(`  steering                 ${pct(open.steerMs)}`);
  say(`  actually rolling backwards ${pct(open.reverseMs)}`);
  say(`  at or near top speed     ${pct(open.atTopMs)}`);
  say(`  phases spent here: ` + Object.entries(open.phase)
      .sort((a, b) => b[1] - a[1])
      .map(([p, ms]) => `${p} ${(ms / 1000).toFixed(0)}s`).join(', '));
  say('');
  say('Read it this way: if the open run is already near top speed, the map is not the');
  say('problem and moving the gates closer buys almost nothing. If the time is piled up');
  say('at one obstacle, that obstacle is the haul.');

  /*
   * THE CONTROL. The strip chart above is flat at about 4.2 m/s across fifty metres of
   * empty ramp, which is not what an obstacle looks like — and 4.2 is exactly the
   * PLAYER's walking speed, which is not the kind of coincidence to let pass. So drive a
   * tractor down the same open ramp with the throttle simply held down, no bot, no
   * steering, and see what the vehicle is actually capable of. If it reaches 7 m/s here,
   * the bot is the reason the haul is slow. If it does not, the tractor is.
   */
  say('');
  say('── CONTROL: throttle pinned, no bot, no steering, empty ramp ───────────');

  const straightLine = (towing) => {
    const g = new Game({ seed: 4242, seedLabel: 'route-control' });
    const input = new Input(window);
    g.startShift();
    const st = g.state;
    const v = Object.values(st.vehiclesById)[0];
    v.x = 68; v.y = 24; v.rot = 0; v.speed = 0;
    st.player.drivingId = v.id; v.driverId = st.player.id;

    let cart = null;
    if (towing) {
      cart = Object.values(st.cartsById)[0];
      cart.x = v.x - 3; cart.y = v.y; cart.rot = 0;
      cart.hitchedToId = v.id; v.nextCartId = cart.id;
    }

    input._debugPress('KeyW');   // stays in _down until released; endStep only clears edges
    const samples = [];
    let peak = 0, lastX = v.x;
    for (let i = 0; i < 60 * 12; i++) {              // twelve seconds of open ramp
      g.frame(FRAME_MS, input);
      const ground = Math.abs(v.x - lastX) / (FRAME_MS / 1000);
      lastX = v.x;
      peak = Math.max(peak, ground);
      if (i % 30 === 0) samples.push(ground.toFixed(2));
      if (v.x > 112) break;
    }
    input._debugRelease('KeyW');
    return { peak, samples, endX: v.x };
  };

  for (const towing of [false, true]) {
    const r = straightLine(towing);
    say(`  ${towing ? 'towing one cart' : 'no cart      '}  peak ground speed ` +
        `${r.peak.toFixed(2)} m/s against a configured top speed of ${top} m/s`);
    say(`     half-second samples: ${r.samples.slice(0, 14).join(' ')}`);
  }
  say('');
  say(`  the player walks at ${CONFIG.player.maxSpeed} m/s. If the tractor tops out near that,`);
  say('  driving is not faster than walking and the whole vehicle is decoration.');

  emit();
} catch (e) {
  say('');
  say(`THREW: ${(e && e.stack) || e}`);
  emit('FAILURES  route diagnostic threw');
}
