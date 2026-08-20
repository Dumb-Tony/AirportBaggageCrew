/* Screenshot pose for Milestone 3: AB221 on final bag call at gate 1, hold open, a
 * loaded cart pulled up alongside, and the crew still feeding it.
 *
 * Two seconds after the transition, so the announcement toast is still up and the board
 * is amber — the shot shows all three of the GDD §5.3 urgency channels at once.
 */
const { game, camera, renderer, hud, debug, input, CONFIG } = window.__ABC;

game.startShift();
game.skipMs(152000);                       // 2:32 — final call rang at 2:30

// AFTER startShift, never before: reset() replaces game.state with a NEW object.
const st = game.state;

const flight = st.flightsById.flight_AB221;
const ac = st.aircraftById[flight.aircraftId];
const cart = st.cartsById.cart_1;
const tractor = st.vehiclesById.tractor_1;

Promise.all([
  import('../src/entities/aircraft.js'),
  import('../src/systems/interaction.js'),
  import('../src/systems/containment.js'),
]).then(([air, act, con]) => {
  const z = air.aircraftHoldZone(ac);

  /* Some of Atlanta already aboard, the rest still to go. */
  const atl = Object.values(st.bagsById).filter(
    (b) => b.flightId === 'flight_AB221' && b.location.type !== 'aircraftHold');
  for (const bag of atl.slice(0, 7)) {
    bag.x = z.x; bag.y = z.y;
    con.moveBag(st, bag, { type: 'aircraftHold', id: ac.id }, game.bus, st.simTimeMs);
  }

  /* The cart that brought them, parked at the hold door. */
  cart.x = z.x - 1.2; cart.y = z.y + 3.4; cart.rot = 0;
  cart.hitchedToId = tractor.id; tractor.nextCartId = cart.id;
  tractor.x = cart.x + 3.1; tractor.y = cart.y; tractor.rot = 0;
  act.setPlacard(st, cart, 'flight_AB221', game.bus, st.simTimeMs);
  for (const bag of atl.slice(7, 11)) {
    con.moveBag(st, bag, { type: 'cart', id: cart.id }, game.bus, st.simTimeMs);
  }

  /* The crew, one bag in hand, standing in the hold door. */
  const p = st.player;
  p.x = z.x - 0.4; p.y = z.y + 2.0; p.aimX = 0; p.aimY = -1;
  const inHand = atl[11];
  if (inHand) con.moveBag(st, inHand, { type: 'carried', id: 'player_1' }, game.bus, st.simTimeMs);

  /* A couple that did not make it into the cart, loose on the stand. */
  atl.slice(12, 14).forEach((b, i) => {
    b.x = z.x - 5.5 - i * 1.3; b.y = z.y + 4.6 + i * 0.7;
    b.vx = 0; b.vy = 0; b.rot = 0.5 + i;
    b.cartCooldownMs = st.simTimeMs + 60000;      // keep them on the ground for the shot
  });

  game.frame(1000 / 60, null);
  camera.follow(p.x, p.y, 0);
  renderer.render(st);
  hud.update();
  debug.update(16.7);
});
void input; void CONFIG;
