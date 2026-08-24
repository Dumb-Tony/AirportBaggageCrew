/* Milestone 2 suite — transport.
 *
 * Exit criterion under test: a full cart can travel to either gate WITHOUT STATE
 * CORRUPTION. That last phrase is the whole milestone. A cart is a container that moves,
 * and a container that moves is where object identity usually goes wrong — so most of
 * what follows drives a loaded train the length of the airport and then counts.
 *
 * See tools\m0-tests.js for why the live section drives game.frame() by hand instead of
 * waiting for animation frames.
 */

import { CONFIG } from '../src/config.js';
import { Game } from '../src/game.js';
import { Input } from '../src/core/input.js';
import { Rng } from '../src/core/rng.js';
import { createBag } from '../src/entities/bag.js';
import {
  createCart, cartSlotWorld, cartTowPoint, cartContains, cartRoomFor,
  cartWeight, nextPlacard, cartMismatches, SLOT_COUNT,
} from '../src/entities/cart.js';
import { createTractor, tractorTowPoint, dismountPoint } from '../src/entities/tractor.js';
import { moveBag, assertContainment, countByLocation } from '../src/systems/containment.js';
import {
  trainOf, tailOf, hitch, unhitchTail, unhitchAll, hitchCandidate, validateChain,
} from '../src/systems/hitching.js';
import {
  enterVehicle, exitVehicle, loadIntoCart, setPlacard, scanBag, throwHeld, findCart, findVehicle,
} from '../src/systems/interaction.js';
import { ANCHORS, isBlocked, STAGING_PADS } from '../src/data/airport.js';
import { FLIGHT_DEFS } from '../src/data/flights.js';

/* ── harness ─────────────────────────────────────────────────────────────── */
const lines = [];
let passes = 0, fails = 0;

function ok(name, cond, detail = '') {
  if (cond) { passes++; lines.push(`PASS  ${name}`); }
  else { fails++; lines.push(`FAIL  ${name}${detail ? '  <- ' + detail : ''}`); }
}
const eq   = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const near = (n, a, b, tol) => ok(n, Math.abs(a - b) <= tol, `got ${a}, want ${b} +/- ${tol}`);
const note = (s) => lines.push(`      ${s}`);

let _pre = null;
function emit(status) {
  if (!_pre) {
    _pre = document.createElement('pre');
    _pre.id = 'test-out';
    _pre.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:#06080c;' +
      'color:#cfe;font:11px ui-monospace,Consolas,monospace;padding:12px;white-space:pre';
    document.body.appendChild(_pre);
  }
  const tail = status || (fails === 0 ? `ALL-PASS  ${passes} assertions` : `FAILURES  ${fails} of ${passes + fails}`);
  _pre.textContent = '==ABCTEST-BEGIN==\n' + lines.join('\n') + '\n\n' + tail + '\n==ABCTEST-END==';
}

const FRAME_MS = 1000 / 60;
const yieldToLoop = () => new Promise((res) => {
  let done = false;
  const finish = () => { if (!done) { done = true; res(); } };
  requestAnimationFrame(finish);
  setTimeout(finish, 500);
});

function newGame(seed = 909) {
  const g = new Game({ seed, seedLabel: 'test' });
  g.startShift();
  return g;
}
const drive = (g, frames, input = null) => {
  for (let i = 0; i < frames; i++) g.frame(FRAME_MS, input);
};
let _serial = 0;
function placeBag(g, x, y, opts = {}) {
  const spec = { flightId: opts.flightId || 'flight_AB221', priority: !!opts.priority,
                 weightClass: opts.weightClass || 'normal' };
  const bag = createBag(spec, ++_serial, 500000, new Rng(11 + _serial, 't'));
  g.state.bagsById[bag.id] = bag;
  bag.x = x; bag.y = y; bag.vx = 0; bag.vy = 0;
  moveBag(g.state, bag, { type: 'floor' }, g.bus, g.state.simTimeMs);
  return bag;
}
/** Fill a cart directly, bypassing the player. */
function fillCart(g, cart, n, opts = {}) {
  const made = [];
  for (let i = 0; i < n; i++) {
    const bag = placeBag(g, 0, 0, opts);
    moveBag(g.state, bag, { type: 'cart', id: cart.id }, g.bus, g.state.simTimeMs);
    made.push(bag.id);
  }
  return made;
}

/** Put the tractor just ahead of a cart so the cart sits behind its hitch. */
function lineUpBehind(g, cart, headingRad = 0) {
  const v = g.state.vehiclesById.tractor_1;
  v.rot = headingRad;
  v.x = cart.x + Math.cos(headingRad) * (CONFIG.tractor.towOffsetM + 1.9);
  v.y = cart.y + Math.sin(headingRad) * (CONFIG.tractor.towOffsetM + 1.9);
  v.speed = 0;
  return v;
}

/**
 * A tiny autopilot: press W and steer toward a point. It drives the real vehicle through
 * the real input abstraction, so the route, the walls and the trailer constraint are all
 * genuinely exercised — a teleport would prove nothing about the door being wide enough.
 */
function driveTo(g, input, tx, ty, maxFrames = 2400, label = '') {
  const v = g.state.vehiclesById.tractor_1;
  let i = 0;
  for (; i < maxFrames; i++) {
    const dx = tx - v.x, dy = ty - v.y;
    if (Math.hypot(dx, dy) < 2.2) break;
    let err = Math.atan2(dy, dx) - v.rot;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;

    input._debugRelease('KeyA'); input._debugRelease('KeyD');
    if (err > 0.05) input._debugPress('KeyD');
    else if (err < -0.05) input._debugPress('KeyA');
    input._debugPress('KeyW');
    g.frame(FRAME_MS, input);
  }
  input._debugRelease('KeyW');
  input._debugRelease('KeyA');
  input._debugRelease('KeyD');

  /*
   * RUNNING OUT OF FRAMES IS ITS OWN FAILURE, and it says so here.
   *
   * Returning quietly at the cap turns "the train reached the stand" into "the train got
   * as far as forty seconds of driving allowed". The assertion that then goes red is
   * `E.gateN.2 arrived < 3.0`, reporting a distance — which reads as a routing or geometry
   * problem when the likeliest cause is a handling change that made the tractor ten percent
   * slower. This only speaks when it trips, so a green run neither gains an assertion nor
   * loses one; when it trips it names the real cause and every measurement taken after it.
   */
  if (i >= maxFrames) {
    const left = Math.hypot(tx - v.x, ty - v.y);
    ok(`driveTo${label ? ` (${label})` : ''} reached its target inside its frame budget`, false,
       `ran out after ${maxFrames} frames = ${(maxFrames / 60).toFixed(1)} s of driving, still ` +
       `${left.toFixed(2)} m short of ${tx.toFixed(1)},${ty.toFixed(1)}; stopped at ` +
       `${v.x.toFixed(1)},${v.y.toFixed(1)} doing ${v.speed.toFixed(2)} m/s. EVERY distance ` +
       `measured after this is measured from where it ran out, not from the target.`);
  }
  return i;
}

