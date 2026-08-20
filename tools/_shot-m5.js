/* Screenshot pose for Milestone 5: the first minute.
 *
 * Twenty seconds in, the rail on step two, a stalled hint showing under it, and an
 * announcement toast still up — the shot is of a player being TAUGHT while the airport
 * carries on regardless, which is the whole argument of GDD §16.5.
 */
const { game, camera, renderer, hud, debug, input, CONFIG } = window.__ABC;

game.startShift();
game.skipMs(118000);

// AFTER startShift, never before: reset() replaces game.state with a NEW object.
const st = game.state;

import('../src/systems/containment.js').then((con) => {
  /* The crew has walked a little, so step one is behind them and step two is live.
     Stood at the pile the belt drops into (airport.js SPOTS.conveyorEnd). */
  st.player.walkedM = 6;
  st.player.x = 24.8; st.player.y = 16.2;
  st.player.aimX = 0.6; st.player.aimY = -0.8;

  /* Bags off the belt, waiting on the sort-room floor in front of them. */
  const loose = Object.values(st.bagsById).filter((b) => b.location.type !== 'carried');
  loose.slice(0, 9).forEach((b, i) => {
    b.x = 22.9 + (i % 3) * 1.6; b.y = 14.2 + Math.floor(i / 3) * 1.7;
    b.vx = 0; b.vy = 0; b.rot = 0.4 + i * 0.9;
    b.cartCooldownMs = st.simTimeMs + 60000;
    con.moveBag(st, b, { type: 'floor' }, game.bus, st.simTimeMs);
  });

  /* Run the frame FIRST. Satisfying a step resets the stall timer by design, so the rail
     has to reach step two before it can be back-dated into a stall. */
  game.frame(1000 / 60, null);
  game.guide.enteredAtMs = st.simTimeMs - 12000;
  st.guide = null;
  game.frame(1000 / 60, null);

  camera.follow(st.player.x, st.player.y, 0);
  renderer.render(st, 1 / 60);
  hud.update();
  debug.update(16.7);
});
void input; void CONFIG;
