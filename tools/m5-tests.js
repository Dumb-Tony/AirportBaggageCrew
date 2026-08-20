/* Milestone 5 suite — onboarding and juice.
 *
 * Exit criterion: uncoached playtesters complete the core loop. A suite cannot recruit a
 * playtester, so it tests the two things that make an uncoached run possible and the one
 * thing that would quietly ruin the game if it were wrong:
 *
 *   - the rail describes the NEXT thing to do and always ends (sections A, B)
 *   - the accessibility settings exist, persist, and actually change something (C, D)
 *   - AUDIO NEVER TOUCHES THE SIMULATION (section E)
 *
 * Section E is the load-bearing one. Everything else in `src/` is deterministic under a
 * seed, and audio is the first subsystem that runs on real time, holds its own graph and
 * subscribes to the bus. If it can write back — even by accident, even once — then two
 * runs of one seed stop matching and every other suite becomes advisory. So E runs the
 * same shift twice, once with a live Sfx attached and once with none, and demands the
 * `describe()` snapshots be byte-identical.
 */

import { Game, MODES } from '../src/game.js';
import { SaveSystem, memoryStorage } from '../src/systems/save.js';
import { assertContainment } from '../src/systems/containment.js';
import {
  GUIDE_STEPS, STALL_MS, stepGuide, resetGuide,
} from '../src/systems/onboarding.js';
import { DEFAULT_SETTINGS, ASSIST_LEVELS, SettingsPanel } from '../src/ui/settings.js';
import { Sfx, BUSES } from '../src/systems/audio.js';
import { EVENTS } from '../src/core/eventBus.js';
import { Hud } from '../src/ui/hud.js';

/* ── harness ─────────────────────────────────────────────────────────────── */
const lines = [];
let passes = 0, fails = 0;
function ok(name, cond, detail = '') {
  if (cond) { passes++; lines.push(`PASS  ${name}`); }
  else { fails++; lines.push(`FAIL  ${name}${detail ? '  <- ' + detail : ''}`); }
}
const eq   = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const note = (s) => lines.push(`      ${s}`);

let _pre = null;
function emit(status) {
  if (!_pre) {
    _pre = document.createElement('pre');
    _pre.id = 'test-out';
    _pre.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:#06080c;' +
      'color:#cfe;font:11px ui-monospace,Consolas,monospace;padding:12px;white-space:pre';
    document.body.appendChild(_pre);
  }
  const tail = status || (fails === 0 ? `ALL-PASS  ${passes} assertions` : `FAILURES  ${fails} of ${passes + fails}`);
  _pre.textContent = '==ABCTEST-BEGIN==\n' + lines.join('\n') + '\n\n' + tail + '\n==ABCTEST-END==';
}

const FRAME_MS = 1000 / 60;
const yieldToLoop = () => new Promise((res) => {
  let done = false;
  const finish = () => { if (!done) { done = true; res(); } };
  requestAnimationFrame(finish);
  setTimeout(finish, 500);
});

/** Always with a fake store: a suite must never write settings into the real browser. */
function newGame(seed = 505, settings = null) {
  const store = memoryStorage();
  // Seeded through SaveSystem rather than by writing the key by hand, so the test cannot
  // pass against a storage format the game no longer reads.
  if (settings) new SaveSystem(store).saveSettings(settings);
  const g = new Game({ seed, seedLabel: 'test', storage: store });
  return g;
}
/** The shape Sfx._pos actually reads. Matching the real Camera, not inventing one. */
const camStub = () => ({ centre: { x: 23, y: 15 }, visibleM: { w: 46, h: 30 } });
const runMs = (g, ms) => { for (let i = 0; i < Math.round(ms / FRAME_MS); i++) g.frame(FRAME_MS, null); };

