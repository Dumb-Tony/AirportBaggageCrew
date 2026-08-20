/* Uniform spatial grid — GDD §24.2.
 *
 * "Use a simple uniform spatial grid for nearby interaction and collision queries once
 * entity count warrants it." A hundred bags scanned pairwise is 4,950 checks per step;
 * through the grid it is a handful per bag.
 *
 * Rebuilt from scratch each step rather than incrementally maintained: entities move
 * every step anyway, and a rebuild has no stale-cell failure mode. Cell arrays are
 * reused, never reallocated, so a steady state allocates nothing (GDD §24.1).
 *
 * Query order is insertion order, which is bag-id order — so results are deterministic.
 */

export class SpatialGrid {
  constructor(widthM, heightM, cellM = 4) {
    this.cellM = cellM;
    this.cols = Math.max(1, Math.ceil(widthM / cellM));
    this.rows = Math.max(1, Math.ceil(heightM / cellM));
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
    this.count = 0;
  }

  clear() {
    for (let i = 0; i < this.cells.length; i++) this.cells[i].length = 0;
    this.count = 0;
  }

  _index(x, y) {
    let cx = Math.floor(x / this.cellM);
    let cy = Math.floor(y / this.cellM);
    if (cx < 0) cx = 0; else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0; else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  insert(id, x, y) {
    this.cells[this._index(x, y)].push(id);
    this.count++;
  }

  /** Ids in every cell the circle touches. May include entities just outside it —
   *  callers do the exact distance test. Results are appended to `out`. */
  query(x, y, radius, out = []) {
    out.length = 0;
    const c = this.cellM;
    let x0 = Math.floor((x - radius) / c), x1 = Math.floor((x + radius) / c);
    let y0 = Math.floor((y - radius) / c), y1 = Math.floor((y + radius) / c);
    // Clamped at BOTH ends of both axes, the same way `_index` clamps an insert. Pushing
    // only the low end up and the high end down left a query centred outside the grid
    // with x0 > x1, which returns nothing — while `insert` had happily filed the entity
    // in an edge cell. Anything that ever escaped the world would then be invisible to
    // targeting even with the player standing on it, turning a recoverable ejection into
    // GDD §29 "permanently unreachable". Nothing can escape today; this is the backstop
    // behind the backstop.
    if (x0 < 0) x0 = 0; if (x0 >= this.cols) x0 = this.cols - 1;
    if (y0 < 0) y0 = 0; if (y0 >= this.rows) y0 = this.rows - 1;
    if (x1 >= this.cols) x1 = this.cols - 1; if (x1 < 0) x1 = 0;
    if (y1 >= this.rows) y1 = this.rows - 1; if (y1 < 0) y1 = 0;
    for (let cy = y0; cy <= y1; cy++) {
      const row = cy * this.cols;
      for (let cx = x0; cx <= x1; cx++) {
        const cell = this.cells[row + cx];
        for (let i = 0; i < cell.length; i++) out.push(cell[i]);
      }
    }
    return out;
  }
}
