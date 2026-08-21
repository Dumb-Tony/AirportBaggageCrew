/* Milestone 8 suite — the renderer draws what it claims to draw.
 *
 * WHY THIS SUITE EXISTS. Every other suite in this project proves the SIMULATION is
 * right, and the render layer got a single assertion per milestone: sample one pixel at
 * the centre of the canvas and check it is not black. That gate is met by the ground
 * fill alone. You can delete the tractor sprite, the aircraft sprite and every entity
 * draw call and all four of those assertions stay green.
 *
 * It cost real bugs. A render audit found three that had been shipping for milestones
 * and were visible in the project's own published screenshots:
 *
 *   - Every bag riding the CONVEYOR was painted UNDER the belt and 0.55 m below the
 *     deck. The belt sorted at 13.7 and a bag on it at ~13.2, so the belt was drawn
 *     last and covered them. The conveyor read as a featureless empty bar for the whole
 *     of M1 through M6, in a game about bags arriving on a conveyor.
 *   - The AIRCRAFT ground pass rotated by `ac.rot` and the upright pass did not. `rot`
 *     is pi at a stand, so the shadow, the gear and the wings were drawn back-to-front
 *     against the fuselage: the fin sat over the nose gear.
 *   - Bags in a CART sorted by their own footprint, which is metres in front of the
 *     cart's sort key, so they slid under the bed.
 *
 * The lesson is that "did it paint" is not the same question as "did it paint the right
 * thing in the right place", and only the second one is worth asserting. The technique
 * throughout is a DIFFERENTIAL: render the frame, remove exactly one class of thing,
 * render again, and count the pixels that changed. If removing every bag on the belt
 * changes nothing in the belt's rectangle, the bags were never visible there — which is
 * the bug, stated as an experiment rather than as an opinion.
 *
 * Removing a thing means deleting it from `state.bagsById` and putting it back, NEVER
 * reassigning `bag.location`. `src/systems/containment.js` owns that field (CLAUDE.md),
 * and a diagnostic that quietly writes to it would be teaching the exact habit the
 * invariant exists to prevent.
 */

import { CONFIG } from '../src/config.js';
import { Game, MODES } from '../src/game.js';
import { CONVEYOR, WORLD } from '../src/data/airport.js';
import { MIN_PX_PER_M } from '../src/render/camera.js';

/* ── harness ─────────────────────────────────────────────────────────────── */
const lines = [];
let passes = 0, fails = 0;

function ok(name, cond, detail = '') {
  if (cond) { passes++; lines.push(`PASS  ${name}`); }
  else { fails++; lines.push(`FAIL  ${name}${detail ? '  <- ' + detail : ''}`); }
}
const eq   = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
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

/* ── the differential ────────────────────────────────────────────────────── */

const ABC = () => window.__ABC;

/** A world-space rectangle as a device-pixel box on the canvas, clipped to it. */
function boxOf(camera, canvas, x0, y0, x1, y1) {
  const a = camera.worldToScreen(x0, y0);
  const b = camera.worldToScreen(x1, y1);
  const d = camera.dpr;
  const L = Math.max(0, Math.floor(Math.min(a.x, b.x) * d));
  const T = Math.max(0, Math.floor(Math.min(a.y, b.y) * d));
  const R = Math.min(canvas.width,  Math.ceil(Math.max(a.x, b.x) * d));
  const B = Math.min(canvas.height, Math.ceil(Math.max(a.y, b.y) * d));
  return { x: L, y: T, w: Math.max(0, R - L), h: Math.max(0, B - T) };
}

/** Paint the state and read one rectangle back. */
function shoot(state, box) {
  const { renderer } = ABC();
  renderer.render(state);
  if (box.w < 1 || box.h < 1) return null;
  return renderer.ctx.getImageData(box.x, box.y, box.w, box.h).data;
}

/** How many pixels differ between two reads of the same rectangle. */
function diffPixels(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  }
  return n;
}