/* ── A. cart geometry and capacity ───────────────────────────────────────── */
function sectionA() {
lines.push('--- A. cart geometry and capacity (GDD 8.1, 6.4, 22.3) ---');
{
  eq('A1 the slot grid matches the configured capacity', SLOT_COUNT, CONFIG.cart.capacitySlots);

  const c = createCart('c', 10, 10, 0);
  let allInside = true;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const p = cartSlotWorld(c, i);
    if (!cartContains(c, p.x, p.y)) allInside = false;
  }
  ok('A2 every slot sits inside the cart bed', allInside);

  const rotated = createCart('r', 10, 10, Math.PI / 2);
  const p0 = cartSlotWorld(rotated, 0);
  ok('A3 slots rotate with the cart',
     Math.abs(p0.x - cartSlotWorld(c, 0).x) > 0.3, `${p0.x.toFixed(2)}`);

  ok('A4 a point in the bed is inside', cartContains(c, 10.2, 10.1));
  ok('A5 a point beyond the bed is outside', !cartContains(c, 14, 10));
  ok('A6 reach padding widens the test', cartContains(c, 13, 10, 2));

  const tow = cartTowPoint(c);
  ok('A7 the tow point is behind the cart', tow.x < c.x, `${tow.x.toFixed(2)} vs ${c.x}`);

  /* GDD §6.4: capacity is space AND weight, and BOTH must be able to bind. */
  const g = newGame();
  const slotCart = g.state.cartsById.cart_1;
  fillCart(g, slotCart, CONFIG.cart.capacitySlots, { weightClass: 'light' });
  const slotVerdict = cartRoomFor(slotCart, g.state, { kg: 9 });
  eq('A8 a cart full of light bags is refused on SPACE', slotVerdict.reason, 'full');
  note(`10 light bags weigh ${cartWeight(slotCart, g.state)} kg of ${slotCart.capacityWeight}`);

  const g2 = newGame();
  const heavyCart = g2.state.cartsById.cart_1;
  let stoppedAt = 0;
  for (let i = 0; i < CONFIG.cart.capacitySlots; i++) {
    const bag = placeBag(g2, 0, 0, { weightClass: 'heavy' });
    if (!cartRoomFor(heavyCart, g2.state, bag).ok) { stoppedAt = i; break; }
    moveBag(g2.state, bag, { type: 'cart', id: heavyCart.id }, g2.bus, 0);
  }
  ok('A9 a cart full of heavy bags is refused on WEIGHT before it runs out of slots',
     stoppedAt > 0 && stoppedAt < CONFIG.cart.capacitySlots,
     `stopped at ${stoppedAt} heavy bags, ${cartWeight(heavyCart, g2.state)} kg`);
  eq('A10 and the reason says which limit bit',
     cartRoomFor(heavyCart, g2.state, { kg: 31 }).reason, 'overweight');
  note(`weight limit bites at ${stoppedAt} heavy bags (${cartWeight(heavyCart, g2.state)} kg of ${heavyCart.capacityWeight})`);

  /* placards */
  const ids = FLIGHT_DEFS.map((f) => f.id);
  let placard = null;
  const seen = [];
  for (let i = 0; i < ids.length + 1; i++) { placard = nextPlacard(placard, ids); seen.push(placard); }
  eq('A11 the placard cycles through every flight and back to blank', seen[seen.length - 1], null);
  eq('A12 and visits each flight exactly once', new Set(seen).size, ids.length + 1);
}
}

/* ── B. containment with carts ───────────────────────────────────────────── */
function sectionB() {
lines.push('--- B. containment with carts (GDD 21.6, 31.1.10) ---');
{
  const g = newGame();
  const cart = g.state.cartsById.cart_1;
  const bag = placeBag(g, cart.x, cart.y);

  moveBag(g.state, bag, { type: 'cart', id: cart.id }, g.bus, 0);
  ok('B1 loading writes both the location and the cart index',
     bag.location.type === 'cart' && bag.location.id === cart.id && cart.bagIds.includes(bag.id));
  eq('B2 the invariant holds', assertContainment(g.state).length, 0);

  const other = g.state.cartsById.cart_2;
  moveBag(g.state, bag, { type: 'cart', id: other.id }, g.bus, 0);
  ok('B3 moving between carts leaves no trace in the first',
     !cart.bagIds.includes(bag.id) && other.bagIds.includes(bag.id));
  eq('B4 a bag is never in two carts', assertContainment(g.state).length, 0);

  moveBag(g.state, bag, { type: 'carried', id: 'player_1' }, g.bus, 0);
  ok('B5 taking a bag out empties it from the cart index',
     !other.bagIds.includes(bag.id) && g.state.player.carryingBagId === bag.id);

  let threw = false;
  try { moveBag(g.state, bag, { type: 'cart', id: 'cart_nope' }, g.bus, 0); } catch (e) { threw = true; }
  ok('B6 loading into a cart that does not exist throws', threw);

  const counts = countByLocation(g.state);
  ok('B7 countByLocation reports carts', 'cart' in counts);

  /* The assertion has to actually catch a corruption, or it is decoration. */
  const g2 = newGame();
  const c2 = g2.state.cartsById.cart_1;
  const b2 = placeBag(g2, 0, 0);
  moveBag(g2.state, b2, { type: 'cart', id: c2.id }, g2.bus, 0);
  c2.bagIds.push(b2.id);                                   // hand-corrupt: listed twice
  ok('B8 a duplicated entry is caught', assertContainment(g2.state).length > 0,
     assertContainment(g2.state).join());
  c2.bagIds.pop();
  eq('B9 and removing it clears the violation', assertContainment(g2.state).length, 0);

  b2.location = { type: 'floor' };                          // hand-corrupt: disagreeing
  ok('B10 a cart holding a bag that says it is elsewhere is caught',
     assertContainment(g2.state).length > 0);
}
}

/* ── C. hitching and chain validation ────────────────────────────────────── */
function sectionC() {
lines.push('--- C. hitching and chain validation (GDD 8.1, 28.1) ---');
{
  const g = newGame();
  const v = g.state.vehiclesById.tractor_1;
  const a = g.state.cartsById.cart_1, b = g.state.cartsById.cart_2, c = g.state.cartsById.cart_3;

  eq('C1 a fresh airport has no train', trainOf(g.state, v).length, 0);
  eq('C2 and a sound chain', validateChain(g.state).length, 0);

  ok('C3 hitching the first cart works', hitch(g.state, v, a, g.bus, 0));
  eq('C4 it hangs off the tractor', a.hitchedToId, v.id);
  eq('C5 the tractor knows it', v.nextCartId, a.id);
  eq('C6 the chain is still sound', validateChain(g.state).length, 0);

  hitch(g.state, v, b, g.bus, 0);
  eq('C7 the second cart hangs off the first', b.hitchedToId, a.id);
  ok('C8 the train reads nose to tail',
     JSON.stringify(trainOf(g.state, v)) === JSON.stringify([a.id, b.id]));
  eq('C9 the tail is the last one', tailOf(g.state, v).id, b.id);

  ok('C10 an already-towed cart cannot be hitched again', !hitch(g.state, v, a, g.bus, 0));
  eq('C11 which left the chain sound', validateChain(g.state).length, 0);

  const dropped = unhitchTail(g.state, v, g.bus, 0);
  eq('C12 unhitching drops the LAST cart', dropped.id, b.id);
  ok('C13 it is free and the first is still attached',
     !b.hitchedToId && a.hitchedToId === v.id && a.nextCartId === null);
  eq('C14 chain still sound', validateChain(g.state).length, 0);

  hitch(g.state, v, b, g.bus, 0);
  hitch(g.state, v, c, g.bus, 0);
  eq('C15 three carts make a train of three', trainOf(g.state, v).length, 3);
  const all = unhitchAll(g.state, v, g.bus, 0);
  eq('C16 unhitchAll drops every one', all.length, 3);
  eq('C17 leaving nothing towed', trainOf(g.state, v).length, 0);
  eq('C18 and a sound chain', validateChain(g.state).length, 0);

  /* the validator has to catch real breakage */
  hitch(g.state, v, a, g.bus, 0);
  a.hitchedToId = 'cart_3';                       // half a link, pointing at the wrong parent
  ok('C19 a one-sided link is caught', validateChain(g.state).length > 0,
     validateChain(g.state).join(' | '));
  a.hitchedToId = v.id;
  eq('C20 and repairing it clears the violation', validateChain(g.state).length, 0);

  b.nextCartId = a.id;                            // two parents for one cart
  a.hitchedToId = v.id;
  ok('C21 a cart towed by two things is caught', validateChain(g.state).length > 0);
  b.nextCartId = null;

  a.nextCartId = a.id;                            // a cycle
  a.hitchedToId = v.id;
  ok('C22 a cycle is caught rather than hanging the walk', validateChain(g.state).length > 0);
  a.nextCartId = null;

  /* candidate selection */
  const g2 = newGame();
  const v2 = g2.state.vehiclesById.tractor_1;
  eq('C23 nothing is hitchable from across the airport', hitchCandidate(g2.state, v2), null);
  lineUpBehind(g2, g2.state.cartsById.cart_2, 0);
  const cand = hitchCandidate(g2.state, v2);
  ok('C24 a cart behind the hitch is a candidate', cand && cand.id === 'cart_2',
     cand && cand.id);
}
}

