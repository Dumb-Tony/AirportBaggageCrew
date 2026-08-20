/* CrewBot — a player, not a cheat.
 *
 * Milestone 6 is a BALANCE pass, and balance needs evidence about what a person can
 * actually get done in eight minutes. The m3 bot proved the arithmetic closes by
 * teleporting bags into holds; that measures the schedule, not the game. This one walks,
 * grabs, loads carts, climbs into the tractor, hitches, drives out through the door,
 * parks at the aircraft and carries bags into the hold one at a time — every one of those
 * through `input._debugPress` and the real contextual verbs, exactly as a keyboard does.
 *
 * That makes it the only honest instrument for GDD §30 M6 ("tune timings, bag counts,
 * route length") and for §29's "no known blocker can make a required bag permanently
 * unreachable": if the bot cannot finish, a person probably cannot either, and where it
 * stalls is a real defect rather than a missing skill.
 *
 * IT MUST NEVER TOUCH STATE DIRECTLY. Reading is fine — a player can see the ramp. The
 * moment it writes a position or moves a bag it stops being a measurement. Nothing below
 * assigns to anything under `state`, and m6 asserts that by source inspection.
 *
 * `skill` scales the two things that separate a novice from a veteran: how long they
 * dither before committing (`reactionMs`) and whether they read the schedule ahead
 * (`lookaheadMs`). It does NOT scale walking speed or reach — those are the game's.
 */

import { CONFIG } from '../src/config.js';
import { DOOR, ANCHORS, standForGate } from '../src/data/airport.js';
import { aircraftHoldZone, holdContains } from '../src/entities/aircraft.js';
import { cartRoomFor, nextPlacard } from '../src/entities/cart.js';
import { FLIGHT_DEFS } from '../src/data/flights.js';
import { isHoldOpen } from '../src/systems/flightSchedule.js';

const KEY = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', grab: 'KeyE', interact: 'KeyF', scan: 'KeyQ' };
const ALL_MOVE = [KEY.up, KEY.down, KEY.left, KEY.right];

/** The sort-room wall is the only obstacle in the world, and the door is its only gap. */
const DOOR_Y = (DOOR.y0 + DOOR.y1) / 2;
const INSIDE_X = 32.4;                 // stand-off west of the wall
const OUTSIDE_X = 36.6;                // ...and east of it
const ROOM_EAST = 34;

/** Where the train is parked to be filled. Coming in through the door the tractor faces
 *  west, so the cart trails EAST of this point — which is why the spot sits west of the
 *  marked bays and north of them. Parked at (24, 18.2) the towed cart landed on top of
 *  the cart on bay 2, and `findCart` then handed the player its neighbour every time. */
const SORT_SPOT = { x: 20, y: 15.2 };

export const SKILLS = Object.freeze({
  novice:  { reactionMs: 900, lookaheadMs: 0,      haulAt: 10, label: 'novice' },
  average: { reactionMs: 380, lookaheadMs: 45000,  haulAt: 8,  label: 'average' },
  veteran: { reactionMs: 90,  lookaheadMs: 110000, haulAt: 6,  label: 'veteran' },
});

export class CrewBot {
  constructor(skill = 'average') {
    this.skill = SKILLS[skill] || SKILLS.average;
    this.phase = 'sort';
    this.sinceDecisionMs = 0;
    this.jobBagId = null;
    this.jobCartId = null;
    this.jobFlightId = null;
    this.unloadStep = 'take';
    this.stats = {
      bagsCarried: 0, cartLoads: 0, holdLoads: 0, hauls: 0, scans: 0, unreachable: 0,
      walkedM: 0, drivenM: 0, idleMs: 0, stuckMs: 0,
      phaseMs: {}, firstLoadMs: null, deadEnds: [],
    };
    this._lastP = null;
    this._noProgressMs = 0;
  }

  /* ── the only entry point ─────────────────────────────────────────────── */

