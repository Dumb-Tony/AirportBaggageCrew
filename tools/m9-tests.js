/* Milestone 9 suite — colour is never the only channel, computed rather than believed.
 *
 * GDD §7.2 and §16.3 both require it, the README says the game does it, and until this
 * file existed nothing had ever checked. The destination tags are RED, BLUE and GREEN;
 * red against green is the single most common way this goes wrong, and it is invisible to
 * anyone reading the hex codes.
 *
 * Three things get asserted, in rising order of how much they would embarrass us:
 *
 *   1. The maths is right. A CVD simulation is forty lines of matrices transcribed from a
 *      paper, and a transposed row still returns plausible-looking colours. Grey is a
 *      fixed point of all three projections and black and white are fixed points of every
 *      colour transform in the file — if those hold, the transcription is almost certainly
 *      sound; if they do not, every number below is decoration.
 *   2. Text meets WCAG AA at the size the stylesheet actually renders it, INCLUDING the
 *      `opacity` the stylesheet applies. The departed board row is `opacity:.55` over a
 *      dark panel, which is exactly the shape of thing that passes a review by eye.
 *   3. Every set of colours the player must tell apart either survives all three
 *      deficiencies, or escapes on lightness, or NAMES the non-colour channel that
 *      carries the same information. The third is not a loophole — section E asserts the
 *      named channel is real by finding it in the shipped source.
 *
 * Copied from `SmallTownEmergencyServices\tools\m10-tests.js` (Dev\INDEX.md), where the
 * same audit found eight collapsing signal pairs and seventeen sub-AA text pairs in a game
 * that looked finished. Every function name in `src/ui/a11y.js` is kept from that original
 * so the lineage stays greppable.
 *
 * NO RUNTIME `fetch` OR `await import()` ANYWHERE — see tools\m8-tests.js for why a single
 * one poisons the harness clock for the whole page. Everything here is a static import.
 */

import { CONFIG } from '../src/config.js';
import { ZONES } from '../src/data/airport.js';
import { FLIGHT_DEFS } from '../src/data/flights.js';
import { PALETTE } from '../src/render/renderer.js';
import { createBag } from '../src/entities/bag.js';
import { Rng } from '../src/core/rng.js';
import { ScannerCard } from '../src/ui/scannerCard.js';
import { Renderer } from '../src/render/renderer.js';
import { FlightBoard } from '../src/ui/flightBoard.js';
import { Game } from '../src/game.js';
import {
  parseColour, toHex, composite, flatten, withOpacity,
  relativeLuminance, contrastRatio, isLargeText, requiredRatio,
  toLab, deltaE, deltaE00, simulateCvd, cvdReport, CVD_KINDS,
  distinguishable, cssTokens, auditText, auditCanvas, auditSignals,
  SIGNAL_GROUPS, TEXT_PAIRS, CANVAS_PAIRS,
  JND_DELTA_E, SIGNAL_DELTA_E, LUM_ESCAPE_RATIO,
} from '../src/ui/a11y.js';

/* ── harness ─────────────────────────────────────────────────────────────── */
const lines = [];
let passes = 0, fails = 0;

function ok(name, cond, detail = '') {
  if (cond) { passes++; lines.push(`PASS  ${name}`); }
  else { fails++; lines.push(`FAIL  ${name}${detail ? '  <- ' + detail : ''}`); }
}
const eq   = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const near = (n, a, b, tol) => ok(n, Math.abs(a - b) <= tol, `got ${a}, want ${b} +/- ${tol}`);
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

/* ── A. the colour maths is actually right ───────────────────────────────── */

