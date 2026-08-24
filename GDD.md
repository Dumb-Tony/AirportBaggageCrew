# Airport Baggage Crew

## Master Game Design Document and Claude Development Blueprint

**Document status:** Living design blueprint  
**Initial target:** Standalone desktop-browser game using HTML, CSS, and JavaScript  
**Long-term target:** Online co-op PC game suitable for Steam  
**Working genre:** Chaotic cooperative physical-logistics game / “friendslop”  
**Recommended players:** 1–4 initially; expandable later  

---

## 1. Executive Summary

**Airport Baggage Crew** is a chaotic cooperative game about a small, underqualified ground-handling crew trying to keep an airport’s baggage operation functioning. Flights arrive and depart on a fixed operational schedule. Conveyor belts keep delivering luggage. The airport does not pause because players are confused, understaffed, or cleaning up an earlier mistake.

The game creates comedy and tension by putting extremely simple physical actions inside a relentless logistics system:

> **Grab. Throw. Scan. Drive. Stack. Push a button.**

No individual task should be difficult to understand. The challenge comes from several urgent, interdependent tasks needing attention at the same time. One misplaced suitcase is funny. A whole cart taken to the wrong aircraft becomes a crisis. The crisis does not end the shift; it creates penalties, recovery work, rush bags, passenger claims, and future emergencies while new bags and flights continue to arrive.

The first playable version must be a tightly scoped, single-player browser prototype that proves this emotional arc:

1. “This is easy.”
2. “We should organize.”
3. “Why is Atlanta leaving already?”
4. “That entire cart is Miami.”
5. “Forget it—save Chicago.”

If the prototype can reliably produce that story with two gates, three active flights, roughly fifty physical bags, one tractor, and a few carts, the concept works. Everything after that is escalation.

---

## 2. Product Vision

### 2.1 Player fantasy

The fantasy is not “accurate airport employee simulator.” It is:

> **Four idiots are somehow responsible for keeping an airport running.**

The game should feel credible enough that players invent real procedures, but immediate enough that a new player can contribute within thirty seconds. Players should remember incidents and arguments, not stat builds.

### 2.2 Core design thesis

> **The game generates chaos by giving players simple physical jobs inside a logistics system that never stops moving.**

### 2.3 Design pillars

1. **The airport never waits.** Flight clocks, bag generation, arrivals, and departures continue unless the whole game is explicitly paused.
2. **Physical work, not menus.** Bags, carts, vehicles, holds, and machinery are objects in the play space.
3. **Simple verbs, complex coordination.** Controls remain small; workload, geography, timing, and dependencies create depth.
4. **Mistakes snowball.** Errors create recoverable consequences instead of instant mission failure.
5. **Roles emerge naturally.** Any player can sort, scan, drive, load, unload, or dispatch at any time.
6. **Readable panic.** Players must always understand what is urgent and why, even when they cannot solve everything.
7. **Comedy comes from systems.** Physics, overconfidence, bad packing, wrong assumptions, and conflicting priorities create stories.
8. **Progression adds operational complexity.** New airports and equipment enable new workflows rather than merely increasing numbers.

### 2.4 Anti-pillars

Do not build the game around:

- long menus or spreadsheet management during active play;
- locked character classes;
- frequent hard failure screens;
- long tutorials before physical play begins;
- precision platforming or complicated combat-like controls;
- realism that makes the work slow without producing choices or comedy;
- upgrades dominated by invisible percentage bonuses;
- scripted jokes that replace emergent situations;
- waiting for every bag before a flight may depart.

---

## 3. Audience, Tone, and Session Shape

### 3.1 Target audience

- Friends who enjoy cooperative panic, role improvisation, slapstick physics, and blaming one another affectionately.
- Players of games such as Overcooked, Moving Out, PlateUp!, Unrailed!, Tools Up!, and physics-based co-op games.
- Simulation-curious players who enjoy optimizing flows but do not want a full professional airport simulator.

### 3.2 Tone

Bright, tactile, legible, and slightly absurd. The airport is serious; the crew is not. Operational messaging should sound authoritative, which makes player chaos funnier. Avoid cruelty toward passengers and avoid graphic injury. Collisions produce cartoon ragdolls, dropped tools, lost seconds, and repair costs.

### 3.3 Session model

- **Prototype:** One 8–12 minute continuous shift with a summary report and immediate replay.
- **Early full game:** 12–20 minute shifts, with a short planning/purchasing break between shifts.
- **Later campaign:** A sequence of operating days, contracts, upgrades, airport expansion, and persistent baggage consequences.

An individual flight completing is not a level ending. The next aircraft is already approaching.

---

## 4. Core Gameplay Loops

### 4.1 Moment-to-moment loop

1. Read the flight board, nearby signs, bag tag, or scanner result.
2. Identify the most urgent useful action.
3. Grab or move a bag, cart, scanner, or vehicle.
4. Deliver the object to its next valid processing point.
5. Receive immediate physical, audio, and UI feedback.
6. Reassess because the schedule or workspace has changed.

### 4.2 Departure baggage flow

**Check-in feed → inbound conveyor → scan/identify → sort onto cart → attach cart to tractor → drive to gate → unload cart → load aircraft hold → aircraft departs**

Every step is a potential bottleneck. Scanning is helpful but optional. A bag may be moved without being scanned, and a confident player may be wrong.

### 4.3 Arrival baggage flow

**Aircraft arrives → hold opens → unload to cart → drive to arrivals intake → place on arrival belt → passenger claim resolves**

Arrival baggage is not required in Phase 1 unless time remains after all acceptance criteria pass. It is the first recommended post-MVP system.

### 4.4 Connecting baggage flow

**Arriving aircraft → unload → scan/recognize connection → priority transfer route → departing aircraft**

Connections create urgency across the two flows. They should be introduced after the base departure loop is stable.

### 4.5 Shift loop

1. Review a compact schedule and available equipment.
2. Operate continuously through overlapping flights.
3. Adapt to late bags, errors, equipment placement, and new priorities.
4. Let flights depart on schedule, with or without their correct baggage.
5. Resolve recoverable issues when possible while the shift continues.
6. Receive an operational report: service, accuracy, damage, revenue, penalties, and memorable odd statistics.

### 4.6 Campaign loop

1. Choose contracts appropriate—or wildly inappropriate—for the crew’s capacity.
2. Complete shifts and absorb consequences.
3. Earn revenue and reputation.
4. Pay penalties, repairs, and baggage compensation.
5. Purchase capability-changing equipment and facility upgrades.
6. Unlock airports, airlines, aircraft, baggage types, weather, and disruptions.
7. Deal with persistent lost bags and outstanding trace requests.

---

## 5. The Sacred Schedule

The flight schedule is the game’s primary antagonist and must be deterministic, legible, and independent of player readiness.

### 5.1 Flight lifecycle

Recommended state sequence:

`SCHEDULED → BAG_ACCEPTANCE → LOADING → FINAL_BAG_CALL → HOLD_CLOSING → PUSHBACK → DEPARTED`

Later arrival sequence:

`INBOUND → ON_BLOCK → UNLOADING → TURNAROUND → LOADING → PUSHBACK`

### 5.2 Rules

- Each state transition is driven by simulation time, not task completion.
- A departure may receive a very small, explicitly communicated operational grace window, but never waits indefinitely.
- At hold closing, loose or carted bags can no longer be loaded.
- At departure, the game evaluates every expected bag’s outcome.
- Missed bags remain physical and actionable after the aircraft leaves.
- Wrongly loaded bags travel with the aircraft and generate downstream records.
- New work continues while consequences are reported.

### 5.3 Readability

Urgency must be visible in at least three ways:

- flight board color/status;
- audio announcements and escalating cues;
- local feedback at the gate/aircraft.

Never require the player to memorize an invisible timer.

---

## 6. Physical Interaction Model

### 6.1 Essential verbs

- Move
- Grab / release
- Throw or place
- Interact / use
- Scan
- Enter / exit vehicle
- Drive / brake / reverse