  /** Drive one frame. Call INSTEAD of pressing keys yourself; returns nothing. */
  step(g, input, dtMs) {
    const st = g.state;
    const p = st.player;
    for (const k of ALL_MOVE) input._debugRelease(k);

    this.sinceDecisionMs += dtMs;
    this.stats.phaseMs[this.phase] = (this.stats.phaseMs[this.phase] || 0) + dtMs;

    if (this._lastP) {
      const d = Math.hypot(p.x - this._lastP.x, p.y - this._lastP.y);
      if (p.drivingId) this.stats.drivenM += d; else this.stats.walkedM += d;
      if (d < 0.004) {
        this.stats.idleMs += dtMs;
        // Standing still with NOTHING TO DO is not a dead end, it is an empty belt, and
        // counting it as one buried the real stalls under hundreds of false ones.
        // Pressing a verb counts as progress even standing still: cycling a placard
        // with F takes several presses in one spot and is not a stall.
        if (!this._loitering && !this._acted) this._noProgressMs += dtMs;
      } else this._noProgressMs = 0;
      if (this._noProgressMs > 6000) {
        this.stats.stuckMs += dtMs;
        // Stuck is a FINDING, not something to drive around. Record where and why once,
        // then re-plan — a real player would also eventually try something else.
        if (this._noProgressMs < 6000 + dtMs * 1.5) {
          const v = p.drivingId ? st.vehiclesById[p.drivingId] : null;
          this.stats.deadEnds.push({
            phase: this.phase, x: +p.x.toFixed(1), y: +p.y.toFixed(1),
            tMs: st.simTimeMs, driving: !!p.drivingId,
            // Enough to diagnose without re-running: a tractor at zero speed is a
            // control problem, one at speed against a wall is a geometry problem.
            speed: v ? +v.speed.toFixed(2) : null,
            rot: v ? +v.rot.toFixed(2) : null,
            want: this._lastAim ? `${this._lastAim.x.toFixed(1)},${this._lastAim.y.toFixed(1)}` : '-',
            carrying: !!p.carryingBagId,
            job: this.jobCartId || '-',
            hitched: this.jobCartId && st.cartsById[this.jobCartId]
              ? !!st.cartsById[this.jobCartId].hitchedToId : null,
            train: v ? (v.nextCartId || '-') : '-',
            clearMs: Math.round(this._clearOfDropMs || 0),
          });
        }
        this._replan();
      }
    }
    this._lastP = { x: p.x, y: p.y };

    // Cleared AFTER the stall check above, which reads last frame's value. Resetting it
    // first made the flag permanently false and the whole exemption a no-op.
    this._loitering = false;
    this._acted = false;

    switch (this.phase) {
      case 'sort':      this._sort(g, input); break;
      case 'toTractor': this._toTractor(g, input); break;
      case 'hitch':     this._hitch(g, input); break;
      case 'drive':     this._drive(g, input); break;
      case 'unload':    this._unload(g, input); break;
      case 'return':    this._return(g, input); break;
      default:          this.phase = 'sort';
    }
  }

  _replan() {
    this._noProgressMs = 0;
    this.jobBagId = null;
    this.phase = this.phase === 'sort' ? 'sort' : 'return';
  }

  /* ── phase: sort off the belt into the marked carts ───────────────────── */