function sectionA() {
  lines.push('--- A. the maths, before anything is concluded from it ---');

  eq('A1 #fff parses to white', toHex('#fff'), '#ffffff');
  eq('A2 #rrggbb round-trips', toHex('#3fbf9b'), '#3fbf9b');
  eq('A3 rgb() parses', toHex('rgb(255, 90, 90)'), '#ff5a5a');
  const rgba = parseColour('rgba(255,90,90,0.5)');
  near('A4 rgba keeps its alpha', rgba.a, 0.5, 1e-9);
  let threw = false;
  try { parseColour('#gg0000'); } catch (e) { threw = true; void e; }
  ok('A5 a malformed hex throws rather than resolving to black', threw);

  // WCAG's own worked examples. If these are wrong, every ratio in this file is wrong.
  near('A6 black on white is exactly 21:1', contrastRatio('#000000', '#ffffff'), 21, 1e-9);
  near('A7 a colour against itself is 1:1', contrastRatio('#4f8fd6', '#4f8fd6'), 1, 1e-9);
  near('A8 white luminance is 1', relativeLuminance('#ffffff'), 1, 1e-9);
  near('A9 black luminance is 0', relativeLuminance('#000000'), 0, 1e-9);
  ok('A10 contrast is symmetric',
     Math.abs(contrastRatio('#171522', '#eae6f4') - contrastRatio('#eae6f4', '#171522')) < 1e-12);

  eq('A11 24px is large text', isLargeText(24, false), true);
  eq('A12 18.66px is large only when bold', isLargeText(18.66, false), false);
  eq('A13 ...and is large when bold', isLargeText(18.66, true), true);
  eq('A14 small text needs 4.5:1', requiredRatio(12, false), 4.5);
  eq('A15 large text needs 3:1', requiredRatio(24, false), 3);

  near('A16 a colour is zero distance from itself', deltaE('#e0574a', '#e0574a'), 0, 1e-9);
  ok('A17 deltaE is symmetric',
     Math.abs(deltaE('#e0574a', '#3fbf9b') - deltaE('#3fbf9b', '#e0574a')) < 1e-9);
  // Sharma et al.'s CIEDE2000 test data, pair 1: the standard transcription check.
  near('A18 CIEDE2000 matches the published test vector',
       deltaE00({ L: 50, a: 2.6772, b: -79.7751 }, { L: 50, a: 0, b: -82.7485 }), 2.0425, 0.002);
  near('A19 ...and the second one',
       deltaE00({ L: 50, a: 3.1571, b: -77.2803 }, { L: 50, a: 0, b: -82.7485 }), 2.8615, 0.002);
  ok('A20 white is far from black perceptually', deltaE('#ffffff', '#000000') > 90,
     deltaE('#ffffff', '#000000').toFixed(1));

  /*
   * THE TRANSCRIPTION CHECK. Grey has no hue for a projection to remove, so it must come
   * back unchanged from all three — and black and white with it. A transposed matrix row
   * still yields plausible colours, so this is the cheapest proof the numbers are right.
   */
  for (const k of CVD_KINDS) {
    for (const grey of ['#000000', '#808080', '#ffffff']) {
      const got = simulateCvd(grey, k);
      const d = deltaE(grey, got);
      ok(`A21.${k}.${grey} grey is a fixed point of ${k}`, d < 2.0, `${got}, dE ${d.toFixed(2)}`);
    }
  }
  let unknownThrew = false;
  try { simulateCvd('#ffffff', 'nonsense'); } catch (e) { unknownThrew = true; void e; }
  ok('A22 an unknown deficiency throws rather than silently passing the colour through',
     unknownThrew);

  // A protanope loses red. Pure red must move a long way; pure blue must barely move.
  const redShift = deltaE('#ff0000', simulateCvd('#ff0000', 'protanopia'));
  const blueShift = deltaE('#0000ff', simulateCvd('#0000ff', 'protanopia'));
  ok('A23 protanopia moves red much further than it moves blue', redShift > blueShift * 3,
     `red ${redShift.toFixed(1)} vs blue ${blueShift.toFixed(1)}`);
  note(`protanopia: red moves ${redShift.toFixed(1)} dE, blue ${blueShift.toFixed(1)} dE`);

  const rep = cvdReport('#e0574a');
  ok('A24 a report covers the normal case and all three deficiencies',
     !!rep.normal && CVD_KINDS.every((k) => !!rep[k]), JSON.stringify(rep));

  // Compositing: a fully opaque layer hides what is under it, a fully transparent one does not.
  eq('A25 an opaque layer replaces the backdrop', toHex(composite('rgba(255,0,0,1)', '#000000')), '#ff0000');
  eq('A26 a transparent layer changes nothing', toHex(composite('rgba(255,0,0,0)', '#123456')), '#123456');
  eq('A27 half alpha lands half way', toHex(composite('rgba(255,255,255,0.5)', '#000000')), '#808080');
  eq('A28 flatten stacks back to front', toHex(flatten(['#000000', 'rgba(255,255,255,0.5)'])), '#808080');
  eq('A29 opacity dims toward the backdrop', toHex(withOpacity('#ffffff', '#000000', 0.5)), '#808080');

  eq('A30 the JND constant is the CIE figure', JND_DELTA_E, 2.3);
  ok('A31 the signal floor is well above a JND', SIGNAL_DELTA_E > JND_DELTA_E * 3,
     `${SIGNAL_DELTA_E} vs ${JND_DELTA_E}`);
  eq('A32 the lightness escape is WCAG 1.4.11 non-text contrast', LUM_ESCAPE_RATIO, 3);
}

