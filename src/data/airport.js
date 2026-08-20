/* The Tiny Regional airport — GDD §20.2 "Map", §14.5 tier 1.
 *
 * Pure data plus pure query helpers. No canvas, no DOM, no game state: the tests reason
 * about geometry without a browser paint, and the renderer reads the same records the
 * collision code does, so a wall can never be drawn somewhere it does not block.
 *
 * Coordinates are metres. +x is east, +y is SOUTH (screen-down), matching canvas.
 * Origin is the north-west corner of the site.
 *
 * Layout, west to east:
 *   sort room  ->  door  ->  staging apron  ->  service road  ->  ramp with two stands
 */

export const WORLD = { widthM: 120, heightM: 70 };

/** Navigable outer rectangle, inset by the perimeter wall thickness. */
export const BOUNDS = { x: 2, y: 2, w: 116, h: 66 };

const WALL_T = 2;      // perimeter thickness
const ROOM_T = 0.6;    // sort-room wall thickness
export const DOOR = { y0: 20, y1: 26 };   // 6 m opening — wide enough for a cart train

/** Functional areas. `kind` drives both the floor colour and, later, gameplay rules
 *  (a bag left in `ramp` is on a live movement area — GDD §11.1 optional penalty). */
export const ZONES = [
  { id: 'sort_room', kind: 'indoor',  label: 'BAGGAGE SORT',  x: 4,  y: 8,  w: 30, h: 32 },
  { id: 'staging',   kind: 'staging', label: 'STAGING',       x: 34, y: 8,  w: 22, h: 38 },
  { id: 'road',      kind: 'road',    label: 'SERVICE ROAD',  x: 56, y: 4,  w: 10, h: 62 },
  { id: 'ramp',      kind: 'ramp',    label: 'RAMP',          x: 66, y: 4,  w: 50, h: 62 },
  { id: 'stand_1',   kind: 'stand',   label: 'GATE 1',        x: 70, y: 8,  w: 40, h: 22 },
  { id: 'stand_2',   kind: 'stand',   label: 'GATE 2',        x: 70, y: 40, w: 40, h: 22 },
];

/** Solid axis-aligned blockers. Anything here stops the player, the tractor and a cart. */
export const WALLS = [
  // perimeter
  { id: 'perim_n', x: 0, y: 0,  w: WORLD.widthM, h: WALL_T },
  { id: 'perim_s', x: 0, y: WORLD.heightM - WALL_T, w: WORLD.widthM, h: WALL_T },
  { id: 'perim_w', x: 0, y: 0,  w: WALL_T, h: WORLD.heightM },
  { id: 'perim_e', x: WORLD.widthM - WALL_T, y: 0, w: WALL_T, h: WORLD.heightM },

  // sort-room shell: four walls, east side split around the door opening
  { id: 'room_n', x: 4, y: 8,          w: 30,     h: ROOM_T },
  { id: 'room_s', x: 4, y: 40 - ROOM_T, w: 30,    h: ROOM_T },
  { id: 'room_w', x: 4, y: 8,          w: ROOM_T, h: 32 },
  { id: 'room_e1', x: 34 - ROOM_T, y: 8,        w: ROOM_T, h: DOOR.y0 - 8 },
  { id: 'room_e2', x: 34 - ROOM_T, y: DOOR.y1,  w: ROOM_T, h: 40 - DOOR.y1 },
];

/* The inbound baggage conveyor. GDD §20.2: "one conveyor that emits bags according to
 * the schedule". It enters through the west wall and runs east across the top of the
 * sort room, dropping bags on the floor at its end — where they pile up if nobody
 * clears them. That pile is the pressure; do not add a magic overflow bin. */
export const CONVEYOR = {
  id: 'conv_1',
  x0: 4.6, y0: 13,
  x1: 26,  y1: 13,
  widthM: 1.4,
  speedMps: 1.6,      // 21 m of belt = a 13 s ride, so a bag is visible well before it lands
};
CONVEYOR.lengthM = Math.hypot(CONVEYOR.x1 - CONVEYOR.x0, CONVEYOR.y1 - CONVEYOR.y0);

/** Marked cart bays, one per gate. GDD §7.3: "Sorting is physical placement onto marked
 *  carts or staging zones" — at Milestone 2 these are the same thing, because a cart
 *  parks on its bay and the bay label says which gate it serves.
 *
 *  Moved north for M2. At M1 they sat at y 29-37 and the carry from the belt drop was
 *  ~17 m per bag; with carts as the target that walk is the whole loop and it was far
 *  too long. From the pile at (26, 13) the near bay is now ~7 m. The pressure is meant
 *  to come from choosing the right cart and from the drive, not from walking. */