  _sort(g, input) {
    const st = g.state;
    const p = st.player;

    // A cart worth hauling? Either it is full, or its flight is close enough to hold
    // closing that leaving now is the last chance. Lookahead is the skill.
    //
    // ONLY WITH EMPTY HANDS. `_toTractor` bounces straight back here while carrying, so
    // without this guard the two phases flip-flop every frame, pressing no keys at all —
    // a veteran stood in the sort room doing that for the last 100 s of every shift.
    const ready = p.carryingBagId ? null : this._cartToHaul(st);
    if (ready) {
      this.jobCartId = ready.id;
      this.jobFlightId = ready.placardFlightId;
      this.phase = 'toTractor';
      return;
    }

    // Carts start BLANK. A player has to walk over and press F to label each one, and
    // so does the bot — the placard is the sorting plan made physical (GDD §7.3).
    const blank = this._needsPlacard(st);
    if (blank && !p.carryingBagId) { this._setPlacard(g, input, blank.cart, blank.flightId); return; }

    if (p.carryingBagId) {
      const bag = st.bagsById[p.carryingBagId];
      const cart = this._cartFor(st, bag.flightId);
      if (!cart) { this._press(input, KEY.grab); return; }   // nowhere to put it: set it down
      if (!cartRoomFor(cart, st, bag).ok) {
        // FULL. Set the bag down where it is and remember which cart needs hauling; with
        // empty hands, `_cartToHaul` picks it up next frame. Changing phase while still
        // holding something is the flip-flop trap: `_toTractor` bounces straight back
        // here, neither phase presses a key, and the crew stands there for four minutes.
        this._press(input, KEY.grab);
        this.jobCartId = cart.id; this.jobFlightId = cart.placardFlightId;
        return;
      }

      // CARTS CAN OVERLAP, and `findCart` returns the nearest one containing you — so
      // standing between two of them loads the wrong cart, or (if that one is full)
      // nothing at all. Act on what is actually in reach, and only insist on the intended
      // cart by walking somewhere the intended cart is the nearest.
      const inReach = p.targetCartId ? st.cartsById[p.targetCartId] : null;
      if (inReach && inReach.placardFlightId === bag.flightId && cartRoomFor(inReach, st, bag).ok) {
        this._press(input, KEY.grab);
        this.stats.cartLoads++;
        this._carryMs = 0;
        return;
      }
      // Standing where two carts overlap, stepping to the "far side" once is not always
      // enough — the geometry can put you back inside the neighbour. Work round the cart
      // instead, a quarter turn every couple of seconds, the way a person circles a
      // trolley they cannot reach past.
      this._carryMs = (this._carryMs || 0) + CONFIG.sim.stepMs;
      const side = Math.floor(this._carryMs / 2200) % 4;
      const off = [[0, 1.15], [1.6, 0], [0, -1.15], [-1.6, 0]][side];
      const approach = inReach && inReach.id !== cart.id
        ? { x: cart.x + off[0], y: cart.y + off[1] }
        : { x: cart.x, y: cart.y };
      this._walkTo(g, input, approach.x, approach.y, 0.9);
      return;
    }

    // Empty-handed: fetch the most urgent loose bag whose flight still has a cart.
    const bag = this._pickBag(st);
    if (!bag) { this._loiter(g, input); return; }
    this.jobBagId = bag.id;
    if (this._walkTo(g, input, bag.x, bag.y, 0.95)) {
      // Take whatever is in reach rather than insisting on the bag we set out for. The
      // aim bias in findTarget can legitimately prefer a different one in a pile, and a
      // player would simply grab that one — holding out froze the first version of this
      // bot at the belt for minutes at a time.
      if (st.player.targetBagId) {
        this._press(input, KEY.grab);
        this.stats.bagsCarried++;
        if (this.sinceDecisionMs > this.skill.reactionMs) {
          this._press(input, KEY.scan); this.stats.scans++;
          this.sinceDecisionMs = 0;
        }
      } else {
        /*
         * ARRIVED AND NOTHING IS IN REACH. Either it rode on down the belt, a neighbour
         * shoved it, or it genuinely cannot be picked up from here — and the third case
         * is precisely what GDD §29 means by an unreachable bag. Count it, put it aside
         * for twenty seconds, and go and do something useful; the count is reported, so
         * a real blocker shows up as a number instead of as a frozen bot.
         */
        this.stats.unreachable++;
        this._skip = this._skip || new Map();
        this._skip.set(bag.id, st.simTimeMs + 20000);
        this.jobBagId = null;
      }
    }
  }

  /** The bag a competent player reaches for: nearest, among flights still loadable. */
  _pickBag(st) {
    const p = st.player;
    let best = null, bestScore = Infinity;
    for (const bag of Object.values(st.bagsById)) {
      if (bag.location.type !== 'floor' && bag.location.type !== 'conveyor') continue;
      const flight = st.flightsById[bag.flightId];
      if (!flight || flight.evaluated) continue;               // already gone; leave it
      if (!this._cartFor(st, bag.flightId)) continue;
      if (this._skip && this._skip.get(bag.id) > st.simTimeMs) continue;
      const d = Math.hypot(bag.x - p.x, bag.y - p.y);
      // Priority bags first, then nearest. A veteran also weighs how soon the hold shuts.
      const urgency = this.skill.lookaheadMs
        ? Math.max(0, flight.times.holdClosingMs - st.simTimeMs) / 1000
        : 0;
      const score = d + (bag.priority ? -8 : 0) + urgency * 0.04;
      if (score < bestScore) { bestScore = score; best = bag; }
    }
    return best;
  }

