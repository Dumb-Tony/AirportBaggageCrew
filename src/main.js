/* Bootstrap — the only place mutable globals are allowed (GDD §31.3).
 *
 * Wiring order matters: Game owns state; Camera and Renderer observe it; Input feeds the
 * fixed step; the HUD and the debug overlay read. Nothing below decides a game rule.
 *
 * The frame is deliberately dumb:
 *     rAF -> game.frame(dt, input) -> clock.advance -> N * game.step
 *         -> renderer.render(state) -> hud.update() -> debug.update()
 * Simulation cannot advance anywhere else. That is the pause guarantee.
 */

import { CONFIG } from './config.js';
import { Game, MODES } from './game.js';
import { Input } from './core/input.js';
import { Camera } from './render/camera.js';
import { Renderer } from './render/renderer.js';
import { Hud } from './ui/hud.js';
import { DebugOverlay } from './dev/debugOverlay.js';
import { WORLD } from './data/airport.js';

const canvas = document.getElementById('stage');
const uiRoot = document.getElementById('ui');

const game = new Game({ seed: CONFIG.sim.defaultSeed, seedLabel: CONFIG.sim.seedLabel });

const camera = new Camera({
  worldW: WORLD.widthM,
  worldH: WORLD.heightM,
  paddingM: CONFIG.render.fitPaddingM,
  maxPixelRatio: CONFIG.render.maxPixelRatio,
});
const renderer = new Renderer(canvas, camera);
renderer.showGrid = CONFIG.render.showGrid;

const input = new Input(window).attach();
const hud   = new Hud(uiRoot, game);
const debug = new DebugOverlay(uiRoot, game, renderer);

/* Focus loss auto-pauses — GDD §24.3. Alt-tabbing out of a live airport and returning to
   three departed flights is a bug report, not a difficulty setting. */
input.onBlur = () => game.pauseForBlur();
document.addEventListener('visibilitychange', () => { if (document.hidden) game.pauseForBlur(); });

/* Screen-level keys are handled on the real keydown rather than through the per-step
   edge buffer: pausing must work on the very frame it is pressed, including while the
   simulation is stopped and therefore consuming no steps. */
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    e.preventDefault();
    if (game.state.mode === MODES.TITLE) game.startShift();
    else game.togglePause();
  }
  // Restart is gated behind the pause screen so a mistyped R cannot destroy a shift.
  if (e.code === 'KeyR' && game.state.mode === MODES.PAUSED) { e.preventDefault(); game.startShift(); }
});

let last = performance.now();

function frame(now) {
  const dt = now - last;
  last = now;

  camera.resize(canvas);
  game.frame(dt, input);

  renderer.render(game.state);
  hud.update();
  debug.update(dt);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* Debug/test handle. Mirrors `__SD` in Something's Different — the smoke-test harness
   drives the real objects through this rather than reaching into module scope. */
window.__ABC = { game, camera, renderer, hud, debug, input, CONFIG };
