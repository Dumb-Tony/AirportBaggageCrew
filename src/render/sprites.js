/* Sprites — everything that is drawn as an object rather than as a surface.
 *
 * All of it is procedural: GDD §21.1 asks for generated shapes over fetched assets, and
 * the game still makes zero external requests.
 *
 * ANIMATION IS DERIVED, NEVER STORED HERE. A walk cycle reads `player.walkedM`, wheels
 * read `odometerM` and `rolledM`, beacons read `simTimeMs`. Those are all simulation
 * values, which buys three things for free: the renderer stays stateless, two runs of a
 * seed animate identically, and a paused game freezes completely rather than continuing
 * to blink and spin behind the pause card.
 *
 * Every routine draws in METRES with the origin at the object's base on the ground and
 * -y going up — i.e. inside camera.beginUpright().
 */

import { CONFIG } from '../config.js';
import { tint } from './textures.js';

/* ── people ──────────────────────────────────────────────────────────────── */

const SKIN = '#e8c9a0', SKIN_BACK = '#3a3126';
const HIVIS = '#e9e153', HIVIS_D = '#b8b02f';
const TROUSER = '#2f3542', BOOT = '#191d25';
const HAT = '#f2b33a', HAT_D = '#c98d1e';

/**
 * A ground handler, animated.
 *
 * @param {object} o
 *   s        overall scale (1 = a 1.72 m adult)
 *   walk     walk phase in radians, derived from distance travelled
 *   move01   0 standing, 1 at full pelt — blends the cycle in
 *   aimX/aimY unit facing
 *   carrying whether both hands are full
 *   charge01 throw wind-up, 0..1
 *   bobT     seconds, for the idle breath
 */
export function drawPerson(ctx, o) {
  const s = o.s || 1;
  const move = Math.max(0, Math.min(1, o.move01 || 0));
  const sw = Math.sin(o.walk || 0);
  const swb = Math.sin((o.walk || 0) + Math.PI);

  const back = (o.aimY || 0) < -0.35;
  const side = Math.abs(o.aimX || 0) > 0.55;
  const faceDir = (o.aimX || 0) >= 0 ? 1 : -1;

  // Bob on every footfall, plus a slow breath when standing still.
  const bob = (-Math.abs(sw) * 0.05 * move
               + Math.sin((o.bobT || 0) * 1.7) * 0.012 * (1 - move)) * s;
  // Lean into the run, and back into a throw wind-up.
  const lean = ((o.aimX || 0) * 0.05 * move - (o.charge01 || 0) * 0.10) * s;

  ctx.save();
  ctx.translate(0, bob);

  /* legs — swung about the hip, so they actually walk */
  const hipY = -0.80 * s;
  leg(ctx, s, hipY, sw * 0.5 * move, faceDir);
  leg(ctx, s, hipY, swb * 0.5 * move, faceDir);

  ctx.save();
  ctx.translate(lean, 0);

  /* arms behind the torso on the far side */
  const armSwing = o.carrying ? 0 : swb * 0.55 * move;
  arm(ctx, s, -0.26 * s, armSwing, o.carrying, o.charge01 || 0, -1);

  /* hi-vis torso */
  const tw = 0.60 * s, th = 0.56 * s, ty = -1.36 * s;
  ctx.fillStyle = HIVIS;
  rr(ctx, -tw / 2, ty, tw, th, 0.13 * s); ctx.fill();
  ctx.strokeStyle = HIVIS_D; ctx.lineWidth = 0.04 * s; ctx.stroke();
  // reflective bands
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillRect(-tw / 2, ty + th * 0.42, tw, 0.07 * s);
  if (!back) {
    ctx.fillRect(-tw / 2 + 0.09 * s, ty, 0.06 * s, th);
    ctx.fillRect(tw / 2 - 0.15 * s, ty, 0.06 * s, th);
  }

  /* near arm, in front of the torso */
  arm(ctx, s, 0.26 * s, o.carrying ? 0 : sw * 0.55 * move, o.carrying, o.charge01 || 0, 1);

  /* head */
  const hy = -1.56 * s;
  ctx.fillStyle = back ? SKIN_BACK : SKIN;
  ctx.beginPath(); ctx.arc(0, hy, 0.20 * s, 0, Math.PI * 2); ctx.fill();
  if (!back) {
    ctx.fillStyle = 'rgba(40,30,20,0.75)';
    const ex = side ? faceDir * 0.07 * s : 0;
    ctx.beginPath(); ctx.arc(ex - 0.06 * s, hy + 0.01 * s, 0.026 * s, 0, Math.PI * 2); ctx.fill();
    if (!side) { ctx.beginPath(); ctx.arc(0.06 * s, hy + 0.01 * s, 0.026 * s, 0, Math.PI * 2); ctx.fill(); }
  }

  /* hard hat, with the brim on the facing side */
  ctx.fillStyle = HAT;
  ctx.beginPath(); ctx.arc(0, hy - 0.03 * s, 0.215 * s, Math.PI, Math.PI * 2); ctx.fill();
  ctx.fillStyle = HAT_D;
  const brimX = side ? faceDir * 0.10 * s : 0;
  ctx.fillRect(-0.24 * s + brimX * 0.4, hy - 0.05 * s, 0.48 * s, 0.055 * s);

  ctx.restore();
  ctx.restore();
}

