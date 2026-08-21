/* Screenshot pose for the README's gate hero shot: the hold door open on AB221, a
 * placarded cart backed up to it on the drawbar, part of Atlanta already aboard and the
 * crew lifting the next one in.
 *
 * WHY THIS FILE EXISTS. The image it replaces was posed by hand and never committed, so
 * it could not be re-shot — and it spent six milestones showing an aircraft drawn
 * back-to-front, because the ground pass rotated by `ac.rot` and the upright pass did
 * not. See tools\_shot-vis-sortroom.js for the other half of the same lesson.
 *
 * Framed slightly BELOW the hold door so the fuselage, the open door and the train are
 * all in frame at once — that trio is the whole loop of the game in one picture.
 */
const { game, camera, renderer, hud, debug, input, CONFIG } = window.__ABC;

game.startShift();
game.skipMs(152000);                       // 2:32 — AB221 on final call, hold open

// AFTER startShift, never before: reset() replaces game.state with a NEW object, and a
// reference taken earlier edits a discarded one without ever erroring.
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

  /* Six of Atlanta aboard already, so the hold reads as half-worked rather than empty. */
  const atl = Object.values(st.bagsById).filter(
    (b) => b.flightId === 'flight_AB221' && b.location.type !== 'aircraftHold');
  for (const bag of atl.slice(0, 6)) {
    bag.x = z.x; bag.y = z.y;
    con.moveBag(st, bag, { type: 'aircraftHold', id: ac.id }, game.bus, st.simTimeMs);
  }

  /* The train that brought them: tractor, drawbar, placarded cart at the door. */
  if (cart && tractor) {
    cart.x = z.x - 1.0; cart.y = z.y + 3.6; cart.rot = 0;
    cart.hitchedToId = tractor.id; tractor.nextCartId = cart.id;
    tractor.x = cart.x + 3.1; tractor.y = cart.y; tractor.rot = 0;
    act.setPlacard(st, cart, 'flight_AB221', game.bus, st.simTimeMs);
    for (const bag of atl.slice(6, 10)) {
      try { con.moveBag(st, bag, { type: 'cart', id: cart.id }, game.bus, st.simTimeMs); }
      catch (e) { void e; }                // a full cart is a fine reason to stop
    }
  }

  /* The crew in the door with the next one in hand, facing the aircraft. */
  const p = st.player;
  p.x = z.x - 0.3; p.y = z.y + 2.1; p.aimX = 0; p.aimY = -1;
  const inHand = atl[10] || atl[atl.length - 1];
  if (inHand && inHand.location.type !== 'aircraftHold') {
    con.moveBag(st, inHand, { type: 'carried', id: 'player_1' }, game.bus, st.simTimeMs);
  }

  game.frame(1000 / 60, null);
  // Sit the camera between the door and the train rather than on the player, so neither
  // the open hold nor the cart falls off the bottom of the frame.
  camera.follow(p.x + 0.5, p.y - 0.8, 0);
  renderer.render(st);
  hud.update();
  debug.update(16.7);
});
void input; void CONFIG;