/* ── D. driving ──────────────────────────────────────────────────────────── */
function sectionD() {
lines.push('--- D. arcade driving (GDD 8.2, 17.1) ---');
{
  const g = newGame();
  const v = g.state.vehiclesById.tractor_1;
  const input = new Input(window);

  eq('D1 a parked tractor has no driver', v.driverId, null);
  g.state.player.x = v.x; g.state.player.y = v.y;
  ok('D2 the tractor is offered when the player stands at it', !!findVehicle(g.state));
  ok('D3 climbing in works', enterVehicle(g.state, v, g.bus, 0));
  eq('D4 the vehicle knows its driver', v.driverId, 'player_1');
  eq('D5 the player knows what they are driving', g.state.player.drivingId, v.id);

  /* a tractor nobody is driving must not move */
  const g0 = newGame();
  const parked = g0.state.vehiclesById.tractor_1;
  const p0 = { x: parked.x, y: parked.y };
  const inp0 = new Input(window);
  inp0._debugPress('KeyW');
  drive(g0, 120, inp0);
  ok('D6 an empty tractor ignores the throttle',
     Math.abs(parked.x - p0.x) < 1e-9 && Math.abs(parked.y - p0.y) < 1e-9);

  /* throttle and cap */
  v.rot = 0; v.x = 80; v.y = 35; v.speed = 0;
  input._debugPress('KeyW');
  drive(g, 180, input);
  near('D7 the throttle reaches the configured top speed', v.speed, CONFIG.tractor.maxSpeed, 0.05);
  note(`0 to ${CONFIG.tractor.maxSpeed} m/s in about ${(CONFIG.tractor.maxSpeed / CONFIG.tractor.accel).toFixed(2)} s`);

  input._debugRelease('KeyW');
  input._debugPress('Space');
  drive(g, 120, input);
  eq('D8 the brake brings it to a dead stop', v.speed, 0);
  input._debugRelease('Space');

  input._debugPress('KeyS');
  drive(g, 180, input);
  near('D9 reverse is capped separately and lower', v.speed, -CONFIG.tractor.reverseSpeed, 0.05);
  input._debugRelease('KeyS');
  drive(g, 240, input);
  eq('D10 releasing everything coasts to a stop', v.speed, 0);

  /* GDD §8.2: forgiving turning at low speed, wider arcs when fast. */
  function turnRadius(targetSpeed) {
    const gg = newGame();
    const t = gg.state.vehiclesById.tractor_1;
    enterVehicle(gg.state, t, gg.bus, 0);
    t.x = 85; t.y = 35; t.rot = 0; t.speed = targetSpeed;
    const inp = new Input(window);
    inp._debugPress('KeyD');
    // hold the speed steady so the radius is measured, not the acceleration
    let sum = 0, n = 0;
    for (let i = 0; i < 60; i++) {
      t.speed = targetSpeed;
      gg.frame(FRAME_MS, inp);
      if (Math.abs(t.yawRate) > 1e-6) { sum += Math.abs(t.speed / t.yawRate); n++; }
    }
    return n ? sum / n : Infinity;
  }
  const rSlow = turnRadius(1.5);
  const rRef  = turnRadius(CONFIG.tractor.yawRefSpeed);
  const rFast = turnRadius(CONFIG.tractor.maxSpeed);
  near('D11 below the reference speed the turning radius is constant', rSlow, rRef, 0.15);
  ok('D12 above it the radius grows with speed', rFast > rRef * 1.8,
     `${rFast.toFixed(2)} m vs ${rRef.toFixed(2)} m`);
  note(`turning radius: ${rSlow.toFixed(1)} m at 1.5 m/s, ${rRef.toFixed(1)} m at ${CONFIG.tractor.yawRefSpeed} m/s, ${rFast.toFixed(1)} m at ${CONFIG.tractor.maxSpeed} m/s`);

  /* walls */
  const g3 = newGame();
  const t3 = g3.state.vehiclesById.tractor_1;
  enterVehicle(g3.state, t3, g3.bus, 0);
  t3.x = 60; t3.y = 6; t3.rot = -Math.PI / 2;      // straight at the north perimeter
  const inp3 = new Input(window);
  inp3._debugPress('KeyW');
  // Sample the run rather than only its last frame: "scrubbed" is a claim about a CHANGE,
  // so it needs the speed the tractor was carrying before it arrived.
  let peakSpeed = 0;
  for (let i = 0; i < 300; i++) {
    g3.frame(FRAME_MS, inp3);
    peakSpeed = Math.max(peakSpeed, Math.abs(t3.speed));
  }
  ok('D13 the tractor cannot drive through a wall', !isBlocked(t3.x, t3.y, 0),
     `${t3.x.toFixed(1)},${t3.y.toFixed(1)}`);
  ok('D13a and it was genuinely moving when it got there', peakSpeed > 1,
     `${peakSpeed.toFixed(2)} m/s peak`);
  /*
   * The old check was `Math.abs(t3.speed) < CONFIG.tractor.maxSpeed`, which a tractor
   * pinned at 99% of top speed grinding along the perimeter for five seconds passes — the
   * exact behaviour the comment in tractor.js says the 0.35 scrub exists to prevent. What
   * the name claims is that the bump TOOK the speed away, so it is measured against what
   * the tractor was doing before it hit.
   */
  ok('D14 and the bump scrubbed its speed rather than trapping it',
     Math.abs(t3.speed) < peakSpeed * 0.3,
     `${Math.abs(t3.speed).toFixed(3)} m/s at the wall after a peak of ${peakSpeed.toFixed(2)} m/s`);
  ok('D15 the odometer recorded the trip', t3.odometerM > 0, `${t3.odometerM.toFixed(1)} m`);
  note(`into the north perimeter at ${peakSpeed.toFixed(2)} m/s, left doing ` +
       `${Math.abs(t3.speed).toFixed(3)} m/s`);

  /* getting out */
  const g4 = newGame();
  const t4 = g4.state.vehiclesById.tractor_1;
  enterVehicle(g4.state, t4, g4.bus, 0);
  t4.speed = 5;
  ok('D16 climbing out works', exitVehicle(g4.state, g4.bus, 0));
  eq('D17 the tractor is released', t4.driverId, null);
  eq('D18 and stops dead rather than rolling away driverless', t4.speed, 0);
  const spot = dismountPoint(t4);
  ok('D19 the player is put down beside the cab, not inside a wall',
     !isBlocked(g4.state.player.x, g4.state.player.y, CONFIG.player.radiusM) &&
     Math.hypot(g4.state.player.x - spot.x, g4.state.player.y - spot.y) < 0.01);
}
}