The same context-sensitive interaction input should operate doors, cart hitches, conveyor controls, aircraft holds, and vehicle entry where practical.

### 6.2 Bags

Each bag is a persistent physical game object with identity and operational state. Phase 1 should use lightweight arcade physics rather than a full rigid-body simulation if the latter threatens stability.

Bag properties that affect play:

- destination and assigned flight;
- visible color/tag markings;
- priority;
- weight class;
- current location/container;
- scan history;
- condition;
- handling requirement;
- connection data;
- lost/mishandled status.

Phase 1 uses normal bags plus a limited heavy/priority modifier. Later bags include fragile items, strollers, wheelchairs, golf clubs, skis, surfboards, instruments, bicycles, live animals, medical equipment, VIP/diplomatic baggage, human remains, and cargo.

### 6.3 Weight and awkwardness

- Light/normal bags move at standard speed and throw distance.
- Heavy bags reduce movement speed and throw distance.
- Oversized objects have unusual collision shapes and may require two players later.
- Mishandling can damage fragile items in the full game.

### 6.4 Stacking and spillage

Carts have a capacity by space/weight, not only a hidden bag count. Imperfect stacking is allowed. Fast turns, collisions, or steep movement can spill unsecured or badly placed bags. Phase 1 may implement a simpler stability score if reliable physics stacking is too costly.

### 6.5 Safety and slapstick

Vehicles may bump players and objects. Results should be readable and reversible: brief ragdoll/stun, dropped carried item, scattered bags, and possibly equipment damage. Never use gore or long incapacitation.

---

## 7. Scanning and Sorting

### 7.1 Scanner behavior

The scanner is an optional confidence tool, not a mandatory permission key.

On a successful scan, display briefly:

```text
BAG 004921
FLIGHT 221 · ATLANTA
GATE 2 · PRIORITY
DEPARTS IN 06:14
```

Feedback:

- neutral beep when identifying a bag;
- green confirmation at a correct cart/gate/hold;
- red warning at an incorrect cart/gate/hold;
- stronger alert for imminent connections or final bag call.

Players may ignore warnings. The game should not teleport a wrong bag back or block the action.

### 7.2 Visual recognition

Bag tags should expose a large flight code and color/symbol family so experienced players can work without scanning every item. Colors cannot be the only differentiator; use alphanumeric codes and simple icons for accessibility.

### 7.3 Sorting

Sorting is physical placement onto marked carts or staging zones. A cart may contain mixed destinations. Mixed carts are allowed and often disastrous, but the game records their contents.

### 7.4 Scan history

Each scan creates a timestamped trace event. This supports feedback, debugging, scoring, and the future lost-baggage investigation system.

---

## 8. Carts, Tractors, and Ramp Driving

### 8.1 Baggage carts

- Accept physically placed bags.
- Carry destination placards that players may set or ignore.
- Hitch to a tractor and to other carts.
- May be detached at any valid moment.
- Preserve bag membership and positions while moving.
- Allow players to ride on them later for comedy.

### 8.2 Tractor

- Arcade steering, throttle, reverse, and brake.
- Clear entry/exit prompt.
- Moderate acceleration and forgiving turning at low speed.
- Wider turns and spill risk with longer cart trains.
- Collision response that creates disruption without trapping the vehicle.

### 8.3 Ramp layout

The route between sort room and gates must be long enough that transport planning matters, but short enough that a missed trip does not create dead time. Clear gate markings, vehicle lanes, safety stripes, and aircraft silhouettes support orientation.

### 8.4 Later traffic

Fuel trucks, catering vehicles, buses, maintenance vans, pushback tractors, aircraft, and NPC ground vehicles add moving hazards. Their routes must be telegraphed and collision-safe.

---

## 9. Aircraft Operations

### 9.1 Phase 1 aircraft

Use one stylized regional aircraft type with:

- one baggage hold interaction zone;
- visible door state;
- a spatial loading area or simplified hold inventory visualization;
- scheduled arrival/presence/pushback/departure;
- clear flight and gate identifiers.

A bag counts as loaded only when released inside the valid hold volume. Do not count a bag merely because it touched the aircraft.

### 9.2 Later aircraft tiers

- **Regional:** direct manual loading into a small hold.
- **Narrow-body:** belt loader positioning, conveyor operation, and an internal stacker.
- **Wide-body:** multiple holds, belt loaders, and containerized ULD operations.
- **Cargo aircraft:** forklifts, pallets, heavy cargo, balance constraints.

### 9.3 Loading quality

Later builds may score distribution, fragile handling, priority ordering, and compartment balance. Phase 1 scores only correct flight, before closure, with optional priority bonus.

### 9.4 Arrival unloading

When added, unloading should reuse grab/cart/drive interactions. Turnaround aircraft create direct competition between unloading the arrival and loading the next departure.

---

## 10. Mistakes, Consequences, and Recovery

### 10.1 Principle

Errors should become new gameplay. Hard failure is reserved for rare campaign-level insolvency or a deliberately chosen challenge mode, not a single misplaced bag.

### 10.2 Error examples

| Error | Immediate result | Downstream consequence | Recovery |
|---|---|---|---|
| Bag left in sort room | Flight departs without it | Mishandled bag penalty | Put on later flight as rush bag |
| Bag on wrong aircraft | Wrong destination recorded | Compensation/reputation loss | Return routing on future arrival |
| Whole cart at wrong gate | Correct flight starved | Multiple likely misses | Detach, reroute, triage priorities |
| Bag falls from cart | Bag remains on ramp | Time loss; possible damage | Find and retrieve it |
| Priority bag loaded late | Service target missed | Lower score/contract penalty | Limited after departure |
| Vehicle collision | Bags scatter/player stunned | Delay and repair cost | Recover equipment and bags |
| Connection missed | Bag stranded | Rush-transfer task | Route through next compatible flight |

### 10.3 Recovery states

Every unresolved bag should move into one explicit state:

- waiting for active flight;
- loaded correctly;
- loaded incorrectly;
- missed departure;
- rush/rebooked;
- at baggage claim;
- trace requested;
- lost warehouse;
- resolved/returned.

### 10.4 Triage

The player should sometimes rationally abandon low-value work to save a priority connection or a nearly complete flight. Scoring must reward intelligent triage enough that a messy shift can still feel successful.

---

## 11. Scoring and Shift Report

### 11.1 Live feedback

Keep the active HUD focused on operational information. Small score popups may acknowledge correct loads, but avoid turning the screen into an arcade combo counter.

Suggested values for the prototype:

- Correct bag loaded before hold closure: `+100`
- Priority bag correctly loaded: additional `+50`
- Wrong-aircraft load at departure: `-250`
- Bag misses its flight: `-150`
- Correct bag left loose on dangerous ramp area: optional small penalty
- Collision/equipment damage: `-50` to `-300`
- Flight with 100% correct expected bags: completion bonus

Tune values through playtesting; the relative cost of a wrong destination should exceed a simple miss.

### 11.2 Service metrics

- flights handled;
- flights fully serviced;
- bags expected;
- bags correctly loaded;
- on-time baggage percentage;
- mishandled bags;
- wrong-destination bags;
- priority bags missed;
- damaged bags/equipment;
- caused delays, if later supported;
- revenue, penalties, and profit in campaign mode.

### 11.3 Comedy statistics

Include one or two shift-specific facts, such as:

- bags sent to a completely wrong country;
- longest loose suitcase journey;
- cart corners taken above safe speed;
- number of times the scanner was dropped;
- most confidently mishandled flight.

Do not let comedy stats obscure core performance.

---

## 12. Persistent Lost Baggage

The lost-baggage system is a signature long-term feature, not a Phase 1 requirement.

### 12.1 Persistent warehouse

Truly unresolved bags accumulate in a physical warehouse across shifts. The space becomes a visible archive of the crew’s failures. Each bag keeps its identity, appearance, last known scan, route history, and owner/claim metadata.

### 12.2 Trace requests

Occasional tasks ask players to locate a specific bag using partial information:

```text
BAG TRACE REQUEST
Passenger: J. Alvarez
Tag ending: 921
Color: Pink
Last scan: Terminal B, three days ago
```

