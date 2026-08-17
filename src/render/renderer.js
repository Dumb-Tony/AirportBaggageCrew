/* Canvas 2D world renderer — GDD §19.1, §16.4.
 *
 * Reads state and airport data; owns nothing. No scoring, no schedule, no rules
 * (GDD §31.3). If the renderer had to be deleted the simulation would run unchanged.
 *
 * "The world should carry information so players do not live inside the HUD"
 * (GDD §16.4) — hence oversized gate numbers, painted stand outlines and floor
 * lettering rather than a minimap.
 */

import { WORLD, BOUNDS, ZONES, WALLS, MARKINGS, ANCHORS } from '../data/airport.js';

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
    this._drawMarkings();
    if (this.showGrid) this._drawGrid();
    this._drawWalls();
    this._drawZoneLabels();
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
        ctx.font = '700 13px "Baloo 2", "Segoe UI", system-ui, sans-serif';
        ctx.fillText(m.gate, m.x + 7, m.y + m.h / 2);
        ctx.font = '700 3.2px Quicksand, "Segoe UI", system-ui, sans-serif';
        ctx.fillText(`GATE ${m.gate}`, m.x + 7, m.y + m.h / 2 + 8.5);

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
    ctx.font = '700 2.6px Quicksand, "Segoe UI", system-ui, sans-serif';
    for (const z of ZONES) {
      if (z.kind === 'stand') continue;             // stands carry their own gate number
      const y = z.kind === 'road' ? z.y + 4 : z.y + 3;
      ctx.fillText(z.label, z.x + z.w / 2, y);
    }
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
    void state;
  }
}