/* ── E. towing: the exit criterion ───────────────────────────────────────── */
function sectionE() {
lines.push('--- E. towing a loaded train (THE EXIT CRITERION) ---');
{
  /** Load a cart, hitch it, drive to a gate, and count what survived. */
  function haul(gateAnchor, label) {
    const g = newGame(4321);
    const v = g.state.vehiclesById.tractor_1;
    const cart = g.state.cartsById.cart_2;
    const loaded = fillCart(g, cart, CONFIG.cart.capacitySlots, { weightClass: 'light' });
    setPlacard(g.state, cart, 'flight_AB221', g.bus, 0);

    lineUpBehind(g, cart, 0);
    enterVehicle(g.state, v, g.bus, 0);
    ok(`E.${label}.1 the loaded cart hitches`, hitch(g.state, v, cart, g.bus, 0));

    const input = new Input(window);
    let embedded = 0, worstLink = 0, chainBroken = 0, containBroken = 0;
    const watch = () => {
      if (isBlocked(cart.x, cart.y, 0)) embedded++;
      if (validateChain(g.state).length) chainBroken++;
      if (assertContainment(g.state).length) containBroken++;
      const tow = tractorTowPoint(v);
      worstLink = Math.max(worstLink, Math.abs(Math.hypot(cart.x - tow.x, cart.y - tow.y) - CONFIG.cart.linkM));
    };

    // out through the sort-room door, then across the ramp to the stand
    const doorFrames = driveTo(g, input, 37, 23, 2400, `${label}: loaded cart to the sort-room door`);
    watch();
    const runFrames = driveTo(g, input, gateAnchor.x, gateAnchor.y, 2400, `${label}: door to the stand`);
    for (let i = 0; i < 30; i++) { g.frame(FRAME_MS, input); watch(); }

    const arrived = Math.hypot(v.x - gateAnchor.x, v.y - gateAnchor.y);
    return { g, v, cart, loaded, arrived, embedded, worstLink, chainBroken, containBroken,
             frames: doorFrames + runFrames };
  }

  for (const [label, anchor] of [['gate1', ANCHORS.gate1Hold], ['gate2', ANCHORS.gate2Hold]]) {
    const r = haul(anchor, label);
    ok(`E.${label}.2 the train reached the stand`, r.arrived < 3.0, `${r.arrived.toFixed(2)} m short`);
    eq(`E.${label}.3 the cart still holds every bag it left with`, r.cart.bagIds.length, r.loaded.length);
    ok(`E.${label}.4 and they are the SAME bags`,
       JSON.stringify(r.cart.bagIds.slice().sort()) === JSON.stringify(r.loaded.slice().sort()));
    eq(`E.${label}.5 no bag was duplicated anywhere`,
       new Set(Object.keys(r.g.state.bagsById)).size, Object.keys(r.g.state.bagsById).length);
    eq(`E.${label}.6 containment held for the whole journey`, r.containBroken, 0);
    eq(`E.${label}.7 the hitch chain held for the whole journey`, r.chainBroken, 0);
    eq(`E.${label}.8 the cart never ended up inside a wall`, r.embedded, 0);
    ok(`E.${label}.9 the drawbar never stretched`, r.worstLink < 0.02, `${r.worstLink.toFixed(4)} m`);
    eq(`E.${label}.10 the placard survived the trip`, r.cart.placardFlightId, 'flight_AB221');
    note(`${label}: ${(r.frames / 60).toFixed(1)} s of driving, ${r.cart.bagIds.length} bags delivered, ${r.cart.spills} spilled`);
  }

  /* the load must ride WITH the cart, not lag a step behind it */
  const g = newGame();
  const v = g.state.vehiclesById.tractor_1;
  const cart = g.state.cartsById.cart_2;
  fillCart(g, cart, 6, { weightClass: 'light' });
  lineUpBehind(g, cart, 0);
  enterVehicle(g.state, v, g.bus, 0);
  hitch(g.state, v, cart, g.bus, 0);

  const input = new Input(window);
  driveTo(g, input, 37, 23, 2400, 'six-bag cart to the sort-room door');
  // Both checks below iterate the load, and an EMPTY cart satisfies both of them: the
  // worst-slot distance would still be 0 and `[].every()` is true. Prove there is a load
  // to check before checking it.
  eq('E0 the cart still has all six bags to check after the drive', cart.bagIds.length, 6);
  let worstSlot = 0;
  for (let i = 0; i < cart.bagIds.length; i++) {
    const bag = g.state.bagsById[cart.bagIds[i]];
    const slot = cartSlotWorld(cart, i);
    worstSlot = Math.max(worstSlot, Math.hypot(bag.x - slot.x, bag.y - slot.y));
  }
  ok('E1 every bag sits exactly in its slot after driving', worstSlot < 1e-9,
     `worst was ${worstSlot} m`);

  const inCart = Object.values(g.state.bagsById).filter((b) => b.location.type === 'cart');
  ok('E2 no bag in a cart is being simulated on the floor',
     inCart.every((b) => b.vx === 0 && b.vy === 0));

  /* a three-cart train through the door */
  const g5 = newGame();
  const v5 = g5.state.vehiclesById.tractor_1;
  const trainLoad = [];                     // the exact bags that set off, by id
  for (const id of ['cart_1', 'cart_2', 'cart_3']) {
    const c = g5.state.cartsById[id];
    trainLoad.push(...fillCart(g5, c, 4, { weightClass: 'light' }));
    c.hitchedToId = null; c.nextCartId = null;
  }
  lineUpBehind(g5, g5.state.cartsById.cart_2, 0);
  enterVehicle(g5.state, v5, g5.bus, 0);
  hitch(g5.state, v5, g5.state.cartsById.cart_2, g5.bus, 0);
  g5.state.cartsById.cart_1.x = g5.state.cartsById.cart_2.x - 2;
  hitch(g5.state, v5, g5.state.cartsById.cart_1, g5.bus, 0);
  g5.state.cartsById.cart_3.x = g5.state.cartsById.cart_2.x - 4;
  hitch(g5.state, v5, g5.state.cartsById.cart_3, g5.bus, 0);
  eq('E3 a three-cart train assembles', trainOf(g5.state, v5).length, 3);
  eq('E3a carrying twelve bags between them', trainLoad.length, 12);

  const inp5 = new Input(window);
  driveTo(g5, inp5, 37, 23, 2400, 'three-cart train to the sort-room door');
  driveTo(g5, inp5, ANCHORS.gate2Hold.x, ANCHORS.gate2Hold.y, 2400, 'three-cart train to gate 2');
  eq('E4 the whole train arrived intact', trainOf(g5.state, v5).length, 3);
  eq('E5 with a sound chain', validateChain(g5.state).length, 0);
  eq('E6 and sound containment', assertContainment(g5.state).length, 0);

  /*
   * DOES A CART ACTUALLY CLIP A WALL? The README has said since M6 that "a cart taking a
   * tight corner can visibly clip a wall for a frame", which is a checkable claim and had
   * never been checked.
   *
   * A towed cart is POSITIONED by the drawbar constraint and then pushed out of walls, and
   * `pushOutOfWalls` works on a CIRCLE — radius half the cart's longest side. A circle
   * that clears a wall does not prove the rotated 2.4 x 1.5 m rectangle inside it does, so
   * the two can disagree exactly where the README says: mid-corner, at an angle.
   *
   * Sampled around the PERIMETER at 0.25 m spacing rather than by a full oriented-box
   * intersection. The spacing is the load-bearing part: the sort-room walls are 0.6 m
   * thick, so anything coarser than that could let a wall pass between two samples and
   * the check would be quietly vacuous. The first version of this sampled the four
   * corners and four edge midpoints — 1.2 m apart on the long edge, twice the wall
   * thickness — and would have reported a clean run whether or not one happened.
   *
   * Driven out through the doorway, round on the apron and back in, because the drawbar
   * swings the other way coming back and the doorway is the tightest corner in the game.
   */
  {
    const gW = newGame();
    const vW = gW.state.vehiclesById.tractor_1;
    for (const id of ['cart_1', 'cart_2', 'cart_3']) {
      const c = gW.state.cartsById[id];
      c.hitchedToId = null; c.nextCartId = null;
    }
    lineUpBehind(gW, gW.state.cartsById.cart_2, 0);
    enterVehicle(gW.state, vW, gW.bus, 0);
    hitch(gW.state, vW, gW.state.cartsById.cart_2, gW.bus, 0);
    gW.state.cartsById.cart_1.x = gW.state.cartsById.cart_2.x - 2;
    hitch(gW.state, vW, gW.state.cartsById.cart_1, gW.bus, 0);

    const L = CONFIG.cart.lengthM / 2, W = CONFIG.cart.widthM / 2;
    const STEP = 0.25;                       // < the 0.6 m wall thickness, by a lot
    const LOCAL = [];
    for (let lx = -L; lx <= L + 1e-9; lx += STEP) { LOCAL.push([lx, W], [lx, -W]); }
    for (let ly = -W; ly <= W + 1e-9; ly += STEP) { LOCAL.push([L, ly], [-L, ly]); }
    ok('E6.pre the perimeter is sampled finer than a wall is thick',
       STEP < 0.6 && LOCAL.length >= 24, `${LOCAL.length} points at ${STEP} m spacing`);
    let clipped = 0, sampled = 0, worst = null;
    const sampleCarts = () => {
      for (const id of trainOf(gW.state, vW)) {
        const c = gW.state.cartsById[id];
        const cos = Math.cos(c.rot), sin = Math.sin(c.rot);
        for (const [lx, ly] of LOCAL) {
          sampled++;
          const x = c.x + lx * cos - ly * sin;
          const y = c.y + lx * sin + ly * cos;
          if (isBlocked(x, y, 0)) {
            clipped++;
            if (!worst) worst = { id, x: +x.toFixed(2), y: +y.toFixed(2), rot: +c.rot.toFixed(2) };
          }
        }
      }
    };

    // Out through the door, turn round on the apron, and back in again — the corner is
    // taken in both directions, because the drawbar swings the other way coming back.
    // Same steering as `driveTo`, but stepped by hand so every frame can be sampled —
    // the claim is about ONE frame mid-corner, so a helper that only reports the end
    // state cannot see it.
    const inpW = new Input(window);
    for (const [tx, ty] of [[37, 23], [45, 23], [37, 23], [22, 20]]) {
      let frames = 0;
      while (frames++ < 1200 && Math.hypot(tx - vW.x, ty - vW.y) > 2.2) {
        let err = Math.atan2(ty - vW.y, tx - vW.x) - vW.rot;
        while (err > Math.PI) err -= Math.PI * 2;
        while (err < -Math.PI) err += Math.PI * 2;
        inpW._debugRelease('KeyA'); inpW._debugRelease('KeyD');
        if (err > 0.05) inpW._debugPress('KeyD');
        else if (err < -0.05) inpW._debugPress('KeyA');
        inpW._debugPress('KeyW');
        gW.frame(FRAME_MS, inpW);
        sampleCarts();
      }
    }
    inpW.clear();

    note(`train through the doorway both ways: ${clipped} of ${sampled} cart-perimeter ` +
         `samples were inside a wall${worst ? ` (first ${JSON.stringify(worst)})` : ''}`);
    ok('E6a no part of a towed cart is ever inside a wall, even mid-doorway',
       clipped === 0,
       `${clipped} of ${sampled} samples${worst ? `, first at ${worst.x},${worst.y}` : ''}`);
  }

  /*
   * COUNT BAGS, NOT EVENTS.
   *
   * This was `stillLoaded + spilled === 12` with `spilled` summed from `cart.spills` — an
   * EVENT COUNTER, not a bag count. One bag shaken off, re-absorbed by the cart once its
   * cooldown lapsed (section F proves that happens) and shaken off again makes that sum 13
   * with nothing whatsoever wrong, and 11 would have gone unnoticed if two spills landed on
   * one bag. The twelve bags that set off are tracked by id instead, and each one is now
   * somewhere: in a cart or on the ramp, which is the whole claim.
   */
  const at = (id) => g5.state.bagsById[id].location.type;
  const stillLoaded = trainLoad.filter((id) => at(id) === 'cart').length;
  const onRamp = trainLoad.filter((id) => at(id) === 'floor').length;
  eq('E7 every one of the twelve bags is still either in a cart or on the ramp',
     stillLoaded + onRamp, trainLoad.length);
  const spillEvents = ['cart_1', 'cart_2', 'cart_3']
    .reduce((n, id) => n + g5.state.cartsById[id].spills, 0);
  note(`three-cart train: ${stillLoaded} of 12 still aboard, ${onRamp} on the ramp ` +
       `(${spillEvents} spill events — a bag can be shaken off more than once)`);
}
}

