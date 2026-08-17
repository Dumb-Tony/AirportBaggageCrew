/* Diagnostic, not a suite: how many requestAnimationFrame callbacks does headless
 * Chrome actually deliver under the flags tools\smoketest.ps1 uses?
 *   .\tools\smoketest.ps1 -Tests tools\_raf.js
 * Keep it — the answer decides how every future milestone writes its live assertions.
 */
let ticks = 0;
const tick = () => { ticks++; requestAnimationFrame(tick); };
requestAnimationFrame(tick);

let polls = 0;
const marks = [];
const poll = () => {
  polls++;
  marks.push(`poll ${String(polls).padStart(2)}  rAF ticks=${String(ticks).padStart(5)}  ` +
             `perf.now=${performance.now().toFixed(0)}  game.frames=${(window.__ABC && window.__ABC.game.frames) || 0}`);
  if (polls < 12) { setTimeout(poll, 250); return; }

  const pre = document.createElement('pre');
  pre.textContent = '==ABCTEST-BEGIN==\n' +
    marks.join('\n') +
    `\n\ntotal rAF ticks: ${ticks}\n` +
    (ticks > 50 ? 'ALL-PASS  rAF is live under the harness'
                : 'FAILURES  rAF is NOT usable under the harness') +
    '\n==ABCTEST-END==';
  document.body.appendChild(pre);
};
setTimeout(poll, 250);