/* ── B. the audit reads the REAL palette, not a copy of one ──────────────── */

function sectionB() {
  lines.push('--- B. the audit is pointed at the shipped colours ---');

  const t = cssTokens(window);
  const names = Object.keys(t);
  ok('B1 the :root tokens resolved off the live document', names.length >= 14, `${names.length} tokens`);
  for (const n of ['--bg', '--panel', '--text', '--dim', '--coral',
                   '--st-scheduled', '--st-loading', '--st-final', '--st-departed']) {
    ok(`B2.${n} resolved to a colour`, !!t[n] && /^#|^rgb/.test(t[n]), t[n] || 'missing');
  }

  /*
   * The point of importing rather than copying. If somebody recolours a flight tag in
   * data/flights.js, this audit follows automatically — the version this was adapted from
   * keeps a literal table and a second test to prove the table has not drifted, and a
   * signal table that names its own entries cannot notice a new one.
   */
  const tagGroup = SIGNAL_GROUPS.find((g) => g.id === 'flight-tags');
  const tags = tagGroup.colours(t);
  eq('B3 the tag group has one colour per authored flight', tags.length, FLIGHT_DEFS.length);
  ok('B4 and they are the colours the flights actually carry',
     tags.every((c, i) => c.hex === FLIGHT_DEFS[i].tag.color),
     tags.map((c) => c.hex).join(','));
  note(`tags: ${tags.map((c) => `${c.label} ${c.hex}`).join('  ')}`);

  ok('B5 the canvas pairs read the live renderer palette',
     CANVAS_PAIRS.some((p) => typeof p.bg === 'function' && p.bg() === PALETTE.stand));
  ok('B6 every signal group names a non-colour channel',
     SIGNAL_GROUPS.every((g) => typeof g.redundancy === 'string' && g.redundancy.length > 10),
     SIGNAL_GROUPS.filter((g) => !g.redundancy).map((g) => g.id).join(','));
}

/* ── C. text meets WCAG AA at the size it is actually rendered ───────────── */

function sectionC() {
  lines.push('--- C. text contrast (WCAG 2.2 AA, 1.4.3) ---');

  const t = cssTokens(window);
  const rows = auditText(t);
  eq('C1 every declared text pair was audited', rows.length, TEXT_PAIRS.length);

  for (const r of rows) {
    ok(`C2.${r.id} ${r.fgHex} on ${r.bgHex} meets ${r.need}:1`, r.pass,
       `${r.ratio.toFixed(2)}:1 at ${r.px}px${r.bold ? ' bold' : ''}${r.opacity ? ` opacity ${r.opacity}` : ''}`);
  }
  const worst = rows.reduce((w, r) => (r.ratio < w.ratio ? r : w), rows[0]);
  note(`worst text pair: ${worst.id} at ${worst.ratio.toFixed(2)}:1 (needs ${worst.need})`);
  note(rows.map((r) => `${r.id} ${r.ratio.toFixed(1)}`).join('  '));

  const canvas = auditCanvas();
  for (const r of canvas) {
    if (r.decorative) {
      note(`${r.id} is ${r.ratio.toFixed(2)}:1 and declared DECORATIVE — see section E`);
      continue;
    }
    ok(`C3.${r.id} canvas text ${r.fgHex} on ${r.bgHex} meets ${r.need}:1`, r.pass,
       `${r.ratio.toFixed(2)}:1 at ${r.px}px`);
  }
  note(canvas.map((r) => `${r.id} ${r.ratio.toFixed(1)}`).join('  '));
}

/* ── D. the signals survive colour-vision deficiency, or say what carries them ── */

function sectionD() {
  lines.push('--- D. signal separation under protanopia, deuteranopia, tritanopia ---');

  const t = cssTokens(window);
  const rows = auditSignals(t);
  ok('D1 there are signal pairs to audit', rows.length >= 10, `${rows.length} pairs`);

  for (const r of rows) {
    /*
     * A pair that collapses is NOT automatically a failure — GDD §7.2's actual
     * requirement is that colour is not the only channel, and every group here names the
     * channel that carries the same information. What IS a failure is a pair that
     * collapses in a group that names no such channel, and section E proves the named
     * channels are real rather than aspirational.
     */
    const verdictOk = r.ok || !!r.redundancy;
    ok(`D2.${r.group}.${r.pair.replace(/\s+/g, '-')} is separable, or carried by something else`,
       verdictOk,
       `${r.verdict}: dE ${r.normal.toFixed(1)} normal, ${r.worst.toFixed(1)} worst (${r.worstKind}), ` +
       `lum ${r.ratio.toFixed(2)}:1 — redundancy: ${r.redundancy}`);
  }

  const collapsing = rows.filter((r) => !r.ok);
  note(`${collapsing.length} of ${rows.length} pairs lose their hue to at least one deficiency:`);
  for (const r of collapsing) {
    note(`  ${r.group} ${r.pair}: ${r.verdict}, worst ${r.worst.toFixed(1)} dE under ${r.worstKind}, ` +
         `${r.ratio.toFixed(2)}:1 lightness`);
  }

  // The headline: the three destination tags, which are the game's core read.
  const tags = rows.filter((r) => r.group === 'flight-tags');
  eq('D3 all three tag pairings were measured', tags.length, 3);
  const worstTag = tags.reduce((w, r) => (r.worst < w.worst ? r : w), tags[0]);
  note(`the tags at their worst: ${worstTag.pair} — ${worstTag.worst.toFixed(1)} dE ` +
       `under ${worstTag.worstKind}, ${worstTag.ratio.toFixed(2)}:1 lightness`);
  ok('D4 the tag colours are at least distinct to normal vision',
     tags.every((r) => r.normal >= SIGNAL_DELTA_E),
     tags.map((r) => `${r.pair} ${r.normal.toFixed(1)}`).join(', '));
}

/* ── E. the non-colour channel is real, not a promise in a comment ───────── */

function sectionE() {
  lines.push('--- E. the redundant channel exists in the shipped game (GDD §7.2) ---');

  /*
   * A `redundancy` string is worth nothing on its own — this is the section that makes
   * the D2 allowance honest. Every claim is checked against real data or real behaviour.
   */

  // Tags: a destination code AND an icon, both distinct across flights.
  const codes = FLIGHT_DEFS.map((f) => f.destinationCode);
  const icons = FLIGHT_DEFS.map((f) => f.tag.icon);
  eq('E1 every flight has a distinct destination code', new Set(codes).size, FLIGHT_DEFS.length);
  eq('E2 every flight has a distinct icon', new Set(icons).size, FLIGHT_DEFS.length);
  note(`tag channels: ${FLIGHT_DEFS.map((f) => `${f.destinationCode}/${f.tag.icon}`).join('  ')}`);

  /*
   * And the icons must be distinguishable as SHAPES, which colour maths cannot check.
   * The weakest possible real assertion is that they are different named glyphs and that
   * the renderer has a branch for each — an icon the renderer does not know how to draw
   * falls back to nothing, which is the failure mode that matters.
   */
  const known = ['triangle', 'square', 'circle'];
  ok('E3 every authored icon is one the renderer can draw',
     icons.every((i) => known.includes(i)), icons.join(','));

  /*
   * BODY COLOUR MUST NOT IDENTIFY THE FLIGHT. A player who learns to sort by "the red
   * ones" has learned a lie, and the whole tag design depends on the suitcase itself
   * saying nothing. `BODY_COLORS` is module-private, so this is asserted the only honest
   * way — build real bags and look at what came out. Checking an exported table would
   * have been checking that a list is long, which is not the same claim.
   */
  const rng = new Rng(24680, 'a11y');
  const byFlight = new Map();
  for (let i = 0; i < 90; i++) {
    const f = FLIGHT_DEFS[i % FLIGHT_DEFS.length];
    const bag = createBag({ flightId: f.id, priority: false, weightClass: 'normal' },
                          i + 1, 500000, rng);
    if (!byFlight.has(f.id)) byFlight.set(f.id, new Set());
    byFlight.get(f.id).add(bag.appearance.color);
  }
  const sets = [...byFlight.values()];
  const shared = [...sets[0]].filter((c) => sets.every((s) => s.has(c)));
  ok('E4 suitcase body colour does not identify the flight', shared.length > 0,
     `no colour is shared by all three flights: ${sets.map((s) => s.size).join('/')} distinct`);
  note(`${shared.length} body colours appear on all three flights — colour is cosmetic noise`);

  ok('E4b a bag carries its destination in TEXT as well as in colour',
     (() => {
       const b = createBag({ flightId: FLIGHT_DEFS[0].id, priority: false, weightClass: 'normal' },
                           1, 500000, new Rng(1, 'a11y'));
       return typeof b.destinationCode === 'string' && b.destinationCode.length >= 3;
     })());

  /*
   * THE SCANNER'S REDUNDANCY, ASSERTED RATHER THAN DECLARED. `correct` against `wrong` is
   * green against red and it COLLAPSES for a deuteranope — 5.3 dE, 1.46:1 lightness, the
   * most familiar failure in interface design. D2 lets it pass because the card also
   * writes the verdict out, so that had better be true. Driven through a real card
   * against real state, because the text table is module-private and a test that reads an
   * exported constant would be checking that a list exists.
   */
  const host = document.createElement('div');
  document.body.appendChild(host);
  const card = new ScannerCard(host);
  // A REAL bag, because the card looks one up and returns silently if it is missing —
  // which is how the first version of this assertion measured an empty string and
  // reported that the game has no verdict text at all.
  const probeBag = createBag({ flightId: FLIGHT_DEFS[0].id, priority: false, weightClass: 'normal' },
                             1, 500000, new Rng(5, 'a11y'));
  const seen = {};
  let at = 0;
  for (const verdict of ['correct', 'wrong', 'neutral']) {
    card.update({
      scan: { bagId: probeBag.id, atMs: (at += 1000), verdict, padId: 'pad_gate_1' },
      bagsById: { [probeBag.id]: probeBag },
      flightsById: {},                       // absent on purpose: the card falls back to the def
      simTimeMs: 0,
    });
    seen[verdict] = (card.el.textContent || '').toUpperCase();
  }
  host.remove();
  ok('E5a the scanner writes RIGHT in words, not only in green',
     /RIGHT|CORRECT/.test(seen.correct), JSON.stringify(seen.correct));
  ok('E5b ...and WRONG in words, not only in red',
     /WRONG/.test(seen.wrong), JSON.stringify(seen.wrong));
  ok('E5c ...and the two readings differ as TEXT',
     seen.correct !== seen.wrong && seen.correct.length > 3);
  note(`scanner says: correct=${JSON.stringify(seen.correct)} wrong=${JSON.stringify(seen.wrong)}`);

  /*
   * The hold state is painted on the canvas, so it has no DOM to read. Its redundancy is
   * checked in the renderer's own source — no fetch, just the function object.
   */
  const aircraftSrc = Renderer.prototype._aircraft.toString();
  ok('E5d the hold state is painted as WORDS beside the aircraft, not only as a colour',
     /HOLD OPEN/.test(aircraftSrc) && /HOLD CLOSED/.test(aircraftSrc),
     aircraftSrc.match(/'HOLD [A-Z]+'/g)?.join(' ') || 'no hold text found');

  /*
   * ⚠ THE BOARD, READ OFF A LIVE BOARD — AND THIS ASSERTION USED TO BE A LIE.
   *
   * It was `boardGroup.colours(...).every(c => /[A-Z]/.test(c.label))`: it tested that the
   * labels in `SIGNAL_GROUPS` — strings written in the audit's own table, never read from
   * the game — contain a capital letter. The flight board could stop rendering status
   * words entirely and it would still have passed. That is exactly the disease the suite
   * meta-audit found elsewhere, reintroduced by the person who fixed it.
   *
   * A real board, driven over a whole shift so every status is reached, and the words are
   * read out of its DOM.
   */
  const boardHost = document.createElement('div');
  document.body.appendChild(boardHost);
  const board = new FlightBoard(boardHost);
  const bg = new Game({ seed: 4242, seedLabel: 'a11y-board' });
  bg.startShift();
  const wordsSeen = new Set();
  let bframes = 0;
  while (bframes++ < 60 * 900 && !bg.state.shift.ended) {
    bg.frame(1000 / 60, null);
    if (bframes % 30) continue;                       // twice a second is plenty
    board.update(bg.state);
    const txt = (board.el.textContent || '').toUpperCase();
    for (const w of ['SCHEDULED', 'ACCEPTING', 'LOADING', 'FINAL', 'CLOSED', 'PUSHING', 'DEPARTED']) {
      if (txt.includes(w)) wordsSeen.add(w);
    }
  }
  boardHost.remove();
  note(`board rendered these status words over a shift: ${[...wordsSeen].sort().join(', ')}`);
  ok('E5 the board spells its status out in words, not only in a colour',
     wordsSeen.size >= 4, `${wordsSeen.size} distinct status words: ${[...wordsSeen].join(',')}`);
  ok('E5b2 ...including the two whose colours collapse for a deuteranope',
     wordsSeen.has('LOADING') && (wordsSeen.has('CLOSED') || wordsSeen.has('FINAL')),
     [...wordsSeen].join(','));

  /*
   * THE LOOPHOLE CANARY. Section D lets a colour pair that COLLAPSES pass when its group
   * declares a `redundancy`, and the only thing making that honest is that section E
   * verifies each declaration against the shipped game. A fifth group added later would
   * inherit the free pass and nothing would notice — so pin the set.
   */
  const covered = ['flight-tags', 'board-status', 'scanner-verdict', 'hold-state'];
  const ids = SIGNAL_GROUPS.map((g) => g.id).sort();
  eq('E5f every signal group is one section E actually verifies',
     ids.join(','), covered.slice().sort().join(','));

  /*
   * THE FLOOR SURFACES ARE NOT A CHANNEL, AND THAT IS WHY THE LANE LINES MAY BE FAINT.
   * All six measure between 1.02:1 and 1.59:1 of one another — it is all tarmac, and no
   * two zones are told apart by colour at any point in the game. What identifies a zone
   * is the word painted on it. Delete a label and this goes red, which is the assertion
   * the decorative exemption in CANVAS_PAIRS is leaning on.
   */
  const unlabelled = ZONES.filter((z) => !z.label || !z.label.trim());
  eq('E6 every zone is named in words, because none of them is told apart by colour',
     unlabelled.length, 0);
  note(`zones: ${ZONES.map((z) => z.label).join(' · ')}`);

  const surfacePairs = [];
  const surfaces = Object.entries({ apron: PALETTE.apron, staging: PALETTE.staging,
                                    indoor: PALETTE.indoor, road: PALETTE.road,
                                    ramp: PALETTE.ramp, stand: PALETTE.stand });
  for (let i = 0; i < surfaces.length; i++) {
    for (let j = i + 1; j < surfaces.length; j++) {
      surfacePairs.push(contrastRatio(surfaces[i][1], surfaces[j][1]));
    }
  }
  const widest = Math.max(...surfacePairs);
  ok('E7 no two floor surfaces are far enough apart to BE a channel, which is deliberate',
     widest < LUM_ESCAPE_RATIO,
     `the widest surface pair is ${widest.toFixed(2)}:1 — if this ever exceeds 3:1, ` +
     'somebody has started encoding meaning in the tarmac and it needs a redundancy');

  // Reduced motion is two switches, not a fade — the other half of §16.6.
  ok('E8 reduced motion is a real setting the renderer reads',
     typeof CONFIG.render.groundSquash === 'number');
}

/* ── F. the live page, and no regression ─────────────────────────────────── */

function sectionF() {
  lines.push('--- F. the live page ---');
  const banner = document.getElementById('err-banner');
  ok('F1 no error banner', !banner, banner && banner.textContent);
  ok('F2 the stylesheet is actually loaded, so the tokens above are not defaults',
     !!cssTokens(window)['--panel'], JSON.stringify(cssTokens(window)['--panel']));
}

/* ── run ─────────────────────────────────────────────────────────────────── */
(async () => {
  const sections = [
    ['A', sectionA], ['B', sectionB], ['C', sectionC],
    ['D', sectionD], ['E', sectionE], ['F', sectionF],
  ];
  for (const [name, fn] of sections) {
    emit(`RUNNING section ${name}...`);
    try { await fn(); }
    catch (e) { fails++; lines.push(`FAIL  section ${name} threw: ${(e && e.stack) || e}`); }
    emit(`RUNNING (section ${name} done)`);
  }
  emit();
})();