/* ── F. spill ────────────────────────────────────────────────────────────── */
function sectionF() {
lines.push('--- F. spillage (GDD 6.4, 10.2) ---');
{
  /** Drive a loaded cart in a hard circle at a chosen speed, return what fell off. */
  function circle(speed, frames = 600, bags = 10) {
    const g = newGame();
    const v = g.state.vehiclesById.tractor_1;
    const cart = g.state.cartsById.cart_2;
    const loaded = fillCart(g, cart, bags, { weightClass: 'light' });
    // out on the open ramp, where there is room to go round
    cart.x = 90; cart.y = 35; cart.rot = 0;
    lineUpBehind(g, cart, 0);
    enterVehicle(g.state, v, g.bus, 0);
    hitch(g.state, v, cart, g.bus, 0);

    const input = new Input(window);
    input._debugPress('KeyD');
    // Sample the stability WHILE the corner is being taken. Read only at the end it says
    // nothing about draining, because by then the cart has already recovered.
    let drainFrame = -1, spillFrame = -1;
    for (let i = 0; i < frames; i++) {
      v.speed = speed;
      g.frame(FRAME_MS, input);
      if (drainFrame < 0 && cart.stability < 1) drainFrame = i;
      if (spillFrame < 0 && cart.spills > 0) spillFrame = i;
    }
    // The bags this cart set off with, counted BY ID at the end. `cart.spills` is an
    // event counter — one bag shaken off, re-absorbed once its cooldown lapses (F8 proves
    // that happens) and shaken off again is two spills and one bag — so it can answer
    // "did the cart lurch?" and must never be used to answer "where are the bags?".
    const at = (id) => g.state.bagsById[id].location.type;
    return { g, cart, drainFrame, spillFrame, loaded,
             inCart: loaded.filter((id) => at(id) === 'cart').length,
             onRamp: loaded.filter((id) => at(id) === 'floor').length };
  }

  const fast = circle(CONFIG.tractor.maxSpeed);
  ok('F1 hard cornering at speed throws bags off the cart', fast.cart.spills > 0,
     `${fast.cart.spills} spills`);
  eq('F2 a spilled bag is on the ramp, not deleted',
     fast.inCart + fast.onRamp, 10);
  ok('F3 spilled bags are physically there to be picked up', fast.onRamp > 0,
     `${fast.onRamp} of the ten are on the ramp, ${fast.inCart} still aboard`);
  eq('F4 spilling never corrupts containment', assertContainment(fast.g.state).length, 0);
  note(`ten bags, hard circle at ${CONFIG.tractor.maxSpeed} m/s: ${fast.onRamp} ended on the ramp ` +
       `(${fast.cart.spills} spill events)`);

  const slow = circle(1.2);
  eq('F5 a careful driver spills nothing', slow.cart.spills, 0);
  note(`the same circle at 1.2 m/s: ${slow.cart.spills} spilled`);

  const empty = circle(CONFIG.tractor.maxSpeed, 600, 0);
  eq('F6 an empty cart has nothing to lose', empty.cart.spills, 0);

  /*
   * GDD §11.3's "cart corners taken above safe speed" has to COUNT CORNERS, and it used
   * to count keystrokes. Steering is binary — `steer` is -1, 0 or +1 — so every course
   * correction is full lock, and full lock above about 2.6 m/s with a loaded cart clears
   * the lateral threshold. The counter fired on the way IN to every one of those, so a
   * played shift reported 168 hard corners against 5.7 bags actually shed, and 56% of
   * them cost under 0.05 stability and recovered within a tenth of a second.
   *
   * Both halves are asserted, because either alone is satisfiable by a broken counter:
   * a hard circle MUST register, and a careful one must NOT.
   */
  ok('F6a a hard circle registers as a corner taken above safe speed',
     fast.g.state.stats.hardCorners > 0, `${fast.g.state.stats.hardCorners} counted`);
  eq('F6b a careful circle registers none at all', slow.g.state.stats.hardCorners, 0);
  ok('F6c and a counted corner is one that nearly cost the load, not a steering nudge',
     fast.g.state.stats.hardCorners <= fast.cart.spills * 8 + 4,
     `${fast.g.state.stats.hardCorners} corners against ${fast.cart.spills} spills — ` +
     'a counter that fires on every keystroke runs to hundreds');

  /*
   * PARKED CARTS PUSH EACH OTHER APART. Two on the same square metre both answer to `E`
   * and `findCart` hands you whichever centre is nearest, so standing between them loads
   * the one you did not mean — the README called it the single most common way the bot
   * lost time, and the bot carries a circling workaround for it.
   */
  {
    const gs = newGame();
    const a = gs.state.cartsById.cart_1, b = gs.state.cartsById.cart_2;
    b.x = a.x; b.y = a.y;                       // exactly on top of one another
    drive(gs, 90);
    const gap = Math.hypot(b.x - a.x, b.y - a.y);
    ok('F8a two parked carts do not stay on the same spot', gap >= CONFIG.cart.widthM - 0.01,
       `${gap.toFixed(2)} m apart after 1.5 s, want at least ${CONFIG.cart.widthM}`);
    ok('F8b ...and they are eased apart rather than flung',
       gap < CONFIG.cart.widthM * 3, `${gap.toFixed(2)} m`);
    eq('F8c separating carts never corrupts containment',
       assertContainment(gs.state).length, 0);
    note(`two coincident carts settle ${gap.toFixed(2)} m apart`);

    /* ...and a TOWED cart is the drawbar's business. Pushing it would start a fight the
     * constraint wins, and `updateTrain` would read the shoving as cornering and throw
     * the load off a stationary train. */
    const gt = newGame();
    const v = gt.state.vehiclesById.tractor_1;
    const towed = gt.state.cartsById.cart_1, other = gt.state.cartsById.cart_2;
    towed.x = v.x - 2; towed.y = v.y;
    hitch(gt.state, v, towed, gt.bus, gt.state.simTimeMs);
    other.x = towed.x; other.y = towed.y;       // park the free one right on the towed one
    const beforeSpills = towed.spills;
    drive(gt, 60);
    eq('F8d a towed cart keeps its place on the drawbar, whatever is parked on it',
       towed.hitchedToId, v.id);
    eq('F8e ...and nothing is shaken off it while the tractor stands still',
       towed.spills, beforeSpills);
    /*
     * And the free cart is NOT shoved aside either, which is deliberate. Making a towed
     * cart push parked ones out of its way turns a passing train into a bulldozer: it
     * drove carts into the sort-room doorway and produced six dead ends across average
     * and veteran where there had been none. It is also only half a collision model —
     * the tractor itself drives straight through a parked cart — so the disruption
     * arrives without the blocking that would explain it.
     */
    ok('F8f ...and a parked cart is not bulldozed by a passing train either',
       Math.hypot(other.x - towed.x, other.y - towed.y) < 0.5,
       `${Math.hypot(other.x - towed.x, other.y - towed.y).toFixed(2)} m — see the comment above`);
  }

  /* the cooldown: a spilled bag must not be swallowed again by the cart that lost it */
  const g = newGame();
  const cart = g.state.cartsById.cart_2;
  const bag = placeBag(g, cart.x, cart.y);
  bag.cartCooldownMs = 5000;
  bag.vx = 0; bag.vy = 0;
  drive(g, 30);
  eq('F7 a bag inside its cooldown is not re-absorbed', bag.location.type, 'floor');
  g.skipMs(6000);
  drive(g, 5);
  eq('F8 once the cooldown lapses the cart catches it again', bag.location.type, 'cart');

  /*
   * Stability must be READABLE BEFORE THE SPILL, not only after — that is the whole point
   * of a stability score rather than a dice roll (GDD §6.4, §10.2): the driver gets a
   * warning they can act on.
   *
   * The old check here was `stability <= 1 && stability >= 0`, which is a restatement of
   * the two clamp lines in hitching.js and cannot say anything about draining at all. It
   * would have stayed green with the drain rate set high enough to empty a cart in one
   * step, which is the failure that would actually ruin the feel. What is asserted now is
   * the ORDER: the bar starts falling, and only later does a bag go.
   */
  ok('F9 stability starts draining before the first bag leaves',
     fast.drainFrame >= 0 && fast.spillFrame > fast.drainFrame,
     `stability first fell below 1 at frame ${fast.drainFrame}, first spill at frame ${fast.spillFrame}`);
  ok('F9a with enough warning to be worth showing',
     (fast.spillFrame - fast.drainFrame) / 60 > 0.25,
     `${((fast.spillFrame - fast.drainFrame) / 60).toFixed(2)} s of warning`);
  ok('F9b and it stays inside the 0..1 the HUD draws it in',
     fast.cart.stability <= 1 && fast.cart.stability >= 0, `${fast.cart.stability}`);
  note(`hard corner: stability starts dropping at frame ${fast.drainFrame}, first bag off at ` +
       `frame ${fast.spillFrame} — ${((fast.spillFrame - fast.drainFrame) / 60).toFixed(2)} s of warning`);
}
}

