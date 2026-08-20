/* Canvas 2D world renderer — GDD §19.1, §16.4.
 *
 * Reads state and airport data; owns nothing. No scoring, no schedule, no rules
 * (GDD §31.3). If the renderer had to be deleted the simulation would run unchanged.
 *
 * OBLIQUE 2.5D, which GDD §19.1 permits explicitly ("top-down or 2.5D"). Two passes:
 *
 *   1. THE GROUND, drawn through camera.applyGround() — foreshortened vertically, so
 *      floors, painted markings, footprints and shadows recede the way a floor does.
 *   2. THINGS THAT STAND UP, drawn through camera.beginUpright() at their foreshortened
 *      base position, unsquashed, with height going up the screen. Depth-sorted by base
 *      y, so a bag in front of a cart covers it and one behind does not.
 *
 * That split is the whole trick, and it is why text and circles are never drawn on the
 * ground transform: they would be squashed with it.
 */

import { WORLD, BOUNDS, ZONES, WALLS, MARKINGS, ANCHORS, STAGING_PADS } from '../data/airport.js';
import { beltPos } from '../entities/conveyor.js';
import { chargeFrac } from '../entities/player.js';
import { cartTowPoint } from '../entities/cart.js';
import { tractorTowPoint } from '../entities/tractor.js';
import { aircraftHoldZone } from '../entities/aircraft.js';
import { CONFIG } from '../config.js';
import { texAsphalt, texIndoor, texRoad, pattern, tint } from './textures.js';
import { FX } from './fx.js';
import {
  drawPerson, drawBagTop, drawWheel, drawTractorBody, drawCartBody,
  drawAircraftGear, drawHoldDoor, rr as roundRect,
} from './sprites.js';
import { EVENTS } from '../core/eventBus.js';

/** World palette. Operational colours, high contrast, colour never the only channel. */
export const PALETTE = {
  void:    '#0b0a12',
  apron:   '#4a4e57',
  staging: '#51555e',
  indoor:  '#3c4450',
  road:    '#3f424a',
  ramp:    '#54585f',
  stand:   '#5c6068',
  wall:    '#2b3040',
  wallTop: '#3a4055',
  paint:   '#e9e4d6',
  paintDim:'rgba(233,228,214,0.35)',
  safety:  '#f2c14e',
  grid:    'rgba(255,255,255,0.045)',
  label:   'rgba(233,228,214,0.5)',
  shadow:  'rgba(0,0,0,0.30)',
  debug:   '#5ce1e6',
};

const ZONE_FILL = {
  indoor:  PALETTE.indoor,
  apron:   PALETTE.apron,
  staging: PALETTE.staging,
  road:    PALETTE.road,
  ramp:    PALETTE.ramp,
  stand:   PALETTE.stand,
};

/* How tall things stand, in metres. Presentation only — nothing here is collision. */
const H = {
  wall: 1.05,
  belt: 0.55,
  cart: 0.72,
  tractor: 1.25,
  player: 1.72,
  fuselage: 1.9,   // NOT the real 3.2: see _aircraft
  bag: { light: 0.30, normal: 0.38, heavy: 0.48 },
};

/* Draw-order tags for the upright pass. */
const T = { WALL: 0, BELT: 1, AIRCRAFT: 2, CART: 3, TRACTOR: 4, BAG: 5, PLAYER: 6 };