Players search, scan candidates, and route the recovered bag. This creates a slower scavenger-hunt variation without replacing the main airport loop.

### 12.3 Technical rule

Do not save full physics transforms for hundreds of warehouse bags forever. Persist compact bag records and reconstruct deterministic shelf/bin placement when the warehouse loads.

---

## 13. Roles Without Classes

Likely roles include sorter, cart driver, ramp agent, loader, unloader, and dispatcher. These are behaviors, not character selections.

Rules:

- Every player has the same verbs and baseline capabilities.
- Equipment, location, and immediate need determine a player’s role.
- No role-specific skill tree may make another player unable to take over.
- Players should be able to hand off work simply by dropping a tool or leaving a vehicle.
- UI should support coordination with flight-colored pings and concise callouts later, without automating decisions.

Good play should look like a self-organized procedure until an interruption forces everyone to improvise.

---

## 14. Progression, Economy, and Contracts

### 14.1 Progression philosophy

Progression grants capabilities, throughput, and new operational problems. Prefer “buy a covered cart” over “+12% rain resistance.”

### 14.2 Ground-handling company

The crew operates a questionable ground-handling business. Airlines offer contracts with:

- daily/shift flight volume;
- aircraft mix;
- expected bag volume;
- accuracy and on-time requirements;
- special handling requirements;
- revenue, bonuses, and penalties;
- reputation gates.

Players choose whether their equipment and crew can support the work. Overcommitting should be allowed.

### 14.3 Capability upgrades

- additional and faster tractors;
- more carts and covered carts;
- belt loaders;
- forklifts and cargo dollies;
- portable/rugged scanners;
- radio and dispatch stations;
- conveyor branches and automatic sorters;
- maintenance support;
- weather equipment;
- expanded lost-baggage storage.

### 14.4 Economy

`Gross contract revenue + service bonuses − mishandling penalties − compensation − equipment repairs − operating costs = shift profit`

Avoid a punishing death spiral. If the company is struggling, offer a small regional recovery contract, leased basic equipment, or insurer/bank rescue with a meaningful but recoverable cost.

### 14.5 Airport progression

1. **Tiny Regional:** two gates, one bag room, direct routes, regional aircraft.
2. **Municipal:** four to six gates, arrivals, connecting bags, belt loaders, more vehicle traffic.
3. **Metro Hub:** multiple concourses, baggage tunnels, remote stands, weather disruptions, airline contracts.
4. **International:** terminals, customs/international baggage, wide-bodies, ULDs, cargo, hundreds of bags, layered failures.

---

## 15. Events, Weather, and Operational Escalation

### 15.1 Event design rules

- Events modify existing work; they should not become unrelated minigames.
- Telegraph an event before its most damaging effect when reasonable.
- Provide at least one meaningful response.
- Rare nightmare events must remain rare enough to feel frightening.
- Event stacking should be controlled by a director, not purely random.

### 15.2 Weather

- **Rain:** slippery driving, reduced grip, uncovered baggage risk.
- **Wind:** empty carts roll, light bags shift or blow, equipment positioning becomes harder.
- **Snow:** slower vehicles; delays compress several departures into the same window.
- **Thunderstorm:** ramp temporarily closes while belts continue feeding the room, creating a backlog.

Delays should often bunch work together rather than merely grant more time.

### 15.3 Equipment failures

- conveyor jam;
- tractor breakdown;
- scanner battery/network outage;
- belt loader misalignment/failure;
- power loss;
- automatic sorter failure.

### 15.4 Nightmare events

- **Baggage System Failure:** all bags enter one pile/manual flow.
- **Scanner Network Offline:** printed tags only.
- **Gate/Aircraft Change:** already-staged bags must move.
- **Mass Delay Release:** several aircraft become urgent together.
- **Lost Bag Trace:** locate a specific physical bag.
- **VIP Arrival:** high-stakes baggage enters an already stressed system.

Nightmare events are post-MVP.

---

## 16. UI and UX

### 16.1 HUD hierarchy

The player needs four answers at a glance:

1. What am I holding or targeting?
2. Which flight is most urgent?
3. Where does this bag belong?
4. What changed?

### 16.2 Phase 1 HUD

- top-center or top-left compact flight board showing 3–4 flights;
- active flight status, gate, time remaining, expected/loaded/missing count;
- contextual interaction prompt near the reticle/player;
- scanner card only while scanning;
- held-object indicator;
- small score/accuracy area;
- announcement/event toast;
- pause/settings access.

### 16.3 Flight board colors

- calm/blue: scheduled;
- green: loading with adequate time;
- amber: approaching final bag call;
- red/pulsing: final bag call/hold closing;
- gray: departed;

Color must be reinforced by text and icons.

### 16.4 World signage

Use large gate numbers, destination boards, floor markings, cart placards, and aircraft labels. The world should carry information so players do not live inside the HUD.

### 16.5 Onboarding

Use a playable first minute:

1. Move to a highlighted bag.
2. Grab it.
3. Scan it.
4. Put it on the matching cart.
5. Drive to the matching gate.
6. Load it.

Then remove the training pauses and allow the live schedule to take over. Offer hints when the player stalls, not mandatory modal explanations.

### 16.6 Accessibility

- remappable keyboard controls in the full product;
- keyboard-only operation supported in Phase 1;
- colorblind-safe symbols and codes;
- adjustable screen shake, camera motion, flashing, and volume categories;
- readable text scaling;
- optional hold/toggle for grab and acceleration;
- subtitle/visual equivalents for all operational audio;
- difficulty assists that alter schedule pressure without changing core verbs.

---

## 17. Controls

### 17.1 Recommended Phase 1 keyboard/mouse controls

| Action | Input |
|---|---|
| Move | WASD or arrow keys |
| Aim/face | Mouse position or movement direction |
| Grab/release | E or left mouse |
| Scan | Q or right mouse |
| Interact / enter / hitch | F |
| Throw | Hold and release left mouse, or Space while carrying |
| Vehicle throttle/reverse | W/S |
| Vehicle steer | A/D |
| Brake | Space |
| Pause | Escape |

For a top-down prototype, favor reliable object selection and movement over elaborate mouse aiming. If grab and throw conflict, use `E` for grab/release and mouse/Space for charged throw.

### 17.2 Future controller

Left stick move/steer, right stick aim, face button grab/release, trigger scan, face button interact, trigger throw. Add controller only after keyboard/mouse acceptance criteria pass.

---

## 18. Audio Direction

Audio is functional first and comedic second.

### 18.1 Essential cues

- distinctive scanner beep, correct chirp, and wrong buzz;
- conveyor motor and bag arrival thumps;
- escalating flight announcements;
- tractor motor, hitch clank, braking/skid, collisions;
- aircraft hold closing and pushback cues;
- score/penalty confirmation kept subtle;
- crowd/ramp ambience.

### 18.2 Dynamic pressure

Music may add layers as urgent flights overlap, but should not become exhausting. The soundscape should communicate state even when the player is looking elsewhere. Every critical cue also needs a visual equivalent.

### 18.3 Voice and announcements

Use concise synthetic/recorded-style airport announcements. Avoid a huge voice pipeline in Phase 1; text plus simple generated placeholder sounds are sufficient.

---

## 19. Visual Direction

### 19.1 Phase 1

Use a clean, stylized top-down or 2.5D presentation built with Canvas 2D. Shapes may be simple, but silhouettes and operational colors must be immediately readable:

- bags as varied rounded rectangles with visible tag stripe/icon;
- carts as open frames with clear contents;
- tractor with obvious front and hitch;
- aircraft as large, unmistakable silhouettes;
- gates with oversized numbers and matching boards;
- conveyor and hold zones with animated affordances;
- characters with squash, recoil, and brief stun animation.

### 19.2 Long-term

Chunky stylized 3D, exaggerated but recognizable airport equipment, expressive workers, bright safety markings, and satisfying physical reactions. Favor clarity with many objects on screen. Avoid photorealism.

### 19.3 Camera