/* ── G. the loading verbs ────────────────────────────────────────────────── */
function sectionG() {
lines.push('--- G. loading, unloading, placards (GDD 7.3, 8.1, 31.1.8) ---');
{
  const g = newGame();
  const cart = g.state.cartsById.cart_1;
  const p = g.state.player;
  p.x = cart.x; p.y = cart.y + 1.6; p.aimX = 0; p.aimY = -1;

  ok('G1 standing at a cart finds it', findCart(g.state) && findCart(g.state).id === cart.id);

  const bag = placeBag(g, p.x, p.y);
  moveBag(g.state, bag, { type: 'carried', id: 'player_1' }, g.bus, 0);
  const input = new Input(window);
  input._debugPress('KeyE');
  drive(g, 1, input);
  eq('G2 E at a cart loads the held bag into it', bag.location.type, 'cart');
  eq('G3 into THAT cart', bag.location.id, cart.id);
  eq('G4 and the hands are empty again', p.carryingBagId, null);

  input._debugPress('KeyE');
  drive(g, 1, input);
  ok('G5 E again takes a bag back out', !!p.carryingBagId);
  eq('G6 which is out of the cart', g.state.bagsById[p.carryingBagId].location.type, 'carried');

  /* a full cart must not silently swallow the bag or refuse the input */
  const g2 = newGame();
  const full = g2.state.cartsById.cart_1;
  fillCart(g2, full, CONFIG.cart.capacitySlots, { weightClass: 'light' });
  const p2 = g2.state.player;
  p2.x = full.x; p2.y = full.y + 1.6;
  const spare = placeBag(g2, p2.x, p2.y);
  moveBag(g2.state, spare, { type: 'carried', id: 'player_1' }, g2.bus, 0);
  const inp2 = new Input(window);
  inp2._debugPress('KeyE');
  drive(g2, 1, inp2);
  eq('G7 pressing E at a full cart puts the bag on the floor instead', spare.location.type, 'floor');
  eq('G8 and the cart is not over-filled', full.bagIds.length, CONFIG.cart.capacitySlots);

  /* throwing a bag into a cart is meant to work — GDD 1, "Grab. Throw." */
  const g3 = newGame();
  const target = g3.state.cartsById.cart_2;
  const p3 = g3.state.player;
  p3.x = target.x - 6; p3.y = target.y; p3.aimX = 1; p3.aimY = 0;
  const flying = placeBag(g3, p3.x + 0.6, p3.y);
  moveBag(g3.state, flying, { type: 'carried', id: 'player_1' }, g3.bus, 0);
  p3.chargeMs = CONFIG.bag.throwChargeMs * 0.45;
  p3.charging = true;
  throwHeld(g3.state, g3.bus, g3.state.simTimeMs);
  drive(g3, 180);
  eq('G9 a bag thrown into a cart is caught by it', flying.location.type, 'cart');
  eq('G10 by the cart it landed in', flying.location.id, target.id);

  /* placards: set, ignored, and never enforced */
  const g4 = newGame();
  const c4 = g4.state.cartsById.cart_1;
  const p4 = g4.state.player;
  p4.x = c4.x; p4.y = c4.y + 1.6;
  const inp4 = new Input(window);
  inp4._debugPress('KeyF');
  drive(g4, 1, inp4);
  ok('G11 F at a cart sets a placard', !!c4.placardFlightId, `${c4.placardFlightId}`);
  ok('G12 and writes the display copy the renderer reads',
     !!c4.placardLabel && !!c4.placardColor, `${c4.placardLabel}`);

  setPlacard(g4.state, c4, 'flight_AB221', g4.bus, 0);
  const wrong = placeBag(g4, c4.x, c4.y, { flightId: 'flight_MC184' });
  moveBag(g4.state, wrong, { type: 'cart', id: c4.id }, g4.bus, 0);
  eq('G13 a cart accepts a bag that contradicts its own placard (GDD 7.3)',
     wrong.location.type, 'cart');
  eq('G14 and the game records the mismatch rather than preventing it',
     cartMismatches(c4, g4.state), 1);

  eq('G15 scanning it says wrong, against the placard',
     scanBag(g4.state, wrong, g4.bus, 100).verdict, 'wrong');
  const right = placeBag(g4, c4.x, c4.y, { flightId: 'flight_AB221' });
  moveBag(g4.state, right, { type: 'cart', id: c4.id }, g4.bus, 0);
  eq('G16 and a matching bag scans correct', scanBag(g4.state, right, g4.bus, 100).verdict, 'correct');

  setPlacard(g4.state, c4, null, g4.bus, 0);
  eq('G17 an unlabelled cart makes no claim, so the scan is neutral',
     scanBag(g4.state, right, g4.bus, 100).verdict, 'neutral');

  /* the marked bays still work for bags left on the floor */
  const pad = STAGING_PADS.find((x) => x.gateId === 'gate_1');
  ok('G18 the gate bays sit where the carts park',
     Math.abs(pad.x + pad.w / 2 - ANCHORS.cartBay1.x) < 1.5, `${pad.x + pad.w / 2}`);
}
}

