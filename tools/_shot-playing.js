/* Screenshot setup: pose the game mid-shift with the debug overlay open, then paint.
 * Headless --dump-dom/--screenshot gives only a couple of rAF callbacks, so the frame is
 * driven and rendered explicitly here rather than waited for. */
const { game, renderer, hud, debug, input } = window.__ABC;

game.startShift();
for (let i = 0; i < 60 * 137; i++) game.frame(1000 / 60, input);   // 2:17 into the shift

renderer.showGrid = false;
renderer.showBounds = true;
debug.visible = true;
debug._apply();

renderer.render(game.state);
hud.update();
debug.update(16.7);
