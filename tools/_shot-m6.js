/* Screenshot pose for Milestone 6: the balance pass, in the only terms that matter.
 *
 * Milestone 6 did not add a thing you can look at — it changed what a shift is WORTH.
 * Before it, every run of every seed finished in five figures of deficit; after it, a
 * competent crew clears three quarters of the schedule and ends in credit. So the shot is
 * the shift report at the end of a real played shift, with `CrewBot` at the controls the
 * whole way: walking, placarding, hitching, driving and carrying bags into holds through
 * the actual input path. Nothing here is posed except the decision to photograph it.
 */
const { game, camera, renderer, hud, debug, input, CONFIG } = window.__ABC;

Promise.all([
  import('./_bot.js'),
  import('../src/core/input.js'),
]).then(([bot, inp]) => {
  const keys = new inp.Input(window);
  bot.playShift(game, keys, 'average');

  camera.follow(game.state.player.x, game.state.player.y, 0);
  renderer.render(game.state, 1 / 60);
  hud.update();
  debug.update(16.7);
});
void input; void CONFIG;