/**
 * Render `box` with those bags present, then with them gone, and return the pixel
 * count that changed. Restores `bagsById` exactly, including key order, because the
 * draw list is built by iterating it and a reordering would be a second variable.
 */
function withoutBags(state, box, ids) {
  const before = shoot(state, box);
  const saved = new Map();
  for (const id of ids) { saved.set(id, state.bagsById[id]); delete state.bagsById[id]; }
  const after = shoot(state, box);
  const rest = Object.entries(state.bagsById);
  for (const k of Object.keys(state.bagsById)) delete state.bagsById[k];
  for (const [id, bag] of saved) state.bagsById[id] = bag;
  for (const [id, bag] of rest) state.bagsById[id] = bag;
  return { changed: diffPixels(before, after), area: box.w * box.h };
}

const idsAt = (state, type) =>
  Object.values(state.bagsById).filter((b) => b.location.type === type).map((b) => b.id);

/*
 * EVERY section here reads pixels, so the canvas must have a real backing store before
 * the first one runs. A suite of synchronous sections never yields to the event loop, so
 * no animation frame ever runs and `camera.resize()` is never called — m1 spent a
 * debugging round silently testing a 1x1 canvas for exactly this reason (CLAUDE.md).
 * Yield once, then force the resize rather than trusting that a frame arrived: headless
 * Chrome delivers only one to three rAF callbacks in total.
 */
async function setup() {
  await yieldToLoop();
  const { camera, renderer } = ABC();
  camera.resize(renderer.canvas);
  ok('S1 the canvas has a real backing store before any pixel is read',
     renderer.canvas.width > 200 && renderer.canvas.height > 100,
     `${renderer.canvas.width}x${renderer.canvas.height} device px`);
  note(`canvas ${renderer.canvas.width}x${renderer.canvas.height}, ${camera.scale.toFixed(1)} px/m`);
}

/* ── A. bags on the conveyor are actually visible on it ──────────────────── */

async function sectionA() {
  const { game, camera, renderer } = ABC();
  game.reset();
  game.startShift();
  camera.resize(renderer.canvas);

  /*
   * Never assume WHEN a seeded bag reaches the belt (CLAUDE.md: this has bitten twice).
   * Drive until the belt is genuinely carrying a few, bounded, and say how long it took.
   */
  let frames = 0;
  const onBelt = () => idsAt(game.state, 'conveyor');
  while (onBelt().length < 3 && frames < 60 * 240) { game.frame(FRAME_MS, null); frames++; }
  const belt = onBelt();
  ok('A1 the belt is carrying bags to look at', belt.length >= 3,
     `${belt.length} after ${(frames / 60).toFixed(1)} s`);
  if (belt.length < 3) return;

  // Frame the belt. The camera is the player's, so point it at the conveyor instead.
  camera.follow((CONVEYOR.x0 + CONVEYOR.x1) / 2, CONVEYOR.y0, 0);

  const pad = CONVEYOR.widthM * 1.5;
  const box = boxOf(camera, renderer.canvas,
                    CONVEYOR.x0 - 1, CONVEYOR.y0 - pad, CONVEYOR.x1 + 1, CONVEYOR.y0 + pad);
  ok('A2 the belt is on screen to be measured', box.w > 20 && box.h > 4,
     `${box.w}x${box.h} device px`);

  const r = withoutBags(game.state, box, belt);
  /*
   * THE ASSERTION THIS SUITE WAS WRITTEN FOR. Before the sort-key fix this was 0: the
   * belt was drawn after its own cargo and covered every bag on it. A threshold of 200
   * device pixels is roughly one bag's top face; anything at all above zero would prove
   * SOMETHING drew, but a handful of pixels would be an edge peeping out from behind
   * the deck rather than bags sitting on it.
   */
  ok('A3 removing the bags on the belt visibly changes the belt', r.changed > 200,
     `${r.changed} of ${r.area} px changed`);
  note(`belt region: ${belt.length} bags, ${r.changed} px changed in ${r.area}`);

  // ...and they are drawn ON the deck, not below it. The lower half of the belt strip
  // is where a bag rendered with no lift would land.
  const under = boxOf(camera, renderer.canvas,
                      CONVEYOR.x0 - 1, CONVEYOR.y0 + CONVEYOR.widthM * 0.6,
                      CONVEYOR.x1 + 1, CONVEYOR.y0 + pad);
  const deck = boxOf(camera, renderer.canvas,
                     CONVEYOR.x0 - 1, CONVEYOR.y0 - pad,
                     CONVEYOR.x1 + 1, CONVEYOR.y0 + CONVEYOR.widthM * 0.5);
  const rUnder = withoutBags(game.state, under, belt);
  const rDeck  = withoutBags(game.state, deck,  belt);
  ok('A4 the belt bags sit on the deck rather than below it',
     rDeck.changed > rUnder.changed,
     `deck ${rDeck.changed} px vs below ${rUnder.changed} px`);
  note(`deck ${rDeck.changed} px / below ${rUnder.changed} px`);
}