/* ── H. determinism and performance ──────────────────────────────────────── */
function sectionH() {
lines.push('--- H. determinism and cost ---');
{
  function scriptedRun(seed) {
    const g = newGame(seed);
    const v = g.state.vehiclesById.tractor_1;
    const cart = g.state.cartsById.cart_2;
    fillCart(g, cart, 8, { weightClass: 'normal' });
    lineUpBehind(g, cart, 0);
    enterVehicle(g.state, v, g.bus, 0);
    hitch(g.state, v, cart, g.bus, 0);
    const input = new Input(window);
    driveTo(g, input, 37, 23, 2400, `seed ${seed}: to the sort-room door`);
    driveTo(g, input, ANCHORS.gate1Hold.x, ANCHORS.gate1Hold.y, 2400, `seed ${seed}: to gate 1`);
    return g;
  }
  const a = scriptedRun(31337), b = scriptedRun(31337);
  ok('H1 the same seed and the same driving give an identical result',
     JSON.stringify(a.describe()) === JSON.stringify(b.describe()),
     JSON.stringify(a.describe().vehicles) + '\n' + JSON.stringify(b.describe().vehicles));

  const c = scriptedRun(31338);
  ok('H2 a different seed differs', JSON.stringify(a.describe()) !== JSON.stringify(c.describe()));

  /* an unattended shift must still be sound: nothing here is driven at all */
  const idle = newGame(777);
  idle.skipMs(idle.state.shift.endTimeMs + 2000);
  eq('H3 an unattended shift keeps containment sound', assertContainment(idle.state).length, 0);
  eq('H4 and the hitch chain sound', validateChain(idle.state).length, 0);
  const counts = countByLocation(idle.state);
  eq('H5 with every bag accounted for',
     Object.values(counts).reduce((x, y) => x + y, 0), Object.keys(idle.state.bagsById).length);
  note(`unattended 10 min with carts present: ${JSON.stringify(counts)}`);

  /* cost: a three-cart train and a hundred loose bags at once */
  const perf = newGame(5);
  const pv = perf.state.vehiclesById.tractor_1;
  enterVehicle(perf.state, pv, perf.bus, 0);
  pv.x = 90; pv.y = 35; pv.rot = 0;
  for (const id of ['cart_1', 'cart_2', 'cart_3']) {
    const c2 = perf.state.cartsById[id];
    c2.x = 88; c2.y = 35;
    fillCart(perf, c2, 6, { weightClass: 'light' });
    hitch(perf.state, pv, c2, perf.bus, 0);
  }
  for (let i = 0; i < 100; i++) placeBag(perf, 70 + (i % 10) * 0.8, 28 + Math.floor(i / 10) * 0.8);
  const inp = new Input(window);
  inp._debugPress('KeyW'); inp._debugPress('KeyD');
  const t0 = performance.now();
  for (let i = 0; i < 600; i++) perf.frame(FRAME_MS, inp);
  const perStep = (performance.now() - t0) / 600;
  /*
   * The GATE is a checked-in baseline, not the frame budget.
   *
   * `perStep < 4` against a measured 0.33 ms is TWELVE times the headroom: this scene
   * could get an order of magnitude slower — every cart bag re-simulated on the floor,
   * say, or the spatial grid abandoned — and the line would still read PASS. The recorded
   * figure is the one in CLAUDE.md's M2 entry ("three loaded carts plus 100 loose bags
   * cost 0.33 ms per step"), and 3x clears the honest run-to-run spread on a machine with
   * other suites building (0.183, 0.189 and 0.242 measured across three runs) while still
   * catching anything that actually regresses. The frame budget stays in the note, where
   * it belongs: it is the number that means something to a reader, not a threshold.
   */
  const BASELINE_MS_PER_STEP = 0.33;
  ok('H6 a laden train plus a hundred loose bags still costs what it was measured to cost',
     perStep < BASELINE_MS_PER_STEP * 3,
     `${perStep.toFixed(3)} ms/step against a ${BASELINE_MS_PER_STEP} ms baseline ` +
     `(gate ${(BASELINE_MS_PER_STEP * 3).toFixed(3)})`);
  note(`three loaded carts + 100 loose bags: ${perStep.toFixed(3)} ms per step ` +
       `(budget ${CONFIG.sim.stepMs.toFixed(2)} ms, baseline ${BASELINE_MS_PER_STEP} ms = ` +
       `${(perStep / BASELINE_MS_PER_STEP).toFixed(2)}x)`);
  eq('H7 and nothing corrupted under load', assertContainment(perf.state).length, 0);
  eq('H8 with the chain intact', validateChain(perf.state).length, 0);
}
}

