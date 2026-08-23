/* Catch the bag that leaves the airport, at the step it happens.
 *
 * `tools\_balance.js` reported `bag_884104 escaped the airport at -181481.9, 13.0` on
 * novice/12345 once the shift went to 51 bags. y is exactly the conveyor's line and x is
 * five orders of magnitude outside a 120 m world, which is a numeric blow-up rather than
 * a bag being nudged through a wall.
 *
 * Reasoning about it is how this project has lost four rounds before. So: play that exact
 * shift, check every bag after every step, and the moment one goes outside the world dump
 * everything about it AND what it looked like the step before. Diagnostic, gates nothing.
 */

import { Game } from '../src/game.js';
import { Input } from '../src/core/input.js';
import { CONFIG } from '../src/config.js';
import { WORLD } from '../src/data/airport.js';
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
    (status || 'ALL-PASS  escape hunt complete') + '\n==ABCTEST-END==';
}

const FRAME = CONFIG.sim.stepMs;
const snap = (b) => ({
  id: b.id, x: +b.x.toFixed(2), y: +b.y.toFixed(2),
  vx: +(b.vx || 0).toFixed(2), vy: +(b.vy || 0).toFixed(2),
  loc: JSON.stringify(b.location), lifecycle: b.lifecycle,
});

try {
  say('ESCAPE HUNT — novice / 12345, the shift _balance.js reported');
  say('');

  const g = new Game({ seed: 12345, seedLabel: 'escape' });
  const input = new Input(window);
  const bot = new CrewBot('novice');
  g.startShift();

  const OUT = 200;                       // far outside a 120 x 70 m world
  let prev = new Map();
  let caught = null;
  let frames = 0;

  while (frames++ < 60 * 900 && !g.state.shift.ended && !caught) {
    bot.step(g, input, FRAME);
    g.frame(FRAME, input);

    for (const b of Object.values(g.state.bagsById)) {
      if (Math.abs(b.x) < OUT && Math.abs(b.y) < OUT &&
          Number.isFinite(b.x) && Number.isFinite(b.y)) continue;
      caught = {
        at: g.state.simTimeMs,
        now: snap(b),
        before: prev.get(b.id) || null,
        conv: {
          riding: g.state.world.conveyor.bagIds.length,
          delivered: g.state.world.conveyor.delivered,
          order: g.state.world.conveyor.bagIds.slice(0, 12),
          spacing: CONFIG.bag.beltSpacingM,
          lengthM: g.state.world.conveyor.lengthM,
        },
      };
      break;
    }
    prev = new Map();
    for (const b of Object.values(g.state.bagsById)) prev.set(b.id, snap(b));
  }

  if (!caught) {
    say(`no bag left the world in ${(g.state.simTimeMs / 1000).toFixed(0)}s of play.`);
    say(`world is ${WORLD.widthM} x ${WORLD.heightM} m; nothing exceeded +/-${OUT} m.`);
    emit();
  } else {
    say(`CAUGHT at ${(caught.at / 1000).toFixed(2)}s`);
    say('');
    say(`  now    ${JSON.stringify(caught.now)}`);
    say(`  before ${JSON.stringify(caught.before)}`);
    say('');
    say(`  conveyor: ${caught.conv.riding} riding, ${caught.conv.delivered} delivered, ` +
        `length ${caught.conv.lengthM.toFixed(2)} m, spacing ${caught.conv.spacing} m`);
    say(`  belt order (first 12): ${caught.conv.order.join(', ')}`);
    say('');
    /*
     * The two readings side by side are the whole diagnosis. A bag that was on the belt
     * with a sane `t` and is now at a wild x means the BELT parameter blew up; one that
     * was on the floor with a sane position means its VELOCITY did.
     */
    const b4 = caught.before;
    if (b4 && /conveyor/.test(b4.loc)) {
      say('  It was on the CONVEYOR the step before. The belt parameter is the suspect:');
      say('  stepConveyor caps each bag at `aheadT - beltSpacingM` and clamps below zero,');
      say('  so a wild t means `aheadT` itself was wild when the cap was applied.');
    } else if (b4) {
      say('  It was NOT on the conveyor the step before — look at velocity, not the belt.');
    }
    emit('FAILURES  a bag left the airport');
  }
} catch (e) {
  say(`THREW: ${(e && e.stack) || e}`);
  emit('FAILURES  escape hunt threw');
}