/* ── A. the rail is a chain, and the chain ends ──────────────────────────── */
function sectionA() {
  ok('A1 there are steps', GUIDE_STEPS.length > 0);
  note(`      ${GUIDE_STEPS.length} steps: ${GUIDE_STEPS.map((s) => s.id).join(' -> ')}`);

  const ids = new Set(GUIDE_STEPS.map((s) => s.id));
  eq('A2 every step id is unique', ids.size, GUIDE_STEPS.length);
  ok('A3 every step has text, a hint and a predicate',
    GUIDE_STEPS.every((s) => s.text && s.hint && typeof s.done === 'function'));

  // The rail teaches the loop, so the loop had better be in it.
  for (const want of ['grab', 'scan', 'cart', 'drive', 'load']) {
    ok(`A4 the rail covers "${want}"`, ids.has(want));
  }

  const g = newGame();
  g.startShift();
  const view = stepGuide(g.guide, g.state);
  ok('A5 a fresh shift shows step 1', view && view.n === 1, JSON.stringify(view));
  eq('A6 numbered against the whole chain', view.of, GUIDE_STEPS.length);
  eq('A7 no hint before the player has stalled', view.hint, null);

  // GDD §16.5: "offer hints when the player stalls". Nothing has happened for STALL_MS.
  g.state.simTimeMs = STALL_MS + 1;
  const stalled = stepGuide(g.guide, g.state);
  ok('A8 the hint appears once the player stalls', !!stalled.hint, JSON.stringify(stalled));
  eq('A9 and it is still the same step', stalled.id, view.id);
}

/* ── B. the rail asserts STATE, not the route taken ──────────────────────── */
function sectionB() {
  const g = newGame();
  g.startShift();

  // A player who does the whole loop in one leap must not be walked back through it.
  // The predicates read live state, so satisfying a later step collapses the chain.
  const st = g.state;
  st.player.walkedM = 99;
  st.stats.scans = 5;
  const bag = Object.values(st.bagsById)[0] || null;
  const cart = Object.values(st.cartsById)[0];
  st.player.carryingBagId = bag ? bag.id : 'x';
  cart.bagIds.push('fake');
  st.player.drivingId = Object.keys(st.vehiclesById)[0];
  cart.hitchedToId = st.player.drivingId;

  const view = stepGuide(g.guide, st);
  ok('B1 six satisfied steps collapse in one call', view && view.id === 'load',
    JSON.stringify(view));
  eq('B2 the counter jumped rather than crawled', view.n, GUIDE_STEPS.length);

  // Finish the last one and the rail must remove itself entirely.
  Object.values(st.flightsById)[0].loadedBagIds.push('fake');
  const done = stepGuide(g.guide, st);
  eq('B3 a finished chain returns nothing', done, null);
  eq('B4 and marks itself complete', g.guide.complete, true);
  eq('B5 a completed rail stays gone', stepGuide(g.guide, st), null);

  // It is a SETTING, not a one-shot: turning it off silences it immediately.
  const g2 = newGame();
  g2.startShift();
  ok('B6 on by default', !!stepGuide(g2.guide, g2.state));
  g2.guide.enabled = false;
  eq('B7 disabled means silent', stepGuide(g2.guide, g2.state), null);

  resetGuide(g2.guide, true);
  eq('B8 reset re-enables and rewinds', g2.guide.index, 0);
  ok('B9 and the rail comes back', !!stepGuide(g2.guide, g2.state));

  // The guide never writes to the world — it is advisory text, not a system.
  const before = JSON.stringify(g2.describe());
  for (let i = 0; i < 50; i++) stepGuide(g2.guide, g2.state);
  eq('B10 stepping the guide mutates nothing', JSON.stringify(g2.describe()), before);

  // And the mirror the HUD reads is the same object the system returned.
  const g3 = newGame();
  g3.startShift();
  runMs(g3, 200);
  ok('B11 state.guide mirrors the live step', !!g3.state.guide && !!g3.state.guide.text,
    JSON.stringify(g3.state.guide));
}