export const STAGING_PADS = [
  { id: 'pad_gate_1', gateId: 'gate_1', label: 'GATE 1', x: 16, y: 17.5, w: 7, h: 5.5 },
  { id: 'pad_gate_2', gateId: 'gate_2', label: 'GATE 2', x: 25, y: 17.5, w: 7, h: 5.5 },
];

/* Aircraft stands. One parking spot per gate, with the hold door on the south side of
 * the fuselage so a cart train pulls up alongside it, and a taxi lane east for pushback.
 * GDD §9.1 wants one baggage hold interaction zone and a visible door state. */
export const STANDS = [
  { id: 'stand_1', gateId: 'gate_1',
    park: { x: 89, y: 19 }, rot: Math.PI,
    hold: { x: 90, y: 21.6 },
    taxiIn: { x: 118, y: 19 }, taxiOut: { x: 118, y: 19 } },
  { id: 'stand_2', gateId: 'gate_2',
    park: { x: 89, y: 51 }, rot: Math.PI,
    hold: { x: 90, y: 53.6 },
    taxiIn: { x: 118, y: 51 }, taxiOut: { x: 118, y: 51 } },
];

export const standForGate = (gateId) => STANDS.find((s) => s.gateId === gateId) || null;

/** Painted markings — presentation only, never collision. */
export const MARKINGS = [
  { kind: 'lane',  x: 56, y: 4,  w: 10, h: 62 },          // service road centreline runs here
  { kind: 'stand', x: 70, y: 8,  w: 40, h: 22, gate: '1' },
  { kind: 'stand', x: 70, y: 40, w: 40, h: 22, gate: '2' },
  { kind: 'hatch', x: 34, y: DOOR.y0, w: 2, h: DOOR.y1 - DOOR.y0 },  // door threshold
];

/** Named points later milestones attach entities to. Declared now so the geometry is
 *  locked and the walk/drive distances below are meaningful. */
export const ANCHORS = {
  conveyorEnd:  { x: 26, y: 13 },   // where bags land in the sort room  (M1)
  sortDoor:     { x: 35, y: 23 },   // sort room <-> staging             (M0 route measure)
  cartBay1:     { x: 19.5, y: 20.25 },  // a cart parks on each marked bay   (M2)
  cartBay2:     { x: 28.5, y: 20.25 },
  cartPark:     { x: 10.5, y: 20.25 },  // the spare third cart              (M2)
  tractorPark:  { x: 42, y: 23 },       // outside the door, lined up on it  (M2)
  gate1Hold:    { x: 90, y: 21.6 },  // aircraft hold door, gate 1       (M3)
  gate2Hold:    { x: 90, y: 53.6 },  // aircraft hold door, gate 2       (M3)
  playerSpawn:  { x: 22, y: 24 },
};

/* ── pure geometry helpers ───────────────────────────────────────────────── */

export const rectContains = (r, x, y) =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

export const rectsOverlap = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Keep a point inside the navigable rectangle. GDD §24.3: clamp objects back into
 *  bounds if numerical error ejects them, rather than losing a bag outside the world. */
export function clampToBounds(x, y, radius = 0) {
  const minX = BOUNDS.x + radius, maxX = BOUNDS.x + BOUNDS.w - radius;
  const minY = BOUNDS.y + radius, maxY = BOUNDS.y + BOUNDS.h - radius;
  return {
    x: x < minX ? minX : (x > maxX ? maxX : x),
    y: y < minY ? minY : (y > maxY ? maxY : y),
    clamped: x < minX || x > maxX || y < minY || y > maxY,
  };
}

/** First wall containing the point, or null. Circle-aware via `radius`. */
export function wallAt(x, y, radius = 0) {
  for (const w of WALLS) {
    if (x >= w.x - radius && x < w.x + w.w + radius &&
        y >= w.y - radius && y < w.y + w.h + radius) return w;
  }
  return null;
}

export const isBlocked = (x, y, radius = 0) => wallAt(x, y, radius) !== null;

/** Innermost zone containing the point (later entries win, so stands beat ramp). */
export function zoneAt(x, y) {
  let hit = null;
  for (const z of ZONES) if (rectContains(z, x, y)) hit = z;
  return hit;
}

export const zoneById = (id) => ZONES.find((z) => z.id === id) || null;

/** Which staging pad, if any, a point sits on. */
export function padAt(x, y) {
  for (const p of STAGING_PADS) if (rectContains(p, x, y)) return p;
  return null;
}

/** Straight-line metres between two anchors. Used to sanity-check GDD §8.3: the route
 *  must be long enough that transport planning matters, short enough that a wasted trip
 *  is not dead time. Measured in the M0 suite so a layout edit cannot silently break it. */
export function anchorDistance(a, b) {
  const p = ANCHORS[a], q = ANCHORS[b];
  return Math.hypot(q.x - p.x, q.y - p.y);
}