/* ── B. bags in a cart ride on the bed ───────────────────────────────────── */

async function sectionB() {
  const { game, camera, renderer } = ABC();
  const st = game.state;

  const cart = Object.values(st.cartsById)[0];
  ok('B1 there is a cart to load', !!cart);
  if (!cart) return;

  // Load it through the real containment API, so the location invariant is never
  // bypassed — this suite proves rendering, and must not manufacture illegal states.
  const { moveBag } = await import('../src/systems/containment.js');
  const loose = Object.values(st.bagsById).filter((b) => b.location.type === 'floor').slice(0, 4);
  let loaded = 0;
  for (const bag of loose) {
    try { moveBag(st, bag, { type: 'cart', id: cart.id }, game.bus, st.simTimeMs); loaded++; }
    catch (e) { note(`cart load refused: ${e && e.message}`); break; }
  }
  ok('B2 bags went into the cart through containment', loaded >= 2, `${loaded} loaded`);
  if (loaded < 2) return;

  game.frame(FRAME_MS, null);           // one step pins the load onto the bed
  camera.follow(cart.x, cart.y, 0);

  const half = Math.max(CONFIG.cart.lengthM, CONFIG.cart.widthM);
  const box = boxOf(camera, renderer.canvas,
                    cart.x - half, cart.y - half * 1.2, cart.x + half, cart.y + half * 0.8);
  const r = withoutBags(st, box, idsAt(st, 'cart'));
  ok('B3 removing the cart load visibly changes the cart', r.changed > 120,
     `${r.changed} of ${r.area} px changed`);
  note(`cart region: ${loaded} bags, ${r.changed} px changed in ${r.area}`);
}

/* ── C. the aircraft is not drawn back-to-front ──────────────────────────── */

async function sectionC() {
  /*
   * An orientation bug is hard to see in a pixel diff and trivial to see in the source:
   * the two passes must agree about rotation or the shadow faces the other way from the
   * fuselage. m0 section G greps the renderer for logic it must not contain; this is the
   * same technique aimed at a thing it must not do twice differently.
   *
   * Comments are stripped first. The comment left at the fix site explains why there is
   * no rotation there, and it contains the string it is forbidding.
   */
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  const rSrc = strip(await (await fetch('/src/render/renderer.js')).text());
  const sSrc = strip(await (await fetch('/src/render/sprites.js')).text());

  const groundFn = rSrc.slice(rSrc.indexOf('_drawAircraftGround'));
  const groundBody = groundFn.slice(0, groundFn.indexOf('\n  _') > 0 ? groundFn.indexOf('\n  _') : 4000);
  ok('C1 the aircraft ground pass does not rotate by ac.rot',
     !/ctx\.rotate\(\s*ac\.rot\s*\)/.test(groundBody),
     groundBody.match(/ctx\.rotate\([^)]*\)/g)?.join(' ') || 'no rotate');

  const gearFn = sSrc.slice(sSrc.indexOf('drawAircraftGear'));
  const gearBody = gearFn.slice(0, gearFn.indexOf('\nexport') > 0 ? gearFn.indexOf('\nexport') : 4000);
  ok('C2 and neither does the gear it has to line up with',
     !/ctx\.rotate\(\s*(ac|a)\.rot\s*\)/.test(gearBody),
     gearBody.match(/ctx\.rotate\([^)]*\)/g)?.join(' ') || 'no rotate');

  // The pair is the point: either both rotate or neither does. One of each is the bug.
  const gRot = /ctx\.rotate\(\s*ac\.rot\s*\)/.test(groundBody);
  const sRot = /ctx\.rotate\(\s*(ac|a)\.rot\s*\)/.test(gearBody);
  eq('C3 the two aircraft passes agree about rotation', gRot, sRot);

  // And the aircraft really is at the rotation that made this visible.
  const { game } = ABC();
  const present = Object.values(game.state.aircraftById || {}).filter((a) => a.present);
  ok('C4 an aircraft is at a stand, where rot is not zero',
     present.length > 0 && present.some((a) => Math.abs(a.rot) > 0.5),
     present.map((a) => a.rot.toFixed(2)).join(', ') || 'none present');
}