function leg(ctx, s, hipY, angle, faceDir) {
  ctx.save();
  ctx.translate(0, hipY);
  ctx.rotate(angle);
  ctx.fillStyle = TROUSER;
  rr(ctx, -0.10 * s, 0, 0.19 * s, 0.62 * s, 0.07 * s); ctx.fill();
  ctx.fillStyle = BOOT;
  rr(ctx, -0.11 * s + faceDir * 0.01 * s, 0.56 * s, 0.22 * s, 0.13 * s, 0.05 * s); ctx.fill();
  ctx.restore();
}

function arm(ctx, s, x, swing, carrying, charge, sideSign) {
  ctx.save();
  ctx.translate(x, -1.30 * s);
  // Carrying holds both arms out front; a wind-up drags the near arm back.
  const a = carrying ? 0.95 : swing - charge * 1.5 * (sideSign > 0 ? 1 : 0.2);
  ctx.rotate(a);
  ctx.fillStyle = HIVIS_D;
  rr(ctx, -0.075 * s, 0, 0.15 * s, 0.42 * s, 0.06 * s); ctx.fill();
  ctx.fillStyle = SKIN;
  ctx.beginPath(); ctx.arc(0, 0.46 * s, 0.075 * s, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/* ── bags ────────────────────────────────────────────────────────────────── */

/**
 * The top face of a bag, by kind. Drawn centred at the origin, already rotated.
 * @param w   width in metres
 * @param d   SCREEN depth (the footprint depth already foreshortened)
 */
export function drawBagTop(ctx, bag, w, d) {
  const c = bag.appearance.color;
  const kind = bag.appearance.kind || 'suitcase';

  switch (kind) {
    case 'duffel': {
      ctx.fillStyle = c;
      rr(ctx, -w / 2, -d / 2, w, d, d * 0.48); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.42)'; ctx.lineWidth = 0.035; ctx.stroke();
      // end panels and a strap across the middle
      ctx.fillStyle = tint(c, -0.07);
      rr(ctx, -w / 2, -d / 2, w * 0.16, d, d * 0.4); ctx.fill();
      rr(ctx, w / 2 - w * 0.16, -d / 2, w * 0.16, d, d * 0.4); ctx.fill();
      ctx.fillStyle = 'rgba(30,28,26,0.7)';
      ctx.fillRect(-w * 0.06, -d / 2, w * 0.12, d);
      break;
    }
    case 'hardcase': {
      ctx.fillStyle = c;
      rr(ctx, -w / 2, -d / 2, w, d, 0.05); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.04; ctx.stroke();
      // ribs, and metal corner caps
      ctx.strokeStyle = tint(c, 0.10); ctx.lineWidth = 0.035;
      for (let i = 1; i < 4; i++) {
        const x = -w / 2 + (w * i) / 4;
        ctx.beginPath(); ctx.moveTo(x, -d / 2 + 0.04); ctx.lineTo(x, d / 2 - 0.04); ctx.stroke();
      }
      ctx.fillStyle = '#9aa0aa';
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        ctx.fillRect(sx * (w / 2 - 0.09), sy * (d / 2 - 0.06) - 0.03, 0.09, 0.07);
      }
      break;
    }
    case 'backpack': {
      ctx.fillStyle = c;
      rr(ctx, -w / 2, -d / 2, w, d, d * 0.34); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.42)'; ctx.lineWidth = 0.035; ctx.stroke();
      // front pocket and two straps
      ctx.fillStyle = tint(c, -0.09);
      rr(ctx, -w * 0.26, -d * 0.18, w * 0.52, d * 0.44, 0.05); ctx.fill();
      ctx.strokeStyle = 'rgba(20,20,20,0.55)'; ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.moveTo(-w * 0.16, -d / 2); ctx.lineTo(-w * 0.16, d / 2);
      ctx.moveTo(w * 0.16, -d / 2);  ctx.lineTo(w * 0.16, d / 2);
      ctx.stroke();
      break;
    }
    default: {                       // suitcase: the workhorse, with wheels and a handle
      ctx.fillStyle = c;
      rr(ctx, -w / 2, -d / 2, w, d, 0.09); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.04; ctx.stroke();
      ctx.strokeStyle = tint(c, 0.12); ctx.lineWidth = 0.03;
      ctx.strokeRect(-w / 2 + 0.07, -d / 2 + 0.05, w - 0.14, d - 0.10);
      // pull handle along the top edge
      ctx.strokeStyle = '#33383f'; ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.moveTo(-w * 0.16, -d / 2 - 0.01); ctx.lineTo(w * 0.16, -d / 2 - 0.01);
      ctx.stroke();
      // wheels at the trailing end
      ctx.fillStyle = '#1a1d23';
      ctx.beginPath(); ctx.arc(w / 2 - 0.06, -d / 2 + 0.06, 0.055, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(w / 2 - 0.06, d / 2 - 0.06, 0.055, 0, Math.PI * 2); ctx.fill();
    }
  }

  if (bag.appearance.strap && kind !== 'duffel') {
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 0.06;
    ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.stroke();
  }
}

