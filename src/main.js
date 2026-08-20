/* Bootstrap — the only place mutable globals are allowed (GDD §31.3).
 *
 * Wiring order matters: Game owns state; Camera and Renderer observe it; Input feeds the
 * fixed step; the HUD and the debug overlay read. Nothing below decides a game rule.
 *
 * The frame is deliberately dumb:
 *     rAF -> game.frame(dt, input) -> clock.advance -> N * game.step
 *         -> camera.follow -> renderer.render(state) -> hud.update() -> debug.update()
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
  viewWidthM: CONFIG.render.viewWidthM,
  followLerp: CONFIG.render.followLerp,
});
const renderer = new Renderer(canvas, camera);
renderer.showGrid = CONFIG.render.showGrid;

const input = new Input(window).attach();
const hud   = new Hud(uiRoot, game);
const debug = new DebugOverlay(uiRoot, game, renderer);

/* Mouse aim. The screen position is stored on move; the WORLD position is recomputed
   every frame, because the camera moves under a stationary cursor and the hands must
   keep pointing at the same place on the ramp, not the same place on the glass. */
window.addEventListener('mousemove', (e) => {
  input.pointer.x = e.clientX;
  input.pointer.y = e.clientY;
  input.pointer.seen = true;
});

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
    if (game.state.mode === MODES.TITLE) startShift();
    else game.togglePause();
  }
  // Restart is gated behind the pause screen so a mistyped R cannot destroy a shift.
  if (e.code === 'KeyR' && game.state.mode === MODES.PAUSED) { e.preventDefault(); startShift(); }
});

/** Start or restart, snapping the camera so a restart never pans across the airport. */
function startShift() {
  game.startShift();
  camera.follow(game.state.player.x, game.state.player.y, 0);
}
hud.onStart = startShift;
hud.report.onReplay = startShift;      // GDD §20.2: the report has a replay button

let last = performance.now();

function frame(now) {
  const dt = now - last;
  last = now;

  camera.resize(canvas);

  if (input.pointer.seen) {
    input.pointerWorld = camera.screenToWorld(input.pointer.x, input.pointer.y);
  }

  game.frame(dt, input);

  // Presentation only: the camera is not simulation, so it eases on REAL time and keeps
  // easing while paused. It must never feed anything back into the game.
  camera.follow(game.state.player.x, game.state.player.y, Math.min(dt, 100) / 1000);

  renderer.render(game.state);
  hud.update();
  debug.update(dt);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* Debug/test handle. Mirrors `__SD` in Something's Different — the smoke-test harness
   drives the real objects through this rather than reaching into module scope. */
window.__ABC = { game, camera, renderer, hud, debug, input, CONFIG, startShift };