Prototype: fixed or gently following top-down camera showing enough route context to plan. Avoid aggressive zoom and rotation. Long-term: third-person or elevated isometric camera to be decided through prototypes.

---

## 20. Phase 1: Standalone Browser Prototype

### 20.1 Purpose

Prove the schedule-driven physical logistics loop is fun and legible. Do not prove campaign depth, multiplayer networking, realistic aircraft operations, or international airport scale.

### 20.2 Required scope

**Map**

- one compact regional airport;
- one sorting room with one continuously operating baggage conveyor;
- one staging/tractor area;
- two gates with clear physical routes;
- one simple ramp space;
- no interiors beyond the functional baggage room.

**Player**

- one local player;
- top-down movement;
- grab, carry, release/throw, scan, interact;
- enter/exit and drive tractor;
- brief collision/stun feedback if implemented.

**Bags**

- roughly 40–60 bags across a shift;
- persistent unique IDs;
- flight, destination, gate, priority, weight class, current state;
- visible tags/codes;
- optional scanning;
- physical placement on floor, cart, and aircraft hold;
- no fragile damage system required.

**Equipment**

- one conveyor that emits bags according to the schedule;
- one handheld scanner owned/carried abstractly by the player or always available;
- one drivable tractor;
- two or three hitchable baggage carts;
- two aircraft hold zones.

**Schedule**

- at least three departing flights during one 8–12 minute shift;
- at least two overlapping active flights;
- flight states progress on simulation time;
- final bag call and departure occur regardless of readiness;
- bag arrival order includes pressure peaks and at least a few late bags.

**Consequences and scoring**

- correct loads counted;
- wrong aircraft loads accepted physically and penalized at departure;
- missed bags remain in the world and are penalized;
- priority bag bonus/penalty;
- no instant failure from baggage errors;
- end-of-shift report with core metrics and replay button.

**UX**

- flight board;
- contextual prompts;
- scan result card;
- visible gate/aircraft labels;
- audio/visual urgency cues;
- pause and restart;
- short in-world onboarding.

### 20.3 Explicitly out of scope for Phase 1

- networking or multiplayer;
- Steam integration;
- campaign, contracts, money, or purchasing;
- save progression beyond settings/best report;
- arrivals and connections, unless added only after all MVP tests pass;
- weather;
- NPC traffic;
- equipment breakdowns/nightmare events;
- belt loaders, forklifts, ULDs, cargo;
- multiple airports or aircraft types;
- lost-baggage warehouse;
- character customization;
- procedural terminal generation;
- full 3D, WebGL engine dependency, or realistic rigid-body physics;
- mobile/touch support;
- online accounts, servers, backend, analytics, or monetization.

### 20.4 Recommended authored shift

Use a deterministic default seed for testing and optional random variations for replay.

| Flight | Destination | Gate | Load window | Bag count | Twist |
|---|---|---:|---:|---:|---|
| AB221 | Atlanta | 1 | early | 14–18 | Tutorial-friendly first flow |
| MC184 | Chicago | 2 | overlaps AB221 | 14–18 | Several heavy bags |
| SK307 | Miami | 1 | begins before Chicago departs | 14–20 | Priority bags arrive late |

Flights may reuse a gate only after the prior aircraft clears. Adjust exact timings until a competent solo player can achieve approximately 75–90% accuracy on an early run and near-perfect performance with practice.

### 20.5 Fun threshold

The MVP succeeds when players voluntarily start staging carts by destination, taking transport risks, skipping scans due to confidence, and making meaningful triage decisions under time pressure.

---

## 21. Technical Architecture for HTML/JavaScript

### 21.1 Delivery constraints

- Runs by opening `index.html` or through a minimal local static server.
- No build step required for the first delivery unless a build tool materially improves reliability.
- No external network dependency at runtime.
- Desktop Chrome, Edge, and Firefox are primary browsers.
- Use Canvas 2D for game rendering and DOM/CSS for crisp interface panels.
- Use plain JavaScript ES modules.
- Prefer generated shapes and small local audio assets over remote libraries/assets.

### 21.2 Suggested file structure

```text
airport-baggage-crew/
  index.html
  styles.css
  README.md
  src/
    main.js
    config.js
    game.js
    core/
      clock.js
      input.js
      eventBus.js
      stateMachine.js
      rng.js
    entities/
      player.js
      bag.js
      cart.js
      tractor.js
      aircraft.js
      conveyor.js
    systems/
      flightSchedule.js
      baggageFlow.js
      interaction.js
      physics.js
      scoring.js
      announcements.js
      save.js
    render/
      renderer.js
      camera.js
      effects.js
    ui/
      hud.js
      flightBoard.js
      scannerCard.js
      shiftReport.js
    data/
      flights.js
      tuning.js
    dev/
      debugOverlay.js
  tests/
    schedule.test.js
    scoring.test.js
    baggageState.test.js
```

Small implementations may combine files, but keep the boundaries conceptually intact.

### 21.3 Simulation loop

- Fixed-step simulation, recommended `1/60` second with accumulated real time.
- Render using `requestAnimationFrame` with interpolation if needed.
- Clamp extreme frame gaps after tab suspension.
- A single `GameClock` owns simulation time and pause/time-scale state.
- Schedule events use simulation timestamps, never scattered browser timers.
- Pausing freezes the simulation clock, flight timers, entities, and bag emission together.

### 21.4 State ownership

Use one authoritative `GameState` containing IDs and serializable state. Renderers and UI observe state; they do not own game rules. Entities should reference other entities by ID rather than nested circular object graphs.

Recommended top-level shape:

```js
const gameState = {
  version: 1,
  seed: 12345,
  mode: "playing",
  simTimeMs: 0,
  shift: { id: "regional_day_1", endTimeMs: 600000 },
  player: {},
  bagsById: {},
  cartsById: {},
  vehiclesById: {},
  aircraftById: {},
  flightsById: {},
  world: {},
  score: {},
  announcements: [],
  settings: {}
};
```

### 21.5 Events

Use domain events for important transitions:

- `BAG_SPAWNED`
- `BAG_SCANNED`
- `BAG_PLACED_IN_CART`
- `BAG_ENTERED_HOLD`
- `BAG_LEFT_HOLD`
- `FLIGHT_STATE_CHANGED`
- `FLIGHT_DEPARTED`
- `BAG_MISROUTED`
- `BAG_MISSED`
- `SCORE_CHANGED`

The event log assists UI, scoring, save migrations, deterministic debugging, and eventual network replication. Avoid implementing an elaborate event-sourcing framework for the MVP.

### 21.6 Collision and containment

Use simple circles/AABBs or oriented rectangles. Bags inside carts may be represented by local positions attached to the cart rather than continuously resolving full rigid-body collisions. A bag changes container only through explicit containment checks on release. Preserve a single invariant: a bag has exactly one authoritative location mode.

### 21.7 Determinism

Use a seeded RNG for flight bag composition, spawn order, and minor variations. Store the seed in reports and debug output. Do not use `Math.random()` directly in gameplay systems.

### 21.8 Debug tools

Provide a hidden debug overlay/toggles for:

- simulation time and FPS;
- flight state/timers;
- bag counts by state and flight;
- selected entity ID and container;
- collision/interaction bounds;
- time scale and skip-to-next-event;
- spawn test bag;
- force departure;
- deterministic seed.

Debug tools must not be mixed into player-facing UI.

---

## 22. Data Models

### 22.1 Bag

```js
{
  id: "bag_004921",
  flightId: "flight_AB221",
  destinationCode: "ATL",
  gateId: "gate_1",
  priority: true,
  weightClass: "normal",
  handling: [],
  appearance: { color: "pink", icon: "triangle", size: "medium" },
  location: { type: "conveyor", id: "conv_1", localX: 0 },
  lifecycle: "active",
  condition: "ok",
  scanHistory: [],
  expectedDepartureMs: 210000,
  actualFlightId: null
}
```

Valid `location.type` values include `conveyor`, `floor`, `carried`, `cart`, `aircraftHold`, `departed`, and later `arrivalBelt`, `warehouse`, or `transit`.

