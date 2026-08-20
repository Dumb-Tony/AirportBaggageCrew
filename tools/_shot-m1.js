/* Screenshot pose for Milestone 1: mid-shift, a pile building at the end of the belt,
 * some bags sorted onto the gate pads, one on the WRONG pad with the scanner card
 * showing it. Headless gives only a couple of animation frames (tools\_raf.js), so the
 * state is posed here and the boot loop paints it.
 */
const { game, renderer, hud, debug, input, CONFIG } = window.__ABC;

game.startShift();
game.skipMs(115000);                       // 1:55 in — AB221 and MC184 both feeding

// AFTER startShift, never before: reset() replaces game.state with a NEW object, so a
// reference captured earlier points at a discarded state and every edit is silently lost.
const st = game.state;

/* Sort a handful onto the pads, so the shot shows the verb the milestone is about. */
const pads = { gate_1: { x: 17.5, y: 19 }, gate_2: { x: 26.5, y: 19 } };
const floor = Object.values(st.bagsById).filter((b) => b.location.type === 'floor');
let placed = { gate_1: 0, gate_2: 0 };
for (const bag of floor) {
  const g = bag.gateId;
  if (placed[g] >= 6) continue;
  const i = placed[g]++;
  bag.x = pads[g].x + (i % 3) * 1.15 + bag.appearance.wobble * 0.3;
  bag.y = pads[g].y + Math.floor(i / 3) * 0.95;
  bag.vx = 0; bag.vy = 0;
  bag.rot = bag.appearance.wobble;
}

/* One ATL bag parked on the GATE 2 pad, and scanned — the red verdict is the whole
 * point of the scanner existing at this milestone. */
const stray = floor.find((b) => b.gateId === 'gate_1' && placed.gate_1 > 0);
if (stray) {
  stray.x = 30.2; stray.y = 21.6; stray.vx = 0; stray.vy = 0; stray.rot = 0.3;
}

/* The player, holding a bag, next to the mistake. */
st.player.x = 24.5; st.player.y = 25.5;
st.player.aimX = 0.5; st.player.aimY = 0.87;
const held = floor.find((b) => b !== stray && b.location.type === 'floor');
if (held) {
  window.__ABC.game.bus.emit('BAG_PICKED_UP', { bagId: held.id }, st.simTimeMs);
  st.player.carryingBagId = held.id;
  held.location = { type: 'carried', id: 'player_1' };
  held.x = st.player.x + st.player.aimX * CONFIG.bag.carryOffsetM;
  held.y = st.player.y + st.player.aimY * CONFIG.bag.carryOffsetM;
}
if (stray) {
  st.scan = { bagId: stray.id, atMs: st.simTimeMs, verdict: 'wrong', padId: 'pad_gate_2' };
}

renderer.render(st);
hud.update();
void debug; void input;