/* ── D. the readability floor and the canvas text scale ──────────────────── */

async function sectionD() {
  const { game, camera, renderer } = ABC();

  ok('D1 the camera never draws below the legibility floor',
     camera.scale >= MIN_PX_PER_M - 1e-9,
     `${camera.scale.toFixed(1)} px/m across ${camera.cssW} css px`);
  ok('D2 and never shows more world than the readability budget',
     camera.visibleM.w <= CONFIG.render.viewWidthM + 0.01,
     `${camera.visibleM.w.toFixed(2)} m vs budget ${CONFIG.render.viewWidthM}`);

  /*
   * GDD §16.6's text scale has to reach the CANVAS, not just the DOM. The DOM half is a
   * CSS variable and m5 section F covers it; the canvas has no cascade, so every
   * metre-space font multiplies by `renderer.textScale` by hand — which is exactly the
   * kind of thing that gets added to seven call sites and forgotten at the eighth.
   *
   * Differential again: a bag's tag rendered at 1x and at 2x must differ. And the
   * PAINTED TARMAC must NOT, because those are world art rather than interface and are
   * deliberately excluded.
   */
  // Any DRAWN bag will do — section B loaded the loose ones into a cart, and a bag on a
  // bed carries the same tag. Asking for a floor bag specifically made this section
  // depend on the one before it.
  const st = game.state;
  const bag = Object.values(st.bagsById).find((b) =>
    ['floor', 'cart', 'conveyor'].includes(b.location.type));
  ok('D3 there is a bag whose tag can be measured', !!bag,
     Object.values(st.bagsById).map((b) => b.location.type).join(',') || 'no bags');
  if (!bag) return;

  camera.follow(bag.x, bag.y, 0);
  const tag = boxOf(camera, renderer.canvas,
                    bag.x - bag.widthM, bag.y - bag.heightM * 2,
                    bag.x + bag.widthM, bag.y + bag.heightM);

  const saved = renderer.textScale;
  renderer.textScale = 1;
  const at1 = shoot(st, tag);
  renderer.textScale = 2;
  const at2 = shoot(st, tag);
  renderer.textScale = saved;

  const moved = diffPixels(at1, at2);
  ok('D4 the text scale reaches the canvas, not just the DOM', moved > 20,
     `${moved} of ${tag.w * tag.h} px changed between 1x and 2x`);
  note(`bag tag: ${moved} px changed between 1x and 2x`);

  // The painted gate number is world art and must hold still.
  const stand = boxOf(camera, renderer.canvas, 40, 8, 56, 20);
  camera.follow(48, 14, 0);
  const paint = boxOf(camera, renderer.canvas, 40, 8, 56, 20);
  renderer.textScale = 1;
  const p1 = shoot(st, paint);
  renderer.textScale = 4;
  const p4 = shoot(st, paint);
  renderer.textScale = saved;
  const painted = diffPixels(p1, p4);
  ok('D5 painted tarmac does not scale with an interface setting', painted === 0,
     `${painted} px moved in the stand markings at 4x`);
  void stand;
}