  /**
   * A flight that has bags to move and no cart claiming them, plus a blank cart to
   * claim them with. Returns null once every live flight has one.
   */
  /*
   * F CYCLES the placard: null -> AB221 -> MC184 -> SK307 -> null. Labelling a cart for
   * the second flight therefore takes two presses, and the cart reads AB221 in between.
   *
   * That intermediate state is why this has to LATCH. Re-deciding every frame, the bot
   * saw cart_2 reading AB221, concluded AB221 already had a cart, went looking for a cart
   * for MC184, found the last blank one, and started the same cycle on that — leaving two
   * carts labelled AB221 and no cart at all for MC184 or SK307. Both those flights took
   * zero bags in every run of every seed.
   */
  _needsPlacard(st) {
    if (this._placardJob) {
      const c = st.cartsById[this._placardJob.cartId];
      if (c && c.placardFlightId !== this._placardJob.flightId) {
        return { cart: c, flightId: this._placardJob.flightId };
      }
      this._placardJob = null;
    }
    const claimed = new Set(Object.values(st.cartsById).map((c) => c.placardFlightId));
    for (const def of FLIGHT_DEFS) {
      const flight = st.flightsById[def.id];
      if (!flight || flight.evaluated) continue;
      if (claimed.has(def.id)) continue;
      // Free to relabel: empty, and not the only cart a live flight has.
      const blank = Object.values(st.cartsById).find((c) => {
        if (c.bagIds.length) return false;
        if (!c.placardFlightId) return true;
        if (!this._flightStillWants(st, c.placardFlightId)) return true;
        const others = Object.values(st.cartsById)
          .filter((o) => o.id !== c.id && o.placardFlightId === c.placardFlightId);
        return others.length > 0;
      });
      if (blank) {
        this._placardJob = { cartId: blank.id, flightId: def.id };
        return { cart: blank, flightId: def.id };
      }
    }
    return null;
  }

  /** Is the flight this cart is labelled for still worth a cart of its own? */
  _flightStillWants(st, flightId) {
    const f = st.flightsById[flightId];
    return !!f && !f.evaluated && isHoldOpen(f);
  }

  /** Stand at the cart and press F until the placard reads what we want. The debounce
   *  in setPlacard means this takes several frames, exactly as it does for a person. */
  _setPlacard(g, input, cart, flightId) {
    const st = g.state;
    if (cart.placardFlightId === flightId) return;
    if (this._walkTo(g, input, cart.x, cart.y, 1.25)) {
      if (st.player.targetCartId === cart.id && !st.player.targetVehicleId) {
        this._press(input, KEY.interact);
      }
    }
    void nextPlacard;
  }

  /** The cart standing on the bay for this flight. */
  _cartFor(st, flightId) {
    // A HITCHED cart still counts. The bot keeps its cart on the drawbar for the whole
    // shift and loads it where it stands, which is both fewer moves and better play.
    for (const c of Object.values(st.cartsById)) {
      if (c.placardFlightId === flightId) return c;
    }
    return null;
  }

  _cartToHaul(st) {
    for (const c of Object.values(st.cartsById)) {
      if (!c.bagIds.length) continue;
      const flight = st.flightsById[c.placardFlightId];
      if (!flight || flight.evaluated || !isHoldOpen(flight)) continue;
      if (c.bagIds.length >= this.skill.haulAt) return c;
      // Last-chance run: the hold shuts before another cartload could be filled.
      const left = flight.times.holdClosingMs - st.simTimeMs;
      if (this.skill.lookaheadMs && left < this.skill.lookaheadMs) return c;
    }
    return null;
  }

  /* ── phase: fetch the tractor ─────────────────────────────────────────── */

  _toTractor(g, input) {
    const st = g.state;
    // Belt and braces against the same trap: put it down rather than bouncing phases.
    if (st.player.carryingBagId) { this._press(input, KEY.grab); return; }
    const v = this._tractor(st);
    if (!v) { this.phase = 'sort'; return; }
    if (st.player.drivingId) {
      const cart = st.cartsById[this.jobCartId];
      this.phase = cart && cart.hitchedToId ? 'drive' : 'hitch';
      return;
    }

    if (this._walkTo(g, input, v.x, v.y, 1.5)) {
      if (st.player.targetVehicleId === v.id) this._press(input, KEY.interact);
    }
  }

  _tractor(st) {
    return Object.values(st.vehiclesById).find((v) => v.kind === 'tractor') ||
           Object.values(st.vehiclesById)[0] || null;
  }

