/* Canvas 2D world renderer — GDD §19.1, §16.4.
 *
 * Reads state and airport data; owns nothing. No scoring, no schedule, no rules
 * (GDD §31.3). If the renderer had to be deleted the simulation would run unchanged.
 *
 * "The world should carry information so players do not live inside the HUD"
 * (GDD §16.4) — hence oversized gate numbers, painted stand outlines and floor
 * lettering rather than a minimap.
 */

import { WORLD, BOUNDS, ZONES, WALLS, MARKINGS, ANCHORS, STAGING_PADS } from '../data/airport.js';
import { beltPos } from '../entities/conveyor.js';
import { chargeFrac } from '../entities/player.js';
import { cartTowPoint } from '../entities/cart.js';
import { tractorTowPoint } from '../entities/tractor.js';
import { aircraftHoldZone } from '../entities/aircraft.js';
import { CONFIG } from '../config.js';

/** World palette. Operational colours, high contrast, colour never the only channel. */
export const PALETTE = {
  void:    '#0b0a12',
  apron:   '#4a4e57',
  staging: '#51555e',
  indoor:  '#3c4450',
  road:    '#3f424a',
  ramp:    '#54585f',
  stand:   '#5c6068',
  wall:    '#242833',
  wallTop: '#313646',
  paint:   '#e9e4d6',
  paintDim:'rgba(233,228,214,0.35)',
  safety:  '#f2c14e',
  grid:    'rgba(255,255,255,0.045)',
  label:   'rgba(233,228,214,0.55)',
  debug:   '#5ce1e6',
};

const ZONE_FILL = {
  indoor:  PALETTE.indoor,
  apron:   PALETTE.apron,
  staging: PALETTE.staging,
  road:   PALETTE.road,
  ramp:   PALETTE.ramp,
  stand:  PALETTE.stand,
};