### 22.2 Flight

```js
{
  id: "flight_AB221",
  number: "AB221",
  destinationCode: "ATL",
  destinationName: "Atlanta",
  gateId: "gate_1",
  aircraftId: "aircraft_1",
  state: "LOADING",
  times: {
    bagAcceptanceMs: 30000,
    loadingMs: 60000,
    finalCallMs: 180000,
    holdClosingMs: 210000,
    departureMs: 225000
  },
  expectedBagIds: [],
  loadedBagIds: [],
  evaluated: false
}
```

### 22.3 Cart

```js
{
  id: "cart_1",
  transform: { x: 0, y: 0, rotation: 0 },
  bagIds: [],
  capacityWeight: 300,
  placardFlightId: null,
  hitchedToId: "tractor_1",
  nextCartId: null,
  stability: 1
}
```

### 22.4 Trace event

```js
{
  id: "trace_123",
  bagId: "bag_004921",
  type: "SCAN",
  simTimeMs: 104233,
  locationId: "sort_room",
  actorId: "player_1",
  metadata: {}
}
```

### 22.5 Content definitions

Keep airports, flight templates, bag types, events, aircraft, and tuning values data-driven. Content records may refer to registered behaviors by stable string keys; do not put functions inside save data.

---

## 23. Save System

### 23.1 Phase 1

Use `localStorage` for:

- settings;
- onboarding complete flag;
- best shift report/high score;
- last selected seed if useful.

Do not promise mid-shift saves in Phase 1.

### 23.2 Later campaign saves

Use versioned JSON containing company state, contracts, equipment ownership, airport unlocks, reputation, persistent bag records, and shift history summaries. Store only essential world state. Reconstruct static maps and deterministic warehouse placement from definitions.

Include:

- `schemaVersion`;
- save timestamp;
- content version;
- migration functions for older versions;
- validation and fallback to backup;
- export/import JSON option for browser builds.

For Steam, place the same serialized model behind a platform storage adapter supporting local files and Steam Cloud.

---

## 24. Performance and Robustness

### 24.1 Prototype targets

- 60 FPS target on a typical modern laptop at 1080p;
- remain playable at 30 FPS;
- 100 active bags without material degradation, even if authored gameplay uses fewer;
- no unbounded DOM nodes, event listeners, particles, or trace logs;
- no per-frame full-array searches where indexed maps/sets suffice;
- pool short-lived visual effects if profiling shows allocation spikes.

### 24.2 Spatial efficiency

Use a simple uniform spatial grid for nearby interaction and collision queries once entity count warrants it. UI updates should be event-driven or throttled rather than reconstructing all panels every frame.

### 24.3 Failure safety

- Clamp objects back into navigable bounds if numerical errors eject them.
- Provide a recover/stuck action for tractor and player.
- Prevent bags from becoming unreachable behind aircraft/world geometry.
- Validate location/container invariants in development builds.
- On browser focus loss, automatically pause by default.

---

## 25. AI and NPC Considerations

### 25.1 Phase 1

No AI coworkers are required. The authored flight schedule and conveyor are the opposition.

### 25.2 Later NPC traffic

Use waypoint/lane graphs with reservations at intersections. NPC vehicles need predictable behavior, strong telegraphs, and recovery from blockage. They are moving constraints, not adversarial hunters.

### 25.3 Optional solo assistants

If added, assistants should accept high-level assignments such as “move Gate 2 carts” or “unload arrivals,” then perform only basic jobs. They should not perfectly optimize the entire operation. Player-readable states—idle, fetching, loading, blocked—are essential.

### 25.4 Passengers

Passengers need not occupy the active ramp. Their presence is represented through claims, announcements, ratings, and baggage consequences. This keeps scope on ground operations.

---

## 26. Multiplayer Roadmap

Do not add networking until the single-player simulation is fun, deterministic enough to debug, and separated cleanly from rendering/input.

### Stage A: Local multi-input prototype

- two local players if the camera and interactions support it;
- same abilities and no classes;
- test object contention and vehicle ownership.

### Stage B: Network architecture prototype

- authoritative host/server simulation;
- clients send input/interaction intents;
- server owns flight clock, bag containment, scoring, and departures;
- snapshot interpolation for transforms;
- reliable ordered messages for grabs, releases, hitches, container changes, and flight state;
- entity IDs stable across peers;
- late join receives full snapshot plus current schedule.

### Stage C: Online co-op productization

- 1–4 players;
- lobby, invitations, join codes, reconnect;
- ping/latency handling;
- host migration or explicit graceful session loss;
- voice-chat integration optional; quick pings required;
- grief controls and private/friends-only defaults;
- Steamworks adapter for invites, achievements, cloud saves, and presence.

### Networking cautions

- Do not synchronize full uncontrolled bag rigid-body physics at high frequency.
- Use authoritative discrete attachment/container states with approximate transform sync.
- Never derive the sacred departure clock independently on each client.
- Resolve simultaneous grabs on the authority and give immediate feedback to the losing client.

---

## 27. Content Roadmap

### Release 0: Phase 1 browser proof

Single regional map, departures only, three flights, bags, scanning, sorting, carts, tractor, loading, schedule, mistakes, report.

### Release 1: Strong vertical slice

- arrivals and aircraft turnaround;
- connecting/rush bags;
- one additional aircraft/loading method;
- local co-op experiment;
- stronger physics feedback and polished audio;
- first equipment failure;
- basic save/settings.

### Release 2: Replayable browser game

- multiple authored shifts and difficulty presets;
- special baggage;
- light weather;
- random but directed disruptions;
- basic company/contracts layer;
- equipment purchases;
- expanded scoring and unlocks.

### Release 3: Online co-op alpha

- authoritative network play;
- 1–4 players;
- municipal airport;
- NPC traffic;
- reconnect and multiplayer usability;
- persistent profile/campaign schema.

### Release 4: Steam vertical slice

- packaged desktop client;
- Steam lobby/invites/cloud/achievements as appropriate;
- controller support;
- accessibility/settings polish;
- performance and crash telemetry with consent;
- lost-baggage warehouse prototype;
- content pipeline suitable for more airports.

### Long-term expansion

International terminals, baggage tunnels, wide-body aircraft, ULDs, cargo, customs, multiple ramps, snow operations, airline contract portfolios, large-scale nightmare events, and hundreds of persistent bags.

---

## 28. Testing Strategy

### 28.1 Automated unit tests

Test pure logic for:

- flight state transitions at exact boundaries;
- pause and time-gap behavior;
- bag spawn schedule;
- correct/wrong/missed classification;
- score calculation;
- bag location invariant;
- seeded RNG reproducibility;
- save parsing/version migration;
- cart hitch chain validation.

### 28.2 Simulation tests

- Run a complete shift without input; all flights still depart and all bags receive a final classification.
- Load every bag correctly; report is accurate and no bag is double-counted.
- Load every bag on the wrong aircraft; departures proceed and penalties are recorded.
- Pause just before departure; no scheduled state advances until unpaused.
- Suspend/resume the browser tab; no enormous unbounded simulation catch-up occurs.
- Remove a bag from a hold before closure; it is not counted as loaded.
- Place a bag across overlapping zones; it has exactly one location owner.

### 28.3 Usability playtests

Observe without coaching:

- Can a new player move and grab a bag within 20 seconds?
- Can they identify a bag’s flight within 45 seconds?
- Can they load a correct aircraft within two minutes?
- Do they understand that the plane will leave?
- Can they explain why a bag was penalized?
- Do they begin forming a cart/sorting strategy?
- Do errors feel recoverable rather than arbitrary?
- Is the board readable during a crisis?

### 28.4 Balance telemetry during development

Keep local debug summaries for time-to-load, queue length, cart trips, scan rate, misses by reason, and player idle/travel time. Do not add external analytics to the MVP.

---

## 29. Phase 1 Acceptance Criteria

The Phase 1 build is complete only when all required criteria pass.

### Functional