  /* ── phase: put the hitch on the cart ─────────────────────────────────── */

  /*
   * DRIVE PAST IT, do not reverse onto it.
   *
   * `hitchCandidate` measures from the tow point — 1.3 m behind the tractor centre — to
   * the cart CENTRE, within 3 m. So a tractor that simply drives forward until the cart
   * is a couple of metres behind it is in range, and no reversing is involved at all.
   *
   * The reversing version of this method spent 82% of every shift steering backwards in
   * circles and hitched nothing. Worth keeping the lesson: reverse-parking is a
   * disproportionately hard control problem for something the geometry does not require.
   */
  _hitch(g, input) {
    const st = g.state;
    const v = st.vehiclesById[st.player.drivingId];
    const cart = st.cartsById[this.jobCartId];
    if (!v) { this.phase = 'sort'; return; }
    if (!cart || cart.hitchedToId) { this._hitchMs = 0; this.phase = 'drive'; return; }

    // In range already? Take it. E while driving hitches whatever the game offers.
    const tow = { x: v.x - Math.cos(v.rot) * CONFIG.tractor.towOffsetM,
                  y: v.y - Math.sin(v.rot) * CONFIG.tractor.towOffsetM };
    if (Math.hypot(cart.x - tow.x, cart.y - tow.y) < CONFIG.cart.hitchRangeM * 0.85) {
      this._press(input, KEY.grab);
      this.stats.hauls++; this._hitchMs = 0; this._hitchAim = null;
      // An empty cart is worth nothing at the gate. Tow it to the belt and fill it there.
      this.phase = cart.bagIds.length ? 'drive' : 'return';
      return;
    }

    // The line to drive along, captured ONCE on arrival so the target does not swing
    // round the cart as we close on it.
    if (!this._hitchAim) {
      const dx = cart.x - v.x, dy = cart.y - v.y;
      const d = Math.hypot(dx, dy) || 1;
      this._hitchAim = { x: dx / d, y: dy / d };
    }
    const aim = this._hitchAim;
    const past = { x: cart.x + aim.x * 2.4, y: cart.y + aim.y * 2.4 };

    // A hitch that routinely needs several passes is a TUNING problem, not a skill one,
    // so the retries are counted rather than hidden.
    this._hitchMs = (this._hitchMs || 0) + CONFIG.sim.stepMs;
    if (this._hitchMs > 12000) {
      this._hitchMs = 0; this._hitchAim = null;
      this.stats.hitchRetries = (this.stats.hitchRetries || 0) + 1;
      if ((this.stats.hitchRetries || 0) > 6) { this.phase = 'return'; return; }
    }

    this._driveTo(g, input, past.x, past.y, 0.9);
  }

  /* ── phase: drive to the gate ─────────────────────────────────────────── */

  _drive(g, input) {
    const st = g.state;
    if (!st.player.drivingId) { this.phase = 'sort'; return; }
    const flight = st.flightsById[this.jobFlightId];
    if (!flight) { this.phase = 'return'; return; }
    const ac = st.aircraftById[flight.aircraftId];
    const stand = standForGate(flight.gateId);
    if (!ac || !stand) { this.phase = 'return'; return; }

    // Park SHORT of the hold, on the open side, so the player can step between the cart
    // and the hold volume without one stealing the other's E.
    const z = aircraftHoldZone(ac);
    const target = { x: z.x - 3.4, y: z.y + 2.6 };
    if (this._driveTo(g, input, target.x, target.y, 2.4)) {
      this._press(input, KEY.interact);          // get out
      this.unloadStep = 'take';
      this.phase = 'unload';
    }
  }

  /* ── phase: cart to hold, one bag at a time ───────────────────────────── */

