/* The first minute — GDD §16.5.
 *
 * "Use a playable first minute... Then remove the training pauses and allow the live
 * schedule to take over. Offer hints when the player stalls, not mandatory modal
 * explanations."
 *
 * THERE ARE NO TRAINING PAUSES, because there cannot be. The airport never waits
 * (GDD pillar 1, §31.1.7) and a tutorial that stops the clock would be teaching a lie
 * about the only thing the game is about. So the rail is advisory text over a completely
 * live shift: the flights are already running while you learn to pick a bag up.
 *
 * EVERY STEP ASSERTS THE STATE IT WANTED, NEVER THE ROUTE YOU TOOK. The predicates read
 * live game state, so a player who does things out of order collapses the chain forward
 * instead of stalling on a step they already satisfied — learned on Something's Different
 * (M11), where a rail that tracked actions instead of state deadlocked on any unexpected
 * play order.
 */

export const GUIDE_STEPS = [
  {
    id: 'move',
    text: 'Bags arrive on the belt behind you. Move with WASD.',
    hint: 'W A S D, or the arrow keys.',
    done: (s) => s.player.walkedM > 3,
  },
  {
    id: 'grab',
    text: 'Pick a bag up off the floor — stand next to one and press E.',
    hint: 'Get close enough that a white ring appears around the bag.',
    done: (s) => !!s.player.carryingBagId,
  },
  {
    id: 'scan',
    text: 'Press Q to scan it. The tag says which flight it belongs to.',
    hint: 'Q works on the bag in your hands, or the one you are standing at.',
    done: (s) => s.stats.scans > 0,
  },
  {
    /*
     * ⚠ THE RAIL USED TO SKIP STRAIGHT FROM THE TAG TO THE CART, and a player could
     * finish the whole tutorial without ever learning that carts can be LABELLED.
     *
     * Carts start blank, and `loadIntoCart` does not check the placard, so putting a bag
     * in an unmarked cart works — which is why the omission was invisible. But an unmarked
     * cart is just a box: the placard is what makes it "the ATL cart", it is how the
     * scanner can tell you a bag is in the wrong one, and loading a bag onto the wrong
     * aircraft is −250. GDD §7.3 says sorting is "physical placement onto MARKED carts",
     * and the rail was teaching the placement without the marking.
     *
     * It sits here because the order is the lesson: read the tag, label a cart to match
     * it, then put the bag in. F placards the nearest cart whether or not your hands are
     * full, so the player can do this still holding the bag from the step before.
     */
    id: 'placard',
    text: 'Label a cart for that flight — stand at one and press F.',
    hint: 'F cycles the placard through the flights and back to blank. Match the tag.',
    done: (s) => Object.values(s.cartsById).some((c) => !!c.placardFlightId),
  },
  {
    id: 'cart',
    text: 'Now put the bag in the cart you just labelled — walk over and press E.',
    // Was "GATE 1 and GATE 2 are painted on the floor" — which points at the painted
    // staging pads, and those do almost nothing: their only mechanical effect is that
    // the scanner will comment on a bag lying loose on one. The cart's PLACARD is the
    // thing that matters, so the hint names that instead.
    hint: 'The placard on the cart and the tag on the bag should read the same flight.',
    done: (s) => Object.values(s.cartsById).some((c) => c.bagIds.length > 0),
  },
  {
    id: 'drive',
    text: 'When the cart is full, get in the tractor outside the door. Press F.',
    hint: 'The tractor is parked on the apron, east through the doorway.',
    done: (s) => !!s.player.drivingId,
  },
  {
    id: 'hitch',
    /*
     * ⚠ THIS USED TO TEACH REVERSING, WHICH IS THE HARD WAY AND IS NOT NEEDED.
     *
     * `hitchCandidate` measures from the tow point — 1.3 m behind the tractor — out to
     * `hitchRangeM` of 3 m, so a cart you have simply driven PAST is already in range.
     * The old hint said "reverse with S until the cart is close", and reverse-parking a
     * vehicle whose yaw rate scales with speed is a disproportionately hard control
     * problem for something the geometry never asked for: the first version of the crew
     * bot spent 82% of every shift steering backwards in circles and hitched nothing.
     * Teaching a first-timer the technique that defeated the bot is the wrong way round.
     */
    text: 'Drive past a cart so it ends up behind you, then press E to hitch it.',
    hint: 'The hitch is behind the tractor, so drive forward past the cart — no reversing.',
    done: (s) => Object.values(s.cartsById).some((c) => c.hitchedToId),
  },
  {
    id: 'load',
    text: 'Haul it to the gate and put the bags in the hold before it closes.',
    hint: 'Stand inside the green box at the aircraft door and press E.',
    done: (s) => Object.values(s.flightsById).some((f) => f.loadedBagIds.length > 0),
  },
];

/** How long a player may sit on one step before the extra nudge appears. */
export const STALL_MS = 11000;

export function createGuide() {
  return { index: 0, enteredAtMs: 0, complete: false, enabled: true };
}

/**
 * Advance past every step already satisfied, and report what to show.
 * Pure apart from mutating the guide's own cursor — it never touches game state.
 */
export function stepGuide(guide, state) {
  if (!guide.enabled || guide.complete) return null;

  let moved = false;
  while (guide.index < GUIDE_STEPS.length && GUIDE_STEPS[guide.index].done(state)) {
    guide.index++;
    moved = true;
  }
  if (moved) guide.enteredAtMs = state.simTimeMs;

  if (guide.index >= GUIDE_STEPS.length) {
    guide.complete = true;
    return null;
  }

  const step = GUIDE_STEPS[guide.index];
  const stalledFor = state.simTimeMs - guide.enteredAtMs;
  return {
    id: step.id,
    text: step.text,
    // GDD §16.5: hint when the player stalls, rather than explaining up front.
    hint: stalledFor > STALL_MS ? step.hint : null,
    n: guide.index + 1,
    of: GUIDE_STEPS.length,
  };
}

export function resetGuide(guide, enabled = true) {
  guide.index = 0;
  guide.enteredAtMs = 0;
  guide.complete = false;
  guide.enabled = enabled;
  return guide;
}
