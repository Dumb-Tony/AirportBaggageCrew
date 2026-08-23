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
// READ-ONLY, like everything else here. `trainOf` and `hitchPointOf` are the same two
// functions the game itself uses to decide what a hitch can reach, and the bot has to ask
// the same question the game will answer — measuring from the tractor instead of from the
// TAIL is precisely why appending a second cart never worked.
import { trainOf, hitchPointOf } from '../src/systems/hitching.js';

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

/** Minimum gap between two presses of the same verb key. About seven a second — brisk
 *  for a person, and the difference between an honest measurement and a fantasy. */
const VERB_GAP_MS = 145;

/*
 * ⚠ MULTI-CART TOURING: BUILT, MEASURED, AND DELIBERATELY LEFT OFF. The README carried it
 * as an open question for two milestones — "a human who couples two carts pays the sixty
 * metre run once instead of twice" — and three earlier attempts failed on cart management
 * rather than on the idea. This one works: the train is permanent, up to three carts, and
 * `_nextStopOrHome` serves a second gate without driving home.
 *
 * The mechanism runs. It costs more than it saves:
 *
 *   divert for any live cart      1.56 gates per round trip   61% delivered
 *   divert only within 6 m        1.33 gates per round trip   68% delivered
 *   never divert (shipped)        1.00 gates per round trip   84% delivered
 *
 * Coupling is a manoeuvre, and every trip that begins with one begins later: the belt
 * queue went from 10 bags to 14 while the crew was fetching a cart. The shared sixty
 * metres is real and it is smaller than the delay. Touring at the gate stays ON, because
 * it is free when a coupled cart happens to be loaded and live — it simply almost never
 * is, and the tour counters say why: at a gate, 6.7 of 6.7 other carts on the train
 * belong to flights that have already departed.
 *
 * So the answer to the README's question is measured rather than assumed, and it is no.
 */

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
      // GDD §28.4 asks for "queue length" — how deep the pile the crew is behind gets.
      // Sampled rather than accumulated: it is a level, not a count.
      queuePeak: 0, queueSamples: 0, queueSum: 0,
    };
    this._lastP = null;
    this._noProgressMs = 0;
    // Latched by _driveTo while backing out of a heading it cannot drive out of.
    this._reversing = false;
    this._reverseMs = 0;
  }

  /* ── the only entry point ─────────────────────────────────────────────── */

  /** Drive one frame. Call INSTEAD of pressing keys yourself; returns nothing. */
  step(g, input, dtMs) {
    const st = g.state;
    const p = st.player;
    for (const k of ALL_MOVE) input._debugRelease(k);

    this.sinceDecisionMs += dtMs;
    this._nowMs = st.simTimeMs;
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

    // Queue depth: everything waiting on the belt or lying on the sort-room floor. Sampled
    // once a second, because a per-frame series would be 41,000 numbers describing a
    // quantity that moves once every few seconds.
    if (Math.floor(st.simTimeMs / 1000) !== this._lastQueueSec) {
      this._lastQueueSec = Math.floor(st.simTimeMs / 1000);
      let q = 0;
      for (const b of Object.values(st.bagsById)) {
        if (b.location.type === 'conveyor' || b.location.type === 'floor') q++;
      }
      this.stats.queuePeak = Math.max(this.stats.queuePeak, q);
      this.stats.queueSum += q;
      this.stats.queueSamples++;
    }

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
    // Drop the reverse latch with the plan that set it, or a back-out aimed at the old
    // target carries into the new one and drives away from it.
    this._reversing = false;
    this.jobBagId = null;
    this.phase = this.phase === 'sort' ? 'sort' : 'return';
  }

  /* ── phase: sort off the belt into the marked carts ───────────────────── */

  _sort(g, input) {
    const st = g.state;
    const p = st.player;

    // GET OUT FIRST. Everything below is on foot and steers with WASD; still in the cab,
    // those same keys drive the tractor, and the bot spent the back half of one shift
    // wiggling a loaded train in the north-west corner of the sort room while trying to
    // "walk" to a bag twenty metres away. `_replan` and the return handoff can both land
    // here mid-drive, so the guard belongs at the top rather than in either of them.
    if (p.drivingId) { this._press(input, KEY.interact); return; }

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
        if (this._press(input, KEY.grab)) { this.stats.cartLoads++; this._carryMs = 0; }
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
        if (this._press(input, KEY.grab)) this.stats.bagsCarried++;
        if (this.sinceDecisionMs > this.skill.reactionMs) {
          if (this._press(input, KEY.scan)) { this.stats.scans++; this.sinceDecisionMs = 0; }
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

  /**
   * Is it time to go, and which gate first?
   *
   * ⚠ THE TRIGGER IS THE TRAIN'S TOTAL, NOT ONE CART'S. That one word is the difference
   * between a train and three carts that happen to be coupled. Waiting for a SINGLE cart
   * to reach `haulAt` means the others are still nearly empty when it does, so the tour
   * in `_nextStopOrHome` finds nothing to do and every run serves exactly one gate — the
   * bot coupled three carts and behaved exactly as it had with one, which is what the
   * telemetry showed the first time this was tried: longest train 3.0, extra gates 0.0.
   *
   * Leaving on the total means two or three carts each go out part-full and the sixty
   * metres is paid for once. Whichever hold shuts SOONEST is the first stop, because the
   * tour is a queue and the aeroplane leaving first is the one worth reaching first.
   */
  _cartToHaul(st) {
    const live = [];
    for (const c of Object.values(st.cartsById)) {
      if (!c.bagIds.length) continue;
      const flight = st.flightsById[c.placardFlightId];
      if (!flight || flight.evaluated || !isHoldOpen(flight)) continue;
      live.push({ cart: c, flight, shutsAt: flight.times.holdClosingMs });
    }
    if (!live.length) return null;
    live.sort((a, b) => a.shutsAt - b.shutsAt);

    const total = live.reduce((n, r) => n + r.cart.bagIds.length, 0);
    if (total >= this.skill.haulAt) return live[0].cart;

    /*
     * GO EARLY WHEN A TOUR IS ACTUALLY AVAILABLE. Two flights are only both loadable for
     * a couple of short windows in a three-flight shift — AB221 and MC184 overlap for
     * 135 s, MC184 and SK307 for 80 s, AB221 and SK307 never — so a trip that leaves on
     * the usual threshold mostly arrives to find the other cart's hold already shut.
     * That is what the tour counters showed: every rejection, on every seed, was "hold
     * shut", never an empty cart. Leaving at a lower bar while the window is open is the
     * only way the second cart is worth anything.
     */
    if (live.length >= 2 && total >= Math.ceil(this.skill.haulAt * 0.6)) return live[0].cart;

    // Last-chance run: a hold shuts before another load could be filled. Still measured
    // per flight, because it is that flight's deadline that forces the trip.
    for (const r of live) {
      const left = r.shutsAt - st.simTimeMs;
      if (this.skill.lookaheadMs && left < this.skill.lookaheadMs) return r.cart;
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
      const v = this._tractor(st);
      const cart = st.cartsById[this.jobCartId];
      // ON THE TRAIN ANYWHERE IS GOOD ENOUGH. This used to demand the job cart be the
      // ONLY thing on the drawbar, which forced a shed before every trip — and shedding
      // is where this bot has lost every fight it has ever had with itself. See
      // `_hitch` for the policy that replaced it.
      /*
       * Go through `hitch` whenever there is ANYTHING left to couple, not only when the
       * job cart itself is loose. Sending a coupled job straight to `drive` skipped the
       * step that picks up the SECOND loaded cart — so the train left with one live cart
       * and whatever dead ones it was already dragging, and the gate-to-gate tour found
       * nothing to do. Measured, a second gate was genuinely available 4.7 times out of 8
       * and the bot drove past it every time.
       */
      /*
       * ⚠ DO NOT DIVERT HERE TO PICK UP A SECOND CART. It was tried, it works, and it is
       * measurably worse — see COUPLE_DETOUR_M for the numbers. The train still tours the
       * gates when a coupled cart happens to be live (`_nextStopOrHome`), which is free;
       * what does not pay is GOING to fetch one.
       */
      const onTrain = cart && v && this._trainIndex(st, v, cart.id) >= 0;
      this.phase = onTrain ? 'drive' : 'hitch';
      return;
    }

    if (this._walkTo(g, input, v.x, v.y, 1.5)) {
      if (st.player.targetVehicleId === v.id) this._press(input, KEY.interact);
    }
  }

  /** Every cart on the train that still has somewhere to take its load, soonest first. */
  _liveStops(st, v) {
    const out = [];
    for (const id of trainOf(st, v)) {
      const c = st.cartsById[id];
      if (!c || !c.bagIds.length) continue;
      const f = st.flightsById[c.placardFlightId];
      if (!f || f.evaluated || !isHoldOpen(f)) continue;
      const a = st.aircraftById[f.aircraftId];
      if (!a || !a.present || !a.holdOpen) continue;
      out.push({ cart: c, flight: f, shutsAt: f.times.holdClosingMs });
    }
    out.sort((a, b) => a.shutsAt - b.shutsAt);
    return out;
  }

  /** The gate to head for first: the hold that shuts soonest. */
  _firstStop(st, v) { return this._liveStops(st, v)[0] || null; }

  /**
   * A loaded cart worth taking that is NOT yet on the drawbar. Bounded by the cart count,
   * so a cart that cannot be coupled for some reason cannot spin this forever.
   */
  _uncoupledLiveCart(st, v) {
    if (trainOf(st, v).length >= Object.keys(st.cartsById).length) return null;
    let best = null, bestShuts = Infinity;
    for (const c of Object.values(st.cartsById)) {
      if (c.hitchedToId || !c.bagIds.length) continue;
      const f = st.flightsById[c.placardFlightId];
      if (!f || f.evaluated || !isHoldOpen(f)) continue;
      const a = st.aircraftById[f.aircraftId];
      if (!a || !a.present || !a.holdOpen) continue;
      if (f.times.holdClosingMs < bestShuts) { best = c; bestShuts = f.times.holdClosingMs; }
    }
    return best;
  }

  /**
   * Where `cartId` sits in the train behind `v`, or -1 if it is not on it.
   *
   * The whole multi-cart policy hangs off this: "is the cart I want already coupled?"
   * used to be `v.nextCartId === cart.id`, which is only ever true for the first one.
   */
  _trainIndex(st, v, cartId) {
    return trainOf(st, v).indexOf(cartId);
  }

  /**
   * How far behind the TRACTOR CENTRE the cart at index `i` rides, in metres.
   *
   * A cart's tow point is `lengthM/2 + 0.15` behind its centre and the next cart's centre
   * is `linkM` behind that, so the carts sit 3.10 m apart; the first is `towOffsetM +
   * linkM` = 3.05 m behind the tractor. Parking is the only place this matters, and it
   * matters a lot: aim the tractor at the hold door with a three-cart train and the cart
   * that actually stops on the door is the one nine metres back.
   */
  _trailDistance(i) {
    const C = CONFIG.cart;
    return CONFIG.tractor.towOffsetM + C.linkM + i * (C.lengthM / 2 + 0.15 + C.linkM);
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
    /*
     * COUPLE EVERY LIVE LOADED CART BEFORE LEAVING, not just the one this trip is for.
     *
     * A cart only ever became coupled when it was the job, so the train filled up with
     * DEAD carts — the ones whose flight had already departed, still holding its missed
     * bags — while the live second cart sat on its bay. Measured, every single cart the
     * gate-to-gate tour rejected was rejected as `evaluated`: 6.7 of 6.7, on every seed.
     * The tour was looking at the wreckage of the last flight instead of the load for the
     * next one, and reported "no second gate to serve" while a full cart stood at the
     * belt. Couple them at the belt, where they already are, and the tour has something
     * to find.
     */
    if (!cart || cart.hitchedToId) {
      this._hitchMs = 0;
      const more = this._uncoupledLiveCart(st, v);
      if (more) { this.jobCartId = more.id; this.jobFlightId = more.placardFlightId; return; }
      const first = this._firstStop(st, v);
      if (first) { this.jobCartId = first.cart.id; this.jobFlightId = first.flight.id; }
      this.phase = 'drive';
      return;
    }

    /*
     * ⚠ THE TRAIN IS PERMANENT. NOTHING IS EVER SHED.
     *
     * This is the cart-management design the README asked for, and every previous attempt
     * failed on the same rock: a cart RELEASED WHILE STATIONARY sits inside hitch range
     * and the next E picks it straight back up. Working around that produced 591
     * shed-and-recouple cycles in one shift; requiring movement to drop produced a
     * three-cart train parked at 0.07 m/s that could never satisfy the condition and
     * deadlocked with SK307 losing all twelve bags.
     *
     * So stop shedding. Couple each flight's cart once, keep all of them on the drawbar
     * for the whole shift, fill them where they stand at the belt, and tour the gates —
     * unloading whichever cart the current gate wants. `hitchCandidate` measures from the
     * TAIL of the train, so appending is exactly as easy as taking the first one: drive
     * forward until the loose cart is behind the last one.
     *
     * It is also simply better play, which is the point. One sixty-metre run serves two
     * flights instead of one, and the run count stops being the bottleneck the telemetry
     * kept blaming.
     */

    /*
     * In range already? Take it. E while driving hitches whatever the game offers.
     *
     * MEASURED FROM THE TAIL, not from the tractor — `hitchPointOf` is the game's own
     * answer to "where does a new cart couple?", and with a train behind you that is
     * metres from where the tractor is. Measuring from the tractor is why every previous
     * attempt at a second cart concluded it was out of range and drove off again.
     */
    const hp = hitchPointOf(st, v);
    if (Math.hypot(cart.x - hp.x, cart.y - hp.y) < CONFIG.cart.hitchRangeM * 0.85) {
      this._press(input, KEY.grab);
      this.stats.hauls++; this._hitchMs = 0; this._hitchAim = null;
      this.stats.trainLength = Math.max(this.stats.trainLength || 0,
                                        trainOf(st, v).length + 1);
      // An empty cart is worth nothing at the gate. Tow it to the belt and fill it there.
      this.phase = cart.bagIds.length ? 'drive' : 'return';
      return;
    }

    // The line to drive along, captured ONCE on arrival so the target does not swing
    // round the cart as we close on it. Aimed from the HITCH POINT for the same reason
    // the range test is.
    if (!this._hitchAim) {
      const dx = cart.x - hp.x, dy = cart.y - hp.y;
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

    this._driveTo(g, input, past.x, past.y, 0.9, true);   // backing onto the drawbar
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
    // The hold shut, or the aircraft is already rolling. Chasing it is how the bot drove
    // a loaded train into the east perimeter fence at 116.9 m — the park target is
    // derived from the aircraft's position, and the aircraft leaves.
    if (!isHoldOpen(flight) || !ac.holdOpen || !ac.present) { this.phase = 'return'; return; }

    /*
     * PARK THE CART IN THE HOLD VOLUME. Coming in from the road the tractor faces east,
     * so the cart trails west of it — put the tractor east of the door and the cart lands
     * on the door. Standing at the cart then puts the crew both at the cart and inside
     * the hold, which since the M6 interaction fix means E takes from the cart and
     * E-with-a-bag loads the aircraft, with no walking between. Parking well is the
     * skill; this is what the stand geometry was always asking for.
     *
     * PARK THE RIGHT CART ON THE DOOR. With one cart the tractor stops 3 m east and the
     * cart lands on it; with a train, the cart this gate wants may be second or third,
     * six or nine metres further back. `_trailDistance` is that offset, so the tractor
     * parks further east and the correct cart stops where the single cart used to.
     */
    const v = st.vehiclesById[st.player.drivingId];
    const z = aircraftHoldZone(ac);
    const idx = v ? Math.max(0, this._trainIndex(st, v, this.jobCartId)) : 0;
    const target = { x: z.x + this._trailDistance(idx), y: z.y + 1.1 };
    if (this._driveTo(g, input, target.x, target.y, 1.6)) {
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
    if (!ac.holdOpen) { this._nextStopOrHome(st); return; }
    if (!cart.bagIds.length && !p.carryingBagId) { this._nextStopOrHome(st); return; }

    const z = aircraftHoldZone(ac);

    // One standing spot for both halves of the job: at the cart, inside the hold.
    const spot = { x: cart.x, y: cart.y };
    const there = this._walkTo(g, input, spot.x, spot.y, 1.0);

    if (p.carryingBagId) {
      if ((there || holdContains(ac, p.x, p.y)) && p.targetHoldId === ac.id && p.targetHoldOpen) {
        if (this._press(input, KEY.grab)) {
          this.stats.holdLoads++;
          if (this.stats.firstLoadMs === null) this.stats.firstLoadMs = st.simTimeMs;
        }
      } else if (there) {
        // Parked badly: the cart is not in the hold volume after all. Walk it in.
        this._walkTo(g, input, z.x, z.y, 0.6);
      }
      return;
    }

    if (there && p.targetCartId === cart.id) this._press(input, KEY.grab);
  }

  /**
   * TOUR THE GATES. Finished with one cart — is another cart ON THIS TRAIN carrying bags
   * for a hold that is still open? If so, drive there next instead of going home.
   *
   * This is the whole return on a permanent train. One sixty-metre run out and back used
   * to serve exactly one flight; now it serves as many as are coupled and loaded, and the
   * empty legs are paid for once. It costs nothing when the train has one cart, which is
   * what it has for the first minute of every shift.
   *
   * Ordered by how soon each hold shuts, because the tour is a queue and the aircraft
   * leaving first is the one worth reaching first.
   */
  _nextStopOrHome(st) {
    const v = this._tractor(st);
    if (!v) { this.phase = 'return'; return; }

    /* Counted, not guessed. The first version of this tour reported zero extra gates on
     * every seed and there are four different reasons that could happen; a tally at each
     * gate says which, and turned "the tour does not work" into one line to change. */
    const S = this.stats;
    S.tourChecks = (S.tourChecks || 0) + 1;
    const train = trainOf(st, v);
    S.tourTrainSum = (S.tourTrainSum || 0) + train.length;

    /*
     * THE OPPORTUNITY, counted regardless of what is coupled. If this is zero then the
     * SHIFT has no second gate to serve at this moment and no cart policy could have
     * found one — which is a fact about the timetable, not about the bot, and it is the
     * only honest way to answer the README's multi-cart question.
     */
    for (const c of Object.values(st.cartsById)) {
      if (c.id === this.jobCartId || !c.bagIds.length) continue;
      const f = st.flightsById[c.placardFlightId];
      if (!f || f.evaluated || !isHoldOpen(f)) continue;
      S.tourOpportunity = (S.tourOpportunity || 0) + 1;
    }

    const stops = [];
    for (const id of train) {
      if (id === this.jobCartId) continue;
      S.tourOthers = (S.tourOthers || 0) + 1;
      const c = st.cartsById[id];
      if (!c || !c.bagIds.length) { S.tourEmptyCart = (S.tourEmptyCart || 0) + 1; continue; }
      const f = st.flightsById[c.placardFlightId];
      if (!f || f.evaluated) { S.tourEvaluated = (S.tourEvaluated || 0) + 1; continue; }
      if (!isHoldOpen(f)) {
        // BEFORE the hold opens and AFTER it shuts are both "not open", and they mean
        // opposite things: too early is a schedule that does not overlap, too late is a
        // crew that did not get there. Counted apart, because the answer to the README's
        // multi-cart question depends on which one it is.
        if (st.simTimeMs < f.times.loadingMs) S.tourTooEarly = (S.tourTooEarly || 0) + 1;
        else S.tourTooLate = (S.tourTooLate || 0) + 1;
        S.tourShut = (S.tourShut || 0) + 1;
        continue;
      }
      const a = st.aircraftById[f.aircraftId];
      if (!a || !a.present || !a.holdOpen) { S.tourNoAircraft = (S.tourNoAircraft || 0) + 1; continue; }
      stops.push({ cart: c, flight: f, shutsAt: f.times.holdClosingMs });
    }
    if (!stops.length) { this.phase = 'return'; return; }

    stops.sort((a, b) => a.shutsAt - b.shutsAt);
    const next = stops[0];
    this.jobCartId = next.cart.id;
    this.jobFlightId = next.flight.id;
    this.stats.tourStops = (this.stats.tourStops || 0) + 1;
    this.phase = 'toTractor';     // climb back in, then drive; the train stays coupled
  }

  /** A point beside `want` on the side away from `other`, so `findCart` picks `want`. */
  _awayFrom(want, other) {
    const dx = want.x - other.x, dy = want.y - other.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x: want.x + (dx / d) * 1.1, y: want.y + (dy / d) * 1.1 };
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

  /**
   * Drive one frame toward a world point. Same waypointing, plus throttle and steering.
   *
   * @param {boolean} backOnto  what a REVERSE is for here. False (the default) means
   *   TRAVELLING: back up only far enough to get the nose round, then drive off forwards.
   *   True means placing the tow point ON something — hitching — where aiming the
   *   tractor's REAR at the target is the entire objective. Steering the same way for
   *   both is what made this bot reverse fifty metres across a ramp; steering the travel
   *   way for both breaks the hitch instead. They are different manoeuvres.
   */
  _driveTo(g, input, tx, ty, withinM, backOnto = false) {
    const st = g.state;
    const v = st.vehiclesById[st.player.drivingId];
    if (!v) return true;
    if (Math.hypot(tx - v.x, ty - v.y) <= withinM) return true;

    const wp = this._nextWaypoint(v.x, v.y, tx, ty);
    this._lastAim = wp;
    let err = Math.atan2(wp.y - v.y, wp.x - v.x) - v.rot;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;

    /*
     * YAW RATE SCALES WITH SPEED, so a stationary tractor cannot turn at all, and
     * steering without throttle is a deadlock. It is the one the first version of this
     * bot sat in for five minutes of every shift, 84 m from where it wanted to be.
     * Facing away means backing out, which is what a person does too.
     *
     * ⚠ REVERSING IS A MANOEUVRE, NOT A WAY TO TRAVEL. Measured on fifty-two metres of
     * empty ramp (`tools\_route.js`), this bot held the throttle 31% of the time and
     * reverse or brake 69%, with a mean SIGNED speed of 0.03 m/s — travelling backwards
     * almost exactly as far as forwards, at the 3 m/s reverse cap, against a tractor that
     * does 7.00 m/s with the throttle simply held down. Every per-trip cost it has ever
     * reported was about double the real one.
     *
     * The cause: this branch used to steer on the error for the REAR direction, so a
     * target directly behind produced ZERO steering and a dead-straight reverse for
     * however far away it was. Reversing is for getting the NOSE round; yaw inverts in
     * reverse (see `stepVehicle`, `dir` is -1), so the key that turns the nose toward the
     * target is the opposite of the one that would do it going forward. Backing ONTO a
     * drawbar still wants the old behaviour, and says so at the call site.
     *
     * Latched, with separate enter and exit angles, so it cannot chatter against its own
     * threshold; and capped by DURATION rather than by distance, because a cap on
     * distance also bans it in the sort room where the turning circle does not fit.
     */
    const REVERSE_ENTER = 2.0, REVERSE_LEAVE = 0.9, REVERSE_MAX_MS = 2500;
    const facingAway = this._reversing ? Math.abs(err) > REVERSE_LEAVE
                                       : Math.abs(err) > REVERSE_ENTER;
    if (facingAway && (backOnto || (this._reverseMs || 0) < REVERSE_MAX_MS)) {
      this._reversing = true;
      this._reverseMs = (this._reverseMs || 0) + CONFIG.sim.stepMs;
      if (backOnto) {
        const rerr = err > 0 ? err - Math.PI : err + Math.PI;   // aim the TOW POINT at it
        if (rerr > 0.05) input._debugPress(KEY.left);
        else if (rerr < -0.05) input._debugPress(KEY.right);
      } else if (err > 0.05) input._debugPress(KEY.left);       // turn the NOSE toward it
      else if (err < -0.05) input._debugPress(KEY.right);
      input._debugPress(KEY.down);
      return false;
    }
    this._reversing = false;
    // The budget refills while driving forward, so a genuine multi-point turn still
    // works — back, pull forward, back again. What it cannot do is reverse across a ramp.
    this._reverseMs = Math.max(0, (this._reverseMs || 0) - CONFIG.sim.stepMs * 2);
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

  /**
   * Press a verb key, at a HUMAN RATE.
   *
   * `wasPressed` is an edge per simulation step, so a bot that presses every frame acts
   * sixty times a second: a ten-bag cart went into a hold in under a fifth of a second,
   * and the unload leg vanished from the telemetry entirely. That is not a finding about
   * the game, it is the instrument lying. A fast player manages six or seven presses a
   * second; `VERB_GAP_MS` is that, and it applies to E, F and Q alike.
   *
   * Movement keys are held, not tapped, so they do not go through here.
   */
  _press(input, code) {
    this._acted = true;
    this._nextPressMs = this._nextPressMs || {};
    const now = this._nowMs || 0;
    if (this._nextPressMs[code] !== undefined && now < this._nextPressMs[code]) return false;
    this._nextPressMs[code] = now + VERB_GAP_MS;
    input._debugPress(code);
    return true;
  }

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
    // Where everything ended up, for diagnosing a flight that took no bags at all.
    carts: Object.values(g.state.cartsById).map((c) => ({
      id: c.id, placard: c.placardFlightId, bags: c.bagIds.length, hitched: !!c.hitchedToId,
    })),
    /* GDD §28.4's "misses by reason". A total tells you the shift went badly; the reason
     * tells you WHY, and they call for different fixes — bags still on the belt mean the
     * crew never got to them, bags in a cart mean a haul that left too late, and bags
     * never spawned mean the timetable outran the conveyor. */
    missesByReason: Object.values(g.state.bagsById).reduce((acc, b) => {
      if (b.lifecycle !== 'missed') return acc;
      const where = b.location.type === 'conveyor' ? 'still on the belt'
                  : b.location.type === 'cart'     ? 'still in a cart'
                  : b.location.type === 'carried'  ? 'in the hands at the whistle'
                  : b.location.type === 'aircraftHold' ? 'in the wrong hold'
                  : 'loose on the floor';
      acc[where] = (acc[where] || 0) + 1;
      return acc;
    }, {}),
    neverSpawned: Object.values(g.state.flightsById)
      .reduce((t, f) => t + f.expectedCount, 0) - Object.keys(g.state.bagsById).length,
    byLifecycle: Object.values(g.state.bagsById).reduce((acc, b) => {
      const k = `${b.flightId.replace('flight_', '')}:${b.lifecycle}`;
      acc[k] = (acc[k] || 0) + 1; return acc;
    }, {}),
  };
}