  _unload(g, input) {
    const st = g.state;
    const p = st.player;
    if (p.drivingId) { this._press(input, KEY.interact); return; }

    const flight = st.flightsById[this.jobFlightId];
    const ac = flight ? st.aircraftById[flight.aircraftId] : null;
    const cart = st.cartsById[this.jobCartId];
    if (!ac || !cart) { this.phase = 'return'; return; }

    // The hold has shut with bags still aboard the cart. Nothing to be done about it —
    // that is the game working, and it is exactly the number M6 wants to know.
    if (!ac.holdOpen) { this.phase = 'return'; return; }
    if (!cart.bagIds.length && !p.carryingBagId) { this.phase = 'return'; return; }

    const z = aircraftHoldZone(ac);

    if (p.carryingBagId) {
      // Into the hold volume, then E. `holdContains` is the same test the game uses.
      if (this._walkTo(g, input, z.x, z.y, 0.6) || holdContains(ac, p.x, p.y)) {
        if (p.targetHoldId === ac.id && p.targetHoldOpen) {
          this._press(input, KEY.grab);
          this.stats.holdLoads++;
          if (this.stats.firstLoadMs === null) this.stats.firstLoadMs = st.simTimeMs;
        }
      }
      return;
    }

    // Empty-handed. Stand at the cart and OUTSIDE the hold volume, or E will pull a bag
    // back out of the aircraft instead of taking one off the cart.
    const spot = this._cartSideSpot(ac, cart);
    if (this._walkTo(g, input, spot.x, spot.y, 0.7)) {
      if (!holdContains(ac, p.x, p.y) && p.targetCartId === cart.id) {
        this._press(input, KEY.grab);
      }
    }
  }

  /** A point beside `want` on the side away from `other`, so `findCart` picks `want`. */
  _awayFrom(want, other) {
    const dx = want.x - other.x, dy = want.y - other.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x: want.x + (dx / d) * 1.1, y: want.y + (dy / d) * 1.1 };
  }

  /** A standing spot beside the cart that is provably outside the hold volume. */
  _cartSideSpot(ac, cart) {
    const z = aircraftHoldZone(ac);
    const away = cart.y >= z.y ? 1 : -1;
    let y = cart.y + away * 1.15;
    // Push out until the test the game runs agrees we are clear of the hold.
    for (let i = 0; i < 8 && holdContains(ac, cart.x, y, 0.15); i++) y += away * 0.5;
    return { x: cart.x, y };
  }

  /* ── phase: back to the sort room ─────────────────────────────────────── */

  _return(g, input) {
    const st = g.state;
    const p = st.player;

    if (p.carryingBagId) { this._press(input, KEY.grab); return; }   // put it down first

    if (!p.drivingId) {
      const v = this._tractor(st);
      // Only ride back if the tractor is here; otherwise walk, which is what a player
      // does after abandoning a run.
      if (v && Math.hypot(v.x - p.x, v.y - p.y) < 14 && !v.driverId) {
        if (this._walkTo(g, input, v.x, v.y, 1.5)) {
          if (p.targetVehicleId === v.id) this._press(input, KEY.interact);
        }
        return;
      }
      if (this._walkTo(g, input, ANCHORS.conveyorEnd.x, ANCHORS.conveyorEnd.y + 3, 2.5)) {
        this.jobCartId = null; this.jobFlightId = null; this.phase = 'sort';
      }
      return;
    }

    /*
     * THE CART STAYS ON THE DRAWBAR. Park the whole train beside the belt, step off, and
     * load it where it stands.
     *
     * The version that dropped the cart on its bay and re-parked the tractor spent 73% of
     * every shift stationary, because E while driving hitches any free cart within 3 m of
     * the tow point and only unhitches when there is none — so dropping a cart and sitting
     * on it picks it straight back up, forever. Not a bug in the game: `hitchCandidate` is
     * doing exactly what a player wants when they nudge up to a cart. It is a bug in
     * asking for the drop while parked on top of the thing you dropped.
     *
     * Towing it to the belt is also simply better play: no walk to the tractor, no
     * reversing onto a hitch, one fewer trip through the door per load.
     */
    if (this._driveTo(g, input, SORT_SPOT.x, SORT_SPOT.y, 2.6)) {
      this._press(input, KEY.interact);        // step off; the train stays where it is
      this.phase = 'sort';
    }
  }

  /* ── locomotion ───────────────────────────────────────────────────────── */

  /** Walk one frame toward a world point through the door if need be.
   *  @returns {boolean} true once within `withinM`. */
  _walkTo(g, input, tx, ty, withinM) {
    const p = g.state.player;
    if (Math.hypot(tx - p.x, ty - p.y) <= withinM) return true;
    const wp = this._nextWaypoint(p.x, p.y, tx, ty);
    this._lastAim = wp;
    const dx = wp.x - p.x, dy = wp.y - p.y;
    if (Math.abs(dx) > 0.12) input._debugPress(dx > 0 ? KEY.right : KEY.left);
    if (Math.abs(dy) > 0.12) input._debugPress(dy > 0 ? KEY.down : KEY.up);
    return false;
  }

  /** Drive one frame toward a world point. Same waypointing, plus throttle and steering. */
  _driveTo(g, input, tx, ty, withinM) {
    const st = g.state;
    const v = st.vehiclesById[st.player.drivingId];
    if (!v) return true;
    if (Math.hypot(tx - v.x, ty - v.y) <= withinM) return true;

    const wp = this._nextWaypoint(v.x, v.y, tx, ty);
    this._lastAim = wp;
    let err = Math.atan2(wp.y - v.y, wp.x - v.x) - v.rot;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;

    // YAW RATE SCALES WITH SPEED, so a stationary tractor cannot turn at all, and
    // steering without throttle is a deadlock. It is the one the first version of this
    // bot sat in for five minutes of every shift, 84 m from where it wanted to be.
    // Facing away means backing out, which is what a person does too.
    if (Math.abs(err) > 2.0) {
      let rerr = err > 0 ? err - Math.PI : err + Math.PI;
      if (rerr > 0.05) input._debugPress(KEY.left);       // inverted in reverse
      else if (rerr < -0.05) input._debugPress(KEY.right);
      input._debugPress(KEY.down);
      return false;
    }
    if (err > 0.05) input._debugPress(KEY.right);
    else if (err < -0.05) input._debugPress(KEY.left);
    // Always under power. A train cornering at full tilt sheds its load, which is the M2
    // spill model working as designed, so the answer is to ease off, never to stop.
    input._debugPress(KEY.up);
    return false;
  }

  /** The sort-room wall is the world's only obstacle, so routing is one decision:
   *  am I crossing it, and if so, aim at the doorway first. */
  _nextWaypoint(fx, fy, tx, ty) {
    const fromIn = fx < ROOM_EAST, toIn = tx < ROOM_EAST;
    if (fromIn === toIn) return { x: tx, y: ty };
    if (fromIn) {
      if (fx < INSIDE_X - 0.4 || Math.abs(fy - DOOR_Y) > 2.0) return { x: INSIDE_X, y: DOOR_Y };
      return { x: OUTSIDE_X, y: DOOR_Y };
    }
    if (fx > OUTSIDE_X + 0.4 || Math.abs(fy - DOOR_Y) > 2.0) return { x: OUTSIDE_X, y: DOOR_Y };
    return { x: INSIDE_X, y: DOOR_Y };
  }

  _press(input, code) { this._acted = true; input._debugPress(code); }

  /** Nothing to do: stand near the belt drop rather than freezing on the spot. */
  _loiter(g, input) {
    this._loitering = true;
    this._walkTo(g, input, ANCHORS.conveyorEnd.x, ANCHORS.conveyorEnd.y + 2.5, 2.0);
  }
}