/* ── E. the depth sort is a total order that nothing escapes ─────────────── */

async function sectionE() {
  const { game, renderer } = ABC();
  const st = game.state;

  /*
   * `_collect()` is the single list that decides what covers what. A new entity type
   * that stands up has to be added to it or it draws at the wrong depth — the failure
   * mode is silent and was how the belt bug survived six milestones. Assert the list is
   * sorted and that every drawable thing in the world reached it.
   */
  renderer.render(st);
  const list = renderer._draws;
  ok('E1 the draw list was built', Array.isArray(list) && list.length > 0, `${list && list.length}`);
  if (!list || !list.length) return;

  let sorted = true;
  for (let i = 1; i < list.length; i++) if (list[i].y < list[i - 1].y) { sorted = false; break; }
  ok('E2 the draw list is in depth order', sorted);

  const drawn = new Set(list.map((d) => d.o && d.o.id).filter(Boolean));
  const shouldDraw = Object.values(st.bagsById).filter((b) =>
    ['floor', 'conveyor', 'carried', 'cart'].includes(b.location.type));
  const missing = shouldDraw.filter((b) => !drawn.has(b.id));
  eq('E3 every bag that has a place in the world is in the draw list', missing.length, 0);

  const carts = Object.values(st.cartsById).filter((c) => !drawn.has(c.id));
  eq('E4 every cart is in the draw list', carts.length, 0);
  const tractors = Object.values(st.vehiclesById).filter((v) => !drawn.has(v.id));
  eq('E5 every tractor is in the draw list', tractors.length, 0);

  // A bag riding something sorts WITH it, which is the fix, stated directly.
  for (const bag of shouldDraw) {
    if (bag.location.type !== 'cart') continue;
    const cart = st.cartsById[bag.location.id];
    if (!cart) continue;
    const e = list.find((d) => d.o === bag);
    const c = list.find((d) => d.o === cart);
    if (!e || !c) continue;
    ok(`E6 a bag in ${cart.id} sorts just after its cart`, e.y > c.y && e.y - c.y < 0.5,
       `bag ${e.y.toFixed(2)} vs cart ${c.y.toFixed(2)}`);
    break;
  }
  for (const bag of shouldDraw) {
    if (bag.location.type !== 'conveyor') continue;
    const e = list.find((d) => d.o === bag);
    const belt = list.find((d) => d.o === st.world.conveyor);
    if (!e || !belt) break;
    ok('E7 a bag on the belt sorts after the belt', e.y > belt.y,
       `bag ${e.y.toFixed(2)} vs belt ${belt.y.toFixed(2)}`);
    break;
  }
}

/* ── G. foreshortening is applied to the ground plane, not to the object ─── */