/* ── I. the live page ────────────────────────────────────────────────────── */
async function sectionI() {
  lines.push('--- I. the live page ---');
  const abc = window.__ABC;
  ok('I1 the game booted', !!(abc && abc.game));
  if (!abc) return;
  await yieldToLoop();          // see m1: sync sections never let an animation frame run

  const { game, renderer, hud } = abc;
  const banner0 = document.getElementById('err-banner');
  ok('I2 no error banner after boot', !banner0, banner0 && banner0.textContent);

  abc.startShift();
  const st = game.state;
  eq('I3 the airport starts with three carts', Object.keys(st.cartsById).length, 3);
  eq('I4 and one tractor', Object.keys(st.vehiclesById).length, 1);

  const cart = st.cartsById.cart_1;
  ok('I5 a cart parks on its marked bay',
     Math.hypot(cart.x - ANCHORS.cartBay1.x, cart.y - ANCHORS.cartBay1.y) < 0.01);

  st.player.x = cart.x; st.player.y = cart.y + 1.5;
  game.frame(FRAME_MS, null);
  hud.update();
  ok('I6 standing at a cart offers the placard prompt',
     document.getElementById('hudPrompt').classList.contains('on'),
     document.getElementById('hudPrompt').textContent);

  const v = st.vehiclesById.tractor_1;
  st.player.x = v.x; st.player.y = v.y;
  game.frame(FRAME_MS, null);
  hud.update();
  ok('I7 standing at the tractor offers the drive prompt',
     /Drive/.test(document.getElementById('hudPrompt').textContent),
     document.getElementById('hudPrompt').textContent);

  const inp = new Input(window);
  inp._debugPress('KeyF');
  game.frame(FRAME_MS, inp);
  eq('I8 F climbs in', st.player.drivingId, 'tractor_1');
  hud.update();
  ok('I9 the driving prompt replaces the walking one',
     /Get out/.test(document.getElementById('hudPrompt').textContent),
     document.getElementById('hudPrompt').textContent);

  /*
   * The tractor paints — and this compares two renders to say so.
   *
   * The old check sampled ONE pixel at the centre of the canvas and asserted `r+g+b > 60`.
   * The sort-room floor fill alone clears that: delete the tractor sprite outright and the
   * assertion stays green while naming the vehicle it cannot see. So the centre patch is
   * captured twice — once with the tractor under the camera and once with it driven off
   * the map — and what is asserted is that the pixels DIFFER.
   */
  abc.camera.follow(st.player.x, st.player.y, 0);
  const cx = Math.floor(renderer.canvas.width / 2), cy = Math.floor(renderer.canvas.height / 2);
  const patch = () => renderer.ctx.getImageData(cx - 16, cy - 16, 32, 32).data;

  renderer.render(st);
  const withTractor = patch();
  const parked = { x: v.x, y: v.y };
  v.x = -500; v.y = -500;                 // off the map, leaving only the ground under the camera
  renderer.render(st);
  const withoutTractor = patch();
  v.x = parked.x; v.y = parked.y;         // put it back before anything else reads the world
  renderer.render(st);

  let differing = 0;
  for (let i = 0; i < withTractor.length; i++) {
    if (withTractor[i] !== withoutTractor[i]) differing++;
  }
  ok('I10 the world paints with the tractor in it — the floor looks different without it',
     differing > 0, `${differing} of ${withTractor.length} subpixels differ`);
  ok('I10a and the canvas is painted rather than left black',
     (withTractor[0] + withTractor[1] + withTractor[2]) > 60,
     `rgb(${withTractor[0]},${withTractor[1]},${withTractor[2]})`);
  note(`the tractor changes ${differing} of ${withTractor.length} subpixels in a 32x32 patch ` +
       `at the camera centre`);

  eq('I11 the live game never violated containment', assertContainment(st).length, 0);
  eq('I12 nor the hitch chain', validateChain(st).length, 0);
  const banner = document.getElementById('err-banner');
  ok('I13 no error banner at the end of the run', !banner, banner && banner.textContent);
}

/* ── run ─────────────────────────────────────────────────────────────────── */
(async () => {
  const sections = [
    ['A', sectionA], ['B', sectionB], ['C', sectionC], ['D', sectionD],
    ['E', sectionE], ['F', sectionF], ['G', sectionG], ['H', sectionH], ['I', sectionI],
  ];
  for (const [name, fn] of sections) {
    emit(`RUNNING section ${name}...`);
    try { await fn(); }
    catch (e) { fails++; lines.push(`FAIL  section ${name} threw: ${(e && e.stack) || e}`); }
    emit(`RUNNING (section ${name} done)`);
  }
  emit();
})();