/**
 * Play a whole shift and report what the crew managed. Returns the balance record M6
 * tunes against — every number measured through the real input path.
 */
export function playShift(g, input, skill = 'average', maxMs = 900000) {
  const bot = new CrewBot(skill);
  const FRAME = CONFIG.sim.stepMs;
  g.startShift();
  let frames = 0;
  const cap = Math.ceil(maxMs / FRAME);
  while (frames < cap && !g.state.shift.ended) {
    bot.step(g, input, FRAME);
    g.frame(FRAME, input);
    frames++;
  }
  const flights = Object.values(g.state.flightsById);
  const owed = flights.reduce((n, f) => n + f.expectedCount, 0);
  const correct = flights.reduce((n, f) => n + f.outcome.correct, 0);
  const misrouted = flights.reduce((n, f) => n + f.outcome.misrouted, 0);
  const missed = flights.reduce((n, f) => n + f.outcome.missed, 0);
  return {
    skill: bot.skill.label,
    owed, correct, misrouted, missed,
    pct: owed ? Math.round((correct / owed) * 100) : 0,
    points: g.state.score.points,
    simMs: g.state.simTimeMs,
    perFlight: flights.map((f) => ({
      number: f.number, correct: f.outcome.correct, owed: f.expectedCount,
      missed: f.outcome.missed, misrouted: f.outcome.misrouted,
    })),
    bot: bot.stats,
  };
}