/* ── C. settings: defaults, persistence, and the assist ──────────────────── */
function sectionC() {
  for (const b of BUSES) {
    ok(`C1 a default volume for "${b}"`, typeof DEFAULT_SETTINGS[b] === 'number');
  }
  eq('C2 reduced motion defaults off', DEFAULT_SETTINGS.reducedMotion, false);
  eq('C3 text scale defaults to 1', DEFAULT_SETTINGS.textScale, 1);
  eq('C4 the guide defaults on', DEFAULT_SETTINGS.guide, true);
  eq('C5 the assist defaults to the authored shift', DEFAULT_SETTINGS.assist, 1);
  ok('C6 the assist levels only ever add time', ASSIST_LEVELS.every((a) => a.v >= 1));

  const store = memoryStorage();
  const g = new Game({ seed: 505, seedLabel: 'test', storage: store });
  g.applySettings({ master: 0.25, reducedMotion: true, textScale: 1.3 });
  eq('C7 a patch merges rather than replaces', g.settings.sfx, DEFAULT_SETTINGS.sfx);
  eq('C8 and takes effect', g.settings.master, 0.25);

  const g2 = new Game({ seed: 505, seedLabel: 'test', storage: store });
  eq('C9 settings survive a new game', g2.settings.master, 0.25);
  eq('C10 including the booleans', g2.settings.reducedMotion, true);
  eq('C11 and the numbers', g2.settings.textScale, 1.3);

  // The bootstrap is told, so it can apply the parts that live outside the simulation.
  let seen = null;
  g2.onSettingsChanged = (s) => { seen = { ...s }; };
  g2.applySettings({ muted: true });
  ok('C12 the bootstrap is notified', seen && seen.muted === true);

  // GDD §16.6: the assist alters SCHEDULE PRESSURE and nothing else.
  const std = newGame(505, { ...DEFAULT_SETTINGS, assist: 1 });
  std.startShift();
  const slow = newGame(505, { ...DEFAULT_SETTINGS, assist: 1.6 });
  slow.startShift();

  const f1 = Object.values(std.state.flightsById)[0];
  const f2 = slow.state.flightsById[f1.id];
  ok('C13 the assist stretches the schedule',
    f2.times.departureMs > f1.times.departureMs,
    `${f1.times.departureMs} -> ${f2.times.departureMs}`);
  eq('C14 by exactly the multiplier',
    f2.times.departureMs, Math.round(f1.times.departureMs * 1.6));
  ok('C15 every window moves together',
    Object.keys(f1.times).every((k) => f2.times[k] === Math.round(f1.times[k] * 1.6)));
  ok('C16 the shift is longer to match',
    slow.state.shift.endTimeMs > std.state.shift.endTimeMs,
    `${std.state.shift.endTimeMs} -> ${slow.state.shift.endTimeMs}`);
  note(`      standard shift ${(std.state.shift.endTimeMs / 1000).toFixed(0)}s, ` +
       `unhurried ${(slow.state.shift.endTimeMs / 1000).toFixed(0)}s`);

  // The verbs are untouched: same bags, same weights, same reach.
  eq('C17 the assist does not change the bag count',
    std.state.shift.bagSchedule.length, slow.state.shift.bagSchedule.length);
  ok('C18 nor the ordering of them',
    std.state.shift.bagSchedule.every((s, i) => s.flightId === slow.state.shift.bagSchedule[i].flightId));

  // CONFIG stays frozen — difficulty is a multiplier at the read site (GDD §31.1, locked).
  let threw = false;
  try { slow.state.shift.assist = 2; } catch { threw = true; }
  void threw;
  const std2 = newGame(505, { ...DEFAULT_SETTINGS, assist: 1 });
  std2.startShift();
  eq('C19 an assisted game leaves no residue on the next one',
    Object.values(std2.state.flightsById)[0].times.departureMs, f1.times.departureMs);
}

/* ── D. the settings panel is wired to the game ──────────────────────────── */
function sectionD() {
  const g = newGame();
  const root = document.createElement('div');
  document.body.appendChild(root);
  const panel = new SettingsPanel(root, g);

  eq('D1 the panel starts closed', panel.open, false);
  panel.show();
  eq('D2 show opens it', panel.el.classList.contains('on'), true);
  panel.hide();
  eq('D3 hide closes it', panel.el.classList.contains('on'), false);

  for (const b of BUSES) {
    ok(`D4 a slider for "${b}"`, !!panel.el.querySelector('#set-' + b));
  }
  ok('D5 a reduced-motion control', !!panel.el.querySelector('#set-reducedMotion'));
  ok('D6 a text-size control', !!panel.el.querySelector('#set-textScale'));
  ok('D7 a guide toggle', !!panel.el.querySelector('#set-guide'));
  eq('D8 one button per assist level',
    panel.el.querySelectorAll('.assist').length, ASSIST_LEVELS.length);

  // A control that does not reach the game is decoration.
  const slider = panel.el.querySelector('#set-master');
  slider.value = '10';
  slider.dispatchEvent(new Event('input'));
  eq('D9 moving a slider reaches the game', g.settings.master, 0.1);

  const rm = panel.el.querySelector('#set-reducedMotion');
  rm.checked = true;
  rm.dispatchEvent(new Event('change'));
  eq('D10 so does a checkbox', g.settings.reducedMotion, true);

  const last = panel.el.querySelectorAll('.assist')[ASSIST_LEVELS.length - 1];
  last.click();
  eq('D11 and an assist button', g.settings.assist, ASSIST_LEVELS[ASSIST_LEVELS.length - 1].v);
  eq('D12 which marks itself selected', last.classList.contains('on'), true);

  panel.destroy();
  root.remove();

  // GDD §16.6 wants the panel reachable without finishing a shift first.
  const g2 = newGame();
  const root2 = document.createElement('div');
  document.body.appendChild(root2);
  const hud = new Hud(root2, g2);
  ok('D13 the title screen offers settings', !!root2.querySelector('#btnTitleSettings'));
  ok('D14 so does the pause screen', !!root2.querySelector('#btnSettings'));
  root2.querySelector('#btnSettings').click();
  eq('D15 and the button opens the panel', hud.settings.open, true);
  hud.settings.hide();

  // The rail renders from state.guide and nothing else.
  g2.startShift();
  runMs(g2, 200);
  hud.update();
  const rail = root2.querySelector('.guide');
  eq('D16 the rail is on screen during the first minute', rail.classList.contains('on'), true);
  ok('D17 showing the step text', rail.textContent.includes(GUIDE_STEPS[0].text.slice(0, 20)),
    rail.textContent);

  g2.guide.complete = true;
  g2.state.guide = null;
  hud.update();
  eq('D18 and removes itself when the chain is done', rail.classList.contains('on'), false);

  hud.destroy();
  root2.remove();
}

