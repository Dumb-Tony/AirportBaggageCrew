/* The title card — the first screen anyone sees, and the one that quietly went a whole
 * milestone out of date. The scope line is DERIVED from the live timetable now, so this
 * shot is really a check that the derivation renders. */
const { game, camera, renderer, hud, debug, input, CONFIG } = window.__ABC;

camera.follow(game.state.player.x, game.state.player.y, 0);
renderer.render(game.state, 1 / 60);
hud.update();
debug.update(16.7);

void input; void CONFIG;