export class Renderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.camera = camera;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.showGrid = false;
    this.showBounds = false;
    this._draws = [];        // reused every frame; never reallocated in a steady state
    this.fx = new FX();
    // GDD §16.6. Set by the bootstrap from the saved settings; the renderer never reads
    // the settings object itself.
    this.reducedMotion = false;
    this._patterns = null;   // built lazily: they need a live 2D context
    this._exhaustAccum = 0;
  }

  /**
   * Effects react to what the simulation ANNOUNCED, rather than to the renderer trying
   * to spot a change by diffing frames. Read-only: nothing here writes game state.
   */
  attachBus(bus) {
    if (!bus || this._bus) return;
    this._bus = bus;
    bus.on(EVENTS.BAG_LEFT_CONVEYOR, (e) => this.fx.dust(e.x, e.y, 0.8));
    bus.on(EVENTS.BAG_RELEASED, (e) => this.fx.dust(e.x, e.y, 0.5));
    bus.on(EVENTS.BAG_SPILLED, (e) => {
      const bag = this._state && this._state.bagsById[e.bagId];
      if (bag) this.fx.spill(bag.x, bag.y, Math.sign(bag.vx) || 1, Math.sign(bag.vy) || 1);
    });
    bus.on(EVENTS.BAG_ENTERED_HOLD, (e) => {
      const bag = this._state && this._state.bagsById[e.bagId];
      if (bag) this.fx.tick(bag.x, bag.y);
    });
    bus.on(EVENTS.SIM_RESET, () => this.fx.reset());
  }

  _buildPatterns() {
    const { ctx } = this;
    this._patterns = {
      apron:   pattern(ctx, texAsphalt(PALETTE.apron, 'apron')),
      staging: pattern(ctx, texAsphalt(PALETTE.staging, 'staging')),
      ramp:    pattern(ctx, texAsphalt(PALETTE.ramp, 'ramp')),
      stand:   pattern(ctx, texAsphalt(PALETTE.stand, 'stand')),
      indoor:  pattern(ctx, texIndoor(PALETTE.indoor, 'indoor')),
      road:    pattern(ctx, texRoad(PALETTE.road, 'road')),
    };
  }

  /** @param dtSec real frame time; 0 while paused, which freezes every effect. */
  render(state, dtSec = 0) {
    const { ctx, camera } = this;
    this._state = state;
    if (!this._patterns) this._buildPatterns();
    this.fx.update(state.mode === 'playing' ? dtSec : 0);

    camera.resetTransform(ctx);
    ctx.fillStyle = PALETTE.void;
    ctx.fillRect(0, 0, camera.cssW, camera.cssH);

    /* ── 1. the ground ─────────────────────────────────────────────────── */
    camera.applyGround(ctx);
    ctx.lineJoin = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    this._drawGround();
    this._drawZones();
    this._drawPads();
    this._drawMarkings();
    if (this.showGrid) this._drawGrid();
    this._drawWallFootprints();
    this._drawBeltFootprint(state);
    this._drawAircraftGround(state);
    this._drawZoneLabels();
    this._drawShadows(state);
    if (this.showBounds) this._drawBounds(state);

    /* ── 2. everything that stands up, back to front ───────────────────── */
    this._collect(state);
    this._draws.sort((a, b) => a.y - b.y);
    for (const d of this._draws) this._drawUpright(d, state);

    this.fx.draw(ctx, camera);
    camera.resetTransform(ctx);
  }

  /* ── ground layer ─────────────────────────────────────────────────────── */

  _drawGround() {
    const { ctx } = this;
    ctx.fillStyle = this._patterns.apron || PALETTE.apron;
    ctx.fillRect(0, 0, WORLD.widthM, WORLD.heightM);
  }

  _drawZones() {
    const { ctx } = this;
    for (const z of ZONES) {
      ctx.fillStyle = this._patterns[z.kind] || ZONE_FILL[z.kind] || PALETTE.apron;
      ctx.fillRect(z.x, z.y, z.w, z.h);
    }
  }

  /** Marked cart bays, one per gate — GDD §7.3, §16.4. */
  _drawPads() {
    const { ctx } = this;
    for (const pad of STAGING_PADS) {
      ctx.fillStyle = 'rgba(233,228,214,0.05)';
      ctx.fillRect(pad.x, pad.y, pad.w, pad.h);
      ctx.strokeStyle = PALETTE.safety;
      ctx.lineWidth = 0.16;
      ctx.setLineDash([1.2, 0.8]);
      ctx.strokeRect(pad.x, pad.y, pad.w, pad.h);
      ctx.setLineDash([]);
    }
  }

  _drawMarkings() {
    const { ctx } = this;

    for (const m of MARKINGS) {
      if (m.kind === 'lane') {
        ctx.strokeStyle = PALETTE.paintDim;
        ctx.lineWidth = 0.25;
        ctx.beginPath();
        ctx.moveTo(m.x + 0.6, m.y); ctx.lineTo(m.x + 0.6, m.y + m.h);
        ctx.moveTo(m.x + m.w - 0.6, m.y); ctx.lineTo(m.x + m.w - 0.6, m.y + m.h);
        ctx.stroke();

        ctx.strokeStyle = PALETTE.safety;
        ctx.lineWidth = 0.3;
        ctx.setLineDash([2.5, 2.5]);
        ctx.beginPath();
        ctx.moveTo(m.x + m.w / 2, m.y); ctx.lineTo(m.x + m.w / 2, m.y + m.h);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (m.kind === 'stand') {
        ctx.strokeStyle = PALETTE.paint;
        ctx.lineWidth = 0.4;
        ctx.strokeRect(m.x, m.y, m.w, m.h);

        // aircraft centreline + nose-stop bar
        ctx.strokeStyle = PALETTE.safety;
        ctx.lineWidth = 0.3;
        ctx.beginPath();
        ctx.moveTo(m.x + 14, m.y + m.h / 2); ctx.lineTo(m.x + m.w - 2, m.y + m.h / 2);
        ctx.moveTo(m.x + 16, m.y + m.h / 2 - 3); ctx.lineTo(m.x + 16, m.y + m.h / 2 + 3);
        ctx.stroke();
      }

      if (m.kind === 'hatch') {
        ctx.strokeStyle = PALETTE.safety;
        ctx.lineWidth = 0.22;
        for (let i = 0; i < m.h + m.w; i += 1.1) {
          ctx.beginPath();
          ctx.moveTo(m.x + Math.min(i, m.w), m.y + Math.max(0, i - m.w));
          ctx.lineTo(m.x + Math.max(0, i - m.h), m.y + Math.min(i, m.h));
          ctx.stroke();
        }
      }
    }
  }

  _drawGrid() {
    const { ctx } = this;
    ctx.strokeStyle = PALETTE.grid;
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    for (let x = 0; x <= WORLD.widthM; x += 10) { ctx.moveTo(x, 0); ctx.lineTo(x, WORLD.heightM); }
    for (let y = 0; y <= WORLD.heightM; y += 10) { ctx.moveTo(0, y); ctx.lineTo(WORLD.widthM, y); }
    ctx.stroke();
  }

  _drawWallFootprints() {
    const { ctx } = this;
    ctx.fillStyle = PALETTE.wall;
    for (const w of WALLS) ctx.fillRect(w.x, w.y, w.w, w.h);
  }

  _drawBeltFootprint(state) {
    const { ctx } = this;
    const c = state.world.conveyor;
    const hw = c.widthM / 2;
    ctx.fillStyle = '#23262e';
    ctx.fillRect(c.x0, c.y0 - hw, c.x1 - c.x0, c.widthM);
  }

  /** Wings and the painted stand furniture lie flat; the fuselage stands up. */
  _drawAircraftGround(state) {
    const { ctx } = this;
    for (const ac of Object.values(state.aircraftById || {})) {
      if (!ac.present) continue;
      const L = ac.lengthM, W = ac.wingspanM;

      ctx.save();
      ctx.translate(ac.x, ac.y);
      ctx.rotate(ac.rot);

      ctx.fillStyle = '#aab1bd';
      ctx.beginPath();
      ctx.moveTo(-2.0, 0);
      ctx.lineTo(0.5, -W / 2); ctx.lineTo(2.6, -W / 2);
      ctx.lineTo(3.5, 0);
      ctx.lineTo(2.6, W / 2); ctx.lineTo(0.5, W / 2);
      ctx.closePath(); ctx.fill();

      const tw = W / 2.3, tx = L / 2 - 4.0;
      ctx.beginPath();
      ctx.moveTo(tx, 0);
      ctx.lineTo(tx + 1.3, -tw / 2); ctx.lineTo(tx + 2.6, -tw / 2);
      ctx.lineTo(tx + 3.2, 0);
      ctx.lineTo(tx + 2.6, tw / 2); ctx.lineTo(tx + 1.3, tw / 2);
      ctx.closePath(); ctx.fill();
      ctx.restore();

      drawAircraftGear(ctx, ac);

      // the hold door, on the apron where the containment test actually is
      const z = aircraftHoldZone(ac);
      ctx.fillStyle = ac.holdOpen ? 'rgba(94,201,106,0.22)' : 'rgba(255,90,90,0.16)';
      ctx.fillRect(z.x - z.lengthM / 2, z.y - z.widthM / 2, z.lengthM, z.widthM);
      ctx.strokeStyle = ac.holdOpen ? '#5ec96a' : '#ff5a5a';
      ctx.lineWidth = 0.16;
      ctx.setLineDash(ac.holdOpen ? [] : [0.6, 0.45]);
      ctx.strokeRect(z.x - z.lengthM / 2, z.y - z.widthM / 2, z.lengthM, z.widthM);
      ctx.setLineDash([]);
    }
  }

  /** Painted floor lettering. Foreshortened with the ground, which is correct — it is
   *  paint on tarmac, not a label floating over it. */
  _drawZoneLabels() {
    const { ctx } = this;
    ctx.fillStyle = PALETTE.label;
    ctx.font = '700 1.6px Quicksand, "Segoe UI", system-ui, sans-serif';
    for (const z of ZONES) {
      if (z.kind === 'stand') continue;
      ctx.fillText(z.label, z.x + z.w / 2, z.y + (z.kind === 'road' ? 4 : 3));
    }
    for (const pad of STAGING_PADS) {
      ctx.fillStyle = 'rgba(242,193,78,0.55)';
      ctx.fillText(pad.label, pad.x + pad.w / 2, pad.y + 1.4);
    }
    // the oversized gate numbers
    ctx.fillStyle = PALETTE.paintDim;
    for (const m of MARKINGS) {
      if (m.kind !== 'stand') continue;
      ctx.font = '700 8px "Baloo 2", "Segoe UI", system-ui, sans-serif';
      ctx.fillText(m.gate, m.x + 7, m.y + m.h / 2 - 1);
      ctx.font = '700 2.2px Quicksand, "Segoe UI", system-ui, sans-serif';
      ctx.fillText(`GATE ${m.gate}`, m.x + 7, m.y + m.h / 2 + 4.6);
    }
  }

  /** Every standing thing gets a shadow where it meets the ground. Without these the
   *  upright pass looks like stickers floating over a floor. */
  _drawShadows(state) {
    const { ctx } = this;
    ctx.fillStyle = PALETTE.shadow;

    const blob = (x, y, rx, ry) => {
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    };

    for (const bag of Object.values(state.bagsById)) {
      const t = bag.location.type;
      if (t !== 'floor' && t !== 'conveyor' && t !== 'carried') continue;
      blob(bag.x, bag.y, bag.widthM * 0.52, bag.heightM * 0.52);
    }
    for (const cart of Object.values(state.cartsById)) {
      blob(cart.x, cart.y, CONFIG.cart.lengthM * 0.5, CONFIG.cart.widthM * 0.5);
    }
    for (const v of Object.values(state.vehiclesById)) {
      blob(v.x, v.y, CONFIG.tractor.lengthM * 0.5, CONFIG.tractor.widthM * 0.5);
    }
    for (const ac of Object.values(state.aircraftById || {})) {
      if (ac.present) blob(ac.x + 0.6, ac.y + 0.9, ac.lengthM * 0.5, CONFIG.aircraft.fuselageWidthM * 0.9);
    }
    if (!state.player.drivingId) {
      blob(state.player.x, state.player.y, CONFIG.player.radiusM * 1.5, CONFIG.player.radiusM * 1.1);
    }
  }

  /* ── upright pass ─────────────────────────────────────────────────────── */

  /** Fill the draw list. Sorted by base y so nearer things cover further ones. */
  _collect(state) {
    const list = this._draws;
    list.length = 0;

    for (const w of WALLS) list.push({ y: w.y + w.h, t: T.WALL, o: w });
    list.push({ y: state.world.conveyor.y0 + state.world.conveyor.widthM / 2,
                t: T.BELT, o: state.world.conveyor });

    for (const ac of Object.values(state.aircraftById || {})) {
      if (ac.present) list.push({ y: ac.y + CONFIG.aircraft.fuselageWidthM / 2, t: T.AIRCRAFT, o: ac });
    }
    for (const cart of Object.values(state.cartsById)) {
      list.push({ y: cart.y + CONFIG.cart.widthM / 2, t: T.CART, o: cart });
    }
    for (const v of Object.values(state.vehiclesById)) {
      list.push({ y: v.y + CONFIG.tractor.widthM / 2, t: T.TRACTOR, o: v });
    }
    for (const bag of Object.values(state.bagsById)) {
      const k = bag.location.type;
      if (k !== 'floor' && k !== 'conveyor' && k !== 'carried' && k !== 'cart') continue;
      // A bag in a cart rides above the bed and must sort with the cart, not under it.
      list.push({ y: bag.y + bag.heightM / 2 + (k === 'cart' ? 0.01 : 0), t: T.BAG, o: bag });
    }
    if (!state.player.drivingId) {
      list.push({ y: state.player.y + CONFIG.player.radiusM, t: T.PLAYER, o: state.player });
    }
    return list;
  }

  _drawUpright(d, state) {
    switch (d.t) {
      case T.WALL:     return this._wall(d.o);
      case T.BELT:     return this._belt(d.o, state);
      case T.AIRCRAFT: return this._aircraft(d.o);
      case T.CART:     return this._cart(d.o, state);
      case T.TRACTOR:  return this._tractor(d.o, state);
      case T.BAG:      return this._bag(d.o, state);
      case T.PLAYER:   return this._player(d.o);
      default:         return undefined;
    }
  }

  _wall(w) {
    const { ctx, camera } = this;
    camera.beginUpright(ctx, w.x + w.w / 2, w.y + w.h);
    const sw = w.w, sd = w.h * camera.squash;
    ctx.fillStyle = PALETTE.wall;
    ctx.fillRect(-sw / 2, -H.wall, sw, H.wall + sd * 0.5);
    ctx.fillStyle = PALETTE.wallTop;
    ctx.fillRect(-sw / 2, -H.wall - sd, sw, sd);
  }

  _belt(c, state) {
    const { ctx, camera } = this;
    const len = c.x1 - c.x0;
    camera.beginUpright(ctx, (c.x0 + c.x1) / 2, c.y0 + c.widthM / 2);
    const sd = c.widthM * camera.squash;

    ctx.fillStyle = '#20232b';
    ctx.fillRect(-len / 2, -H.belt, len, H.belt + sd * 0.4);
    ctx.fillStyle = '#2f333d';
    ctx.fillRect(-len / 2, -H.belt - sd, len, sd);

    // rollers, scrolling with SIMULATION time so a paused clock is a stopped belt
    const phase = ((state.simTimeMs / 1000) * c.speedMps) % 1.0;
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    for (let t = -1 + phase; t < len; t += 1.0) {
      if (t < 0) continue;
      ctx.moveTo(-len / 2 + t, -H.belt - sd);
      ctx.lineTo(-len / 2 + t, -H.belt);
    }
    ctx.stroke();

    ctx.fillStyle = PALETTE.safety;
    ctx.fillRect(len / 2 - 0.25, -H.belt - sd, 0.3, sd);
  }

  /**
   * The fuselage stands up; the wings are on the ground pass, under it.
   *
   * Kept deliberately low. A real regional fuselage is 3.2 m and drawing it at true
   * height turned the aeroplane into a featureless white wall that buried its own wings
   * and most of the stand. GDD §19.1 asks for "large, unmistakable silhouettes" and
   * clarity with many objects on screen — a slab is neither.
   */
  _aircraft(ac) {
    const { ctx, camera } = this;
    const L = ac.lengthM, F = CONFIG.aircraft.fuselageWidthM;
    camera.beginUpright(ctx, ac.x, ac.y + F / 2);
    const sd = F * camera.squash;
    const top = -H.fuselage - sd;

    // tail fin first, so the fuselage overlaps its base
    ctx.fillStyle = '#c8cfda';
    ctx.beginPath();
    ctx.moveTo(L / 2 - 4.4, top + sd * 0.4);
    ctx.lineTo(L / 2 - 2.2, top - 2.9);
    ctx.lineTo(L / 2 - 0.2, top - 2.9);
    ctx.lineTo(L / 2 - 0.2, top + sd * 0.4);
    ctx.closePath(); ctx.fill();

    // side of the tube
    ctx.fillStyle = '#b4bcc8';
    roundRect(ctx, -L / 2, -H.fuselage, L, H.fuselage + sd * 0.45, sd * 0.5);
    ctx.fill();

    // upper surface — a capsule, so the nose and tail read as round
    ctx.fillStyle = '#eef1f5';
    roundRect(ctx, -L / 2, top, L, sd, sd * 0.5);
    ctx.fill();
    ctx.strokeStyle = '#98a0ad'; ctx.lineWidth = 0.08; ctx.stroke();

    // cockpit glass at the nose
    ctx.fillStyle = 'rgba(70,82,100,0.65)';
    roundRect(ctx, -L / 2 + 0.5, top + sd * 0.22, 1.7, sd * 0.5, 0.2); ctx.fill();

    // cabin windows along the side, and the flight number where it can be read
    ctx.fillStyle = 'rgba(70,82,100,0.5)';
    for (let x = -L / 2 + 3.6; x < L / 2 - 5.2; x += 1.45) {
      ctx.fillRect(x, -H.fuselage + 0.42, 0.5, 0.5);
    }
    ctx.fillStyle = 'rgba(52,60,74,0.92)';
    ctx.font = '800 1.25px Quicksand, "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(ac.number, -1.5, -H.fuselage + 1.65);

    // the cargo door, hinged and travelling — door01 eases over about a second, so hold
    // closing is something you watch come down rather than a state that silently flipped
    // Low on the near side, lined up over the hold zone the containment test uses —
    // not mid-fuselage, where it read as a hatch in the roof.
    drawHoldDoor(ctx, ac, ac.holdOffsetX - 1.15, -1.25, 2.3, 1.15);

    // anti-collision strobe, on simulation time so it stops when the game does
    if (this.reducedMotion || (simTimeMsOf(this) % 1500) < 90) {
      ctx.fillStyle = this.reducedMotion ? 'rgba(255,240,220,0.5)' : 'rgba(255,240,220,0.95)';
      ctx.beginPath(); ctx.arc(L / 2 - 1.2, top - 3.0, 0.28, 0, Math.PI * 2); ctx.fill();
    }

    ctx.fillStyle = ac.holdOpen ? 'rgba(94,201,106,0.95)' : 'rgba(255,90,90,0.95)';
    ctx.font = '800 0.9px Quicksand, "Segoe UI", system-ui, sans-serif';
    ctx.fillText(ac.holdOpen ? 'HOLD OPEN' : 'HOLD CLOSED', -L / 2 - 4.2, -0.3);
  }

  _cart(cart, state) {
    const { ctx, camera } = this;
    const L = CONFIG.cart.lengthM, W = CONFIG.cart.widthM;
    camera.beginUpright(ctx, cart.x, cart.y);
    const sd = W * camera.squash;

    // wheels first, so the bed sits over them. They turn on distance rolled.
    const spin = cart.rolledM / 0.24;
    const along = Math.cos(cart.rot), across = Math.sin(cart.rot);
    for (const ox of [-0.72, 0.72]) {
      drawWheel(ctx, along * ox - across * 0.0, across * ox * camera.squash - 0.24,
                0.24, spin);
    }

    extrude(ctx, cart.rot, L, sd, H.cart, '#262a34', 0.16);

    // bed
    ctx.save();
    ctx.translate(0, -H.cart);
    drawCartBody(ctx, cart, sd);
    ctx.restore();

    // stability warning — GDD §6.4 wants spill risk readable BEFORE it happens
    if (cart.stability < 0.6) {
      const a = (0.6 - cart.stability) / 0.6;
      ctx.strokeStyle = `rgba(255,90,90,${(0.3 + a * 0.6).toFixed(3)})`;
      ctx.lineWidth = 0.16;
      ctx.strokeRect(-L / 2 - 0.15, -H.cart - sd / 2 - 0.15, L + 0.3, sd + H.cart + 0.3);
    }

    // placard, standing off the near side
    if (cart.placardLabel) {
      ctx.save();
      ctx.translate(0, -H.cart - 0.1);
      ctx.fillStyle = cart.placardColor || '#888';
      roundRect(ctx, -0.62, sd / 2 - 0.1, 1.24, 0.56, 0.1); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = '800 0.42px Quicksand, "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(cart.placardLabel, 0, sd / 2 + 0.19);
      ctx.restore();
    }

    if (cart.id === state.player.targetCartId) {
      ctx.strokeStyle = PALETTE.paint;
      ctx.lineWidth = 0.08;
      ctx.setLineDash([0.3, 0.26]);
      ctx.strokeRect(-L / 2 - 0.28, -H.cart - sd / 2 - 0.28, L + 0.56, sd + H.cart + 0.56);
      ctx.setLineDash([]);
    }

    // drawbar to whatever is towing it
    if (cart.hitchedToId) {
      const parent = state.cartsById[cart.hitchedToId] || state.vehiclesById[cart.hitchedToId];
      if (parent) {
        const p = parent.kind === 'tractor' ? tractorTowPoint(parent) : cartTowPoint(parent);
        ctx.strokeStyle = '#1d2029';
        ctx.lineWidth = 0.18;
        ctx.beginPath();
        ctx.moveTo(0, -H.cart * 0.45);
        ctx.lineTo((p.x - cart.x), (p.y - cart.y) * camera.squash - H.cart * 0.45);
        ctx.stroke();
      }
    }
  }

  _tractor(v, state) {
    const { ctx, camera } = this;
    const L = CONFIG.tractor.lengthM, W = CONFIG.tractor.widthM;
    camera.beginUpright(ctx, v.x, v.y);
    const sd = W * camera.squash;

    // wheels, turning on the odometer
    const spin = v.odometerM / 0.28;
    const along = Math.cos(v.rot);
    for (const ox of [-0.66, 0.66]) {
      drawWheel(ctx, along * ox, -0.26, 0.28, spin);
    }

    extrude(ctx, v.rot, L, sd, H.tractor * 0.28, '#6b3d0f', 0.2);
    drawTractorBody(ctx, v, sd, state.simTimeMs, !!v.driverId, !this.reducedMotion);

    if (!v.driverId && state.player.targetVehicleId === v.id) {
      ctx.strokeStyle = PALETTE.paint;
      ctx.lineWidth = 0.08;
      ctx.beginPath();
      ctx.ellipse(0, 0, L * 0.7, L * 0.7 * camera.squash, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // the driver, sitting in it — no walk cycle, but still breathing
    if (v.driverId) {
      ctx.save();
      ctx.translate(-0.08, -H.tractor * 0.30);
      drawPerson(ctx, {
        s: 0.62, walk: 0, move01: 0,
        aimX: Math.cos(v.rot), aimY: Math.sin(v.rot),
        carrying: !!state.player.carryingBagId, charge01: 0,
        bobT: state.simTimeMs / 1000,
      });
      ctx.restore();
    }
  }

  /** GDD §7.2: a tag is code + colour + icon. The bag's own colour says nothing. */
  _bag(bag, state) {
    const { ctx, camera } = this;
    const w = bag.widthM;
    const sd = bag.heightM * camera.squash;
    const t = H.bag[bag.weightClass] || H.bag.normal;
    const lift = bag.location.type === 'cart' ? H.cart : 0;

    camera.beginUpright(ctx, bag.x, bag.y);
    if (lift) ctx.translate(0, -lift);

    extrude(ctx, bag.rot, w, sd, t, shade(bag.appearance.color), 0.1);

    ctx.save();
    ctx.translate(0, -t);
    ctx.rotate(bag.rot);

    // The body, by physical kind — suitcase, duffel, hardcase or backpack, each with
    // its own handles, straps and wheels. Purely cosmetic: GDD §7.2 keeps identity in
    // the TAG, so a player must never be able to sort by shape either.
    drawBagTop(ctx, bag, w, sd);

    const ts = Math.min(sd * 0.82, 0.36);
    ctx.fillStyle = bag.appearance.tagColor;
    roundRect(ctx, -w / 2 + 0.06, -ts / 2, ts, ts, 0.05); ctx.fill();
    drawIcon(ctx, bag.appearance.icon, -w / 2 + 0.06 + ts / 2, 0, ts * 0.30);

    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.font = '800 0.32px Quicksand, "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(bag.destinationCode, 0.1 + ts / 2, 0.01);

    if (bag.priority) {
      ctx.fillStyle = PALETTE.safety;
      ctx.fillRect(w / 2 - 0.13, -sd / 2, 0.13, sd);
    }
    ctx.restore();

    if (bag.id === state.player.targetBagId) {
      ctx.strokeStyle = PALETTE.paint;
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      ctx.ellipse(0, 0, w * 0.75, w * 0.75 * camera.squash, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /**
   * The crew, animated.
   *
   * Every input to the animation comes from SIMULATION state — the walk phase from
   * distance walked, the lean from velocity, the wind-up from the charge timer. Nothing
   * is stored here, so two runs of a seed animate identically and a paused game freezes
   * mid-stride instead of carrying on jogging behind the pause card.
   */
  _player(p) {
    const { ctx, camera } = this;
    camera.beginUpright(ctx, p.x, p.y);

    const speed = Math.hypot(p.vx, p.vy);
    if (p.charging && p.carryingBagId) {
      const f = chargeFrac(p);
      ctx.strokeStyle = f > 0.85 ? PALETTE.safety : PALETTE.paint;
      ctx.lineWidth = 0.13;
      ctx.beginPath();
      ctx.ellipse(0, 0, 1.0, 1.0 * camera.squash, 0, Math.PI * 1.15, Math.PI * (1.15 + 0.7 * f));
      ctx.stroke();
    }

    drawPerson(ctx, {
      s: 1,
      // 3.6 rad/m is a stride of about 1.75 m — a walk, not a scurry.
      walk: p.walkedM * 3.6,
      move01: Math.min(1, speed / CONFIG.player.maxSpeed),
      aimX: p.aimX, aimY: p.aimY,
      carrying: !!p.carryingBagId,
      charge01: p.charging ? chargeFrac(p) : 0,
      bobT: (this._state ? this._state.simTimeMs : 0) / 1000,
    });
  }

  /** Debug only (F3 -> B). GDD §21.8 keeps this out of player-facing UI. */
  _drawBounds(state) {
    const { ctx } = this;
    ctx.strokeStyle = PALETTE.debug;
    ctx.lineWidth = 0.2;
    ctx.setLineDash([1, 1]);
    ctx.strokeRect(BOUNDS.x, BOUNDS.y, BOUNDS.w, BOUNDS.h);
    ctx.setLineDash([]);

    ctx.fillStyle = PALETTE.debug;
    ctx.font = '700 1.4px Quicksand, "Segoe UI", system-ui, sans-serif';
    for (const [name, p] of Object.entries(ANCHORS)) {
      ctx.beginPath(); ctx.arc(p.x, p.y, 0.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillText(name, p.x, p.y - 1.6);
    }

    const pl = state.player;
    ctx.strokeStyle = 'rgba(92,225,230,0.5)';
    ctx.lineWidth = 0.07;
    ctx.beginPath(); ctx.arc(pl.x, pl.y, CONFIG.player.reachM, 0, Math.PI * 2); ctx.stroke();
    void beltPos;
  }
}

/* ── drawing helpers ─────────────────────────────────────────────────────── */

/**
 * The side of a box, for something that can be rotated.
 *
 * Sweeping a rotated footprint up the screen is not a shape canvas will give you, so it
 * is stamped in a few slices instead. Translating BEFORE rotating is what keeps the
 * extrusion screen-vertical rather than tilting with the object.
 */
function extrude(ctx, rot, w, screenDepth, height, color, radius, slices = 4) {
  ctx.fillStyle = color;
  for (let k = 0; k <= slices; k++) {
    ctx.save();
    ctx.translate(0, -(height * k) / slices);
    ctx.rotate(rot);
    roundRect(ctx, -w / 2, -screenDepth / 2, w, screenDepth, radius);
    ctx.fill();
    ctx.restore();
  }
}

/** The symbol half of the tag's identity. Shapes, not just hues — GDD §16.6. */
function drawIcon(ctx, kind, cx, cy, r) {
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.beginPath();
  if (kind === 'triangle') {
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.92, cy + r * 0.75);
    ctx.lineTo(cx - r * 0.92, cy + r * 0.75);
    ctx.closePath();
  } else if (kind === 'square') {
    ctx.rect(cx - r * 0.82, cy - r * 0.82, r * 1.64, r * 1.64);
  } else {
    ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2);
  }
  ctx.fill();
}

/** A darker version of a hex colour, for the side of a box. */
function shade(hex) {
  if (typeof hex !== 'string' || hex[0] !== '#' || hex.length !== 7) return '#222';
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * 0.55);
  const g = Math.round(((n >> 8) & 255) * 0.55);
  const b = Math.round((n & 255) * 0.55);
  return `rgb(${r},${g},${b})`;
}

/** The renderer keeps the last state it drew, so helpers can read simulation time
 *  without every one of them taking it as an argument. */
function simTimeMsOf(r) { return r._state ? r._state.simTimeMs : 0; }