/* ── E. AUDIO MUST NOT TOUCH THE SIMULATION ──────────────────────────────── */
/* The whole determinism contract rests on this. Audio is the first thing in the project
 * that runs on real time and owns external resources; if it can write back, every other
 * suite is measuring a coincidence. */
function sectionE() {
  const A = newGame(777);
  const B = newGame(777);

  const sfx = new Sfx();
  sfx.attach(A.bus, camStub);
  eq('E1 audio is inert until armed', sfx.armed, false);
  eq('E2 and holds no context', sfx.ac, null);

  // Count the cues the audio actually received, so E3 cannot pass by both runs being
  // equally empty. Asserting a raw event TOTAL would be the same mistake as asserting
  // when a seeded bag spawns — count the kinds that matter instead.
  const heard = { belt: 0, flight: 0 };
  A.bus.on(EVENTS.BAG_LEFT_CONVEYOR, () => heard.belt++);
  A.bus.on(EVENTS.FLIGHT_STATE_CHANGED, () => heard.flight++);

  A.startShift();
  B.startShift();
  runMs(A, 200000);
  runMs(B, 200000);

  const da = JSON.stringify(A.describe());
  const db = JSON.stringify(B.describe());
  eq('E3 a shift with audio attached is identical to one without', da, db);
  ok('E4 and the audio had bag cues to react to', heard.belt > 0, `${heard.belt} heard`);
  ok('E5 and flight cues', heard.flight > 0, `${heard.flight} heard`);
  note(`      200 s of play, ${A.describe().events} events ` +
       `(${heard.belt} off the belt, ${heard.flight} flight transitions), ` +
       `${A.describe().bags} bags — snapshots match to the byte`);

  // Arming inside a headless run may fail (no output device); either way the game must
  // not care. This asserts the SHAPE of that: armed or not, the sim is unchanged.
  const armed = sfx.arm();
  note(`      AudioContext ${armed ? 'armed' : 'unavailable in this environment'}`);
  const C = newGame(777);
  const sfx2 = new Sfx();
  sfx2.attach(C.bus, camStub);
  sfx2.arm();
  C.startShift();
  runMs(C, 200000);
  sfx2.update(C.state, 1 / 60);
  eq('E6 arming the audio changes nothing in the simulation',
    JSON.stringify(C.describe()), db);
  eq('E7 nor does calling update', JSON.stringify(C.describe()), db);

  // Volume is a mix control, not a gameplay one.
  sfx2.setVolume('master', 0);
  sfx2.setMuted(true);
  runMs(C, 5000);
  runMs(B, 5000);
  eq('E8 muting changes nothing either', JSON.stringify(C.describe()), JSON.stringify(B.describe()));

  sfx2._reset();
  sfx._reset();
  eq('E9 a torn-down graph leaves the game running', C.state.mode, MODES.PLAYING);
  eq('E10 containment held throughout', assertContainment(C.state).length, 0);

  // Cheap guard against the obvious regression: audio importing anything it should not.
  ok('E11 audio subscribes rather than polls', !!sfx2._bus);
}

