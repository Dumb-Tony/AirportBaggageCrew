/* Screenshot pose for the README's sort-room hero shot: bags RIDING THE BELT, more
 * already sorted onto the two marked cart bays, and the crew carrying one across.
 *
 * WHY THIS FILE EXISTS. The image it replaces was posed by hand and never committed, so
 * nobody could re-shoot it — and it spent six milestones showing a conveyor with nothing
 * on it, because every bag riding the belt was being painted underneath the belt. A hero
 * image with no reproducible source is how a render bug survives in a README. This pose
 * puts bags on the belt ON PURPOSE, so the shot fails visibly if that ever regresses.
 *
 * Note the shot is composed AFTER startShift(): reset() replaces game.state with a new
 * object, and a reference captured earlier edits a discarded one in total silence.
 */
const { game, camera, renderer, hud, debug, input, CONFIG } = window.__ABC;

game.startShift();

/* Run until the belt is genuinely carrying a few bags rather than guessing a timestamp.
 * Never assume WHEN a seeded bag spawns — that assumption has been wrong twice here. */
const onBelt = () => Object.values(game.state.bagsById)
  .filter((b) => b.location.type === 'conveyor');
for (let i = 0; i < 60 * 240 && onBelt().length < 4; i++) game.frame(1000 / 60, null);

const st = game.state;

Promise.all([
  import('../src/systems/interaction.js'),
  import('../src/systems/containment.js'),
]).then(([act, con]) => {
  const cart1 = st.cartsById.cart_1;
  const cart2 = st.cartsById.cart_2;

  /* The two marked bays, each with a placarded cart taking its flight's bags. */
  if (cart1) {
    cart1.x = 17.5; cart1.y = 19.2; cart1.rot = 0;
    act.setPlacard(st, cart1, 'flight_AB221', game.bus, st.simTimeMs);
  }
  if (cart2) {
    cart2.x = 26.5; cart2.y = 19.2; cart2.rot = 0;
    act.setPlacard(st, cart2, 'flight_MC184', game.bus, st.simTimeMs);
  }

  /* Sort the loose ones into whichever cart matches, which is the verb the shot is of. */
  const loose = Object.values(st.bagsById).filter((b) => b.location.type === 'floor');
  let intoOne = 0, intoTwo = 0;
  for (const bag of loose) {
    const target = bag.flightId === 'flight_AB221' ? cart1
                 : bag.flightId === 'flight_MC184' ? cart2 : null;
    if (!target) continue;
    if (target === cart1 && intoOne >= 4) continue;
    if (target === cart2 && intoTwo >= 3) continue;
    try {
      con.moveBag(st, bag, { type: 'cart', id: target.id }, game.bus, st.simTimeMs);
      if (target === cart1) intoOne++; else intoTwo++;
    } catch (e) { void e; }                 // a full cart is a fine reason to stop
  }

  /* A couple left on the floor, so the room does not look tidied. */
  const rest = Object.values(st.bagsById).filter((b) => b.location.type === 'floor');
  rest.slice(0, 3).forEach((b, i) => {
    b.x = 13.5 + i * 1.6; b.y = 17.0 + (i % 2) * 1.1;
    b.vx = 0; b.vy = 0; b.rot = 0.4 + i * 0.9;
    b.cartCooldownMs = st.simTimeMs + 60000;
  });

  /* The crew mid-carry, between the belt and the bays — the shot is OF that verb, so
   * take the bag off the belt if the floor has none spare rather than posing empty
   * hands. Placing it in the hands is what moves it; containment owns the rest. */
  const p = st.player;
  p.x = 21.5; p.y = 16.4; p.aimX = 0; p.aimY = 1;
  const inHand = rest[3]
    || Object.values(st.bagsById).find((b) => b.location.type === 'conveyor');
  if (inHand) con.moveBag(st, inHand, { type: 'carried', id: 'player_1' }, game.bus, st.simTimeMs);

  game.frame(1000 / 60, null);
  camera.follow(p.x, p.y - 1.5, 0);
  renderer.render(st);
  hud.update();
  debug.update(16.7);
});
void input; void CONFIG;
