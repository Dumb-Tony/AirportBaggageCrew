/* Screenshot pose for Milestone 2: a loaded two-cart train being hauled across the ramp
 * toward gate 1, with a couple of bags shaken off on the corner behind it.
 *
 * Headless gives only a couple of animation frames (tools\_raf.js), so the state is
 * posed here and the boot loop paints it.
 */
const { game, camera, renderer, hud, debug, input, CONFIG } = window.__ABC;

game.startShift();
game.skipMs(150000);

// AFTER startShift, never before: reset() replaces game.state with a NEW object, so a
// reference captured earlier points at a discarded state and every edit is silently lost.
const st = game.state;

const v = st.vehiclesById.tractor_1;
const c1 = st.cartsById.cart_1;
const c2 = st.cartsById.cart_2;

/* Load the two carts from what the belt has already delivered, ATL in one, ORD in the
   other, so the placards are honest for once. */
const floor = Object.values(st.bagsById).filter((b) => b.location.type === 'floor');
const take = (gate, n) => floor.filter((b) => b.gateId === gate).slice(0, n);

for (const bag of take('gate_1', 8)) {
  bag.vx = 0; bag.vy = 0;
  c1.bagIds.push(bag.id);
  bag.location = { type: 'cart', id: c1.id };
}
for (const bag of take('gate_2', 6)) {
  bag.vx = 0; bag.vy = 0;
  c2.bagIds.push(bag.id);
  bag.location = { type: 'cart', id: c2.id };
}

/* Out on the ramp, mid-run, angling toward gate 1. */
v.x = 74; v.y = 30; v.rot = -0.32; v.speed = 5.4; v.driverId = 'player_1';
st.player.drivingId = v.id;

c1.x = v.x - 3.0; c1.y = v.y + 0.9; c1.rot = -0.1;
c2.x = v.x - 6.2; c2.y = v.y + 2.2; c2.rot = 0.12;
v.nextCartId = c1.id;  c1.hitchedToId = v.id;
c1.nextCartId = c2.id; c2.hitchedToId = c1.id;
c1.stability = 0.42;                                  // mid-corner, about to shed one
c2.stability = 0.95;

/* Placards, through the real setter so the display copies are written too. */
import('../src/systems/interaction.js').then((m) => {
  m.setPlacard(st, c1, 'flight_AB221', game.bus, st.simTimeMs);
  m.setPlacard(st, c2, 'flight_MC184', game.bus, st.simTimeMs);

  /* Two bags already shaken off, lying on the ramp behind the train. */
  const strays = floor.filter((b) => b.location.type === 'floor').slice(0, 2);
  strays.forEach((b, i) => {
    b.x = 64 - i * 2.1; b.y = 34.5 + i * 1.4;
    b.vx = 0; b.vy = 0; b.rot = 0.6 + i;
  });

  /* Settle the train onto its constraint and paint. */
  game.frame(1000 / 60, null);
  camera.follow(st.player.x, st.player.y, 0);
  renderer.render(st);
  hud.update();
  debug.update(16.7);
});
void input; void CONFIG;