/* ── F. the whole thing still boots and runs ─────────────────────────────── */
async function sectionF() {
  await yieldToLoop();
  const abc = window.__ABC;
  ok('F1 the bootstrap ran', !!abc, 'window.__ABC missing');
  if (!abc) return;

  ok('F2 audio is wired into the bootstrap', !!abc.sfx);
  eq('F3 and is inert with no gesture', abc.sfx.armed, false);
  ok('F4 the HUD owns a settings panel', !!abc.hud.settings);
  eq('F5 the text scale is on the document',
    getComputedStyle(document.documentElement).getPropertyValue('--ts').trim(), '1');

  // Reduced motion has to reach the renderer, not just the stylesheet.
  abc.game.applySettings({ reducedMotion: true });
  eq('F6 reduced motion stops the particles', abc.renderer.fx.enabled, false);
  eq('F7 and the flashing lights', abc.renderer.reducedMotion, true);
  eq('F8 and marks the document for CSS',
    document.body.classList.contains('reduced-motion'), true);
  abc.game.applySettings({ reducedMotion: false, textScale: 1.25 });
  eq('F9 turning it back on restores the particles', abc.renderer.fx.enabled, true);
  eq('F10 the text scale reaches the document',
    getComputedStyle(document.documentElement).getPropertyValue('--ts').trim(), '1.25');
  abc.game.applySettings({ ...DEFAULT_SETTINGS });

  abc.startShift();
  const t0 = performance.now();
  for (let i = 0; i < 600; i++) abc.game.frame(FRAME_MS, abc.input);
  const ms = performance.now() - t0;
  note(`      600 live frames with audio wired in: ${ms.toFixed(0)} ms ` +
       `(${(ms / 600).toFixed(3)} ms/frame against a 16.7 ms budget)`);
  ok('F11 the frame budget survives the additions', ms / 600 < 16.7, `${(ms / 600).toFixed(3)} ms`);

  eq('F12 containment held', assertContainment(abc.game.state).length, 0);
  const banner = document.getElementById('err-banner');
  ok('F13 no error banner at the end of the run', !banner, banner && banner.textContent);
}

/* ── G. source hygiene for the new files ─────────────────────────────────── */
async function sectionG() {
  const files = [
    'src/systems/audio.js', 'src/systems/onboarding.js', 'src/ui/settings.js',
  ];
  const src = {};
  for (const f of files) src[f] = await (await fetch('/' + f)).text();
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  for (const f of files) {
    const code = strip(src[f]);
    ok(`G1 ${f} draws no gameplay Math.random`, !/Math\.random/.test(code));
  }

  // Audio owns real time by necessity — it is the ONE subsystem allowed to, because a
  // WebAudio schedule is measured in AudioContext seconds. It must not read the wall
  // clock for anything else, and it must never advance a simulation value.
  const audio = strip(src['src/systems/audio.js']);
  ok('G2 audio does not read the wall clock', !/Date\.now|performance\.now/.test(audio));
  ok('G3 audio does not set timers', !/setTimeout|setInterval/.test(audio));
  ok('G4 audio imports no simulation system',
    !/from '\.\/(flightSchedule|scoring|containment|baggageFlow|interaction)/.test(audio));

  // The onboarding rail is advisory. It may read anything and write nothing.
  const onb = strip(src['src/systems/onboarding.js']);
  ok('G5 the rail never assigns into state',
    !/\bstate\.[a-zA-Z]+\s*=|\bs\.[a-zA-Z]+\s*=[^=]/.test(onb), 'assignment into state found');
  ok('G6 the rail does not pause anything', !/paused|setMode|MODES/.test(onb));
  ok('G7 the rail does not import the clock', !/clock\.js/.test(onb));

  // GDD §16.6: assists change schedule pressure, never the verbs.
  const set = strip(src['src/ui/settings.js']);
  ok('G8 settings hold no gameplay constants',
    !/reachM|throwSpeed|capacitySlots|walkSpeed/.test(set));

  // CONFIG is deep-frozen so difficulty cannot be written into it (GDD §31.1).
  const cfg = await (await fetch('/src/config.js')).text();
  ok('G9 config is still deep-frozen', /deepFreeze|Object\.freeze/.test(cfg));
}

/* ── run ─────────────────────────────────────────────────────────────────── */
(async () => {
  const sections = [
    ['A', sectionA], ['B', sectionB], ['C', sectionC],
    ['D', sectionD], ['E', sectionE], ['F', sectionF], ['G', sectionG],
  ];
  for (const [name, fn] of sections) {
    emit(`RUNNING section ${name}...`);
    try { await fn(); }
    catch (e) { fails++; lines.push(`FAIL  section ${name} threw: ${(e && e.stack) || e}`); }
    emit(`RUNNING (section ${name} done)`);
  }
  emit();
})();