- The game loads into a playable shift with no external services.
- The player can move, grab, carry, release/throw, and scan bags.
- The conveyor emits the authored bags over time.
- Each bag has a unique identity and correct flight assignment.
- Bags can be placed into and removed from carts.
- A tractor can hitch carts, drive between sort room and gates, and detach them.
- Bags released in the correct open aircraft hold are loaded.
- Bags can also be loaded into the wrong open aircraft; the game does not block the mistake.
- At least three flights progress and depart on schedule without waiting for the player.
- At least two flights create overlapping demands.
- Final bag call and hold closure are communicated visibly and audibly.
- Missed and wrong-flight bags are classified once, without double counting.
- The shift ends with an accurate report and can be replayed.

### UX

- A first-time player can complete the basic loop without reading a separate manual.
- Flight, gate, countdown, and bag destination are legible at normal desktop resolution.
- Color is not the only information channel.
- Pausing stops the entire simulation consistently.
- Restart resets every entity and timer cleanly.

### Quality

- No known blocker can make a required bag permanently unreachable.
- No known duplication or deletion of bag identity occurs during normal play.
- A ten-minute shift runs without uncaught errors.
- Performance remains playable with 100 spawned bags.
- Core schedule/scoring tests pass.
- README explains how to launch, controls, scope, and known limitations.

### Design validation

- At least three external playtesters understand that the airport will not wait.
- At least two report a memorable unscripted mistake or recovery.
- Repeated play produces improved organization or routing.
- Pressure comes from overlapping simple work, not confusing controls.

---

## 30. Development Milestones

### Milestone 0: Skeleton and design locks

- Create file structure, render loop, fixed simulation clock, input, map bounds, debug overlay.
- Encode the Phase 1 scope and out-of-scope list in README.
- Exit criterion: stable blank simulation, pause/restart, deterministic seed.

### Milestone 1: The bag feels good

- Player movement, target selection, grab/carry/release/throw.
- Bag identity, basic collision/containment, conveyor spawn.
- Scanner result UI and tag readability.
- Exit criterion: moving and sorting ten bags is reliable and pleasant.

### Milestone 2: Transport

- Carts, containment, placards, hitching.
- Tractor entry/exit and arcade driving.
- Ramp route and gate staging zones.
- Exit criterion: a full cart can travel to either gate without state corruption.

### Milestone 3: Sacred schedule

- Flight definitions and state machine.
- Aircraft arrival/presence, hold opening/closing, departure.
- Flight board and announcements.
- Exit criterion: a no-input shift completes deterministically.

### Milestone 4: Outcomes and pressure

- Correct/wrong/missed evaluation.
- Priority bags and authored overlapping schedule.
- Scoring, report, replay.
- Exit criterion: full acceptance tests for all outcome paths pass.

### Milestone 5: Onboarding and juice

- Context prompts, first-minute hints, better audio/visual feedback.
- Collision/spill polish if stable.
- Accessibility basics and settings.
- Exit criterion: uncoached playtesters complete the core loop.

### Milestone 6: Balance and hardening

- Tune timings, bag counts, route length, and score.
- Profile 100 bags; fix unreachable/stuck cases.
- Cross-browser testing and README.
- Exit criterion: all Phase 1 acceptance criteria pass.

Do not begin later content merely because a milestone feels visually plain. First close its exit criteria.

---

## 31. Implementation Instructions for Claude

### 31.1 Operating rules

1. Treat this document as the product and architecture brief, but report contradictions or infeasible details rather than silently inventing scope.
2. Build only Phase 1 until every Phase 1 acceptance criterion passes.
3. Keep future systems represented by clean data boundaries and interfaces, not half-built features.
4. Produce a playable increment at every milestone.
5. Favor reliable arcade behavior over elaborate physics.
6. Keep schedule logic independent from rendering and wall-clock timers.
7. Never make a flight wait for task completion.
8. Never prevent a player from making a wrong load solely to protect their score.
9. Never use a misplaced bag as an instant loss condition.
10. Use stable IDs and a single authoritative bag location.
11. Add or update tests whenever schedule, scoring, or containment rules change.
12. Update README and a short changelog after each milestone.
13. Before adding a dependency, explain why built-in browser APIs are insufficient.
14. Avoid remote assets and runtime network calls.
15. Keep all tuning values in central data/config files.

### 31.2 Required workflow for each milestone

1. Restate the milestone’s exact scope and exit criterion.
2. Inspect existing code and list the files to change.
3. Implement the smallest coherent vertical slice.
4. Run automated tests and a local smoke test.
5. Check the browser console for errors.
6. Verify pause, restart, and deterministic behavior when relevant.
7. Summarize what works, known limitations, and the next milestone.
8. Stop and request review if the exit criterion is not met; do not bury failures under new features.

### 31.3 Code quality expectations

- Clear names and small modules.
- Comments explain non-obvious invariants, not obvious syntax.
- No duplicated flight-time rules across UI and simulation.
- No scoring logic inside renderer/UI code.
- No entity ownership hidden in DOM elements.
- No per-entity browser timers.
- No mutable global state outside the game bootstrap/config boundary.
- Defensive handling for missing entity references.
- Development assertions for illegal bag locations or duplicate containment.

### 31.4 Decisions Claude may make autonomously

- Exact visual layout and placeholder art style within the readability direction.
- Exact key bindings if documented and consistent.
- Exact authored timings and bag counts during balance passes.
- Whether simple physical containment or abstract local cart slots are more stable.
- File/module granularity.
- Test runner choice, provided launch remains simple and offline.

### 31.5 Decisions that require explicit approval

- changing the core camera/presentation away from top-down Canvas 2D;
- adding frameworks, engines, package-heavy build systems, or online services;
- adding multiplayer before Phase 1 completion;
- removing physical carts/tractor/loading from Phase 1;
- making flight departures completion-dependent;
- replacing physical play with menus;
- materially expanding Phase 1 scope;
- adding monetization or account systems.

---

## 32. Copy-Paste Prompts for Claude

### Prompt A: Start the project

```text
You are implementing Airport Baggage Crew from the attached Master GDD. Read the entire GDD before coding. Build only Milestone 0 and do not begin later gameplay systems.

Create a standalone HTML/CSS/JavaScript project that runs locally with no runtime network dependency. Use Canvas 2D for the world and DOM/CSS for the interface. Establish the fixed-step simulation clock, input abstraction, seeded RNG, game state boundary, pause/restart behavior, simple airport map bounds, and a development-only debug overlay. Add a README that states the Phase 1 scope and explicit out-of-scope list.

Before implementing, summarize the milestone scope, proposed files, and key invariants. After implementing, run the relevant tests/smoke checks and report exact results, known limitations, and whether the milestone exit criterion is met. Do not add bags, carts, flights, multiplayer, campaign systems, weather, or other future content yet.
```

### Prompt B: Continue one milestone

```text
Continue the Airport Baggage Crew implementation using the Master GDD. Work on Milestone [NUMBER: NAME] only. First inspect the current repository and verify the previous milestone's exit criterion still passes.

Restate this milestone's required scope and exit criterion. List the files you plan to change. Implement the smallest complete vertical slice, preserving these invariants: the GameClock is authoritative; flights never wait for player readiness; each bag has exactly one authoritative location; wrong actions are allowed and become consequences; rendering/UI do not own simulation rules; gameplay randomness uses the seeded RNG.

Add or update tests for all changed schedule, scoring, and containment logic. Run tests and a browser smoke check. Update README/changelog. Stop after this milestone and report what works, test results, limitations, and any tuning questions. Do not start a later milestone.
```

### Prompt C: Phase 1 audit

```text
Audit the current Airport Baggage Crew browser build against Section 29, Phase 1 Acceptance Criteria, of the Master GDD. Do not add post-MVP content.

For every criterion, mark PASS, FAIL, or NOT VERIFIED and cite the implementation or test evidence. Reproduce failures where possible. Fix all Phase 1 blockers and high-impact usability issues, add regression tests, and rerun the complete audit. Specifically stress: no-input shift completion; wrong-aircraft loads; missed bags; pause at a flight boundary; restart cleanliness; browser tab suspension; bag location uniqueness; 100-bag performance; and cross-browser launch.

Return the final acceptance matrix, test results, remaining non-blocking limitations, and exact launch instructions. Do not claim completion while any required criterion is failed or unverified.
```