/* ── wheels, shared by everything that rolls ─────────────────────────────── */

/** A wheel seen from the side, with a spoke so the rotation is visible. */
export function drawWheel(ctx, x, y, r, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#15181e';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#565d6b';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#8b93a3';
  ctx.lineWidth = r * 0.16;
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(-r * 0.62, 0); ctx.lineTo(r * 0.62, 0);
  ctx.stroke();
  ctx.restore();
}

/* ── the tractor ─────────────────────────────────────────────────────────── */

/** Bodywork, cab, seat and a beacon that flashes on simulation time. */
export function drawTractorBody(ctx, v, sd, simTimeMs, driven, flashing = true) {
  const L = CONFIG.tractor.lengthM, deckY = -CONFIG.tractor.lengthM * 0.28;

  ctx.save();
  ctx.translate(0, deckY);
  ctx.rotate(v.rot);

  ctx.fillStyle = driven ? '#e08a30' : '#a8601f';
  rr(ctx, -L / 2, -sd / 2, L, sd, 0.18); ctx.fill();
  ctx.strokeStyle = '#40270a'; ctx.lineWidth = 0.07; ctx.stroke();

  // a stripe so the body is not one flat slab
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(-L / 2 + 0.15, -sd * 0.10, L - 0.3, sd * 0.14);

  // an unmistakable front — GDD §19.1
  ctx.fillStyle = '#f7ecd2';
  ctx.beginPath();
  ctx.moveTo(L / 2 - 0.04, -sd / 2 + 0.09);
  ctx.lineTo(L / 2 + 0.30, 0);
  ctx.lineTo(L / 2 - 0.04, sd / 2 - 0.09);
  ctx.closePath(); ctx.fill();

  // hitch
  ctx.fillStyle = '#23262e';
  ctx.fillRect(-L / 2 - 0.34, -0.09, 0.4, 0.18);
  ctx.restore();

  // seat and steering column, standing on the deck
  ctx.fillStyle = '#2a2f3a';
  rr(ctx, -0.26, deckY - 0.42, 0.34, 0.42, 0.07); ctx.fill();
  ctx.strokeStyle = '#4a515f'; ctx.lineWidth = 0.07;
  ctx.beginPath(); ctx.moveTo(0.26, deckY); ctx.lineTo(0.20, deckY - 0.46); ctx.stroke();

  // roll cage
  ctx.strokeStyle = '#8a5c1c'; ctx.lineWidth = 0.09;
  ctx.beginPath();
  ctx.moveTo(-0.42, deckY); ctx.lineTo(-0.42, deckY - 0.95);
  ctx.lineTo(0.42, deckY - 0.95); ctx.lineTo(0.42, deckY);
  ctx.stroke();

  // amber beacon. Flashes on SIMULATION time, so it stops when the game does. Under
  // reduced motion it holds steady rather than dimming — GDD §16.6 asks for no flashing,
  // and a faint strobe is still a strobe.
  const flash = flashing ? 0.35 + 0.65 * Math.pow(Math.max(0, Math.sin(simTimeMs / 150)), 6) : 0.6;
  ctx.fillStyle = `rgba(255,176,48,${flash.toFixed(3)})`;
  ctx.beginPath(); ctx.arc(0, deckY - 1.06, 0.13, 0, Math.PI * 2); ctx.fill();
  if (driven) {
    ctx.fillStyle = `rgba(255,176,48,${(flash * 0.22).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(0, deckY - 1.06, 0.42, 0, Math.PI * 2); ctx.fill();
  }
}

/* ── the cart ────────────────────────────────────────────────────────────── */

/** An open frame with mesh sides, so it reads as something you load rather than a slab. */
export function drawCartBody(ctx, cart, sd) {
  const L = CONFIG.cart.lengthM;

  ctx.save();
  ctx.rotate(cart.rot);

  ctx.fillStyle = '#495060';
  rr(ctx, -L / 2, -sd / 2, L, sd, 0.14); ctx.fill();
  ctx.strokeStyle = '#252a34'; ctx.lineWidth = 0.07; ctx.stroke();

  // deck planks
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 0.035;
  for (let i = 1; i < 5; i++) {
    const x = -L / 2 + (L * i) / 5;
    ctx.beginPath(); ctx.moveTo(x, -sd / 2 + 0.05); ctx.lineTo(x, sd / 2 - 0.05); ctx.stroke();
  }

  // rails down each side
  ctx.strokeStyle = '#79808f'; ctx.lineWidth = 0.08;
  ctx.beginPath();
  ctx.moveTo(-L / 2 + 0.1, -sd / 2 + 0.05); ctx.lineTo(L / 2 - 0.1, -sd / 2 + 0.05);
  ctx.moveTo(-L / 2 + 0.1, sd / 2 - 0.05);  ctx.lineTo(L / 2 - 0.1, sd / 2 - 0.05);
  ctx.stroke();

  ctx.fillStyle = '#23262e';
  ctx.fillRect(L / 2 - 0.04, -0.09, 0.4, 0.18);
  ctx.restore();
}

/* ── the aircraft ────────────────────────────────────────────────────────── */

/** Engines and gear, drawn flat under the fuselage on the ground pass. */
export function drawAircraftGear(ctx, ac) {
  const L = ac.lengthM, W = ac.wingspanM;
  ctx.save();
  ctx.translate(ac.x, ac.y);
  ctx.rotate(ac.rot);

  // two engines slung under the wings
  ctx.fillStyle = '#8e96a3';
  for (const sy of [-1, 1]) {
    rr(ctx, -1.2, sy * W * 0.26 - 0.85, 4.4, 1.7, 0.85); ctx.fill();
    ctx.fillStyle = '#40464f';
    ctx.beginPath(); ctx.ellipse(-1.0, sy * W * 0.26, 0.5, 0.72, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#8e96a3';
  }
  // main gear and nose gear
  ctx.fillStyle = '#15181e';
  for (const sy of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(1.6, sy * 1.9, 0.42, 0.3, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.beginPath(); ctx.ellipse(-L / 2 + 3.2, 0, 0.34, 0.26, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** The cargo door: a panel that hinges up as door01 goes 0 -> 1. */
export function drawHoldDoor(ctx, ac, x, yTop, w, h) {
  const open = ac.door01 || 0;
  // frame
  ctx.fillStyle = '#3d434e';
  rr(ctx, x, yTop, w, h, 0.08); ctx.fill();
  // the dark opening, growing as the door lifts
  ctx.fillStyle = '#11141a';
  rr(ctx, x + 0.06, yTop + 0.06, w - 0.12, (h - 0.12) * open, 0.06); ctx.fill();
  // the panel itself, hinged at the top and swinging outward
  ctx.save();
  ctx.translate(x + w / 2, yTop + 0.04);
  ctx.rotate(-open * 1.15);
  ctx.fillStyle = '#dfe4ea';
  rr(ctx, -w / 2 + 0.04, 0, w - 0.08, h - 0.08, 0.07); ctx.fill();
  ctx.strokeStyle = '#9aa2b0'; ctx.lineWidth = 0.04; ctx.stroke();
  ctx.restore();
}

/* ── shared ──────────────────────────────────────────────────────────────── */

/** Own rounded rect: this runs a few hundred times a frame and must behave identically
 *  on every target browser (GDD §21.1 lists three). */
export function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}
