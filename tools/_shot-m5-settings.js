/* Screenshot pose for Milestone 5: the settings panel (GDD §16.6).
 *
 * Opened over a paused live shift rather than over the title card, because that is where
 * a player reaches for it — mid-shift, having decided the schedule is too tight.
 */
const { game, camera, renderer, hud, debug, input, CONFIG } = window.__ABC;

game.startShift();
game.skipMs(96000);

// AFTER startShift, never before: reset() replaces game.state with a NEW object.
const st = game.state;

st.player.x = 24.8; st.player.y = 16.2;
game.frame(1000 / 60, null);

camera.follow(st.player.x, st.player.y, 0);
renderer.render(st, 1 / 60);

game.togglePause();
hud.settings.show();
hud.update();
debug.update(16.7);

void input; void CONFIG;