### Prompt D: Balance pass after functional completion

```text
Perform a Phase 1 balance and readability pass on Airport Baggage Crew. The feature set is locked: do not add arrivals, connections, weather, failures, campaign systems, multiplayer, new airports, or new vehicle types.

Tune the authored three-flight shift so a new but attentive solo player can understand the loop, feel rising pressure, make recoverable mistakes, and complete roughly 75–90% of bags, while practiced play can approach perfection. Inspect bag spawn peaks, travel time, cart capacity, hold-close warnings, priority timing, and UI legibility. Preserve the rule that flights depart on schedule regardless of readiness.

Make tuning data centralized and document every changed value. Run deterministic simulations and uncoached playtests if available. Report observed problems, changes, evidence, and remaining hypotheses separately.
```

### Prompt E: Begin post-MVP vertical slice

```text
The Phase 1 acceptance audit is complete and approved. Propose—but do not yet implement—the smallest post-MVP vertical slice adding arrivals, connecting/rush bags, and aircraft turnaround while reusing the existing physical verbs.

Identify required data model changes, new state transitions, UI additions, tests, migration concerns, and networking implications. Keep contracts, economy, weather, nightmare events, lost-baggage warehouse, and online multiplayer out of this slice. Preserve backwards compatibility with the existing authored departure shift. Provide a staged plan with exit criteria and call out any decision that requires approval under the Master GDD.
```

---

## 33. Final Product Test

At every stage, ask:

- Can a newcomer understand the useful verbs immediately?
- Does the airport continue without asking permission?
- Can a bad decision create a funny, worsening, but still playable problem?
- Are players solving logistics in the world rather than in menus?
- Can anyone abandon their current job and take over another?
- Is urgency understandable before it becomes a penalty?
- Does added content create new coordination problems rather than mere stat inflation?

If the answer to these remains yes, the game can scale from a tiny regional baggage room to a sprawling international operation without losing its identity.

---

## 34. One-Sentence North Star

> **Airport Baggage Crew is a game where simple physical work becomes hilarious logistical panic because the airport keeps operating whether the players are ready or not.**

---

## 35. Milestone 10 — The Suites Are Tested Too

**Authored after the fact (2026-08-24), like §28.5 below it.** §28's roadmap ends at
Milestone 6 and this milestone comes from a specific finding rather than from a plan: the
2026-08-21 meta-audit read all nine suites and found roughly twenty assertions that could
not fail, plus one structural hole — a green suite never proved how many assertions RAN.
The count baseline closed the structural half. **This milestone closes the other half, and
it closes it by measurement instead of by reading.**

### 35.1 The problem with auditing a test by reading it

Every hole the meta-audit found was found by eye, four agents deep, and the process caught
its own author twice more afterwards — the m9 `E5` assertion tested the labels in the
audit's own table rather than anything the game renders, and the m6 claim that `CrewBot`
never writes to state was written down as a rule in `CLAUDE.md` and checked by nothing.
Reading is not a reliable instrument for this. An assertion that cannot fail *looks
exactly like one that can*, and the ones that survive review are by definition the ones
that read most convincingly.

There is a direct measurement available, and it is the standard one: **break the code on
purpose and see whether the suite notices.** A mutation that leaves the suite green is a
hole, named, with the file and line already in hand.

### 35.2 What gets built

`tools\_mutate.ps1` — a mutation harness over a **table of deliberate reversions of real
fixes**, not of random operators. Every entry is a bug this project actually shipped or
nearly shipped, expressed as a one-line source substitution:

- the degenerate separation normal that threw a bag 181 km
- separation shoving a bag through the sort-room wall
- `recoverStuck` not re-seating the train
- each of the three renderer depth-sort bugs
- the clock running behind the title screen
- the camera readability floor
- the priority-bag penalty
- the signal-separation threshold in the accessibility audit

For each: apply, **verify the substitution matched exactly once**, run the suite, record
which assertions went red, restore the file. A mutation that matched zero times is
reported as an ERROR, never as a result — a substitution that silently did nothing is the
same disease this milestone exists to cure, worn as a tool.

### 35.3 Completion criteria (all measurable)

1. The harness runs a table of at least twelve mutations and restores every file it
   touched, including on a crash or an interrupt.
2. Every mutation is verified to have applied before its suite is run; a no-match is an
   error and fails the run.
3. Each mutation is reported **KILLED** with the assertion ids that caught it, or
   **SURVIVED** with the file it was made in.
4. Every survivor is either closed with a new assertion in the same commit, or recorded in
   this document with the reason it is allowed to survive.
5. The harness refuses to start on a dirty working tree, so a crash can never be confused
   with a source edit.
6. The kill rate is stated as a number in the README, not described as good.

### 35.4 What it found — first pass, 2026-08-24

**10 of 14 killed. Four survivors, every one a real hole, all four now closed.**

| mutation | verdict | caught by |
|---|---|---|
| degenerate separation normal | KILLED | m1 E9b, E9d, E9e |
| separated bag not pushed out of walls | KILLED | m6 D1.novice.12345 *(one seed, 3.5 min in)* |
| recover does not re-seat the train | **SURVIVED** | — |
| conveyor bags sort under the belt | KILLED | m8 A3, E7 |
| cart bags sort under the bed | KILLED | m8 E6 |
| aircraft ground pass rotates again | KILLED | m8 C1, C3 |
| clock runs behind the title screen | KILLED | m0 C3, H9 |
| camera readability floor removed | **SURVIVED** | — |
| priority miss costs no more than any other | KILLED | m4 B0.6 |
| signal separation threshold to nothing | KILLED | m9 A31 |
| walls stop blocking movement | KILLED | m6 I2 *(incidentally, 3 min in)* |
| hold becomes a radius again | KILLED | m3 B5, C10 |
| corner statistic counts keystrokes | **SURVIVED** | — |
| shift is 11 bags a flight again | **SURVIVED** | — |
| nothing ever spills *(added by §36)* | KILLED | m2 F1, F3, F5b.pre, F5b, F6a, F9 (+1) |

**Three of the four survivors are the same defect**, and it is worth naming because it is
invisible on the page: **the assertion computed its expectation from the value under
test.**

- m1 `I5` asserted the zoom equals `min(viewWidthM, cssW / MIN_PX_PER_M)` — re-derived from
  the very constant the camera used, so both sides move together and it cannot fail. `I5b`
  asked whether the scale clears `MIN_PX_PER_M`, which the mutation set to 1. Compounding
  it, the readability floor only ACTS below a ~1290 px window and every suite in this
  project renders at ~1262 px, where deleting it changes the zoom by 2%.
- m6 `A9` asserted the conveyor emits `FLIGHT_DEFS.reduce(sum of bagCount)` bags. True of
  any bag count whatsoever, including 11 a flight — outside both §20.2 and §20.4, and a
  shift a careless crew finishes in credit.
- The corner statistic survived for a subtler reason: m2 `F6c` bounds hard corners against
  spills correctly, but its scenario is a full-lock circle, which is ONE long overload
  episode, and `overLimit` is a once-per-episode latch. The keystroke artefact only appears
  across hundreds of brief corrections — which means across a played shift, which nothing
  measured.
- The fourth is different and worse: `recoverFuzz` and `recoverSpillProbe` were written
  specifically for the re-seat bug, and `tools\_soak.js` was their only caller. **Soak
  measures; it does not gate.** A prober for a known bug, sitting in a diagnostic, is not
  coverage.

**Two mutations were killed in the wrong place**, which the cost-ordered suite list makes
visible and which is worth as much as the survivors. The wall-shove bug was caught only by
a played shift on one seed at one skill level, three and a half minutes in, reporting
"nothing stranded the crew" without being able to say what did — it would go quiet on a
different seed. And disabling the x-axis branch of `moveWithWalls` — the branch holding
every doorway in the game — was caught only incidentally, by the recover test happening to
manufacture a player inside a wall. Both now have direct assertions that run in
milliseconds and name the wall.