/** The bounding box of the pixels that differ between two reads, in device px. */
function diffBox(a, b, w) {
  if (!a || !b || a.length !== b.length) return null;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue;
    const p = i / 4, x = p % w, y = (p / w) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

async function sectionG() {
  const { game, camera, renderer } = ABC();
  const st = game.state;
  const v = Object.values(st.vehiclesById)[0];
  ok('G1 there is a tractor to measure', !!v);
  if (!v) return;

  /*
   * THE RULE. Foreshortening belongs to the GROUND PLANE: rotate the footprint in world
   * space, THEN squash the result vertically. Squashing an object's own depth and then
   * rotating the squashed rectangle applies the foreshortening to whichever way the
   * object happens to be pointing, which is not a projection of anything.
   *
   * The measurement that separates the two is the drawn WIDTH, because the height also
   * carries the extruded body and the ratio gets muddied. A tractor is 2.2 m long and
   * 1.3 m wide, so turning it from east to north should narrow it to 1.3/2.2 = 0.59 of
   * its drawn width. Under the object-space bug the width also picks up the 0.75 squash
   * and the ratio collapses to 0.44 — and the tractor renders 33% too long facing north,
   * which is what the eye actually notices.
   */
  const L = CONFIG.tractor.lengthM, W = CONFIG.tractor.widthM;
  v.x = 30; v.y = 26; v.speed = 0;
  camera.follow(v.x, v.y, 0);
  const pad = L * 2.2;
  const box = boxOf(camera, renderer.canvas, v.x - pad, v.y - pad, v.x + pad, v.y + pad);

  const measure = (rot) => {
    v.rot = rot;
    const before = shoot(st, box);
    const saved = st.vehiclesById[v.id];
    delete st.vehiclesById[v.id];
    const after = shoot(st, box);
    st.vehiclesById[v.id] = saved;
    return diffBox(before, after, box.w);
  };

  const east  = measure(0);
  const north = measure(-Math.PI / 2);
  ok('G2 the tractor is drawn at both headings', !!east && !!north,
     `east ${east && east.w}x${east && east.h}, north ${north && north.w}x${north && north.h}`);
  if (!east || !north) return;

  const ratio = north.w / east.w;
  const want  = W / L;
  note(`tractor drawn east ${east.w}x${east.h} px, north ${north.w}x${north.h} px`);
  note(`width ratio ${ratio.toFixed(3)} — world says ${want.toFixed(3)}, object-space squash would say ${(want * camera.squash).toFixed(3)}`);
  /*
   * Stated as the hypothesis test it is, rather than as a tolerance nobody can justify.
   * The two candidate models predict 0.59 and 0.44; the measurement has to land nearer
   * one of them. It reads high of both because the wheels overhang the body sideways and
   * widen the north-facing box — which is why an absolute tolerance here would have been
   * a number picked to match today's sprite rather than a claim about projection.
   *
   * A render audit reported this as a live bug ("the tractor is 33% too long facing
   * north"). It is not: measured 0.765, and the heights differ by 23 px where the
   * world-space model predicts 19 and the object-space one 35. Recorded as a NEGATIVE
   * RESULT so the next reader does not re-derive it from the shape of the source.
   */
  ok('G3 turning the tractor north narrows it by its own proportions, not by the squash',
     Math.abs(ratio - want) < Math.abs(ratio - want * camera.squash),
     `${ratio.toFixed(3)}: world-space says ${want.toFixed(3)}, object-space ${(want * camera.squash).toFixed(3)}`);

  v.rot = 0;
}

/* ── H. what a frame costs to paint ──────────────────────────────────────── */

async function sectionH() {
  const { game, camera, renderer } = ABC();
  const st = game.state;

  /*
   * WHY THIS COUNTS CALLS INSTEAD OF TIMING THEM. The obvious version of this section
   * timed 240 render() calls with performance.now() and reported 0.000 ms/frame. That is
   * not a fast renderer — it is a frozen clock. A control loop of three million Math.sqrt
   * calls, placed right beside it, also measured 0.00 ms. Under the harness's
   * --virtual-time-budget, performance.now() does not advance across synchronous work,
   * so ANY wall-clock measurement of a synchronous block here is meaningless.
   *
   * (That is worth knowing beyond this file: the per-step costs the other suites print
   * come from the same clock. They span far longer runs and do report plausible numbers,
   * but no assertion in this project should rest on a microbenchmark taken this way.)
   *
   * So count the WORK instead. A canvas operation census is deterministic, identical on
   * every machine, and it is the quantity the render audit was actually asking about:
   * how much of each frame is spent drawing things nobody can see.
   */
  camera.follow(st.player.x, st.player.y, 0);
  renderer.render(st);                       // warm: the first frame builds the patterns

  const ctx = renderer.ctx;
  const COUNTED = ['fillRect', 'strokeRect', 'fill', 'stroke', 'fillText', 'strokeText',
                   'drawImage', 'beginPath', 'save', 'restore', 'setTransform', 'ellipse'];
  const tally = {};
  const original = {};
  for (const m of COUNTED) {
    original[m] = ctx[m];
    tally[m] = 0;
    ctx[m] = function (...a) { tally[m]++; return original[m].apply(ctx, a); };
  }
  renderer.render(st);
  for (const m of COUNTED) ctx[m] = original[m];

  const painted = tally.fill + tally.stroke + tally.fillRect + tally.strokeRect +
                  tally.fillText + tally.strokeText + tally.drawImage + tally.ellipse;
  note(`one frame: ${painted} paint ops, ${tally.save} save / ${tally.restore} restore, ` +
       `${tally.setTransform} transforms, ${renderer._draws.length} in the draw list`);

  ok('H1 the frame actually issued drawing work', painted > 50, `${painted} paint ops`);
  eq('H2 every save is matched by a restore', tally.save, tally.restore);

  /*
   * THE CENSUS THAT MATTERS. `_collect()` walks every entity in the world, and the ground
   * pass walks every wall, zone and marking, whether or not any of it is inside the
   * viewport. At this world size that is affordable; the number is recorded so that if
   * the airport grows, the cost of NOT culling is a figure somebody can point at rather
   * than a suspicion. The threshold is a ceiling on today's frame, not a target.
   */
  const vis = camera.visibleM;
  const inView = (x, y) => Math.abs(x - camera.centre.x) <= vis.w / 2 + 2 &&
                           Math.abs(y - camera.centre.y) <= vis.h / 2 + 2;
  const drawn = renderer._draws;
  const off = drawn.filter((d) => d.o && typeof d.o.x === 'number' && !inView(d.o.x, d.o.y));
  const pct = drawn.length ? Math.round((off.length / drawn.length) * 100) : 0;
  note(`${off.length} of ${drawn.length} depth-sorted entries (${pct}%) are outside the viewport`);
  ok('H3 the draw list is not overwhelmingly off-screen work', pct < 90, `${pct}% off-screen`);

  /*
   * `_buildPatterns` runs inside the FIRST render rather than at construction, so the
   * very first painted frame does the procedural-texture work — a one-off hitch at the
   * worst possible moment. Counted rather than timed, for the reason at the top.
   */
  const fresh = new (renderer.constructor)(renderer.canvas, camera);
  fresh.textScale = renderer.textScale;
  ok('H4 a fresh renderer has not built its ground patterns yet', !fresh._patterns,
     'they are built lazily inside the first render');
  fresh.render(st);
  ok('H5 and has them after one frame', !!fresh._patterns);
  renderer.render(st);                       // leave the shared canvas as we found it
}

/* ── F. the live page, and no regression in what already worked ──────────── */

async function sectionF() {
  await yieldToLoop();
  const { game, renderer } = ABC();
  ok('F1 the game booted', !!game && !!renderer);
  const banner = document.getElementById('err-banner');
  ok('F2 no error banner after a suite of re-renders', !banner, banner && banner.textContent);
  eq('F3 the renderer left the game in play', game.state.mode, MODES.PLAYING);

  const { assertContainment } = await import('../src/systems/containment.js');
  eq('F4 rendering never moved a bag', assertContainment(game.state).length, 0);

  const bags = Object.keys(game.state.bagsById).length;
  ok('F5 and never lost one', bags <= game.state.shift.bagSchedule.length,
     `${bags} bags vs ${game.state.shift.bagSchedule.length} authored`);
  note(`${bags} bags in the world at the end of the render suite`);
  void WORLD;
}

/* ── run ─────────────────────────────────────────────────────────────────── */
(async () => {
  const sections = [
    ['S', setup], ['A', sectionA], ['B', sectionB], ['C', sectionC],
    ['D', sectionD], ['E', sectionE], ['G', sectionG], ['H', sectionH], ['F', sectionF],
  ];
  for (const [name, fn] of sections) {
    emit(`RUNNING section ${name}...`);
    try { await fn(); }
    catch (e) { fails++; lines.push(`FAIL  section ${name} threw: ${(e && e.stack) || e}`); }
    emit(`RUNNING (section ${name} done)`);
  }
  emit();
})();