export class Renderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.camera = camera;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.showGrid = false;
    this.showBounds = false;
  }

  render(state) {
    const { ctx, camera } = this;

    camera.resetTransform(ctx);
    ctx.fillStyle = PALETTE.void;
    ctx.fillRect(0, 0, camera.cssW, camera.cssH);

    camera.applyTo(ctx);
    ctx.lineJoin = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    this._drawGround();
    this._drawZones();
    this._drawPads(state);
    this._drawMarkings();
    if (this.showGrid) this._drawGrid();
    this._drawWalls();
    this._drawZoneLabels();
    this._drawConveyor(state);
    this._drawAircraft(state);
    this._drawHitchLinks(state);
    this._drawCarts(state);
    this._drawBags(state);
    this._drawVehicles(state);
    this._drawPlayer(state);
    if (this.showBounds) this._drawBounds(state);

    camera.resetTransform(ctx);
  }

  /* ── layers ───────────────────────────────────────────────────────────── */

  _drawGround() {
    const { ctx } = this;
    ctx.fillStyle = PALETTE.apron;
    ctx.fillRect(0, 0, WORLD.widthM, WORLD.heightM);
  }

  _drawZones() {
    const { ctx } = this;
    for (const z of ZONES) {
      ctx.fillStyle = ZONE_FILL[z.kind] || PALETTE.apron;
      ctx.fillRect(z.x, z.y, z.w, z.h);
    }
  }

  _drawMarkings() {
    const { ctx } = this;

    for (const m of MARKINGS) {
      if (m.kind === 'lane') {
        // service-road edge lines plus a dashed centreline
        ctx.strokeStyle = PALETTE.paintDim;
        ctx.lineWidth = 0.25;
        ctx.setLineDash([]);
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

        // oversized gate number, painted on the stand — GDD §16.4
        ctx.fillStyle = PALETTE.paintDim;
        ctx.font = '700 7px "Baloo 2", "Segoe UI", system-ui, sans-serif';
        ctx.fillText(m.gate, m.x + 7, m.y + m.h / 2 - 1);
        ctx.font = '700 2px Quicksand, "Segoe UI", system-ui, sans-serif';
        ctx.fillText(`GATE ${m.gate}`, m.x + 7, m.y + m.h / 2 + 4.4);

        // aircraft centreline + nose-stop bar, so the stand reads as a parking place
        ctx.strokeStyle = PALETTE.safety;
        ctx.lineWidth = 0.3;
        ctx.beginPath();
        ctx.moveTo(m.x + 14, m.y + m.h / 2); ctx.lineTo(m.x + m.w - 2, m.y + m.h / 2);
        ctx.moveTo(m.x + 16, m.y + m.h / 2 - 3); ctx.lineTo(m.x + 16, m.y + m.h / 2 + 3);
        ctx.stroke();
      }

      if (m.kind === 'hatch') {
        // safety hatching across the sort-room doorway threshold
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

  _drawWalls() {
    const { ctx } = this;
    for (const w of WALLS) {
      ctx.fillStyle = PALETTE.wall;
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.fillStyle = PALETTE.wallTop;
      ctx.fillRect(w.x, w.y, w.w, Math.min(0.35, w.h));
    }
  }

  _drawZoneLabels() {
    const { ctx } = this;
    ctx.fillStyle = PALETTE.label;
    ctx.font = '700 1.5px Quicksand, "Segoe UI", system-ui, sans-serif';
    for (const z of ZONES) {
      if (z.kind === 'stand') continue;             // stands carry their own gate number
      const y = z.kind === 'road' ? z.y + 4 : z.y + 3;
      ctx.fillText(z.label, z.x + z.w / 2, y);
    }
  }

  /* ── equipment, bags, people ──────────────────────────────────────────── */

  /** Marked floor staging, one pad per gate — GDD §7.3, §16.4. */
  _drawPads(state) {
    const { ctx } = this;
    for (const pad of STAGING_PADS) {
      ctx.fillStyle = 'rgba(233,228,214,0.05)';
      ctx.fillRect(pad.x, pad.y, pad.w, pad.h);
      ctx.strokeStyle = PALETTE.safety;
      ctx.lineWidth = 0.16;
      ctx.setLineDash([1.2, 0.8]);
      ctx.strokeRect(pad.x, pad.y, pad.w, pad.h);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(242,193,78,0.55)';
      ctx.font = '700 1.5px Quicksand, "Segoe UI", system-ui, sans-serif';
      ctx.fillText(pad.label, pad.x + pad.w / 2, pad.y + 1.3);
    }
    void state;
  }

  _drawConveyor(state) {
    const { ctx } = this;
    const c = state.world.conveyor;
    const hw = c.widthM / 2;
    const dx = (c.x1 - c.x0) / c.lengthM, dy = (c.y1 - c.y0) / c.lengthM;
    const nx = -dy, ny = dx;                      // belt normal

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(c.x0 + nx * hw, c.y0 + ny * hw);
    ctx.lineTo(c.x1 + nx * hw, c.y1 + ny * hw);
    ctx.lineTo(c.x1 - nx * hw, c.y1 - ny * hw);
    ctx.lineTo(c.x0 - nx * hw, c.y0 - ny * hw);
    ctx.closePath();
    ctx.fillStyle = '#2b2f38';
    ctx.fill();
    ctx.strokeStyle = '#1c1f26';
    ctx.lineWidth = 0.18;
    ctx.stroke();

    // Rollers. They scroll with simulation time, so a stopped clock is a stopped belt —
    // the animation must never imply motion the simulation is not producing.
    const phase = (state.simTimeMs / 1000 * c.speedMps) % 1.0;
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    for (let t = -1 + phase; t < c.lengthM; t += 1.0) {
      if (t < 0) continue;
      const p = beltPos(c, t);
      ctx.moveTo(p.x + nx * hw, p.y + ny * hw);
      ctx.lineTo(p.x - nx * hw, p.y - ny * hw);
    }
    ctx.stroke();

    // the drop-off lip
    const end = beltPos(c, c.lengthM);
    ctx.fillStyle = PALETTE.safety;
    ctx.fillRect(end.x - 0.2, end.y - hw, 0.35, c.widthM);
    ctx.restore();
  }

  /**
   * Aircraft on stand — GDD §9.1, §19.1 ("aircraft as large, unmistakable silhouettes").
   *
   * The hold door is channel three of GDD §5.3: open is a lit green mouth you can walk
   * into, closed is a red bar. A player looking at the aeroplane can tell whether they
   * can still load it without reading the board or hearing the announcement.
   */
  _drawAircraft(state) {
    const { ctx } = this;
    for (const ac of Object.values(state.aircraftById || {})) {
      if (!ac.present) continue;
      const L = ac.lengthM, W = ac.wingspanM, F = CONFIG.aircraft.fuselageWidthM;

      ctx.save();
      ctx.translate(ac.x, ac.y);
      ctx.rotate(ac.rot);

      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(0.5, 0.9, L / 2, F, 0, 0, Math.PI * 2); ctx.fill();

      // Wings and tailplane, swept and tapered. Drawn as rectangles first, they read as
      // grey slabs laid across the stand rather than as an aeroplane.
      ctx.fillStyle = '#b9bfcb';
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

      ctx.fillStyle = '#e6eaf0';
      ctx.beginPath();
      ctx.moveTo(-L / 2, 0);                                   // nose
      ctx.quadraticCurveTo(-L / 2 + 2.5, -F / 2, -L / 2 + 6, -F / 2);
      ctx.lineTo(L / 2 - 2, -F / 2);
      ctx.quadraticCurveTo(L / 2, -F / 2, L / 2, -0.5);        // tail
      ctx.lineTo(L / 2, 0.5);
      ctx.quadraticCurveTo(L / 2, F / 2, L / 2 - 2, F / 2);
      ctx.lineTo(-L / 2 + 6, F / 2);
      ctx.quadraticCurveTo(-L / 2 + 2.5, F / 2, -L / 2, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#8d94a2'; ctx.lineWidth = 0.14; ctx.stroke();

      // cabin windows, so the silhouette reads as an aeroplane at a glance
      ctx.fillStyle = 'rgba(60,70,86,0.55)';
      for (let x = -L / 2 + 5; x < L / 2 - 4; x += 1.5) ctx.fillRect(x, -0.35, 0.7, 0.7);

      // the flight number, painted along the fuselage — GDD §16.4 world signage
      ctx.fillStyle = 'rgba(60,70,86,0.85)';
      ctx.font = '800 1.5px Quicksand, "Segoe UI", system-ui, sans-serif';
      ctx.save();
      ctx.rotate(Math.PI);              // stands face west; keep the text upright
      ctx.fillText(ac.number, 1.5, 0.05);
      ctx.restore();
      ctx.restore();

      /* the hold door, in world space so it lines up with the containment test */
      const z = aircraftHoldZone(ac);
      ctx.save();
      ctx.fillStyle = ac.holdOpen ? 'rgba(94,201,106,0.20)' : 'rgba(255,90,90,0.14)';
      ctx.fillRect(z.x - z.lengthM / 2, z.y - z.widthM / 2, z.lengthM, z.widthM);
      ctx.strokeStyle = ac.holdOpen ? '#5ec96a' : '#ff5a5a';
      ctx.lineWidth = 0.16;
      ctx.setLineDash(ac.holdOpen ? [] : [0.6, 0.45]);
      ctx.strokeRect(z.x - z.lengthM / 2, z.y - z.widthM / 2, z.lengthM, z.widthM);
      ctx.setLineDash([]);

      // Beside the door, not under it: the crew, the cart and the hold zone all crowd
      // the same few metres, and a label printed below the zone lands on top of them.
      ctx.fillStyle = ac.holdOpen ? 'rgba(94,201,106,0.95)' : 'rgba(255,90,90,0.95)';
      ctx.font = '800 0.9px Quicksand, "Segoe UI", system-ui, sans-serif';
      ctx.fillText(ac.holdOpen ? 'HOLD OPEN' : 'HOLD CLOSED',
                   z.x - z.lengthM / 2 - 3.0, z.y);
      ctx.restore();
    }
  }

  /** Drawbars, under everything, so a train reads as one connected thing. */
  _drawHitchLinks(state) {
    const { ctx } = this;
    ctx.strokeStyle = '#1d2029';
    ctx.lineWidth = 0.22;
    ctx.lineCap = 'round';
    for (const cart of Object.values(state.cartsById)) {
      if (!cart.hitchedToId) continue;
      const parent = state.cartsById[cart.hitchedToId] || state.vehiclesById[cart.hitchedToId];
      if (!parent) continue;
      const p = parent.kind === 'tractor' ? tractorTowPoint(parent) : cartTowPoint(parent);
      const nose = {
        x: cart.x + Math.cos(cart.rot) * (CONFIG.cart.lengthM / 2),
        y: cart.y + Math.sin(cart.rot) * (CONFIG.cart.lengthM / 2),
      };
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(nose.x, nose.y);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  /** Open frames with visible contents — GDD §19.1. The bags themselves are drawn by
   *  _drawBags from their own world positions, so a cart is only ever the frame. */
  _drawCarts(state) {
    const { ctx } = this;
    const L = CONFIG.cart.lengthM, W = CONFIG.cart.widthM;
    const target = state.player.targetCartId;

    for (const cart of Object.values(state.cartsById)) {
      ctx.save();
      ctx.translate(cart.x, cart.y);
      ctx.rotate(cart.rot);

      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      roundRect(ctx, -L / 2 + 0.08, -W / 2 + 0.1, L, W, 0.16);
      ctx.fill();

      // bed
      ctx.fillStyle = '#3a3f4b';
      roundRect(ctx, -L / 2, -W / 2, L, W, 0.16);
      ctx.fill();
      ctx.strokeStyle = '#20242e';
      ctx.lineWidth = 0.09;
      ctx.stroke();

      // side rails, so it reads as an open frame rather than a slab
      ctx.strokeStyle = '#5b6373';
      ctx.lineWidth = 0.13;
      ctx.beginPath();
      ctx.moveTo(-L / 2 + 0.12, -W / 2 + 0.1); ctx.lineTo(L / 2 - 0.12, -W / 2 + 0.1);
      ctx.moveTo(-L / 2 + 0.12,  W / 2 - 0.1); ctx.lineTo(L / 2 - 0.12,  W / 2 - 0.1);
      ctx.stroke();

      // drawbar stub at the nose
      ctx.fillStyle = '#2a2e38';
      ctx.fillRect(L / 2 - 0.05, -0.1, 0.42, 0.2);

      // Stability warning. GDD §6.4 wants spill risk to be readable BEFORE it happens,
      // not explained afterwards.
      if (cart.stability < 0.6) {
        const a = (0.6 - cart.stability) / 0.6;
        ctx.strokeStyle = `rgba(255,90,90,${(0.25 + a * 0.6).toFixed(3)})`;
        ctx.lineWidth = 0.18;
        roundRect(ctx, -L / 2 - 0.1, -W / 2 - 0.1, L + 0.2, W + 0.2, 0.2);
        ctx.stroke();
      }
      ctx.restore();

      // placard: a small board on the near side, colour AND code
      if (cart.placardLabel) {
        const px = cart.x - Math.sin(cart.rot) * (W / 2 + 0.34);
        const py = cart.y + Math.cos(cart.rot) * (W / 2 + 0.34);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(cart.rot);
        ctx.fillStyle = cart.placardColor || '#888';
        roundRect(ctx, -0.62, -0.28, 1.24, 0.56, 0.1);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.font = '800 0.42px Quicksand, "Segoe UI", system-ui, sans-serif';
        ctx.fillText(cart.placardLabel, 0, 0.02);
        ctx.restore();
      }

      if (cart.id === target) {
        ctx.strokeStyle = PALETTE.paint;
        ctx.lineWidth = 0.09;
        ctx.setLineDash([0.35, 0.3]);
        ctx.strokeRect(cart.x - L / 2 - 0.25, cart.y - W / 2 - 0.25, L + 0.5, W + 0.5);
        ctx.setLineDash([]);
      }
    }
  }

  _drawVehicles(state) {
    const { ctx } = this;
    const L = CONFIG.tractor.lengthM, W = CONFIG.tractor.widthM;

    for (const v of Object.values(state.vehiclesById)) {
      ctx.save();
      ctx.translate(v.x, v.y);
      ctx.rotate(v.rot);

      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      roundRect(ctx, -L / 2 + 0.08, -W / 2 + 0.1, L, W, 0.2);
      ctx.fill();

      ctx.fillStyle = v.driverId ? '#d87a2a' : '#a8601f';
      roundRect(ctx, -L / 2, -W / 2, L, W, 0.2);
      ctx.fill();
      ctx.strokeStyle = '#2a1a08';
      ctx.lineWidth = 0.09;
      ctx.stroke();

      // an unmistakable front — GDD §19.1 "tractor with obvious front and hitch"
      ctx.fillStyle = '#f2e2c0';
      ctx.beginPath();
      ctx.moveTo(L / 2 - 0.05, -W / 2 + 0.12);
      ctx.lineTo(L / 2 + 0.32, 0);
      ctx.lineTo(L / 2 - 0.05, W / 2 - 0.12);
      ctx.closePath();
      ctx.fill();

      // roll cage
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 0.1;
      ctx.strokeRect(-0.45, -W / 2 + 0.18, 0.9, W - 0.36);

      // the hitch, at the back
      ctx.fillStyle = '#2a2e38';
      ctx.fillRect(-L / 2 - 0.34, -0.11, 0.42, 0.22);
      ctx.restore();

      if (!v.driverId && state.player.targetVehicleId === v.id) {
        ctx.strokeStyle = PALETTE.paint;
        ctx.lineWidth = 0.09;
        ctx.beginPath();
        ctx.arc(v.x, v.y, L * 0.75, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  _drawBags(state) {
    const { ctx } = this;
    const target = state.player.targetBagId;
    for (const id of Object.keys(state.bagsById)) {
      const bag = state.bagsById[id];
      const t = bag.location.type;
      if (t !== 'floor' && t !== 'conveyor' && t !== 'carried' && t !== 'cart') continue;
      this._drawBag(bag, id === target);
    }
  }

  /** GDD §7.2: a tag is THREE channels — code, colour and icon — so that colour is
   *  never the only differentiator. The body colour is cosmetic and says nothing. */
  _drawBag(bag, isTarget) {
    const { ctx } = this;
    const w = bag.widthM, h = bag.heightM;

    ctx.save();
    ctx.translate(bag.x, bag.y);
    ctx.rotate(bag.rot);

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    roundRect(ctx, -w / 2 + 0.06, -h / 2 + 0.08, w, h, 0.12);
    ctx.fill();

    // body
    ctx.fillStyle = bag.appearance.color;
    roundRect(ctx, -w / 2, -h / 2, w, h, 0.12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 0.05;
    ctx.stroke();

    if (bag.appearance.strap) {
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 0.09;
      ctx.beginPath();
      ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0);
      ctx.stroke();
    }

    // the tag patch: flight colour + flight icon
    const ts = Math.min(h * 0.78, 0.42);
    ctx.fillStyle = bag.appearance.tagColor;
    roundRect(ctx, -w / 2 + 0.07, -ts / 2, ts, ts, 0.06);
    ctx.fill();
    drawIcon(ctx, bag.appearance.icon, -w / 2 + 0.07 + ts / 2, 0, ts * 0.30);

    // the destination code, the channel that survives colour blindness
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '800 0.34px Quicksand, "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(bag.destinationCode, 0.12 + ts / 2, 0.01);

    // priority: a hazard chevron down the trailing end
    if (bag.priority) {
      ctx.fillStyle = '#f2c14e';
      ctx.fillRect(w / 2 - 0.14, -h / 2, 0.14, h);
    }
    ctx.restore();

    if (isTarget) {
      ctx.strokeStyle = PALETTE.paint;
      ctx.lineWidth = 0.09;
      ctx.beginPath();
      ctx.arc(bag.x, bag.y, Math.max(w, h) * 0.72, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  _drawPlayer(state) {
    const { ctx } = this;
    const p = state.player;
    const r = p.radiusM * 1.35;   // drawn larger than the collider, deliberately

    // throw charge arc, in front of the hands — GDD §16.1 "what am I holding?"
    if (p.charging && p.carryingBagId) {
      const f = chargeFrac(p);
      const a = Math.atan2(p.aimY, p.aimX);
      ctx.strokeStyle = f > 0.85 ? PALETTE.safety : PALETTE.paint;
      ctx.lineWidth = 0.14;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 0.75, a - 0.9, a - 0.9 + 1.8 * f);
      ctx.stroke();
    }

    // Driving: the player sits at the tractor position, so draw a smaller seated figure
    // on top of the cab instead of a full body standing on it.
    const seated = !!p.drivingId;
    const br = seated ? r * 0.55 : r;

    ctx.save();
    ctx.translate(p.x, p.y);

    if (!seated) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.arc(0.06, 0.09, br, 0, Math.PI * 2); ctx.fill();
    }

    ctx.rotate(Math.atan2(p.aimY, p.aimX));
    // hi-vis vest
    ctx.fillStyle = '#e8e04a';
    ctx.beginPath(); ctx.arc(0, 0, br, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3a3618'; ctx.lineWidth = 0.06; ctx.stroke();
    // reflective band
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.08;
    ctx.beginPath(); ctx.arc(0, 0, br * 0.62, 0, Math.PI * 2); ctx.stroke();
    // head, offset toward the facing so the direction reads at a glance
    ctx.fillStyle = '#e8c9a0';
    ctx.beginPath(); ctx.arc(br * 0.30, 0, br * 0.40, 0, Math.PI * 2); ctx.fill();
    // hands, when carrying
    if (p.carryingBagId) {
      ctx.fillStyle = '#2a2a30';
      ctx.beginPath(); ctx.arc(br * 0.75, -br * 0.55, br * 0.22, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(br * 0.75, br * 0.55, br * 0.22, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
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
    ctx.font = '700 1.6px Quicksand, "Segoe UI", system-ui, sans-serif';
    for (const [name, p] of Object.entries(ANCHORS)) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(name, p.x, p.y - 1.8);
    }

    // reach ring and aim
    const pl = state.player;
    ctx.strokeStyle = 'rgba(92,225,230,0.5)';
    ctx.lineWidth = 0.07;
    ctx.beginPath(); ctx.arc(pl.x, pl.y, 1.7, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pl.x, pl.y);
    ctx.lineTo(pl.x + pl.aimX * 2.2, pl.y + pl.aimY * 2.2);
    ctx.stroke();
  }
}

/* ── small drawing helpers ───────────────────────────────────────────────── */

/** Own implementation rather than ctx.roundRect: this runs a few hundred times a frame
 *  and must behave identically on every target browser (GDD §21.1 lists three). */
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
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