**Closures:** m1 `E2b`/`E2c` (the other axis), `E9f`/`E9g` (separation against a wall),
`I5c.*` (an absolute pixel floor across six window widths); m3 `A0`/`A0b` (§20.2 and §20.4
as absolute ranges); m6 `D13` (§11.3 measured over a played shift), `H10`–`H12` (the
recover probers, wired into a gating suite).

**The harness had two bugs of its own**, both recorded in the script: a `.ps1` without a
UTF-8 BOM is decoded as ANSI by PS 5.1, so an em-dash inside a double-quoted string
mojibakes into a stray quote and cascades into eleven parse errors; and the first version
asked whether the whole TREE was clean at the end, which meant no other edit could be made
to the repo for the twenty minutes a sweep takes without the run ending in a false
RESTORE FAILED. The final check is now scoped to the files it actually mutated.

**Second pass, after every survivor was closed: 14 of 14** — and **15 of 15** once §36 added
`nothing-ever-spills`, which m2 kills with seven assertions. Two of them are now caught in
a different place — the wall-shove by m1 `E9f` in seconds rather than m6 `D1.novice.12345`
after three and a half minutes, and the x-axis wall branch by m1 `E2b` rather than
incidentally by m6 `I2`. When a mutation starts SURVIVING again, the assertion that used to
catch it has rotted, and the report names the suite that lost it.

---

## 36. Milestone 11 — Is Cornering A Decision?

**Authored after the fact (2026-08-24), from the README's own "Known limitations".** It is
the one design question that list marks *genuinely still open*, and it is the first time
there have been honest numbers to argue it from.

### 36.1 The question

§6.4 permits spill to be a stability score rather than physics, and it is: lateral load is
speed × yaw rate scaled by fill, and a full-lock circle at top speed empties a cart.
§11.3 counts the near-losses. The design intent behind all of it is that **hauling a full
cart fast is a gamble** — that "ease off for this corner" is a decision a player makes,
and gets wrong, and learns from.

Nobody has ever tested whether the gamble is worth taking. Measured today: the crew holds
97% throttle, spends 94% of the open run at top speed, delivers 85% of the shift, and
sheds **5.7 bags** doing it — about 11% of the load, one every two minutes. If the time
saved by driving flat out is worth more than five bags, then **easing off is never the
right play**, and the entire stability model is a cost with no decision attached to it:
flavour, not a mechanic.

That is a real possibility and the honest one to test first, because the shipped bot is
evidence FOR it. The bot drives flat out and it is the best crew this game has.

### 36.2 ⚠ The instrument cannot currently answer this

`steer` is −1, 0 or +1 and the throttle is held or not, so **`CrewBot` has no gentle
option** — it cannot ease off, so it cannot be asked whether easing off pays. This is the
same trap that made the balance telemetry wrong for two milestones: a measurement of a
choice the instrument cannot express is a measurement of the instrument.

So the first deliverable is a bot that can drive carefully, and the constraint from
`CLAUDE.md` binds absolutely: **`CrewBot` must never write to state.** m6 section J now
proves that by deep-snapshot and deep-freeze, so a careful-driving policy that reaches into
the world to slow a cart down will fail the suite rather than quietly becoming a second
implementation of the game.

### 36.3 What gets built

1. A **`careful` driving policy** in `tools\_bot.js` — a throttle ceiling derived from the
   towed load's stability margin and the turn it is about to take, expressed purely as
   fewer key presses. Read-only, like everything else the bot does.
2. A **sweep** of flat-out against careful, three seeds × three skills, reporting delivered
   percentage, points, spills, hard corners, and seconds lost to the slower policy.
3. Then the decision the sweep licenses, and only that one:
   - if careful WINS, the model is already a mechanic and the bot has been playing badly —
     which changes the balance baseline and re-opens the bag count for the third time;
   - if careful LOSES at the shipped price, sweep the price (`CONFIG` spill terms) for a
     crossover and state the value at which the gamble becomes real;
   - if there is NO price at which careful wins, that is the finding, and it means spill
     cannot be made into a decision by tuning — it needs a different cost (damaged bags,
     a re-collection trip) or it should be recorded as flavour and left alone.

### 36.4 Completion criteria (all measurable)

1. Both policies measured across at least three seeds and three skills, medians reported,
   with the seconds-lost figure separated from the bags-lost figure.
2. The crossover price stated as a NUMBER, or its absence stated with the sweep behind it.
3. An assertion that cornering has a cost a player can actually avoid — careful driving
   sheds measurably fewer bags than flat-out on the same seed. If that fails, the model is
   not responsive to the input at all, which is a more serious finding than the price.
4. The negative result, if it is one, written into the README's limitations with its
   numbers — not dropped for being unexciting.
5. `tools\_mutate.ps1` gains a mutation for whichever spill term the milestone ends up
   defending, so the conclusion cannot rot silently.

### 36.5 What it found — 2026-08-24

**Yes, for the crew that drives the most. No, for everyone else. And the first answer was
wrong because the ease-off was tuned to the wrong number.**

#### The two thresholds

`tools\m2-tests.js` F5b now sweeps a full-lock circle with ten light bags:

| speed (m/s) | 1.2 | 2.6 | 3.5 | **4.5** | 5.5 | 6.5 | 7.0 |
|---|---|---|---|---|---|---|---|
| bags shed | 0 | 0 | 0 | **4** | 7 | 8 | 9 |

⚠ **Above ~2.6 m/s stability starts DRAINING; a bag does not leave until 4.5.** Those are
two different numbers and the project had only ever written down the first. The careful
policy was built on it, so its first nine paired shifts spent time avoiding a cost that
does not exist below 4.5 — and duly measured being careful as nearly free and nearly
pointless (spills −28%, delivery −9 bags overall, dominated by one −13 outlier).

Corrected to 4.5, on the same nine pairs:

| skill | delivery, paired | points, paired | spills |
|---|---|---|---|
| novice | +0, −4, +6 | +0, −1000, +1600 | 10 → 11 |
| average | +0, +0, −1 | +0, +0, −250 | 17 → 12 |
| **veteran** | **+1, +4, +1** | **+750, +1500, +250** | **23 → 11** |

Spills across all nine: **50 → 34, −32%.** Cost of care: **0.5%–2.3% of a 692-second
shift.**

#### The answer

**Cornering is a decision, and it is a decision for the veteran.** Easing off improves that
profile on every seed — +4 points of delivery and about +900 points on the median, taking
it from −700 to +200. It is neutral for the average crew and pure noise for the novice,
whose shifts swing ±6 bags on whether a haul happens to clear a hold closure.

**No price sweep was needed, which resolves §36.4's second criterion.** That criterion asked
for the crossover spill price as a number, or its absence with the sweep behind it — and
both were conditional on careful driving LOSING at the shipped price. It does not: at
`spillLatMps2: 7.0` the veteran already gains on every seed, so there is nothing to sweep
toward. The shipped terms are left alone.

That is not a coincidence, and it retires a question the README has carried since M6:
**the veteran scored WORSE than the average crew and nobody knew why.** It hauls at six
bags instead of eight, so it makes more trips, corners far more (55 hard corners a shift
against 17), and sheds most (median 8 against 5) — and nothing in its policy accounted for
the load it was carrying. The extra trips were paying for themselves and the cornering was
taking it back.

#### What is deliberately NOT done here

**The shipped bot still drives flat out.** Making `careful` the default is a balance change,
not a bug fix, and the numbers say what it would cost: the novice median goes from −1850 to
−250 and its delivery from 47% to 59%. m6 `D5`/`D6` encode the design claim that a careless
crew does not clear the shift, and 51 bags was chosen precisely because a novice finishing
in credit turned `D6` red at 42. **Flipping the default therefore re-opens the bag count**,
which is a sweep of its own and the third time that number would have moved.

So this milestone answers its question and hands the next one a specific job, with the table
above as its starting point. §36.3 anticipated exactly this branch.
